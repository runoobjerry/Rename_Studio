import asyncio

import pytest

from app.core.config import DirectoryListingCacheSettings
from app.core.errors import NotFoundError, ProviderError, StorageBusyError, StorageConnectionChangedError
from app.providers.base import StorageDriver
from app.providers.name_validation import NameValidationIssue
from app.schemas.files import DirectoryBreadcrumb, DirectoryListing, FileItem, RenameFile
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
        self.is_directory = False
        self.fail = False
        self.started, self.resume = asyncio.Event(), asyncio.Event()
        self.pause_next = False
        self.pause_error: NotFoundError | None = None

    async def list_directory(self, location: StorageLocation) -> DirectoryListing:
        self.calls += 1
        if self.fail:
            raise ProviderError("Incomplete directory")
        item = FileItem(id="item", name=self.name, path=self.name, parent_path="", is_directory=self.is_directory)
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
            root_id="root-id", parent_location=None if isinstance(canonical, RootLocation) else RootLocation(),
            breadcrumbs=[DirectoryBreadcrumb(name="Root", location=RootLocation())] + (
                [] if isinstance(canonical, RootLocation) else [DirectoryBreadcrumb(name="Folder", location=canonical)]
            ),
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
    assert directories._cache.ancestor("cloud", 1, "root-id") is not None
    assert directories._cache.ancestor("cloud", 1, RootLocation()) is not None
    assert directories._cache.ancestor("other", 1, "root-id") is None
    assert directories._cache.ancestor("cloud", 2, "root-id") is None
    now += 1
    assert directories._cache.ancestor("cloud", 1, "root-id") is None
    assert directories._cache.ancestor("cloud", 1, RootLocation()) is None
    await directories.list_directory("cloud", RootLocation())
    assert driver.calls == 2


@pytest.mark.asyncio
async def test_other_storage_can_read_refresh_and_write_while_a_read_is_pending() -> None:
    first_driver, other_driver = DirectoryDriver(), DirectoryDriver("fixture_other")
    manager = registry_for({"cloud": first_driver, "other": other_driver}, cache_directories=True).manager
    directories = manager.directories
    root = RootLocation()
    first_driver.pause_next = True
    pending = asyncio.create_task(directories.list_directory("cloud", root))
    try:
        await asyncio.wait_for(first_driver.started.wait(), 5)
        await asyncio.wait_for(directories.list_directory("other", root, mode="refresh"), 5)
        with manager.execution("other", 1), directories.writing("other", 1, RenameCacheScope({root})):
            assert (await directories.list_directory("other", root)).revision == 1
        directories.invalidate("other")
        assert not pending.done()
    finally:
        first_driver.resume.set()
        original = await pending
    assert await directories.list_directory("cloud", root) == original
    assert first_driver.calls == 1


@pytest.mark.asyncio
async def test_cancelling_one_waiter_preserves_the_shared_read_and_cache() -> None:
    driver = DirectoryDriver()
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    driver.pause_next = True
    first = asyncio.create_task(directories.list_directory("cloud", RootLocation()))
    await asyncio.wait_for(driver.started.wait(), 5)
    joined = asyncio.Event()

    async def follow() -> DirectoryListing:
        joined.set()
        return await directories.list_directory("cloud", RootLocation())

    second = asyncio.create_task(follow())
    try:
        await asyncio.wait_for(joined.wait(), 5)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert not second.done()
    finally:
        driver.resume.set()
        result = await second
    assert await directories.list_directory("cloud", RootLocation()) == result
    assert not directories._flights
    assert driver.calls == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [False, True])
async def test_abandoned_shared_read_neither_publishes_nor_evicts_cache_and_cleans_up(failure: bool) -> None:
    driver = DirectoryDriver()
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    root = RootLocation()
    driver.pause_next = True
    driver.pause_error = NotFoundError("Gone") if failure else None
    pending = asyncio.create_task(directories.list_directory("cloud", root))
    await asyncio.wait_for(driver.started.wait(), 5)
    provider_task = directories._flights[("cloud", 1, root)].task
    joined = asyncio.Event()

    async def follow() -> DirectoryListing:
        joined.set()
        return await directories.list_directory("cloud", root)

    follower = asyncio.create_task(follow())
    await asyncio.wait_for(joined.wait(), 5)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert ("cloud", 1, root) in directories._flights
    follower.cancel()
    with pytest.raises(asyncio.CancelledError):
        await follower
    assert not directories._flights
    driver.resume.set()
    # Wait for the shielded task's own cleanup callback, without retrieving its exception.
    completed = asyncio.Event()
    provider_task.add_done_callback(lambda _: completed.set())
    await asyncio.wait_for(completed.wait(), 5)
    assert directories._cache.get(("cloud", 1, root)) is None
    driver.name = "fresh"
    result = await directories.list_directory("cloud", root)
    assert result.items[0].name == "fresh" and driver.calls == 2
    assert not directories._flights


