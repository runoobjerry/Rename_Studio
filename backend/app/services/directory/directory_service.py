import asyncio
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from time import perf_counter
from typing import Literal

from app.core.errors import NotFoundError, PermissionDeniedError, StorageBusyError, StorageConnectionChangedError, ValidationError
from app.providers.base import StorageDriver
from app.providers.shared.directory_metadata import AncestorLookup, DirectoryAncestry, DirectoryHint, DirectoryMetadataConflict
from app.schemas.files import DirectoryListing, FileItem
from app.schemas.storage import IdLocation, RootLocation, StorageLocation
from app.services.directory.directory_cache import DirectoryCache, DirectoryKey, RenameCacheScope
from app.services.storage.storage_manager import StorageManager


logger = logging.getLogger("rename_studio.directory")
cache_logger = logging.getLogger("rename_studio.cache")
type DirectoryReadMode = Literal["cached", "refresh", "verify", "navigate"]
_DIRECTORY_FAILURES = (DirectoryMetadataConflict, NotFoundError, PermissionDeniedError, ValidationError)


@dataclass(slots=True)
class _Read:
    key: DirectoryKey
    generation: int
    abandoned: bool = False
    borrowed: set[str] = field(default_factory=set)
    expires_at: float | None = None


@dataclass(slots=True)
class _Flight:
    read: _Read
    task: asyncio.Task[DirectoryListing]
    waiters: int = 0


