import asyncio

import pytest

from app.core.config import DirectoryListingCacheSettings
from app.core.errors import NotFoundError, ProviderError, StorageBusyError
from app.providers.base import StorageProvider
from app.providers.name_validation import NameValidationIssue
from app.schemas.files import DirectoryBreadcrumb, DirectoryListing, FileItem
from app.schemas.storage import IdLocation, PathLocation, RootLocation, StorageLocation
from app.services import directory_cache
from app.services.directory_cache import DirectoryCache, RenameCacheScope
from app.services.directory_service import DirectoryService
from provider_fixtures import registry_for


class DirectoryProvider(StorageProvider):
    def __init__(self, storage_id: str = "cloud") -> None:
        self.id = storage_id
        self.calls = 0
        self.name = "original"
        self.path_id = "folder"
        self.empty = False
        self.fail = False
        self.started, self.resume = asyncio.Event(), asyncio.Event()
        self.pause_next = False
        self.pause_error: NotFoundError | None = None

    async def list_directory(self, location: StorageLocation) -> DirectoryListing:
        self.calls += 1
        if self.fail:
            raise ProviderError("Incomplete directory")
        item = FileItem(id="item", name=self.name, path=self.name, parent_path="", is_directory=False)
        canonical = IdLocation(value=self.path_id) if isinstance(location, PathLocation) else location
        if canonical == IdLocation(value="root-id"):
            canonical = RootLocation()
        directory_id = "root-id" if isinstance(canonical, RootLocation) else canonical.value
        if self.pause_next:
            self.pause_next = False
            self.started.set()
            await self.resume.wait()
            if self.pause_error is not None:
                raise self.pause_error
        return DirectoryListing(
            provider=self.id, path="", parent_path=None, location=canonical,
            directory_id=directory_id, items=[] if self.empty else [item],
        )

    async def list_files(self, path: str) -> list[FileItem]:
        raise AssertionError("Use the directory API")

    async def get_metadata(self, file_id: str) -> FileItem:
        raise AssertionError("Use the directory API")

    async def rename(self, file_id: str, new_name: str) -> FileItem:
        raise AssertionError("This fixture only reads directories")

    def validate_name(self, name: str) -> NameValidationIssue | None:
        return None


@pytest.mark.asyncio
@pytest.mark.parametrize(("empty", "ttl"), [(False, 600), (True, 30)])
async def test_expiry_is_based_on_read_time_and_hits_are_isolated(
    monkeypatch: pytest.MonkeyPatch, empty: bool, ttl: int,
) -> None:
    now = 10
    monkeypatch.setattr(directory_cache, "monotonic", lambda: now)
    provider = DirectoryProvider()
    provider.empty = empty
    directories = registry_for([provider], cache_directories=True).manager.directories
    first = await directories.list_directory("cloud", RootLocation())
    first.items.clear()
    now += ttl - 1
    # An explicit root ID shares the Provider's canonical root entry.
    hit = await directories.list_directory("cloud", IdLocation(value="root-id"))
    assert len(hit.items) == (0 if empty else 1)
    assert provider.calls == 1
    now += 1
    await directories.list_directory("cloud", RootLocation())
    assert provider.calls == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", ["entries", "bytes"])
async def test_capacity_evicts_the_least_recently_used_listing(limit: str) -> None:
    provider = DirectoryProvider()
    manager = registry_for([provider], cache_directories=True).manager
    sample = await manager.directories.list_directory("cloud", IdLocation(value="a"), mode="fresh")
    entry_size = len(sample.model_dump_json().encode("utf-8"))
    settings = (DirectoryListingCacheSettings(max_entries=2) if limit == "entries"
                else DirectoryListingCacheSettings(max_bytes=2 * entry_size))
    directories = DirectoryService(manager, DirectoryCache(settings))
    for value in ["a", "b", "a", "c", "a", "c"]:
        await directories.list_directory("cloud", IdLocation(value=value))
    assert provider.calls == 4  # One sample and three misses.
    await directories.list_directory("cloud", IdLocation(value="b"))
    assert provider.calls == 5


