from dataclasses import dataclass, field, replace
from collections.abc import Callable
from time import monotonic

from cachetools import TLRUCache

from app.core.config import DirectoryListingCacheSettings
from app.core.errors import AppError, NotFoundError, RenameOutcomeUnknownError
from app.providers.directory_metadata import DirectoryAncestry
from app.schemas.files import DirectoryBreadcrumb, DirectoryListing, FileItem, RenameFile
from app.schemas.storage import IdLocation, PathLocation, RootLocation, StorageLocation


type DirectoryKey = tuple[str, int, StorageLocation]


@dataclass(frozen=True, slots=True)
class _RenameUpdate:
    parent: StorageLocation
    original_name: str
    current: RenameFile


@dataclass(slots=True)
class RenameCacheScope:
    parents: set[StorageLocation]
    folder_ids: set[str] = field(default_factory=set)
    folder_paths: set[str] = field(default_factory=set)
    unknown_parent: bool = False
    stale_parent: bool = False
    updates: dict[str, _RenameUpdate] = field(default_factory=dict)

    def observe(
        self, file_id: str, parent: StorageLocation, original_name: str, outcome: RenameFile | AppError,
        *, target_confirmed: bool, original_path: str | None = None,
    ) -> None:
        if isinstance(outcome, RenameOutcomeUnknownError):
            self.unknown_parent = True
            return
        if isinstance(outcome, AppError):
            if isinstance(outcome, NotFoundError) or "actual_name" in outcome.details:
                self.stale_parent = True
                self.folder_ids.add(file_id)
                if original_path:
                    self.folder_paths.add(original_path)
            return
        if outcome.parent_location is not None:
            self.parents.add(outcome.parent_location)
        if outcome.is_directory or original_path is not None:
            self.folder_ids.update((file_id, outcome.id))
            if isinstance(outcome.location, IdLocation):
                self.folder_ids.add(outcome.location.value)
            if original_path:
                self.folder_paths.add(original_path)
            if outcome.path:
                self.folder_paths.add(outcome.path)
            if outcome.parent_path is not None and original_name:
                self.folder_paths.add("/".join(filter(None, (outcome.parent_path, original_name))))
        if target_confirmed:
            self.updates[file_id] = _RenameUpdate(parent, original_name, outcome)
        else:
            self.stale_parent = True


@dataclass(frozen=True, slots=True)
class _Entry:
    payload: bytes
    expires_at: float
    directory_id: str | None
    path: str
    parent: StorageLocation | None
    ancestry: DirectoryAncestry | None
    recorded_at: float

    @property
    def breadcrumb_ids(self) -> tuple[str, ...]:
        return tuple(file_id for file_id, _ in self.ancestry.chain[1:]) if self.ancestry is not None else ()


class _ListingCache(TLRUCache):
    """Notify the derived index when cachetools expires or evicts a listing."""

    def __init__(self, maxsize: int, removed: Callable[[DirectoryKey, _Entry], None]) -> None:
        super().__init__(maxsize, ttu=lambda key, entry, now: entry.expires_at, timer=lambda: monotonic())
        self._removed = removed

    def expire(self, time: float | None = None) -> list[tuple[DirectoryKey, _Entry]]:
        expired = super().expire(time)
        for key, entry in expired:
            self._removed(key, entry)
        return expired

    def popitem(self) -> tuple[DirectoryKey, _Entry]:
        key, entry = super().popitem()
        self._removed(key, entry)
        return key, entry


