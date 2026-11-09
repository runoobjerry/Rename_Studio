from provider_fixtures import registry_for
import asyncio
from pydantic import BaseModel
import pytest

from app.core.errors import NotFoundError, ProviderError, RenameOutcomeUnknownError
from app.providers.base import RenameRequest, StorageDriver
from app.providers.name_validation import NameValidationIssue
from app.rules.base import RenameRule, RuleContext
from app.rules.registry import RuleRegistry
from app.schemas.files import DirectoryListing, FileItem
from app.schemas.rename import RenamePreviewRequest
from app.schemas.rules import RuleSpec
from app.schemas.storage import IdLocation, RootLocation, StorageLocation
from app.services.execute_service import ExecuteService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine


class MappingConfig(BaseModel):
    names: dict[str, str]


class MappingRule(RenameRule[MappingConfig]):
    type = "mapping"
    config_model = MappingConfig

    def apply(self, filename: str, context: RuleContext, config: MappingConfig) -> str:
        return config.names.get(filename, filename)


class StableIdDriver(StorageDriver):
    provider_type = "stable"
    execution_batch_size = 2

    def __init__(self, names: dict[str, str]) -> None:
        self.items = {key: FileItem(id=key, name=name, path=f"display/{name}", parent_path="display", is_directory=False,
                                   location=IdLocation(value=key), parent_location=IdLocation(value="directory")) for key, name in names.items()}
        self.writes: list[list[RenameRequest]] = []
        self.lose_response = False
        self.unreadable_after_write = False
        self.fail_targets: set[str] = set()

    async def list_files(self, path: str) -> list[FileItem]:
        raise AssertionError("Opaque directory IDs must not be passed as display paths")

    async def list_directory(self, location: StorageLocation) -> DirectoryListing:
        assert isinstance(location, RootLocation) or location == IdLocation(value="directory")
        return DirectoryListing(provider=self.provider_type, path="display", parent_path=None, location=IdLocation(value="directory"),
                                items=[item.model_copy(deep=True) for item in self.items.values()])

    async def get_metadata(self, file_id: str) -> FileItem:
        if self.unreadable_after_write and self.writes:
            raise ProviderError("Metadata unavailable")
        if file_id not in self.items:
            raise NotFoundError("Item missing")
        return self.items[file_id].model_copy(deep=True)

    async def rename(self, file_id: str, new_name: str) -> FileItem:
        if new_name in self.fail_targets:
            raise ProviderError("Write rejected")
        self.items[file_id].name = new_name
        return self.items[file_id].model_copy(deep=True)

    async def rename_many(self, requests: list[RenameRequest]):
        self.writes.append(requests)
        outcomes = await super().rename_many(requests)
        if self.lose_response:
            self.lose_response = False
            raise RenameOutcomeUnknownError("Response lost after the write")
        return outcomes

    def validate_name(self, name: str) -> NameValidationIssue | None:
        return None if name else NameValidationIssue("NAME_EMPTY", "Empty name")

    def normalize_name(self, name: str) -> str:
        return name


class ControlledBatchDriver(StableIdDriver):
    """Use gates to observe overlapping writes without depending on network latency."""

    execution_batch_size = 20
    execution_batch_concurrency = 2

    def __init__(self, count: int) -> None:
        super().__init__({str(index): f"old-{index}" for index in range(count)})
        self.groups: list[list[RenameRequest]] = []
        self.gates: list[asyncio.Event] = []
        self.started: asyncio.Queue[int] = asyncio.Queue()
        self.finished: asyncio.Queue[int] = asyncio.Queue()
        self.active = 0
        self.max_active = 0
        self.release_all = False
        self.unknown_group: int | None = None
        self.crash_group: int | None = None
        self.unknown_ids: set[str] = set()
        self.metadata_started = asyncio.Event()
        self.metadata_release = asyncio.Event()

    async def rename_many(self, requests: list[RenameRequest]):
        index = len(self.groups)
        self.groups.append(requests)
        gate = asyncio.Event()
        self.gates.append(gate)
        if self.release_all:
            gate.set()
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.started.put_nowait(index)
        try:
            await gate.wait()
            if index == self.crash_group:
                raise RuntimeError("Unexpected write failure")
            outcomes = await super().rename_many(requests)
            if index == self.unknown_group:
                self.unknown_ids.update(request.file_id for request in requests)
                return {request.file_id: RenameOutcomeUnknownError("Write response lost") for request in requests}
            return outcomes
        finally:
            self.active -= 1
            self.finished.put_nowait(index)

    async def get_metadata(self, file_id: str) -> FileItem:
        if file_id in self.unknown_ids:
            self.metadata_started.set()
            await self.metadata_release.wait()
        return await super().get_metadata(file_id)

    def release_everything(self) -> None:
        self.release_all = True
        self.metadata_release.set()
        for gate in self.gates:
            gate.set()


