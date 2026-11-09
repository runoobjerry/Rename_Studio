from collections import OrderedDict
from dataclasses import dataclass, field, replace
from time import monotonic

from app.core.config import DirectoryListingCacheSettings
from app.core.errors import AppError, NotFoundError, RenameOutcomeUnknownError
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
    breadcrumb_ids: tuple[str, ...]


class DirectoryCache:
    def __init__(self, settings: DirectoryListingCacheSettings | None = None) -> None:
        settings = settings if settings is not None else DirectoryListingCacheSettings()
        self._ttl = settings.ttl
        self._empty_ttl = settings.empty_ttl
        self._max_entries = settings.max_entries
        self._max_bytes = settings.max_bytes
        self._max_entry_bytes = settings.max_entry_bytes
        self._entries: OrderedDict[DirectoryKey, _Entry] = OrderedDict()
        self._bytes = 0

    def _find(self, key: DirectoryKey) -> tuple[DirectoryKey, _Entry | None]:
        entry = self._entries.get(key)
        if entry is None and isinstance(key[2], IdLocation):
            # The providers represent their canonical root as RootLocation, even for an ID request.
            root_key = (key[0], key[1], RootLocation())
            root = self._entries.get(root_key)
            if root is not None and root.directory_id == key[2].value:
                key, entry = root_key, root
        if entry is not None and entry.expires_at <= monotonic():
            self._remove(key)
            entry = None
        return key, entry

    def get(self, key: DirectoryKey) -> DirectoryListing | None:
        key, entry = self._find(key)
        if entry is None:
            return None
        self._entries.move_to_end(key)
        return DirectoryListing.model_validate_json(entry.payload)

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

    def put(self, key: DirectoryKey, listing: DirectoryListing, payload: bytes) -> None:
        ttl = self._ttl if listing.items else self._empty_ttl
        self._store(key, _Entry(
            payload, monotonic() + ttl, listing.directory_id, listing.path, listing.parent_location,
            tuple(crumb.location.value for crumb in listing.breadcrumbs or () if isinstance(crumb.location, IdLocation)),
        ))

    def _store(self, key: DirectoryKey, entry: _Entry) -> None:
        if key in self._entries:
            self._remove(key)
        now = monotonic()
        if entry.expires_at <= now or len(entry.payload) > min(self._max_entry_bytes, self._max_bytes):
            return
        for expired_key in [key for key, entry in self._entries.items() if entry.expires_at <= now]:
            self._remove(expired_key)
        self._entries[key] = entry
        self._bytes += len(entry.payload)
        while len(self._entries) > self._max_entries or self._bytes > self._max_bytes:
            self._remove(next(iter(self._entries)))

    def invalidate(self, storage_id: str | None = None) -> None:
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

    def _remove(self, key: DirectoryKey) -> None:
        self._bytes -= len(self._entries.pop(key).payload)
