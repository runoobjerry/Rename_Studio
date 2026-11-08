import asyncio
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

from app.core.errors import NotFoundError, PermissionDeniedError, StorageBusyError, StorageConnectionChangedError, ValidationError
from app.core.log_context import request_id_context
from app.providers.base import StorageProvider
from app.providers.directory_metadata import DirectoryMetadataConflict, DirectoryMetadataRead
from app.schemas.files import DirectoryListing, FileItem
from app.schemas.rename import SingleRenameExecuteRequest
from app.schemas.storage import IdLocation, PathLocation, StorageLocation
from app.services.directory_cache import DirectoryCache, DirectoryKey, RenameCacheScope
from app.services.directory_metadata_index import DirectoryMetadataIndex

if TYPE_CHECKING:
    from app.services.storage_manager import StorageManager


logger = logging.getLogger("rename_studio.directory")
type DirectoryReadMode = Literal["cached", "refresh", "fresh"]


@dataclass(eq=False, slots=True)
class _Read:
    key: DirectoryKey
    task: asyncio.Task[tuple[DirectoryListing, bytes]] | None = None
    publish: bool = True
    invalidated: bool = False
    metadata_publish: bool = True
    refreshed_locations: set[StorageLocation] = field(default_factory=set)


class DirectoryService:
    def __init__(
        self, manager: "StorageManager", cache: DirectoryCache, *, metadata: DirectoryMetadataIndex | None = None,
    ) -> None:
        self._manager = manager
        self._cache = cache
        self._metadata = metadata if metadata is not None else DirectoryMetadataIndex()
        self._reads: dict[_Read, None] = {}
        self._writing: set[str] = set()

    def invalidate(self, storage_id: str | None = None) -> None:
        self._cache.invalidate(storage_id)
        self._metadata.invalidate(storage_id)
        self._fence_reads(storage_id)
        logger.debug("directory cache invalidated storage_id=%s", storage_id)

    def invalidate_rename(self, storage_id: str, scope: RenameCacheScope) -> None:
        self._cache.invalidate_rename(storage_id, scope)
        # Rename responses can reveal a different parent only after the write.
        # Clear this connection's hints while preserving unrelated listing hits.
        self._metadata.invalidate(storage_id)
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
    def writing(self, storage_id: str, scope: RenameCacheScope) -> Iterator[None]:
        # The caller holds the connection's execution lock through any write reconciliation.
        self.invalidate_rename(storage_id, scope)
        self._writing.add(storage_id)
        try:
            yield
        finally:
            # Reads started during the write cannot populate the cache.
            if scope.unknown_parent:
                self._cache.invalidate(storage_id)
            else:
                self._cache.invalidate_rename(storage_id, scope)
            self._writing.remove(storage_id)
            logger.debug("rename directories invalidated after write storage_id=%s whole_connection=%s",
                         storage_id, scope.unknown_parent)

    async def list_siblings(self, storage_id: str, item: FileItem) -> list[FileItem]:
        location = StorageProvider.parent_directory(item)
        return (await self.list_directory(storage_id, location)).items

    async def list_directory(
        self, storage_id: str, location: StorageLocation, *, mode: DirectoryReadMode = "cached",
    ) -> DirectoryListing:
        record = self._manager.record(storage_id)
        key = (storage_id, record.revision, location)
        if mode == "fresh":
            # Track failures for invalidation even though fresh reads never publish a listing.
            read = _Read(key)
            self._reads[read] = None
            try:
                return await self._fetch(key, mode, read=read)
            finally:
                del self._reads[read]
        cache_enabled = self._manager.registry.definition(record.provider_type).cache_directories
        if cache_enabled:
            auth = self._manager.auth(storage_id, required=False)
            cache_enabled = auth is None or auth.status().connected
        if mode == "refresh":
            return await self._refresh(key, cache_enabled)
        if not cache_enabled:
            return await self._fetch(key, mode)

        # Only the Provider's canonical location is cached. Aliases are resolved on each read.
        payload = self._cache.get(key)
        if payload is not None:
            logger.debug("directory cache hit storage_id=%s", storage_id)
            return DirectoryListing.model_validate_json(payload)
        # The real parent may be discovered only in the write response. Keep existing
        # unrelated hits, but fence new fills until the write has finished.
        if storage_id in self._writing:
            return await self._fetch(key, mode)
        for read in self._reads:
            if read.key == key and read.task is not None and read.publish and not read.invalidated:
                logger.debug("directory read joined storage_id=%s", storage_id)
                _, payload = await asyncio.shield(read.task)
                self._check_revision(key)
                return DirectoryListing.model_validate_json(payload)

        logger.debug("directory cache miss storage_id=%s", storage_id)
        read = _Read(key)
        self._reads[read] = None
        read.task = asyncio.create_task(self._fill(read))
        read.task.add_done_callback(self._finish_fill)
        listing, _ = await asyncio.shield(read.task)
        # Authorization can change between the shared task finishing and this waiter resuming.
        self._check_revision(key)
        return listing

    async def _fetch(
        self, key: DirectoryKey, mode: DirectoryReadMode, *,
        metadata: DirectoryMetadataRead | None = None, read: _Read | None = None,
    ) -> DirectoryListing:
        storage_id, revision, location = key
        logger.info("directory provider read storage_id=%s mode=%s request_id=%s",
                    storage_id, mode, request_id_context.get())
        # Execution revalidation needs fresh siblings, without browsing their ancestors.
        try:
            listing = await self._manager.provider(storage_id).read_directory(
                location, metadata=metadata, include_breadcrumbs=mode != "fresh",
            )
        except (DirectoryMetadataConflict, NotFoundError, PermissionDeniedError, ValidationError) as exc:
            self._check_revision(key)
            # A late failure must not evict cache entries published by a newer refresh.
            if (read is not None and read.publish and not read.invalidated and read.metadata_publish
                    and not isinstance(location, PathLocation) and storage_id not in self._writing
                    and self._manager.registry.definition(self._manager.record(storage_id).provider_type).cache_directories):
                target_id = metadata.failure_id if metadata is not None else None
                if target_id is not None and not isinstance(exc, DirectoryMetadataConflict):
                    parent_id = self._metadata.invalidate_subtree((storage_id, revision), target_id)
                    parents = {IdLocation(value=parent_id)} if parent_id is not None else set()
                    self._cache.invalidate_rename(storage_id, RenameCacheScope(parents, {target_id}))
                    self._fence_reads(storage_id)
                else:
                    self.invalidate(storage_id)
            raise
        self._check_revision(key)
        return listing.model_copy(update={"storage_id": storage_id, "revision": revision})

    def _check_revision(self, key: DirectoryKey) -> None:
        if self._manager.record(key[0]).revision != key[1]:
            raise StorageConnectionChangedError("Storage changed while reading the directory")

    async def _fill(self, read: _Read) -> tuple[DirectoryListing, bytes]:
        try:
            metadata = self._metadata.reader(read.key[:2], use_cache=True)
            listing = await self._fetch(read.key, "cached", metadata=metadata, read=read)
            payload = listing.model_dump_json().encode("utf-8")
            self._remember(read, listing, payload, metadata)
            return listing, payload
        finally:
            del self._reads[read]

    @staticmethod
    def _finish_fill(task: asyncio.Task[tuple[DirectoryListing, bytes]]) -> None:
        # A shielded read may finish after every waiting request was cancelled.
        if not task.cancelled():
            task.exception()

    async def _refresh(self, key: DirectoryKey, cache_enabled: bool) -> DirectoryListing:
        storage_id = key[0]
        self._manager.ensure_mutable(storage_id)
        read = _Read(key)
        self._reads[read] = None
        try:
            metadata = self._metadata.reader(key[:2], use_cache=False) if cache_enabled else None
            listing = await self._fetch(key, "refresh", metadata=metadata, read=read)
            if read.invalidated:
                raise StorageBusyError("Directory changed during refresh; refresh again")
            canonical = self._remember(read, listing, None, metadata) if cache_enabled else None
            if canonical is not None:
                # An overlapping cached read may have captured an older listing through an alias.
                aliases = {key[2], canonical}
                if listing.directory_id:
                    aliases.add(IdLocation(value=listing.directory_id))
                self._metadata.fence(storage_id)
                earlier = True
                for previous in self._reads:
                    if previous is read:
                        earlier = False
                        continue
                    if previous.key[:2] != key[:2] or (not earlier and previous.task is None):
                        continue
                    # Different listings can still observe the same folder or ancestor.
                    previous.metadata_publish = False
                    if previous.key[2] in aliases:
                        previous.publish = False
                    elif isinstance(previous.key[2], PathLocation):
                        # Only the Provider knows which ID an in-flight path read will resolve to.
                        previous.refreshed_locations.add(canonical)
            return listing
        finally:
            del self._reads[read]

    def _remember(
        self, read: _Read, listing: DirectoryListing, payload: bytes | None, metadata: DirectoryMetadataRead | None,
    ) -> StorageLocation | None:
        storage_id, revision, requested = read.key
        location = listing.location or requested
        if not read.publish or read.invalidated or location in read.refreshed_locations:
            return None
        if payload is None:
            payload = listing.model_dump_json().encode("utf-8")
        if read.metadata_publish and metadata is not None and metadata.listed:
            changed, parents, root_changed = self._metadata.store((storage_id, revision), metadata)
            if changed:
                if root_changed:
                    self._cache.invalidate(storage_id)
                else:
                    self._cache.invalidate_rename(
                        storage_id, RenameCacheScope({IdLocation(value=parent) for parent in parents}, changed),
                    )
                self._fence_reads(storage_id, except_read=read)
        self._cache.put((storage_id, revision, location), listing, payload)
        return location