async def controlled_execution(driver: ControlledBatchDriver):
    preview, execute = services(driver)
    names = {item.name: f"new-{key}" for key, item in driver.items.items()}
    snapshot = await preview.preview(request(list(driver.items), names))
    task = asyncio.create_task(execute.execute(snapshot.preview_id))
    return execute, snapshot.preview_id, task


async def next_group(driver: ControlledBatchDriver) -> int:
    return await asyncio.wait_for(driver.started.get(), timeout=5)


async def wait_processed(execute: ExecuteService, preview_id: str, count: int) -> None:
    async with asyncio.timeout(5):
        while execute.progress(preview_id).processed != count:
            # Yield for result collection; this is not a timed performance assertion.
            await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_independent_groups_roll_forward_and_keep_progress_in_completion_order() -> None:
    driver = ControlledBatchDriver(61)
    execute, preview_id, task = await controlled_execution(driver)
    try:
        assert [await next_group(driver), await next_group(driver)] == [0, 1]
        assert execute.progress(preview_id).processed == 0
        assert driver.active == driver.max_active == 2
        driver.gates[1].set()
        assert await next_group(driver) == 2
        assert not driver.gates[0].is_set()
        assert execute.progress(preview_id).processed == 20
        driver.gates[2].set()
        assert await next_group(driver) == 3
        assert execute.progress(preview_id).processed == 40
        driver.gates[3].set()
        await wait_processed(execute, preview_id, 41)
        assert not task.done()
    finally:
        driver.release_everything()
        result = await asyncio.wait_for(task, timeout=5)
    assert result.status == "completed"
    assert [item.file_id for item in result.items] == list(driver.items)
    assert [len(group) for group in driver.groups] == [20, 20, 20, 1]
    assert execute.progress(preview_id).processed == execute.progress(preview_id).total == 61
    assert driver.active == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [7, 40, 41, 1001])
async def test_concurrent_execution_keeps_batch_limits_and_submits_every_id_once(count: int) -> None:
    driver = ControlledBatchDriver(count)
    driver.release_everything()
    execute, preview_id, task = await controlled_execution(driver)
    result = await asyncio.wait_for(task, timeout=5)
    submitted = [entry.file_id for group in driver.groups for entry in group]
    assert submitted == list(driver.items)
    assert len(submitted) == len(set(submitted)) == count
    assert all(0 < len(group) <= 20 for group in driver.groups)
    assert driver.max_active <= 2
    assert result.status == "completed"
    assert [item.file_id for item in result.items] == list(driver.items)
    assert all(item.actual_name == f"new-{item.file_id}" for item in result.items)
    assert execute.progress(preview_id).processed == count


@pytest.mark.asyncio
@pytest.mark.parametrize("unreadable", [False, True])
async def test_unknown_group_pauses_refill_and_drains_other_in_flight_group(unreadable: bool) -> None:
    driver = ControlledBatchDriver(60)
    driver.unknown_group = 0
    driver.unreadable_after_write = unreadable
    execute, preview_id, task = await controlled_execution(driver)
    try:
        assert [await next_group(driver), await next_group(driver)] == [0, 1]
        driver.gates[0].set()
        await asyncio.wait_for(driver.metadata_started.wait(), timeout=5)
        driver.gates[1].set()
        await wait_processed(execute, preview_id, 20)
        await asyncio.sleep(0)
        assert len(driver.groups) == 2
        assert not task.done()
        driver.metadata_release.set()
        if not unreadable:
            assert await next_group(driver) == 2
            assert execute.progress(preview_id).processed == 40
    finally:
        driver.release_everything()
        result = await asyncio.wait_for(task, timeout=5)
    assert driver.active == 0
    submitted = [entry.file_id for group in driver.groups for entry in group]
    assert len(submitted) == len(set(submitted))
    if unreadable:
        assert len(driver.groups) == 2
        assert all(item.status == "unknown" and item.error_code == "RENAME_OUTCOME_UNKNOWN" and item.actual_name is None for item in result.items[:20])
        assert all(item.status == "renamed" for item in result.items[20:40])
        assert all(item.status == "not_attempted" for item in result.items[40:])
        assert all(driver.items[str(index)].name == f"old-{index}" for index in range(40, 60))
    else:
        assert len(driver.groups) == 3
        assert result.status == "completed"


