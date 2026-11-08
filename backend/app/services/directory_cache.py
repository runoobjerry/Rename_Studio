from collections import OrderedDict
from dataclasses import dataclass, field
from time import monotonic

from app.core.config import DirectoryListingCacheSettings
from app.core.errors import RenameOutcomeUnknownError
from app.schemas.files import DirectoryListing, RenameFile
from app.schemas.storage import IdLocation, PathLocation, RootLocation, StorageLocation


type DirectoryKey = tuple[str, int, StorageLocation]


@dataclass(slots=True)
class RenameCacheScope:
    parents: set[StorageLocation]
    folder_ids: set[str] = field(default_factory=set)
    folder_paths: set[str] = field(default_factory=set)
    unknown_parent: bool = False

    def observe(self, original_name: str, outcome: RenameFile | RenameOutcomeUnknownError) -> None:
        if isinstance(outcome, RenameOutcomeUnknownError):
            self.unknown_parent = True
            return
        if outcome.parent_location is not None:
            self.parents.add(outcome.parent_location)
        if outcome.is_directory:
            self.folder_ids.add(outcome.id)
            if isinstance(outcome.location, IdLocation):
                self.folder_ids.add(outcome.location.value)
            if outcome.path:
                self.folder_paths.add(outcome.path)
            if outcome.parent_path is not None and original_name:
                self.folder_paths.add("/".join(filter(None, (outcome.parent_path, original_name))))


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

    def get(self, key: DirectoryKey) -> bytes | None:
        key, entry = self._find(key)
        if entry is None:
            return None
        self._entries.move_to_end(key)
        return entry.payload

    def path_for(self, key: DirectoryKey) -> str | None:
        _, _, location = key
        if isinstance(location, RootLocation):
            return ""
        if isinstance(location, PathLocation):
            return location.value
        _, entry = self._find(key)
        return entry.path if entry is not None else None

    def put(self, key: DirectoryKey, listing: DirectoryListing, payload: bytes) -> None:
        if key in self._entries:
            self._remove(key)
        if len(payload) > min(self._max_entry_bytes, self._max_bytes):
            return
        now = monotonic()
        for expired_key in [key for key, entry in self._entries.items() if entry.expires_at <= now]:
            self._remove(expired_key)
        ttl = self._ttl if listing.items else self._empty_ttl
        self._entries[key] = _Entry(
            payload, now + ttl, listing.directory_id, listing.path, listing.parent_location,
            tuple(crumb.location.value for crumb in listing.breadcrumbs or () if isinstance(crumb.location, IdLocation)),
        )
        self._bytes += len(payload)
        while len(self._entries) > self._max_entries or self._bytes > self._max_bytes:
            self._remove(next(iter(self._entries)))

    def invalidate(self, storage_id: str | None = None) -> None:
        for key in [key for key in self._entries if storage_id is None or key[0] == storage_id]:
            self._remove(key)

    def invalidate_rename(self, storage_id: str, scope: RenameCacheScope) -> None:
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
        for key, entry in entries:
            if key[2] in scope.parents or entry.directory_id in parent_ids:
                self._remove(key)
            elif (key[2] in folder_ids or entry.directory_id in scope.folder_ids or entry.parent in folder_ids
                  or scope.folder_ids.intersection(entry.breadcrumb_ids)):
                self._remove(key)
            elif not entry.breadcrumb_ids:
                path = entry.path.casefold()
                if path in parent_paths or any(path == folder or path.startswith(folder + "/") for folder in folder_paths):
                    self._remove(key)

    def _remove(self, key: DirectoryKey) -> None:
        self._bytes -= len(self._entries.pop(key).payload)
