import asyncio
from uuid import uuid4

import pytest

from app.core.errors import (
    AppError, NotFoundError, RenameOutcomeUnknownError, StorageBusyError, StorageConnectionChangedError,
)
from app.providers.base import StorageProvider
from app.providers.name_validation import NameValidationIssue
from app.schemas.files import FileItem
from app.schemas.rename import SingleRenameExecuteRequest
from app.services.single_rename_service import SingleRenameService
from provider_fixtures import registry_for


class DirectProvider(StorageProvider):
    id = "custom-direct"

    def __init__(self, error: AppError | None = None, *, confirmed_name: str | None = None) -> None:
        self.error = error
        self.confirmed_name = confirmed_name
        self.writes = 0
        self.reads = 0

    async def list_files(self, path: str) -> list[FileItem]:
        raise AssertionError("Single rename must not list the directory")

    async def get_metadata(self, file_id: str) -> FileItem:
        self.reads += 1
        if self.confirmed_name is None:
            raise NotFoundError("Cannot confirm the write")
        return self.item(self.confirmed_name)

    @staticmethod
    def item(name: str) -> FileItem:
        return FileItem(id="opaque-id", name=name, path=name, parent_path="", is_directory=False)

    async def rename(self, file_id: str, new_name: str) -> FileItem:
        assert file_id == "opaque-id"
        self.writes += 1
        if self.error:
            raise self.error
        return self.item(new_name)

    def validate_name(self, name: str) -> NameValidationIssue | None:
        return None


def request() -> SingleRenameExecuteRequest:
    return SingleRenameExecuteRequest(
        operation_id=uuid4(), revision=1, file_id="opaque-id",
        original_name="displayed-before-external-change.txt", target_name="new.txt",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("current_name", ["new.txt", "external.txt", None])
async def test_single_unknown_write_is_reconciled_once_without_replay(current_name: str | None) -> None:
    provider = DirectProvider(RenameOutcomeUnknownError("Lost response"), confirmed_name=current_name)
    result = await SingleRenameService(registry_for([provider])).execute(provider.id, request())
    assert provider.writes == 1
    assert provider.reads == 1
    item = result.items[0]
    if current_name == "new.txt":
        assert result.status == "completed"
        assert item.current_file == provider.item("new.txt")
    else:
        assert result.status == "failed"
        assert item.error_code == ("RENAME_OUTCOME_UNKNOWN" if current_name is None else "PROVIDER_ERROR")
        assert item.actual_name == current_name


@pytest.mark.asyncio
async def test_single_rename_rejects_stale_revision_and_busy_connection_before_writing() -> None:
    provider = DirectProvider()
    registry = registry_for([provider])
    service = SingleRenameService(registry)
    stale = request().model_copy(update={"revision": 2})
    with pytest.raises(StorageConnectionChangedError):
        await service.execute(provider.id, stale)
    with registry.execution(provider.id, 1):
        with pytest.raises(StorageBusyError):
            await service.execute(provider.id, request())
    assert provider.writes == 0


@pytest.mark.asyncio
async def test_cancelled_single_write_keeps_connection_busy_until_provider_finishes() -> None:
    started, release = asyncio.Event(), asyncio.Event()

    class WaitingProvider(DirectProvider):
        async def rename(self, file_id: str, new_name: str) -> FileItem:
            started.set()
            await release.wait()
            return await super().rename(file_id, new_name)

    provider = WaitingProvider()
    registry = registry_for([provider])
    service = SingleRenameService(registry)
    execution = asyncio.create_task(service.execute(provider.id, request()))
    await started.wait()
    execution.cancel()
    with pytest.raises(StorageBusyError):
        await service.execute(provider.id, request())
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await execution
    with registry.execution(provider.id, 1):
        assert provider.writes == 1