@pytest.mark.asyncio
async def test_unresolved_unknown_waits_for_other_in_flight_write_before_returning() -> None:
    driver = ControlledBatchDriver(60)
    driver.unknown_group = 0
    driver.unreadable_after_write = True
    execute, preview_id, task = await controlled_execution(driver)
    try:
        assert [await next_group(driver), await next_group(driver)] == [0, 1]
        driver.gates[0].set()
        await asyncio.wait_for(driver.metadata_started.wait(), timeout=5)
        driver.metadata_release.set()
        await wait_processed(execute, preview_id, 20)
        assert not task.done()
        assert not driver.gates[1].is_set()
        assert execute.providers.manager.info("stable").busy
        assert len(driver.groups) == 2
    finally:
        driver.release_everything()
        result = await asyncio.wait_for(task, timeout=5)
    assert len(driver.groups) == 2
    assert driver.active == 0
    assert all(item.status == "renamed" for item in result.items[20:40])
    assert all(item.status == "not_attempted" for item in result.items[40:])


@pytest.mark.asyncio
async def test_confirmed_failure_keeps_successes_and_continues_independent_groups() -> None:
    driver = ControlledBatchDriver(60)
    driver.fail_targets.add("new-0")
    execute, preview_id, task = await controlled_execution(driver)
    try:
        assert [await next_group(driver), await next_group(driver)] == [0, 1]
        driver.gates[0].set()
        assert await next_group(driver) == 2
        assert execute.progress(preview_id).processed == 20
    finally:
        driver.release_everything()
        result = await asyncio.wait_for(task, timeout=5)
    assert result.items[0].status == "failed"
    assert result.items[0].error_code == "PROVIDER_ERROR"
    assert all(item.status == "renamed" for item in result.items[1:])
    assert driver.items["0"].name == "old-0"
    assert len(driver.groups) == 3


@pytest.mark.asyncio
async def test_serial_cancellation_waits_for_the_started_write_without_starting_next_group() -> None:
    driver = ControlledBatchDriver(41)
    driver.execution_batch_concurrency = 1
    execute, preview_id, task = await controlled_execution(driver)
    try:
        assert await next_group(driver) == 0
        assert execute.progress(preview_id).processed == 0
        task.cancel()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert not task.done()
        assert execute.providers.manager.info("stable").busy
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        assert len(driver.groups) == 1
        assert driver.active == 1
    finally:
        driver.release_everything()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5)
    assert driver.active == 0
    assert len(driver.groups) == 1
    assert not execute.providers.manager.info("stable").busy
    assert execute.progress(preview_id).phase == "failed"
    assert driver.items["0"].name == "new-0"
    assert driver.items["20"].name == "old-20"


@pytest.mark.asyncio
@pytest.mark.parametrize("interrupt", ["cancel", "crash"])
async def test_interrupted_execution_holds_connection_until_in_flight_writes_finish(interrupt: str) -> None:
    driver = ControlledBatchDriver(60)
    execute, preview_id, task = await controlled_execution(driver)
    try:
        assert [await next_group(driver), await next_group(driver)] == [0, 1]
        if interrupt == "crash":
            driver.crash_group = 0
            driver.gates[0].set()
            assert await asyncio.wait_for(driver.finished.get(), timeout=5) == 0
        else:
            task.cancel()
        # Allow the interruption to reach the collector while the second write remains gated.
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert not task.done()
        assert execute.providers.manager.info("stable").busy
        assert len(driver.groups) == 2
        if interrupt == "cancel":
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()
    finally:
        driver.release_everything()
        expected = asyncio.CancelledError if interrupt == "cancel" else RuntimeError
        with pytest.raises(expected):
            await asyncio.wait_for(task, timeout=5)
    assert driver.active == 0
    assert len(driver.groups) == 2
    assert not execute.providers.manager.info("stable").busy
    assert execute.progress(preview_id).phase == "failed"
    assert driver.items["20"].name == "new-20"


def services(driver: StableIdDriver):
    registry = registry_for({"stable": driver})
    rules = RuleRegistry()
    rules.register(MappingRule())
    store = PreviewStore()
    preview = PreviewService(registry, RenameEngine(rules), store)
    return preview, ExecuteService(registry, store, preview)


def request(ids: list[str], names: dict[str, str]) -> RenamePreviewRequest:
    return RenamePreviewRequest(storage_id="stable", location=RootLocation(), file_ids=ids, rules=[RuleSpec(type="mapping", config={"names": names})])


@pytest.mark.asyncio
async def test_preview_and_execution_results_keep_requested_order() -> None:
    driver = StableIdDriver({"1": "001.jpg", "2": "002.jpg"})
    preview, execute = services(driver)
    snapshot = await preview.preview(request(["2", "1"], {"001.jpg": "a.jpg", "002.jpg": "b.jpg"}))
    assert [item.file_id for item in snapshot.items] == ["2", "1"]
    result = await execute.execute(snapshot.preview_id)
    assert result.status == "completed"
    assert [item.file_id for item in result.items] == ["2", "1"]
    assert [item.new_name for item in result.items] == ["b.jpg", "a.jpg"]


