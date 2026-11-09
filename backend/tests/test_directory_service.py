import asyncio

import pytest

from app.core.config import DirectoryListingCacheSettings
from app.core.errors import NotFoundError, ProviderError, StorageBusyError
from app.providers.base import StorageDriver
from app.providers.name_validation import NameValidationIssue
from app.schemas.files import DirectoryListing, FileItem
from app.schemas.storage import IdLocation, PathLocation, RootLocation, StorageLocation
from app.services import directory_cache
from app.services.directory_cache import DirectoryCache, RenameCacheScope
from app.services.directory_service import DirectoryService
from provider_fixtures import registry_for


class DirectoryDriver(StorageDriver):
    def __init__(self, provider_type: str = "fixture_cloud") -> None:
        self.provider_type = provider_type
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
            provider=self.provider_type, path="", parent_path=None, location=canonical,
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
    driver = DirectoryDriver()
    driver.empty = empty
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    first = await directories.list_directory("cloud", RootLocation())
    first.items.clear()
    now += ttl - 1
    # An explicit root ID shares the driver's canonical root entry.
    hit = await directories.list_directory("cloud", IdLocation(value="root-id"))
    assert len(hit.items) == (0 if empty else 1)
    assert driver.calls == 1
    now += 1
    await directories.list_directory("cloud", RootLocation())
    assert driver.calls == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", ["entries", "bytes"])
async def test_capacity_evicts_the_least_recently_used_listing(limit: str) -> None:
    driver = DirectoryDriver()
    manager = registry_for({"cloud": driver}, cache_directories=True).manager
    sample = await manager.directories.list_directory("cloud", IdLocation(value="a"), mode="fresh")
    entry_size = len(sample.model_dump_json().encode("utf-8"))
    settings = (DirectoryListingCacheSettings(max_entries=2) if limit == "entries"
                else DirectoryListingCacheSettings(max_bytes=2 * entry_size))
    directories = DirectoryService(manager, DirectoryCache(settings))
    for value in ["a", "b", "a", "c", "a", "c"]:
        await directories.list_directory("cloud", IdLocation(value=value))
    assert driver.calls == 4  # One sample and three misses.
    await directories.list_directory("cloud", IdLocation(value="b"))
    assert driver.calls == 5


@pytest.mark.asyncio
async def test_oversized_and_failed_reads_do_not_fill_cache() -> None:
    driver = DirectoryDriver()
    manager = registry_for({"cloud": driver}, cache_directories=True).manager
    driver.name = "a" * 2048
    directories = DirectoryService(manager, DirectoryCache(DirectoryListingCacheSettings(max_entry_bytes=1024)))
    for _ in range(2):
        listing = await directories.list_directory("cloud", RootLocation())
        assert listing.items[0].name == driver.name
    driver.fail = True
    with pytest.raises(ProviderError):
        await directories.list_directory("cloud", RootLocation())
    driver.fail = False
    driver.name = "small"
    for _ in range(2):
        assert (await directories.list_directory("cloud", RootLocation())).items[0].name == "small"
    assert driver.calls == 4


@pytest.mark.asyncio
async def test_path_requests_resolve_again_and_only_populate_canonical_ids() -> None:
    first_driver, second_driver = DirectoryDriver(), DirectoryDriver("fixture_other")
    second_driver.name = "other account"
    directories = registry_for({"cloud": first_driver, "other": second_driver}, cache_directories=True).manager.directories
    path = PathLocation(value="folder")
    original = await directories.list_directory("cloud", path)
    by_id = await directories.list_directory("cloud", IdLocation(value="folder"))
    other = await directories.list_directory("other", IdLocation(value="folder"))
    assert by_id == original and first_driver.calls == second_driver.calls == 1
    assert other.items[0].name == "other account"
    first_driver.path_id, first_driver.name = "replacement-id", "replacement"
    remapped = await directories.list_directory("cloud", path)
    assert remapped.location == IdLocation(value="replacement-id")
    assert remapped.items[0].name == "replacement" and first_driver.calls == 2


@pytest.mark.asyncio
async def test_provider_without_cache_capability_reads_live() -> None:
    driver = DirectoryDriver("fixture_direct")
    directories = registry_for({"direct": driver}).manager.directories
    await directories.list_directory("direct", RootLocation())
    driver.name = "changed"
    assert (await directories.list_directory("direct", RootLocation())).items[0].name == "changed"
    assert driver.calls == 2