@pytest.mark.asyncio
@pytest.mark.parametrize("interruption", ["refresh", "cancel"])
async def test_old_task_completion_cannot_unregister_a_replacement_flight(interruption: str) -> None:
    driver = DirectoryDriver()
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    root = RootLocation()
    driver.pause_next = True
    old = asyncio.create_task(directories.list_directory("cloud", root))
    await asyncio.wait_for(driver.started.wait(), 5)
    old_resume = driver.resume
    old_provider = directories._flights[("cloud", 1, root)].task
    if interruption == "cancel":
        old.cancel()
        with pytest.raises(asyncio.CancelledError):
            await old
    else:
        # A different live directory also advances this storage's generation.
        await directories.list_directory("cloud", IdLocation(value="other"), mode="refresh")
    driver.started, driver.resume = asyncio.Event(), asyncio.Event()
    driver.pause_next = True
    driver.name = "replacement"
    replacement = asyncio.create_task(directories.list_directory("cloud", root))
    try:
        await asyncio.wait_for(driver.started.wait(), 5)
        flight = directories._flights[("cloud", 1, root)]
        old_resume.set()
        await old_provider
        if interruption != "cancel":
            await old
        assert directories._flights[("cloud", 1, root)] is flight
        joined = asyncio.Event()

        async def follow() -> DirectoryListing:
            joined.set()
            return await directories.list_directory("cloud", root)

        follower = asyncio.create_task(follow())
        await asyncio.wait_for(joined.wait(), 5)
    finally:
        driver.resume.set()
        result = await replacement
    assert await follower == result
    assert result.items[0].name == "replacement"
    assert driver.calls == (2 if interruption == "cancel" else 3)
    assert not directories._flights


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [False, True])
async def test_unknown_root_alias_cannot_overwrite_or_evict_an_existing_canonical_result(failure: bool) -> None:
    driver = DirectoryDriver()
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    driver.pause_next = True
    driver.pause_error = NotFoundError("Old failure") if failure else None
    old = asyncio.create_task(directories.list_directory("cloud", RootLocation()))
    try:
        await asyncio.wait_for(driver.started.wait(), 5)
        driver.name = "fresh"
        latest = await directories.list_directory("cloud", IdLocation(value="root-id"))
    finally:
        driver.resume.set()
    if failure:
        with pytest.raises(NotFoundError):
            await old
    else:
        assert (await old).items[0].name == "original"
    assert await directories.list_directory("cloud", RootLocation()) == latest
    assert await directories.list_directory("cloud", IdLocation(value="root-id")) == latest
    assert driver.calls == 2


@pytest.mark.asyncio
async def test_revision_change_rejects_pending_result_without_publishing() -> None:
    driver = DirectoryDriver()
    manager = registry_for({"cloud": driver}, cache_directories=True).manager
    directories = manager.directories
    driver.pause_next = True
    old = asyncio.create_task(directories.list_directory("cloud", RootLocation()))
    try:
        await asyncio.wait_for(driver.started.wait(), 5)
        # Model the atomic connection replacement; revision remains an independent check.
        manager.state.connections["cloud"] = manager.record("cloud").model_copy(update={"revision": 2})
        driver.name = "new connection"
        latest = await directories.list_directory("cloud", RootLocation())
    finally:
        driver.resume.set()
    with pytest.raises(StorageConnectionChangedError):
        await old
    assert directories._cache.get(("cloud", 1, RootLocation())) is None
    assert await directories.list_directory("cloud", RootLocation()) == latest
    assert latest.revision == 2 and driver.calls == 2


@pytest.mark.asyncio
async def test_verify_does_not_join_or_invalidate_an_inflight_cached_read() -> None:
    driver = DirectoryDriver()
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    driver.pause_next = True
    old = asyncio.create_task(directories.list_directory("cloud", RootLocation()))
    try:
        await asyncio.wait_for(driver.started.wait(), 5)
        driver.name = "verified"
        verified = await directories.list_directory("cloud", RootLocation(), mode="verify")
        assert verified.items[0].name == "verified"
        assert directories._cache.get(("cloud", 1, RootLocation())) is None
    finally:
        driver.resume.set()
        original = await old
    assert await directories.list_directory("cloud", RootLocation()) == original
    assert original.items[0].name == "original" and driver.calls == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("is_folder", [False, True])
