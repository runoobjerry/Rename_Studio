import asyncio
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

from app.core.errors import NotFoundError, PermissionDeniedError, StorageBusyError, StorageConnectionChangedError, ValidationError
from app.core.log_context import request_id_context
from app.providers.base import StorageProvider
from app.providers.directory_metadata import DirectoryHint, DirectoryMetadataConflict
from app.schemas.files import DirectoryListing, FileItem
from app.schemas.rename import SingleRenameExecuteRequest
from app.schemas.storage import IdLocation, RootLocation, StorageLocation
from app.services.directory_cache import DirectoryCache, DirectoryKey, RenameCacheScope

if TYPE_CHECKING:
    from app.services.storage_manager import StorageManager


logger = logging.getLogger("rename_studio.directory")
type DirectoryReadMode = Literal["cached", "refresh", "fresh"]
_DIRECTORY_FAILURES = (DirectoryMetadataConflict, NotFoundError, PermissionDeniedError, ValidationError)


@dataclass(eq=False, slots=True)
class _Read:
    key: DirectoryKey
    task: asyncio.Task[tuple[DirectoryListing, bytes]] | None = None
    publish: bool = True
    invalidated: bool = False
    refreshed_locations: set[StorageLocation] = field(default_factory=set)


class DirectoryService:
    def __init__(self, manager: "StorageManager", cache: DirectoryCache) -> None:
        self._manager = manager
        self._cache = cache
        self._reads: dict[_Read, None] = {}
        self._writing: set[str] = set()

    def invalidate(self, storage_id: str | None = None) -> None:
        self._cache.invalidate(storage_id)
        self._fence_reads(storage_id)
        logger.debug("directory cache invalidated storage_id=%s", storage_id)

    def invalidate_rename(self, storage_id: str, scope: RenameCacheScope) -> None:
        self._cache.invalidate_rename(storage_id, scope)
        self._fence_reads(storage_id)
        logger.debug("rename directories invalidated storage_id=%s", storage_id)

    def _fence_reads(self, storage_id: str | None, *, except_read: _Read | None = None) -> None:
        for read in self._reads:
            if read is not except_read and (storage_id is None or read.key[0] == storage_id):
                read.invalidated = True

    def single_rename_scope(self, storage_id: str, request: SingleRenameExecuteRequest) -> RenameCacheScope:
        # The request supplies only browse context. Collect cache hints without a Provider read.
        scope = RenameCacheScope({request.location}, {request.file_id})
        parent_path = self._cache.path_for((storage_id, request.revision, request.location))
        if parent_path is not None and request.original_name:
            scope.folder_paths.add("/".join(filter(None, (parent_path, request.original_name))))
        return scope

    @contextmanager
    def writing(self, storage_id: str, revision: int, scope: RenameCacheScope) -> Iterator[None]:
        # The caller holds the connection's execution lock through any write reconciliation.
        self._fence_reads(storage_id)
        self._writing.add(storage_id)
        try:
            yield
        except BaseException:
            # An interrupted execution may have submitted writes without collecting all outcomes.
            self._cache.invalidate(storage_id)
            raise
        else:
            self._cache.finish_rename(storage_id, revision, scope)
        finally:
            self._writing.remove(storage_id)

    async def list_siblings(self, storage_id: str, item: FileItem) -> list[FileItem]:
        location = StorageProvider.parent_directory(item)
        return (await self.list_directory(storage_id, location)).items

    async def list_directory(
        self, storage_id: str, location: StorageLocation, *, mode: DirectoryReadMode = "cached",
        parent_location: StorageLocation | None = None,
    ) -> DirectoryListing:
        record = self._manager.record(storage_id)
        key = (storage_id, record.revision, location)
        cache_enabled = self._manager.registry.definition(record.provider_type).cache_directories
        if cache_enabled:
            auth = self._manager.auth(storage_id, required=False)
            cache_enabled = auth is None or auth.status().connected
        # Leave old listings in place for reconciliation, hidden from reads during the write.
        if storage_id in self._writing and mode != "refresh":
            return await self._fetch(key, mode)
        if mode != "cached":
            return await self._read_live(key, mode, cache_enabled, parent_location)
        if not cache_enabled:
            return await self._fetch(key, mode)

        # Only the Provider's canonical location is cached. Aliases are resolved on each read.
        listing = self._cache.get(key)
        if listing is not None:
            logger.debug("directory cache hit storage_id=%s", storage_id)
            return listing
        for read in self._reads:
            if read.key == key and read.task is not None and read.publish and not read.invalidated:
                logger.debug("directory read joined storage_id=%s", storage_id)
                _, payload = await asyncio.shield(read.task)
                self._check_revision(key)
                return DirectoryListing.model_validate_json(payload)

        logger.debug("directory cache miss storage_id=%s", storage_id)
        read = _Read(key)
        self._reads[read] = None
        read.task = asyncio.create_task(self._fill(read, parent_location))
        read.task.add_done_callback(self._finish_fill)
        listing, _ = await asyncio.shield(read.task)
        # Authorization can change between the shared task finishing and this waiter resuming.
        self._check_revision(key)
        return listing

    async def _fetch(
        self, key: DirectoryKey, mode: DirectoryReadMode, *, hint: DirectoryHint | None = None,
    ) -> DirectoryListing:
        storage_id, revision, location = key
        logger.info("directory provider read storage_id=%s mode=%s request_id=%s",
                    storage_id, mode, request_id_context.get())
        listing = await self._manager.provider(storage_id).read_directory(
            location, hint=hint, include_breadcrumbs=mode != "fresh",
        )
        self._check_revision(key)
        return listing.model_copy(update={"storage_id": storage_id, "revision": revision})

    def _check_revision(self, key: DirectoryKey) -> None:
        if self._manager.record(key[0]).revision != key[1]:
            raise StorageConnectionChangedError("Storage changed while reading the directory")

    def _hint(self, key: DirectoryKey, parent_location: StorageLocation | None) -> DirectoryHint | None:
        location = key[2]
        if not isinstance(location, IdLocation) or parent_location is None or parent_location == location:
            return None
        parent = self._cache.get((key[0], key[1], parent_location))
        if parent is None or parent.directory_id is None or parent.location is None:
            return None
        folder = self._cache.find_child_folder(parent, location.value)
        breadcrumbs = self._cache.get_breadcrumbs(parent)
        if folder is None or breadcrumbs is None or folder.parent_location not in (
            parent.location, IdLocation(value=parent.directory_id),
        ):
            return None
        return DirectoryHint(folder, parent.directory_id, parent.location, parent.path, breadcrumbs, parent.drive_id)

    def _invalidate_failed_read(
        self, read: _Read, *, hint: DirectoryHint | None = None, parent_location: StorageLocation | None = None,
    ) -> None:
        self._check_revision(read.key)
        # A stale failure must not evict a newer refresh or a post-write listing.
        storage_id, _, location = read.key
        if (read.publish and not read.invalidated and not read.refreshed_locations
                and storage_id not in self._writing and isinstance(location, (IdLocation, RootLocation))):
            if hint is None and parent_location is not None:
                hint = self._hint(read.key, parent_location)
            self._cache.invalidate_directory(read.key, hint.parent_location if hint is not None else None)
            self._fence_reads(storage_id, except_read=read)

    async def _fill(self, read: _Read, parent_location: StorageLocation | None) -> tuple[DirectoryListing, bytes]:
        try:
            hint = self._hint(read.key, parent_location) if not read.invalidated else None
            try:
                listing = await self._fetch(read.key, "cached", hint=hint)
            except _DIRECTORY_FAILURES:
                self._invalidate_failed_read(read, hint=hint)
                if hint is None:
                    raise
                listing = await self._fetch(read.key, "cached")
            payload = listing.model_dump_json().encode("utf-8")
            self._remember(read, listing, payload)
            return listing, payload
        finally:
            del self._reads[read]

    @staticmethod
    def _finish_fill(task: asyncio.Task[tuple[DirectoryListing, bytes]]) -> None:
        # A shielded read may finish after every waiting request was cancelled.
        if not task.cancelled():
            task.exception()

    async def _read_live(
        self, key: DirectoryKey, mode: Literal["refresh", "fresh"], cache_enabled: bool,
        parent_location: StorageLocation | None,
    ) -> DirectoryListing:
        storage_id = key[0]
        if mode == "refresh":
            self._manager.ensure_mutable(storage_id)
        read = _Read(key)
        self._reads[read] = None
        try:
            try:
                listing = await self._fetch(key, mode)
            except _DIRECTORY_FAILURES:
                if cache_enabled:
                    self._invalidate_failed_read(read, parent_location=parent_location if mode == "refresh" else None)
                raise
            if mode == "fresh":
                return listing
            if read.invalidated:
                raise StorageBusyError("Directory changed during refresh; refresh again")
            canonical = self._remember(read, listing) if cache_enabled else None
            if canonical is not None:
                aliases = {key[2], canonical}
                if listing.directory_id:
                    aliases.add(IdLocation(value=listing.directory_id))
                earlier = True
                for previous in self._reads:
                    if previous is read:
                        earlier = False
                        continue
                    if previous.key[:2] != key[:2] or (not earlier and previous.task is None):
                        continue
                    # Cached fills may already have captured a parent listing from before this refresh.
                    if previous.task is not None or previous.key[2] in aliases:
                        previous.publish = False
                    else:
                        # An earlier refresh can resolve to the same canonical directory through an alias.
                        previous.refreshed_locations.add(canonical)
            return listing
        finally:
            del self._reads[read]

    def _remember(
        self, read: _Read, listing: DirectoryListing, payload: bytes | None = None,
    ) -> StorageLocation | None:
        storage_id, revision, requested = read.key
        location = listing.location or requested
        if not read.publish or read.invalidated or location in read.refreshed_locations:
            return None
        if payload is None:
            payload = listing.model_dump_json().encode("utf-8")
        self._cache.put((storage_id, revision, location), listing, payload)
        return location