class DirectoryCache:
    def __init__(self, settings: DirectoryListingCacheSettings | None = None) -> None:
        settings = settings if settings is not None else DirectoryListingCacheSettings()
        self._ttl = settings.ttl
        self._empty_ttl = settings.empty_ttl
        self._ancestors: dict[tuple[str, int, str | RootLocation], set[DirectoryKey]] = {}
        self._entries = _ListingCache(settings.max_entries, self._unindex)

    def _unindex(self, key: DirectoryKey, entry: _Entry) -> None:
        if entry.ancestry is None:
            return
        for file_id in (RootLocation(), *(file_id for file_id, _ in entry.ancestry.chain)):
            index_key = (key[0], key[1], file_id)
            references = self._ancestors[index_key]
            references.remove(key)
            if not references:
                del self._ancestors[index_key]

    def _remove(self, key: DirectoryKey) -> None:
        self._entries.expire()
        entry = self._entries.pop(key, None)
        if entry is not None:
            self._unindex(key, entry)

    def _store(self, key: DirectoryKey, entry: _Entry) -> None:
        with self._entries.timer as now:
            self._remove(key)
            # A parent patch must never extend the listing's original deadline.
            if entry.expires_at <= now:
                return
            self._entries[key] = entry
            if entry.ancestry is not None:
                for file_id in (RootLocation(), *(file_id for file_id, _ in entry.ancestry.chain)):
                    self._ancestors.setdefault((key[0], key[1], file_id), set()).add(key)

    def ancestor(self, storage_id: str, revision: int, folder_id: str | RootLocation) -> DirectoryAncestry | None:
        self._entries.expire()
        index_key = (storage_id, revision, folder_id)
        references = self._ancestors.get(index_key)
        if references is None:
            return None
        candidates: list[tuple[float, DirectoryAncestry]] = []
        for key in tuple(references):
            entry = self._entries.get(key)
            if entry is None:
                # Expiration may have occurred since the initial sweep.
                self._entries.expire()
                references.discard(key)
                continue
            ancestry = entry.ancestry
            if ancestry is None:
                references.discard(key)
                continue
            ids = [file_id for file_id, _ in ancestry.chain]
            if isinstance(folder_id, RootLocation) or folder_id in ids:
                length = 1 if isinstance(folder_id, RootLocation) else ids.index(folder_id) + 1
                prefix = DirectoryAncestry(ancestry.chain[:length], ancestry.drive_id, entry.expires_at)
                candidates.append((entry.recorded_at, prefix))
            else:
                references.discard(key)
        if not references:
            self._ancestors.pop(index_key, None)
        if not candidates:
            return None
        _, newest = max(candidates, key=lambda candidate: candidate[0])
        identity = tuple(file_id for file_id, _ in newest.chain)
        if any(tuple(file_id for file_id, _ in chain.chain) != identity or chain.drive_id != newest.drive_id
               for _, chain in candidates):
            return None
        return newest

    def _find(self, key: DirectoryKey) -> tuple[DirectoryKey, _Entry | None]:
        self._entries.expire()
        entry = self._entries.get(key)
        if entry is None and isinstance(key[2], IdLocation):
            # The providers represent their canonical root as RootLocation, even for an ID request.
            root_key = (key[0], key[1], RootLocation())
            root = self._entries.get(root_key)
            if root is not None and root.directory_id == key[2].value:
                key, entry = root_key, root
        return key, entry

    def get(self, key: DirectoryKey) -> DirectoryListing | None:
        _, entry = self._find(key)
        if entry is None:
            return None
        listing = DirectoryListing.model_validate_json(entry.payload)
        if entry.ancestry is not None:
            listing.root_id = entry.ancestry.chain[0][0]
        return listing

    def expires_at(self, key: DirectoryKey) -> float | None:
        _, entry = self._find(key)
        return entry.expires_at if entry is not None else None

    @staticmethod
    def find_child_folder(parent: DirectoryListing, child_id: str) -> FileItem | None:
        return next((item for item in parent.items if item.id == child_id and item.is_directory), None)

    @staticmethod
    def get_breadcrumbs(listing: DirectoryListing) -> list[DirectoryBreadcrumb] | None:
        chain = listing.breadcrumbs
        if chain and isinstance(chain[0].location, RootLocation) and chain[-1].location == listing.location:
            return chain
        return None

    def invalidate_directory(self, key: DirectoryKey, parent: StorageLocation | None = None) -> None:
        key, entry = self._find(key)
        if isinstance(key[2], RootLocation):
            self.invalidate(key[0])
        elif isinstance(key[2], IdLocation):
            parent = parent if parent is not None else entry.parent if entry is not None else None
            self.invalidate_rename(key[0], RenameCacheScope({parent} if parent is not None else set(), {key[2].value}))

    def path_for(self, key: DirectoryKey) -> str | None:
        _, _, location = key
        if isinstance(location, RootLocation):
            return ""
        if isinstance(location, PathLocation):
            return location.value
        _, entry = self._find(key)
        return entry.path if entry is not None else None

    @classmethod
    def _listing_ancestry(cls, listing: DirectoryListing) -> DirectoryAncestry | None:
        chain = cls.get_breadcrumbs(listing)
        ancestry = None
        if chain and listing.directory_id is not None:
            # Root's opaque ID is not present in the public RootLocation breadcrumb.
            if isinstance(listing.location, RootLocation):
                root_id = listing.directory_id
            else:
                root_id = listing.root_id
            if root_id is not None and all(isinstance(crumb.location, IdLocation) for crumb in chain[1:]):
                pairs = ((root_id, chain[0].name), *((crumb.location.value, crumb.name) for crumb in chain[1:]))
                ids = [file_id for file_id, _ in pairs]
                expected_parent = (RootLocation() if len(ids) == 2 else IdLocation(value=ids[-2])) if len(ids) > 1 else None
                if (len(ids) == len(set(ids)) and ids[-1] == listing.directory_id
                        and listing.parent_location == expected_parent):
                    ancestry = DirectoryAncestry(pairs, listing.drive_id)
        return ancestry

    def reconcile_refresh(self, key: DirectoryKey, listing: DirectoryListing) -> bool:
        """A fully live chain supersedes conflicting snapshots, including parent item lists."""
        fresh = self._listing_ancestry(listing)
        if fresh is None:
            return False
        self._entries.expire()
        scope = RenameCacheScope(set())
        root_id = fresh.chain[0][0]
        for index, (folder_id, name) in enumerate(fresh.chain):
            lookup = RootLocation() if index == 0 else folder_id
            for entry_key in tuple(self._ancestors.get((key[0], key[1], lookup), ())):
                entry = self._entries.get(entry_key)
                if entry is None or entry.ancestry is None:
                    continue
                old = entry.ancestry
                if old.chain[0] != fresh.chain[0] or old.drive_id != fresh.drive_id:
                    self.invalidate(key[0])
                    return True
                old_index = next(i for i, (file_id, _) in enumerate(old.chain) if file_id == folder_id)
                if index == 0:
                    continue
                old_parent = old.chain[old_index - 1][0]
                new_parent = fresh.chain[index - 1][0]
                if old.chain[old_index][1] != name or old_parent != new_parent:
                    scope.folder_ids.add(folder_id)
                    scope.parents.update(RootLocation() if parent == root_id else IdLocation(value=parent)
                                         for parent in (old_parent, new_parent))
        if not scope.folder_ids:
            return False
        self.invalidate_rename(key[0], scope)
        return True

    def put(self, key: DirectoryKey, listing: DirectoryListing, payload: bytes, *, expires_at: float | None = None) -> None:
        ttl = self._ttl if listing.items else self._empty_ttl
        now = monotonic()
        deadline = min(now + ttl, expires_at) if expires_at is not None else now + ttl
        self._store(key, _Entry(payload, deadline, listing.directory_id, listing.path,
                                listing.parent_location, self._listing_ancestry(listing), now))

    def invalidate(self, storage_id: str | None = None) -> None:
        self._entries.expire()
        for key in [key for key in self._entries if storage_id is None or key[0] == storage_id]:
            self._remove(key)

    def finish_rename(self, storage_id: str, revision: int, scope: RenameCacheScope) -> None:
        if scope.unknown_parent:
            self.invalidate(storage_id)
        elif scope.updates or scope.stale_parent:
            self._apply_rename(storage_id, scope, patch_revision=None if scope.stale_parent else revision)

    def invalidate_rename(self, storage_id: str, scope: RenameCacheScope) -> None:
        self._apply_rename(storage_id, scope, patch_revision=None)

    def _apply_rename(self, storage_id: str, scope: RenameCacheScope, *, patch_revision: int | None) -> None:
        entries = [(key, entry) for key, entry in self._entries.items() if key[0] == storage_id]
        folder_ids = {IdLocation(value=value) for value in scope.folder_ids}
        # Path-based listings can identify a renamed ancestor via its cached folder or direct child.
        for key, entry in entries:
            if entry.breadcrumb_ids:
                continue
            if key[2] in folder_ids or entry.directory_id in scope.folder_ids:
                scope.folder_paths.add(entry.path)
            elif entry.parent in folder_ids:
                scope.folder_paths.add(entry.path.rpartition("/")[0])

        parent_ids = {parent.value for parent in scope.parents if isinstance(parent, IdLocation)}
        parent_paths = {parent.value.casefold() for parent in scope.parents if isinstance(parent, PathLocation)}
        folder_paths = {path.casefold() for path in scope.folder_paths if path}
        patchable: list[DirectoryKey] = []
        for key, entry in entries:
            path = entry.path.casefold()
            in_subtree = (
                key[2] in folder_ids or entry.directory_id in scope.folder_ids or entry.parent in folder_ids
                or scope.folder_ids.intersection(entry.breadcrumb_ids)
                or (not entry.breadcrumb_ids and any(path == folder or path.startswith(folder + "/") for folder in folder_paths))
            )
            if in_subtree:
                self._remove(key)
            elif (key[2] in scope.parents or entry.directory_id in parent_ids
                  or (not entry.breadcrumb_ids and path in parent_paths)):
                if key[1] == patch_revision:
                    patchable.append(key)
                else:
                    self._remove(key)

        for key in patchable:
            _, entry = self._find(key)
            if entry is None:
                continue
            updated = self._patch_parent(key, entry, scope.updates)
            if updated is None:
                self._remove(key)
            else:
                self._store(key, updated)

    @staticmethod
    def _patch_parent(key: DirectoryKey, entry: _Entry, updates: dict[str, _RenameUpdate]) -> _Entry | None:
        listing = DirectoryListing.model_validate_json(entry.payload)
        positions = {item.id: index for index, item in enumerate(listing.items)}
        parent_locations = {key[2]}
        if entry.directory_id is not None:
            parent_locations.add(IdLocation(value=entry.directory_id))
        for file_id, update in updates.items():
            current = update.current
            if (file_id not in positions or update.parent not in parent_locations
                    or current.parent_location not in parent_locations):
                return None
            index = positions[file_id]
            previous = listing.items[index]
            if previous.name != update.original_name or previous.is_directory != current.is_directory:
                return None
            if current.parent_path is not None and current.parent_path != previous.parent_path:
                return None
            # Single rename can confirm identity without returning browse paths.
            parent_path = previous.parent_path
            listing.items[index] = previous.model_copy(update={
                **dict(current),
                "parent_path": parent_path,
                "path": current.path if current.path is not None else "/".join(filter(None, (parent_path, current.name))),
            })
        if len({item.id for item in listing.items}) != len(listing.items):
            return None
        return replace(entry, payload=listing.model_dump_json().encode("utf-8"))
