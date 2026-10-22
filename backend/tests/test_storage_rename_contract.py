from provider_fixtures import registry_for
import asyncio
from pydantic import BaseModel
import pytest

from app.core.errors import NotFoundError, ProviderError, RenameOutcomeUnknownError
from app.providers.base import RenameRequest, StorageProvider
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


class StableIdProvider(StorageProvider):
    id = "stable"
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
        return DirectoryListing(provider=self.id, path="display", parent_path=None, location=IdLocation(value="directory"),
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

    def validate_name(self, name: str) -> str | None:
        return None if name else "Empty name"

    def normalize_name(self, name: str) -> str:
        return name


class ControlledBatchProvider(StableIdProvider):
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


async def controlled_execution(provider: ControlledBatchProvider):
    preview, execute = services(provider)
    names = {item.name: f"new-{key}" for key, item in provider.items.items()}
    snapshot = await preview.preview(request(list(provider.items), names))
    task = asyncio.create_task(execute.execute(snapshot.preview_id))
    return execute, snapshot.preview_id, task


async def next_group(provider: ControlledBatchProvider) -> int:
    return await asyncio.wait_for(provider.started.get(), timeout=5)


async def wait_processed(execute: ExecuteService, preview_id: str, count: int) -> None:
    async with asyncio.timeout(5):
        while execute.progress(preview_id).processed != count:
            # Yield for result collection; this is not a timed performance assertion.
            await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_independent_groups_roll_forward_and_keep_progress_in_completion_order() -> None:
    provider = ControlledBatchProvider(61)
    execute, preview_id, task = await controlled_execution(provider)
    try:
        assert [await next_group(provider), await next_group(provider)] == [0, 1]
        assert execute.progress(preview_id).processed == 0
        assert provider.active == provider.max_active == 2
        provider.gates[1].set()
        assert await next_group(provider) == 2
        assert not provider.gates[0].is_set()
        assert execute.progress(preview_id).processed == 20
        provider.gates[2].set()
        assert await next_group(provider) == 3
        assert execute.progress(preview_id).processed == 40
        provider.gates[3].set()
        await wait_processed(execute, preview_id, 41)
        assert not task.done()
    finally:
        provider.release_everything()
        result = await asyncio.wait_for(task, timeout=5)
    assert result.status == "completed"
    assert [item.file_id for item in result.items] == list(provider.items)
    assert [len(group) for group in provider.groups] == [20, 20, 20, 1]
    assert execute.progress(preview_id).processed == execute.progress(preview_id).total == 61
    assert provider.active == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [7, 40, 41, 1000])
async def test_concurrent_execution_keeps_batch_limits_and_submits_every_id_once(count: int) -> None:
    provider = ControlledBatchProvider(count)
    provider.release_everything()
    execute, preview_id, task = await controlled_execution(provider)
    result = await asyncio.wait_for(task, timeout=5)
    submitted = [entry.file_id for group in provider.groups for entry in group]
    assert submitted == list(provider.items)
    assert len(submitted) == len(set(submitted)) == count
    assert all(0 < len(group) <= 20 for group in provider.groups)
    assert provider.max_active <= 2
    assert result.status == "completed"
    assert [item.file_id for item in result.items] == list(provider.items)
    assert all(item.actual_name == f"new-{item.file_id}" for item in result.items)
    assert execute.progress(preview_id).processed == count