class DirectoryService:
    def __init__(self, manager: StorageManager, cache: DirectoryCache) -> None:
        self._manager = manager
        self._cache = cache
        self._flights: dict[DirectoryKey, _Flight] = {}
        self._writing: set[str] = set()

    def invalidate_rename(self, storage_id: str, scope: RenameCacheScope) -> None:
        self._cache.invalidate_rename(storage_id, scope)
        self._cache.advance_generation(storage_id)
        cache_logger.debug("Rename directory entries invalidated", extra={"storage_id": storage_id})

    def _can_publish(self, read: _Read) -> bool:
        return not read.abandoned and read.generation == self._cache.generation(read.key[0])

    @contextmanager
    def writing(self, storage_id: str, revision: int, scope: RenameCacheScope) -> Iterator[None]:
        # The caller holds the connection's execution lock through any write reconciliation.
        self._cache.advance_generation(storage_id)
        self._writing.add(storage_id)
        try:
            yield
        except BaseException:
            # An interrupted execution may have submitted writes without collecting all outcomes.
            self._cache.invalidate(storage_id)
            cache_logger.debug("Directory entries invalidated after interrupted write", extra={"storage_id": storage_id})
            raise
        else:
            self._cache.finish_rename(storage_id, revision, scope)
        finally:
            self._writing.remove(storage_id)

    async def list_siblings(self, storage_id: str, item: FileItem) -> list[FileItem]:
        location = StorageDriver.parent_directory(item)
        return (await self.list_directory(storage_id, location)).items

    async def list_directory(
        self, storage_id: str, location: StorageLocation, *, mode: DirectoryReadMode = "cached",
        parent_location: StorageLocation | None = None,
    ) -> DirectoryListing:
        key = (storage_id, self._manager.revision(storage_id), location)
        cache_enabled = self._manager.directory_cache_enabled(storage_id)
        # Leave old listings in place for reconciliation, hidden from reads during the write.
        if storage_id in self._writing and mode not in ("refresh", "navigate"):
            return await self._fetch(key, mode)
        if mode != "cached":
            return await self._read_live(key, mode, cache_enabled, parent_location)
        if not cache_enabled:
            return await self._fetch(key, mode)

        # Only the Provider's canonical location is cached. Aliases are resolved on each read.
        listing = self._cache.get(key)
        if listing is not None:
            cache_logger.debug("Directory cache hit", extra={"storage_id": storage_id})
            return listing
        generation = self._cache.generation(storage_id)
        flight = self._flights.get(key)
        if flight is None or flight.read.generation != generation:
            cache_logger.debug("Directory cache miss", extra={"storage_id": storage_id})
            read = _Read(key, generation)
            task = asyncio.create_task(self._fill(read, parent_location))
            flight = _Flight(read, task)
            self._flights[key] = flight
            task.add_done_callback(lambda done: self._finish_fill(key, flight, done))
        else:
            cache_logger.debug("Joined an in-flight directory read", extra={"storage_id": storage_id})
        listing = await self._wait_read(key, flight)
        # Authorization can change between the shared task finishing and this waiter resuming.
        self._check_revision(key)
        return listing.model_copy(deep=True)

    async def _wait_read(self, key: DirectoryKey, flight: _Flight) -> DirectoryListing:
        flight.waiters += 1
        try:
            return await asyncio.shield(flight.task)
        finally:
            flight.waiters -= 1
            if flight.waiters == 0 and not flight.task.done():
                flight.read.abandoned = True
                if self._flights.get(key) is flight:
                    del self._flights[key]

    def _ancestor_lookup(self, read: _Read) -> AncestorLookup:
        def lookup(folder_id: str | RootLocation) -> DirectoryAncestry | None:
            if not self._can_publish(read):
                return None
            result = self._cache.ancestor(read.key[0], read.key[1], folder_id)
            if result is None:
                return None
            if result.expires_at is not None:
                read.expires_at = (min(read.expires_at, result.expires_at) if read.expires_at is not None
                                   else result.expires_at)
            if not isinstance(folder_id, RootLocation):
                read.borrowed.add(result.chain[-1][0])
            cache_logger.debug("Reused a cached directory ancestor", extra={"storage_id": read.key[0]})
            return result
        return lookup

    async def _fetch(
        self, key: DirectoryKey, mode: DirectoryReadMode, *, hint: DirectoryHint | None = None,
        ancestor_lookup: AncestorLookup | None = None,
    ) -> DirectoryListing:
        storage_id, revision, location = key
        started = perf_counter()
        listing = await self._manager.get_driver(storage_id).read_directory(
            location, hint=hint,
            ancestor_lookup=ancestor_lookup,
            reuse_target=mode == "cached" and ancestor_lookup is not None,
            verify=mode == "verify",
        )
        self._check_revision(key)
        logger.log(
            logging.DEBUG if mode == "verify" else logging.INFO,
            "Directory loaded successfully mode=%s item_count=%s duration_ms=%.2f",
            mode, len(listing.items), (perf_counter() - started) * 1000,
            extra={"storage_id": storage_id},
        )
        return listing.model_copy(update={"storage_id": storage_id, "revision": revision})

    def _check_revision(self, key: DirectoryKey) -> None:
        if self._manager.revision(key[0]) != key[1]:
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
        return DirectoryHint(folder, parent.directory_id, parent.location, parent.path, breadcrumbs, parent.drive_id,
                             parent.root_id or (parent.directory_id if isinstance(parent.location, RootLocation) else None))

    def _invalidate_failed_read(
        self, read: _Read, *, hint: DirectoryHint | None = None, parent_location: StorageLocation | None = None,
        preserve_cached: bool = False,
    ) -> None:
        self._check_revision(read.key)
        # A stale failure must not evict a newer refresh or a post-write listing.
        storage_id, _, location = read.key
        if self._can_publish(read) and isinstance(location, (IdLocation, RootLocation)):
            # A cache miss may race a successful read through an unknown root alias.
            if preserve_cached and self._cache.expires_at(read.key) is not None:
                return
            if hint is None and parent_location is not None:
                hint = self._hint(read.key, parent_location)
            self._cache.invalidate_directory(read.key, hint.parent_location if hint is not None else None)
            if read.borrowed:
                self._cache.invalidate_rename(storage_id, RenameCacheScope(folder_ids=read.borrowed))
            # This read owns the invalidation and may publish its unhinted retry.
            read.generation = self._cache.advance_generation(storage_id)

    async def _fill(self, read: _Read, parent_location: StorageLocation | None) -> DirectoryListing:
        hint = self._hint(read.key, parent_location) if self._can_publish(read) else None
        if hint is not None:
            read.expires_at = self._cache.expires_at((read.key[0], read.key[1], hint.parent_location))
            if read.expires_at is None:
                hint = None
        try:
            listing = await self._fetch(read.key, "cached", hint=hint, ancestor_lookup=self._ancestor_lookup(read))
        except _DIRECTORY_FAILURES:
            self._invalidate_failed_read(read, hint=hint, preserve_cached=True)
            if hint is None and not read.borrowed:
                raise
            read.expires_at = None
            listing = await self._fetch(read.key, "cached")
        self._remember(read, listing, replace_existing=False)
        return listing

    def _finish_fill(self, key: DirectoryKey, flight: _Flight, task: asyncio.Task[DirectoryListing]) -> None:
        # An older task must not remove the replacement registered under the same key.
        if self._flights.get(key) is flight:
            del self._flights[key]
        # A shielded read may fail after every waiting request was cancelled.
        if not task.cancelled():
            task.exception()

    async def _read_live(
        self, key: DirectoryKey, mode: Literal["refresh", "verify", "navigate"], cache_enabled: bool,
        parent_location: StorageLocation | None,
    ) -> DirectoryListing:
        if mode == "verify":
            return await self._fetch(key, mode)
        storage_id = key[0]
        self._manager.ensure_mutable(storage_id)
        read = _Read(key, self._cache.advance_generation(storage_id))
        try:
            listing = await self._fetch(key, mode, ancestor_lookup=self._ancestor_lookup(read)
                                        if mode == "navigate" and cache_enabled else None)
        except _DIRECTORY_FAILURES:
            if cache_enabled:
                self._invalidate_failed_read(read, parent_location=parent_location if mode == "refresh" else None)
            if mode != "navigate" or not read.borrowed:
                raise
            read.expires_at = None
            listing = await self._fetch(key, mode)
        if not self._can_publish(read):
            raise StorageBusyError("Directory changed during refresh; refresh again")
        # Reconciliation, its generation boundary, and publication are synchronous.
        if cache_enabled:
            if mode == "refresh" and self._cache.reconcile_refresh(key, listing):
                read.generation = self._cache.advance_generation(storage_id)
            self._remember(read, listing)
        return listing

    def _remember(
        self, read: _Read, listing: DirectoryListing, *, replace_existing: bool = True,
    ) -> None:
        if not self._can_publish(read):
            return
        storage_id, revision, requested = read.key
        location = listing.location or requested
        key = (storage_id, revision, location)
        # Unknown aliases can race in one generation. Keep the first valid canonical
        # snapshot rather than letting a late ordinary read overwrite it.
        if not replace_existing and self._cache.expires_at(key) is not None:
            return
        payload = listing.model_dump_json().encode("utf-8")
        self._cache.put(key, listing, payload, expires_at=read.expires_at)
