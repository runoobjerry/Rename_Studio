import asyncio
from uuid import uuid4

import pytest

from app.core.errors import (
    AppError, NotFoundError, RenameOutcomeUnknownError, StorageBusyError, StorageConnectionChangedError,
)
from app.providers.base import StorageProvider
from app.providers.name_validation import NameValidationIssue
from app.schemas.files import DirectoryListing, FileItem
from app.schemas.rename import SingleRenameExecuteRequest
from app.schemas.storage import IdLocation, RootLocation, StorageLocation
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
    assert item.status == ("renamed" if current_name == "new.txt" else "unknown" if current_name is None else "failed")
    if current_name == "new.txt":
        assert item.current_file == provider.item("new.txt")
    else:
        assert item.error_code == ("RENAME_OUTCOME_UNKNOWN" if current_name is None else "PROVIDER_ERROR")
        assert item.actual_name == current_name


@pytest.mark.asyncio
@pytest.mark.parametrize("current_name", ["new.txt", "external.txt", None])
async def test_single_write_uses_confirmed_parent_and_only_falls_back_when_unresolved(current_name: str | None) -> None:
    requested, actual, unrelated = (IdLocation(value=value) for value in ("requested", "actual", "unrelated"))

    class MovedFileProvider(DirectProvider):
        directory_reads: list[StorageLocation]

        async def list_directory(self, location: StorageLocation) -> DirectoryListing:
            self.directory_reads.append(location)
            return DirectoryListing(provider=self.id, path="fixture", parent_path="", location=location)

        async def get_metadata(self, file_id: str) -> FileItem:
            current = await super().get_metadata(file_id)
            return current.model_copy(update={"parent_location": actual})

    provider = MovedFileProvider(RenameOutcomeUnknownError("Lost response"), confirmed_name=current_name)
    provider.directory_reads = []
    registry = registry_for([provider], cache_directories=True)
    directories = registry.manager.directories
    for location in (requested, actual, unrelated):
        await directories.list_directory(provider.id, location)
    result = await SingleRenameService(registry).execute(
        provider.id, request().model_copy(update={"location": requested}),
    )
    assert result.items[0].status == ("renamed" if current_name == "new.txt" else "failed" if current_name else "unknown")
    assert provider.directory_reads == [requested, actual, unrelated]
    for location in (requested, actual, unrelated):
        await directories.list_directory(provider.id, location)
    assert provider.directory_reads[3:] == ([requested, actual, unrelated] if current_name is None else [requested, actual])


@pytest.mark.asyncio
async def test_single_folder_rename_refreshes_deep_cached_paths_without_reading_the_folder() -> None:
    child, sibling = IdLocation(value="deep"), IdLocation(value="sibling")

    class FolderProvider(DirectProvider):
        async def list_directory(self, location: StorageLocation) -> DirectoryListing:
            if location == child:
                path = "Renamed/sub/deep" if self.writes else "Reports/sub/deep"
            else:
                path = "Unrelated external change" if self.writes else "Reports-Archive/sub/deep"
            return DirectoryListing(provider=self.id, path=path, parent_path=path.rpartition("/")[0], location=location)

        async def rename(self, file_id: str, new_name: str) -> FileItem:
            self.writes += 1
            return FileItem(
                id=file_id, name=new_name, path=new_name, parent_path="", is_directory=True,
                parent_location=RootLocation(),
            )

    provider = FolderProvider()
    registry = registry_for([provider], cache_directories=True)
    directories = registry.manager.directories
    assert (await directories.list_directory(provider.id, child)).path == "Reports/sub/deep"
    sibling_listing = await directories.list_directory(provider.id, sibling)
    result = await SingleRenameService(registry).execute(
        provider.id, request().model_copy(update={"original_name": "Reports", "target_name": "Renamed"}),
    )
    assert result.items[0].status == "renamed"
    assert (await directories.list_directory(provider.id, child)).path == "Renamed/sub/deep"
    assert (await directories.list_directory(provider.id, sibling)) == sibling_listing


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