@pytest.mark.asyncio
@pytest.mark.parametrize("unreadable", [False, True])
async def test_unknown_group_pauses_refill_and_drains_other_in_flight_group(unreadable: bool) -> None:
    provider = ControlledBatchProvider(60)
    provider.unknown_group = 0
    provider.unreadable_after_write = unreadable
    execute, preview_id, task = await controlled_execution(provider)
    try:
        assert [await next_group(provider), await next_group(provider)] == [0, 1]
        provider.gates[0].set()
        await asyncio.wait_for(provider.metadata_started.wait(), timeout=5)
        provider.gates[1].set()
        await wait_processed(execute, preview_id, 20)
        await asyncio.sleep(0)
        assert len(provider.groups) == 2
        assert not task.done()
        provider.metadata_release.set()
        if not unreadable:
            assert await next_group(provider) == 2
            assert execute.progress(preview_id).processed == 40
    finally:
        provider.release_everything()
        result = await asyncio.wait_for(task, timeout=5)
    assert provider.active == 0
    submitted = [entry.file_id for group in provider.groups for entry in group]
    assert len(submitted) == len(set(submitted))
    if unreadable:
        assert len(provider.groups) == 2
        assert result.status == "partial"
        assert all(item.error_code == "RENAME_OUTCOME_UNKNOWN" and item.actual_name is None for item in result.items[:20])
        assert all(item.status == "renamed" for item in result.items[20:40])
        assert all(item.status == "failed" and "not attempted" in item.error for item in result.items[40:])
        assert all(provider.items[str(index)].name == f"old-{index}" for index in range(40, 60))
    else:
        assert len(provider.groups) == 3
        assert result.status == "completed"


@pytest.mark.asyncio
async def test_unresolved_unknown_waits_for_other_in_flight_write_before_returning() -> None:
    provider = ControlledBatchProvider(60)
    provider.unknown_group = 0
    provider.unreadable_after_write = True
    execute, preview_id, task = await controlled_execution(provider)
    try:
        assert [await next_group(provider), await next_group(provider)] == [0, 1]
        provider.gates[0].set()
        await asyncio.wait_for(provider.metadata_started.wait(), timeout=5)
        provider.metadata_release.set()
        await wait_processed(execute, preview_id, 20)
        assert not task.done()
        assert not provider.gates[1].is_set()
        assert execute.providers.manager.info("stable").busy
        assert len(provider.groups) == 2
    finally:
        provider.release_everything()
        result = await asyncio.wait_for(task, timeout=5)
    assert result.status == "partial"
    assert len(provider.groups) == 2
    assert provider.active == 0
    assert all(item.status == "renamed" for item in result.items[20:40])
    assert all(item.status == "failed" for item in result.items[40:])


@pytest.mark.asyncio
async def test_confirmed_failure_keeps_successes_and_continues_independent_groups() -> None:
    provider = ControlledBatchProvider(60)
    provider.fail_targets.add("new-0")
    execute, preview_id, task = await controlled_execution(provider)
    try:
        assert [await next_group(provider), await next_group(provider)] == [0, 1]
        provider.gates[0].set()
        assert await next_group(provider) == 2
        assert execute.progress(preview_id).processed == 20
    finally:
        provider.release_everything()
        result = await asyncio.wait_for(task, timeout=5)
    assert result.status == "partial"
    assert result.items[0].error_code == "PROVIDER_ERROR"
    assert all(item.status == "renamed" for item in result.items[1:])
    assert provider.items["0"].name == "old-0"
    assert len(provider.groups) == 3


@pytest.mark.asyncio
async def test_serial_cancellation_waits_for_the_started_write_without_starting_next_group() -> None:
    provider = ControlledBatchProvider(41)
    provider.execution_batch_concurrency = 1
    execute, preview_id, task = await controlled_execution(provider)
    try:
        assert await next_group(provider) == 0
        assert execute.progress(preview_id).processed == 0
        task.cancel()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert not task.done()
        assert execute.providers.manager.info("stable").busy
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        assert len(provider.groups) == 1
        assert provider.active == 1
    finally:
        provider.release_everything()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5)
    assert provider.active == 0
    assert len(provider.groups) == 1
    assert not execute.providers.manager.info("stable").busy
    assert execute.progress(preview_id).phase == "failed"
    assert provider.items["0"].name == "new-0"
    assert provider.items["20"].name == "old-20"


