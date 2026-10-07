from pydantic import BaseModel
import pytest

from app.core.errors import NotFoundError, ProviderError, RenameOutcomeUnknownError
from app.providers.base import RenameRequest, StorageProvider
from app.providers.registry import ProviderRegistry
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
    display_name = "Mapping"
    description = "Test business outcomes with opaque storage IDs"
    config_model = MappingConfig

    def apply(self, filename: str, context: RuleContext, config: MappingConfig) -> str:
        return config.names.get(filename, filename)


class StableIdProvider(StorageProvider):
    id = "stable"
    display_name = "Stable IDs"
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


def services(provider: StableIdProvider):
    registry = ProviderRegistry([provider])
    rules = RuleRegistry()
    rules.register(MappingRule())
    store = PreviewStore()
    preview = PreviewService(registry, RenameEngine(rules), store)
    return preview, ExecuteService(registry, store, preview)


def request(ids: list[str], names: dict[str, str]) -> RenamePreviewRequest:
    return RenamePreviewRequest(provider="stable", location=RootLocation(), file_ids=ids, rules=[RuleSpec(type="mapping", config={"names": names})])


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