@pytest.mark.asyncio
async def test_fresh_read_leaves_cached_listing_until_refresh() -> None:
    driver = DirectoryDriver()
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    root = RootLocation()
    cached = await directories.list_directory("cloud", root)
    driver.name = "new"
    fresh = await directories.list_directory("cloud", root, mode="fresh")
    assert fresh.items[0].name == "new"
    assert await directories.list_directory("cloud", root) == cached
    refreshed = await directories.list_directory("cloud", root, mode="refresh")
    assert await directories.list_directory("cloud", root) == refreshed == fresh
    assert driver.calls == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("interruption", ["refresh", "write"])
async def test_concurrent_misses_share_a_read_without_repopulating_after_refresh_or_write(interruption: str) -> None:
    driver = DirectoryDriver()
    manager = registry_for({"cloud": driver}, cache_directories=True).manager
    directories = manager.directories
    location = RootLocation()
    driver.pause_next = True
    first = asyncio.create_task(directories.list_directory("cloud", location))
    await asyncio.wait_for(driver.started.wait(), timeout=5)
    joined = asyncio.Event()

    async def read_again() -> DirectoryListing:
        joined.set()
        return await directories.list_directory("cloud", location)

    second = asyncio.create_task(read_again())
    try:
        await asyncio.wait_for(joined.wait(), timeout=5)
        assert driver.calls == 1
        driver.name = "updated"
        if interruption == "refresh":
            # Refresh through the root ID while a read using the root marker is still pending.
            refreshed = await directories.list_directory("cloud", IdLocation(value="root-id"), mode="refresh")
            assert refreshed.items[0].name == "updated"
        else:
            with manager.execution("cloud", 1), directories.writing("cloud", 1, RenameCacheScope({location})):
                with pytest.raises(StorageBusyError):
                    await directories.list_directory("cloud", location, mode="refresh")
    finally:
        driver.resume.set()
        original, follower = await asyncio.gather(first, second)
    assert original.items[0].name == follower.items[0].name == "original"
    original.items[0].name = "mutated"
    assert follower.items[0].name == "original"
    assert (await directories.list_directory("cloud", location)).items[0].name == "updated"
    assert driver.calls == 2


@pytest.mark.asyncio
async def test_late_not_found_does_not_evict_a_successful_refresh() -> None:
    driver = DirectoryDriver()
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    driver.pause_next = True
    driver.pause_error = NotFoundError("Directory was missing")
    old_read = asyncio.create_task(directories.list_directory("cloud", RootLocation()))
    try:
        await asyncio.wait_for(driver.started.wait(), timeout=5)
        refreshed = await directories.list_directory("cloud", IdLocation(value="root-id"), mode="refresh")
    finally:
        driver.resume.set()
        with pytest.raises(NotFoundError):
            await old_read
    assert await directories.list_directory("cloud", RootLocation()) == refreshed
    assert driver.calls == 2


@pytest.mark.asyncio
async def test_refresh_overlapping_a_write_cannot_confirm_the_directory() -> None:
    driver = DirectoryDriver()
    manager = registry_for({"cloud": driver}, cache_directories=True).manager
    directories = manager.directories
    driver.pause_next = True
    refresh = asyncio.create_task(directories.list_directory("cloud", RootLocation(), mode="refresh"))
    try:
        await asyncio.wait_for(driver.started.wait(), timeout=5)
        with manager.execution("cloud", 1), directories.writing("cloud", 1, RenameCacheScope({RootLocation()})):
            driver.name = "updated"
    finally:
        driver.resume.set()
    with pytest.raises(StorageBusyError):
        await refresh
    assert (await directories.list_directory("cloud", RootLocation())).items[0].name == "updated"


@pytest.mark.asyncio
@pytest.mark.parametrize("same_directory", [True, False])
async def test_overlapping_path_refreshes_update_their_own_canonical_entries(same_directory: bool) -> None:
    driver = DirectoryDriver()
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    driver.pause_next = True
    first = asyncio.create_task(directories.list_directory("cloud", PathLocation(value="first"), mode="refresh"))
    try:
        await asyncio.wait_for(driver.started.wait(), timeout=5)
        if not same_directory:
            driver.path_id = "other-folder"
        driver.name = "newer"
        await directories.list_directory("cloud", PathLocation(value="second"), mode="refresh")
    finally:
        driver.resume.set()
        await first
    first_directory = await directories.list_directory("cloud", IdLocation(value="folder"))
    assert first_directory.items[0].name == ("newer" if same_directory else "original")
    assert (await directories.list_directory("cloud", IdLocation(value=driver.path_id))).items[0].name == "newer"
    assert driver.calls == 2