async def test_late_cached_read_preserves_patched_parent_and_renamed_folder_invalidation(
    monkeypatch: pytest.MonkeyPatch, is_folder: bool,
) -> None:
    now = 10
    monkeypatch.setattr(directory_cache, "monotonic", lambda: now)
    driver = DirectoryDriver()
    driver.is_directory = is_folder
    manager = registry_for({"cloud": driver}, cache_directories=True).manager
    directories = manager.directories
    root, child = RootLocation(), IdLocation(value="item")
    driver.pause_next = True
    old = asyncio.create_task(directories.list_directory("cloud", root))
    try:
        await asyncio.wait_for(driver.started.wait(), 5)
        await directories.list_directory("cloud", IdLocation(value="root-id"))
        if is_folder:
            child_listing = await directories.list_directory("cloud", child)
            # Include a deeper indexed descendant and one whose ancestry is unavailable.
            for folder_id, complete in (("grandchild", True), ("missing-ancestry", False)):
                location = IdLocation(value=folder_id)
                descendant = child_listing.model_copy(update={
                    "directory_id": folder_id, "location": location, "parent_location": child,
                    "breadcrumbs": [*child_listing.breadcrumbs, DirectoryBreadcrumb(name="Nested", location=location)]
                    if complete else None,
                })
                directories._cache.put(("cloud", 1, location), descendant, descendant.model_dump_json().encode("utf-8"))
        deadline = directories._cache.expires_at(("cloud", 1, root))
        now = 20
        scope = RenameCacheScope({root})
        with manager.execution("cloud", 1), directories.writing("cloud", 1, scope):
            driver.started.clear()
            driver.pause_next = True
            during_write = asyncio.create_task(directories.list_directory("cloud", root))
            await asyncio.wait_for(driver.started.wait(), 5)
            scope.observe("item", root, "original", RenameFile(
                id="item", name="renamed", is_directory=is_folder, parent_location=root,
            ), target_confirmed=True)
    finally:
        driver.resume.set()
    assert (await old).items[0].name == "original"
    assert (await during_write).items[0].name == "original"
    assert (await directories.list_directory("cloud", root)).items[0].name == "renamed"
    assert directories._cache.expires_at(("cloud", 1, root)) == deadline
    if is_folder:
        assert directories._cache.get(("cloud", 1, child)) is None
        for folder_id in ("grandchild", "missing-ancestry"):
            assert directories._cache.get(("cloud", 1, IdLocation(value=folder_id))) is None
        assert directories._cache.ancestor("cloud", 1, "item") is None
    assert driver.calls == (4 if is_folder else 3)


@pytest.mark.asyncio
async def test_refresh_structure_change_fences_reads_started_during_the_refresh() -> None:
    driver = DirectoryDriver()
    driver.is_directory = True
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    root, child = RootLocation(), IdLocation(value="item")
    await directories.list_directory("cloud", root)
    driver.name = "renamed folder"
    driver.pause_next = True
    refresh = asyncio.create_task(directories.list_directory("cloud", root, mode="refresh"))
    await asyncio.wait_for(driver.started.wait(), 5)
    refresh_resume = driver.resume
    driver.started, driver.resume = asyncio.Event(), asyncio.Event()
    driver.pause_next = True
    child_read = asyncio.create_task(directories.list_directory("cloud", child))
    try:
        await asyncio.wait_for(driver.started.wait(), 5)
        refresh_resume.set()
        latest = await refresh
    finally:
        driver.resume.set()
        await child_read
    assert directories._cache.get(("cloud", 1, child)) is None
    assert await directories.list_directory("cloud", root) == latest
    assert latest.items[0].name == "renamed folder" and driver.calls == 3
    # An incomplete live chain cannot establish which old ancestry remains valid.
    await directories.list_directory("cloud", child)
    incomplete = latest.model_copy(update={"directory_id": None, "breadcrumbs": None})
    assert directories._cache.reconcile_refresh(("cloud", 1, root), incomplete)
    assert directories._cache.get(("cloud", 1, root)) is None
    assert directories._cache.get(("cloud", 1, child)) is None