@pytest.mark.asyncio
async def test_oversized_and_failed_reads_do_not_fill_cache() -> None:
    provider = DirectoryProvider()
    manager = registry_for([provider], cache_directories=True).manager
    provider.name = "a" * 2048
    directories = DirectoryService(manager, DirectoryCache(DirectoryListingCacheSettings(max_entry_bytes=1024)))
    for _ in range(2):
        listing = await directories.list_directory("cloud", RootLocation())
        assert listing.items[0].name == provider.name
    provider.fail = True
    with pytest.raises(ProviderError):
        await directories.list_directory("cloud", RootLocation())
    provider.fail = False
    provider.name = "small"
    for _ in range(2):
        assert (await directories.list_directory("cloud", RootLocation())).items[0].name == "small"
    assert provider.calls == 4


@pytest.mark.asyncio
async def test_path_requests_resolve_again_and_only_populate_canonical_ids() -> None:
    first, second = DirectoryProvider(), DirectoryProvider("other")
    second.name = "other account"
    directories = registry_for([first, second], cache_directories=True).manager.directories
    path = PathLocation(value="folder")
    original = await directories.list_directory("cloud", path)
    by_id = await directories.list_directory("cloud", IdLocation(value="folder"))
    other = await directories.list_directory("other", IdLocation(value="folder"))
    assert by_id == original and first.calls == second.calls == 1
    assert other.items[0].name == "other account"
    first.path_id, first.name = "replacement-id", "replacement"
    remapped = await directories.list_directory("cloud", path)
    assert remapped.location == IdLocation(value="replacement-id")
    assert remapped.items[0].name == "replacement" and first.calls == 2


@pytest.mark.asyncio
async def test_provider_without_cache_capability_reads_live() -> None:
    provider = DirectoryProvider("direct")
    directories = registry_for([provider]).manager.directories
    await directories.list_directory("direct", RootLocation())
    provider.name = "changed"
    assert (await directories.list_directory("direct", RootLocation())).items[0].name == "changed"
    assert provider.calls == 2


@pytest.mark.asyncio
async def test_fresh_read_leaves_cached_listing_until_refresh() -> None:
    provider = DirectoryProvider()
    directories = registry_for([provider], cache_directories=True).manager.directories
    root = RootLocation()
    cached = await directories.list_directory("cloud", root)
    provider.name = "new"
    fresh = await directories.list_directory("cloud", root, mode="fresh")
    assert fresh.items[0].name == "new"
    assert await directories.list_directory("cloud", root) == cached
    refreshed = await directories.list_directory("cloud", root, mode="refresh")
    assert await directories.list_directory("cloud", root) == refreshed == fresh
    assert provider.calls == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("interruption", ["refresh", "write"])
async def test_concurrent_misses_share_a_read_without_repopulating_after_refresh_or_write(interruption: str) -> None:
    provider = DirectoryProvider()
    manager = registry_for([provider], cache_directories=True).manager
    directories = manager.directories
    location = RootLocation()
    provider.pause_next = True
    first = asyncio.create_task(directories.list_directory("cloud", location))
    await asyncio.wait_for(provider.started.wait(), timeout=5)
    joined = asyncio.Event()

    async def read_again() -> DirectoryListing:
        joined.set()
        return await directories.list_directory("cloud", location)

    second = asyncio.create_task(read_again())
    try:
        await asyncio.wait_for(joined.wait(), timeout=5)
        assert provider.calls == 1
        provider.name = "updated"
        if interruption == "refresh":
            # Refresh through the root ID while a read using the root marker is still pending.
            refreshed = await directories.list_directory("cloud", IdLocation(value="root-id"), mode="refresh")
            assert refreshed.items[0].name == "updated"
        else:
            with manager.execution("cloud", 1), directories.writing("cloud", RenameCacheScope({location})):
                with pytest.raises(StorageBusyError):
                    await directories.list_directory("cloud", location, mode="refresh")
    finally:
        provider.resume.set()
        original, follower = await asyncio.gather(first, second)
    assert original.items[0].name == follower.items[0].name == "original"
    original.items[0].name = "mutated"
    assert follower.items[0].name == "original"
    assert (await directories.list_directory("cloud", location)).items[0].name == "updated"
    assert provider.calls == 2