@pytest.mark.asyncio
@pytest.mark.parametrize("interrupt", ["cancel", "crash"])
async def test_interrupted_execution_holds_connection_until_in_flight_writes_finish(interrupt: str) -> None:
    provider = ControlledBatchProvider(60)
    execute, preview_id, task = await controlled_execution(provider)
    try:
        assert [await next_group(provider), await next_group(provider)] == [0, 1]
        if interrupt == "crash":
            provider.crash_group = 0
            provider.gates[0].set()
            assert await asyncio.wait_for(provider.finished.get(), timeout=5) == 0
        else:
            task.cancel()
        # Allow the interruption to reach the collector while the second write remains gated.
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert not task.done()
        assert execute.providers.manager.info("stable").busy
        assert len(provider.groups) == 2
        if interrupt == "cancel":
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()
    finally:
        provider.release_everything()
        expected = asyncio.CancelledError if interrupt == "cancel" else RuntimeError
        with pytest.raises(expected):
            await asyncio.wait_for(task, timeout=5)
    assert provider.active == 0
    assert len(provider.groups) == 2
    assert not execute.providers.manager.info("stable").busy
    assert execute.progress(preview_id).phase == "failed"
    assert provider.items["20"].name == "new-20"


@pytest.mark.asyncio
@pytest.mark.parametrize("fail", [False, True])
async def test_name_dependency_disables_new_concurrent_scheduler_including_rollback(fail: bool) -> None:
    provider = ControlledBatchProvider(42)
    names = {f"old-{index}": f"new-{index}" for index in range(42)}
    names.update({"old-0": "old-1", "old-1": "old-0"})
    if fail:
        provider.fail_targets.add("new-2")
    preview, execute = services(provider)
    snapshot = await preview.preview(request(list(provider.items), names))
    task = asyncio.create_task(execute.execute(snapshot.preview_id))
    try:
        assert await next_group(provider) == 0
        provider.gates[0].set()  # Complete temporary names before the direct phase starts.
        assert await next_group(provider) == 1
        assert provider.active == 1
        assert len(provider.groups) == 2
    finally:
        provider.release_everything()
        result = await asyncio.wait_for(task, timeout=5)
    assert provider.max_active == 1
    assert result.status == ("failed" if fail else "completed")
    assert provider.items["0"].name == ("old-0" if fail else "old-1")
    assert provider.items["1"].name == ("old-1" if fail else "old-0")


def services(provider: StableIdProvider):
    registry = registry_for([provider])
    rules = RuleRegistry()
    rules.register(MappingRule())
    store = PreviewStore()
    preview = PreviewService(registry, RenameEngine(rules), store)
    return preview, ExecuteService(registry, store, preview)


def request(ids: list[str], names: dict[str, str]) -> RenamePreviewRequest:
    return RenamePreviewRequest(storage_id="stable", location=RootLocation(), file_ids=ids, rules=[RuleSpec(type="mapping", config={"names": names})])


@pytest.mark.asyncio
async def test_preview_and_execution_results_keep_requested_order() -> None:
    provider = StableIdProvider({"1": "001.jpg", "2": "002.jpg"})
    preview, execute = services(provider)
    snapshot = await preview.preview(request(["2", "1"], {"001.jpg": "a.jpg", "002.jpg": "b.jpg"}))
    assert [item.file_id for item in snapshot.items] == ["2", "1"]
    result = await execute.execute(snapshot.preview_id)
    assert result.status == "completed"
    assert [item.file_id for item in result.items] == ["2", "1"]
    assert [item.new_name for item in result.items] == ["b.jpg", "a.jpg"]


@pytest.mark.asyncio
async def test_all_existing_same_name_owners_are_checked() -> None:
    provider = StableIdProvider({"unselected": "same", "selected": "same", "other": "old"})
    preview, _ = services(provider)
    result = await preview.preview(request(["selected", "other"], {"same": "free", "old": "same"}))
    assert not result.valid
    assert result.items[1].conflict


@pytest.mark.asyncio
async def test_stable_ids_chain_and_provider_batch_size() -> None:
    provider = StableIdProvider({"1": "A", "2": "B", "3": "C"})
    preview, execute = services(provider)
    result = await execute.execute((await preview.preview(request(["1", "2", "3"], {"A": "B", "B": "C", "C": "D"}))).preview_id)
    assert result.status == "completed"
    assert {key: item.name for key, item in provider.items.items()} == {"1": "B", "2": "C", "3": "D"}
    assert all(len(batch) <= 2 for batch in provider.writes)