@pytest.mark.asyncio
async def test_capacity_evicts_the_least_recently_used_listing() -> None:
    driver = DirectoryDriver()
    manager = registry_for({"cloud": driver}, cache_directories=True).manager
    settings = DirectoryListingCacheSettings(max_entries=2)
    directories = DirectoryService(manager, DirectoryCache(settings))
    for value in ["a", "b", "a", "c", "a", "c"]:
        await directories.list_directory("cloud", IdLocation(value=value))
    assert driver.calls == 3
    assert directories._cache.ancestor("cloud", 1, "b") is None
    assert directories._cache.ancestor("cloud", 1, "a") is not None
    assert directories._cache.ancestor("cloud", 1, "c") is not None
    await directories.list_directory("cloud", IdLocation(value="b"))
    assert driver.calls == 4
    directories.invalidate_rename("cloud", RenameCacheScope(set(), {"b"}))
    assert directories._cache.ancestor("cloud", 1, "b") is None
    assert directories._cache.ancestor("cloud", 1, "root-id") is not None
    directories.invalidate("cloud")
    assert directories._cache.ancestor("cloud", 1, "root-id") is None


@pytest.mark.asyncio
async def test_failed_reads_do_not_fill_cache() -> None:
    driver = DirectoryDriver()
    manager = registry_for({"cloud": driver}, cache_directories=True).manager
    directories = manager.directories
    driver.fail = True
    with pytest.raises(ProviderError):
        await directories.list_directory("cloud", RootLocation())
    driver.fail = False
    driver.name = "small"
    for _ in range(2):
        assert (await directories.list_directory("cloud", RootLocation())).items[0].name == "small"
    assert driver.calls == 2


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
async def test_verify_read_leaves_cached_listing_until_refresh() -> None:
    driver = DirectoryDriver()
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    root = RootLocation()
    cached = await directories.list_directory("cloud", root)
    driver.name = "new"
    verified = await directories.list_directory("cloud", root, mode="verify")
    assert verified.items[0].name == "new"
    assert await directories.list_directory("cloud", root) == cached
    refreshed = await directories.list_directory("cloud", root, mode="refresh")
    assert await directories.list_directory("cloud", root) == refreshed == verified
    assert driver.calls == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("interruption", ["refresh", "navigate", "failed_refresh", "write", "invalidate", "invalidate_all"])
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
        if interruption in ("refresh", "navigate"):
            # Refresh through the root ID while a read using the root marker is still pending.
            refreshed = await directories.list_directory("cloud", IdLocation(value="root-id"), mode=interruption)
            assert refreshed.items[0].name == "updated"
        elif interruption == "failed_refresh":
            driver.fail = True
            with pytest.raises(ProviderError):
                await directories.list_directory("cloud", location, mode="refresh")
            driver.fail = False
        elif interruption == "write":
            with manager.execution("cloud", 1), directories.writing("cloud", 1, RenameCacheScope({location})):
                with pytest.raises(StorageBusyError):
                    await directories.list_directory("cloud", location, mode="refresh")
        else:
            directories.invalidate("cloud" if interruption == "invalidate" else None)
    finally:
        driver.resume.set()
        original, follower = await asyncio.gather(first, second)
    assert original.items[0].name == follower.items[0].name == "original"
    original.items[0].name = "mutated"
    assert follower.items[0].name == "original"
    assert (await directories.list_directory("cloud", location)).items[0].name == "updated"
    assert driver.calls == (3 if interruption == "failed_refresh" else 2)


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
@pytest.mark.parametrize("mode", ["refresh", "navigate"])
@pytest.mark.parametrize("same_directory", [True, False])
async def test_new_live_read_supersedes_an_older_read_across_the_storage(mode: str, same_directory: bool) -> None:
    driver = DirectoryDriver()
    directories = registry_for({"cloud": driver}, cache_directories=True).manager.directories
    driver.pause_next = True
    first = asyncio.create_task(directories.list_directory("cloud", PathLocation(value="first"), mode=mode))
    try:
        await asyncio.wait_for(driver.started.wait(), timeout=5)
        if not same_directory:
            driver.path_id = "other-folder"
        driver.name = "newer"
        latest = await directories.list_directory("cloud", PathLocation(value="second"), mode=mode)
    finally:
        driver.resume.set()
    with pytest.raises(StorageBusyError):
        await first
    if not same_directory:
        assert directories._cache.get(("cloud", 1, IdLocation(value="folder"))) is None
    assert await directories.list_directory("cloud", latest.location) == latest
    assert driver.calls == 2