@pytest.mark.asyncio
async def test_late_not_found_does_not_evict_a_successful_refresh() -> None:
    provider = DirectoryProvider()
    directories = registry_for([provider], cache_directories=True).manager.directories
    provider.pause_next = True
    provider.pause_error = NotFoundError("Directory was missing")
    old_read = asyncio.create_task(directories.list_directory("cloud", RootLocation()))
    try:
        await asyncio.wait_for(provider.started.wait(), timeout=5)
        refreshed = await directories.list_directory("cloud", IdLocation(value="root-id"), mode="refresh")
    finally:
        provider.resume.set()
        with pytest.raises(NotFoundError):
            await old_read
    assert await directories.list_directory("cloud", RootLocation()) == refreshed
    assert provider.calls == 2


@pytest.mark.asyncio
async def test_refresh_overlapping_a_write_cannot_confirm_the_directory() -> None:
    provider = DirectoryProvider()
    manager = registry_for([provider], cache_directories=True).manager
    directories = manager.directories
    provider.pause_next = True
    refresh = asyncio.create_task(directories.list_directory("cloud", RootLocation(), mode="refresh"))
    try:
        await asyncio.wait_for(provider.started.wait(), timeout=5)
        with manager.execution("cloud", 1), directories.writing("cloud", RenameCacheScope({RootLocation()})):
            provider.name = "updated"
    finally:
        provider.resume.set()
    with pytest.raises(StorageBusyError):
        await refresh
    assert (await directories.list_directory("cloud", RootLocation())).items[0].name == "updated"


@pytest.mark.asyncio
@pytest.mark.parametrize("same_directory", [True, False])
async def test_overlapping_path_refreshes_update_their_own_canonical_entries(same_directory: bool) -> None:
    provider = DirectoryProvider()
    directories = registry_for([provider], cache_directories=True).manager.directories
    provider.pause_next = True
    first = asyncio.create_task(directories.list_directory("cloud", PathLocation(value="first"), mode="refresh"))
    try:
        await asyncio.wait_for(provider.started.wait(), timeout=5)
        if not same_directory:
            provider.path_id = "other-folder"
        provider.name = "newer"
        await directories.list_directory("cloud", PathLocation(value="second"), mode="refresh")
    finally:
        provider.resume.set()
        await first
    first_directory = await directories.list_directory("cloud", IdLocation(value="folder"))
    assert first_directory.items[0].name == ("newer" if same_directory else "original")
    assert (await directories.list_directory("cloud", IdLocation(value=provider.path_id))).items[0].name == "newer"
    assert provider.calls == 2


@pytest.mark.parametrize("breadcrumbs", [False, True])
def test_folder_invalidation_evicts_its_subtree_without_evicting_unrelated_names(breadcrumbs: bool) -> None:
    cache = DirectoryCache()
    folder = IdLocation(value="folder")
    sibling_path = "Reports/deep/leaf" if breadcrumbs else "Reports-Archive/deep/leaf"
    for storage_id in ["cloud", "other"]:
        for directory_id, path, ancestor in [
            ("root-id", "", None), ("folder", "Reports", "folder"),
            ("deep", "Reports/deep/leaf", "folder"), ("unrelated", sibling_path, "unrelated-folder"),
        ]:
            location = RootLocation() if directory_id == "root-id" else IdLocation(value=directory_id)
            listing = DirectoryListing(
                provider="fixture", path=path, parent_path=None, location=location, directory_id=directory_id,
                breadcrumbs=[DirectoryBreadcrumb(name="Reports", location=IdLocation(value=ancestor))]
                if breadcrumbs and ancestor is not None else None,
            )
            cache.put((storage_id, 1, location), listing, listing.model_dump_json().encode("utf-8"))
    cache.invalidate_rename("cloud", RenameCacheScope({IdLocation(value="root-id")}, {folder.value}))
    assert cache.get(("cloud", 1, RootLocation())) is None
    assert cache.get(("cloud", 1, folder)) is None
    assert cache.get(("cloud", 1, IdLocation(value="deep"))) is None
    assert cache.get(("cloud", 1, IdLocation(value="unrelated"))) is not None
    assert cache.get(("other", 1, folder)) is not None