@pytest.mark.asyncio
async def test_lost_write_response_is_reconciled_without_replay() -> None:
    provider = StableIdProvider({"1": "A", "2": "B"})
    preview, execute = services(provider)
    snapshot = await preview.preview(request(["1", "2"], {"A": "X", "B": "Y"}))
    provider.lose_response = True
    result = await execute.execute(snapshot.preview_id)
    assert result.status == "completed"
    assert len(provider.writes) == 1
    assert [item.actual_name for item in result.items] == ["X", "Y"]


@pytest.mark.asyncio
async def test_unknown_outcome_stops_later_batches() -> None:
    provider = StableIdProvider({"1": "A", "2": "B", "3": "C"})
    preview, execute = services(provider)
    snapshot = await preview.preview(request(["1", "2", "3"], {"A": "X", "B": "Y", "C": "Z"}))
    provider.lose_response = True
    provider.unreadable_after_write = True
    result = await execute.execute(snapshot.preview_id)
    assert result.status == "failed"
    assert result.items[0].error_code == "RENAME_OUTCOME_UNKNOWN"
    assert result.items[0].actual_name is None
    assert provider.items["3"].name == "C"
    assert len(provider.writes) == 1


@pytest.mark.asyncio
async def test_direct_failure_restores_staging() -> None:
    provider = StableIdProvider({"1": "A", "2": "B"})
    preview, execute = services(provider)
    snapshot = await preview.preview(request(["1", "2"], {"A": "B", "B": "C"}))
    provider.fail_targets = {"C"}
    result = await execute.execute(snapshot.preview_id)
    assert result.status == "failed"
    assert {item.name for item in provider.items.values()} == {"A", "B"}
    assert result.items[0].actual_name == "A"


@pytest.mark.asyncio
async def test_final_and_rollback_failure_reports_remaining_name() -> None:
    provider = StableIdProvider({"1": "A", "2": "B"})
    preview, execute = services(provider)
    snapshot = await preview.preview(request(["1", "2"], {"A": "B", "B": "A"}))
    provider.fail_targets = {"A", "B"}
    result = await execute.execute(snapshot.preview_id)
    assert result.status == "failed"
    assert all("rollback failed" in (item.error or "") for item in result.items)
    assert all(item.error_code == "PROVIDER_ERROR" for item in result.items)
    assert all(item.actual_name == provider.items[item.file_id].name for item in result.items)


@pytest.mark.asyncio
async def test_provider_case_rules_and_permissions_are_used() -> None:
    provider = StableIdProvider({"1": "A", "2": "B"})
    preview, _ = services(provider)
    response = await preview.preview(request(["1", "2"], {"A": "x", "B": "X"}))
    assert response.valid
    provider.items["1"].can_rename = False
    response = await preview.preview(request(["1"], {"A": "renamed"}))
    assert not response.valid
    assert "permissions" in response.items[0].error


@pytest.mark.asyncio
async def test_two_thousand_stable_ids_use_two_independent_preview_execute_batches() -> None:
    provider = StableIdProvider({str(index): f"old-{index}" for index in range(2000)})
    provider.execution_batch_size = 20
    preview, execute = services(provider)
    completed_ids: set[str] = set()
    for offset in (0, 1000):
        ids = [str(index) for index in range(offset, offset + 1000)]
        snapshot = await preview.preview(request(ids, {f"old-{index}": f"new-{index}" for index in range(offset, offset + 1000)}))
        assert snapshot.valid
        assert len(snapshot.items) == 1000
        result = await execute.execute(snapshot.preview_id)
        assert result.status == "completed"
        assert not completed_ids.intersection(item.file_id for item in result.items)
        assert all(item.current_file.id == item.file_id for item in result.items)
        completed_ids.update(item.file_id for item in result.items)
    assert len(completed_ids) == 2000
    assert all(item.name == f"new-{item.id}" for item in provider.items.values())