@pytest.mark.asyncio
async def test_all_existing_same_name_owners_are_checked() -> None:
    driver = StableIdDriver({"unselected": "same", "selected": "same", "other": "old"})
    preview, _ = services(driver)
    result = await preview.preview(request(["selected", "other"], {"same": "free", "old": "same"}))
    assert not result.valid
    assert result.items[1].conflict


@pytest.mark.asyncio
async def test_lost_write_response_is_reconciled_without_replay() -> None:
    driver = StableIdDriver({"1": "A", "2": "B"})
    preview, execute = services(driver)
    snapshot = await preview.preview(request(["1", "2"], {"A": "X", "B": "Y"}))
    driver.lose_response = True
    result = await execute.execute(snapshot.preview_id)
    assert result.status == "completed"
    assert len(driver.writes) == 1
    assert [item.actual_name for item in result.items] == ["X", "Y"]


@pytest.mark.asyncio
async def test_unknown_outcome_stops_later_batches() -> None:
    driver = StableIdDriver({"1": "A", "2": "B", "3": "C"})
    preview, execute = services(driver)
    snapshot = await preview.preview(request(["1", "2", "3"], {"A": "X", "B": "Y", "C": "Z"}))
    driver.lose_response = True
    driver.unreadable_after_write = True
    result = await execute.execute(snapshot.preview_id)
    assert [item.status for item in result.items] == ["unknown", "unknown", "not_attempted"]
    assert result.items[0].error_code == "RENAME_OUTCOME_UNKNOWN"
    assert result.items[0].actual_name is None
    assert driver.items["3"].name == "C"
    assert len(driver.writes) == 1


@pytest.mark.asyncio
async def test_provider_case_rules_and_permissions_are_used() -> None:
    driver = StableIdDriver({"1": "A", "2": "B"})
    preview, _ = services(driver)
    response = await preview.preview(request(["1", "2"], {"A": "x", "B": "X"}))
    assert response.valid
    driver.items["1"].can_rename = False
    response = await preview.preview(request(["1"], {"A": "renamed"}))
    assert not response.valid
    assert "permissions" in response.items[0].error


@pytest.mark.asyncio
async def test_single_target_uses_provider_name_rules_without_text_rule_limits() -> None:
    target = "  资料/" + "长" * 256 + ".txt"
    driver = StableIdDriver({"opaque-id": "old.txt", "other": target.upper()})
    preview, execute = services(driver)

    response = await preview.preview(RenamePreviewRequest(
        storage_id="stable", location=RootLocation(), file_ids=["opaque-id"], target_name=target,
    ))

    assert response.valid
    assert response.items[0].new_name == target
    assert driver.writes == []
    result = await execute.execute(response.preview_id)
    assert result.status == "completed"
    assert result.items[0].current_file.id == "opaque-id"
    assert driver.items["opaque-id"].name == target
    assert driver.items["other"].name == target.upper()


@pytest.mark.asyncio
async def test_single_target_cannot_bypass_item_permissions() -> None:
    driver = StableIdDriver({"opaque-id": "old.txt"})
    driver.items["opaque-id"].can_rename = False
    preview, _ = services(driver)

    response = await preview.preview(RenamePreviewRequest(
        storage_id="stable", location=RootLocation(), file_ids=["opaque-id"], target_name="new.txt",
    ))

    assert not response.valid
    assert "permissions" in response.items[0].error
    assert driver.writes == []


@pytest.mark.asyncio
@pytest.mark.parametrize("readable", [True, False], ids=["reconciled", "unresolved"])
async def test_single_target_lost_response_never_replays_write(readable: bool) -> None:
    driver = StableIdDriver({"opaque-id": "old.txt"})
    preview, execute = services(driver)
    response = await preview.preview(RenamePreviewRequest(
        storage_id="stable", location=RootLocation(), file_ids=["opaque-id"], target_name="new.txt",
    ))
    driver.lose_response = True
    driver.unreadable_after_write = not readable

    result = await execute.execute(response.preview_id)

    assert len(driver.writes) == 1
    assert driver.items["opaque-id"].name == "new.txt"
    if readable:
        assert result.items[0].status == "renamed"
        assert result.items[0].current_file.name == "new.txt"
    else:
        assert result.items[0].status == "unknown"
        assert result.items[0].error_code == "RENAME_OUTCOME_UNKNOWN"
        assert result.items[0].actual_name is None
