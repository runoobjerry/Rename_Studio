from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.core.errors import AppError
from app.schemas.files import DirectoryListing, FileItem, RenameFile
from app.schemas.storage import PathLocation, RootLocation, StorageLocation
from app.core.paths import normalize_storage_path
from app.providers.name_validation import NameValidationIssue


@dataclass(frozen=True, slots=True)
class RenameRequest:
    file_id: str
    new_name: str


class StorageProvider(ABC):
    id: str
    execution_batch_size: int = 20
    execution_batch_concurrency: int = 1

    async def list_directory(self, location: StorageLocation) -> DirectoryListing:
        """Path providers keep identity relative to their configured root."""
        path = "" if isinstance(location, RootLocation) else normalize_storage_path(location.value)
        items = await self.list_files(path)
        parent = path.rpartition("/")[0] if path else None
        canonical = PathLocation(value=path) if path else RootLocation()
        parent_location = (PathLocation(value=parent) if parent else RootLocation()) if parent is not None else None
        return DirectoryListing(provider=self.id, path=path, parent_path=parent, items=items,
                                location=canonical, parent_location=parent_location)

    async def list_siblings(self, item: FileItem) -> list[FileItem]:
        location = item.parent_location or PathLocation(value=item.parent_path)
        return (await self.list_directory(location)).items

    @staticmethod
    def parent_key(item: FileItem) -> str:
        return item.parent_location.model_dump_json() if item.parent_location else item.parent_path

    @abstractmethod
    async def list_files(self, path: str) -> list[FileItem]:
        raise NotImplementedError

    @abstractmethod
    async def get_metadata(self, file_id: str) -> FileItem:
        raise NotImplementedError

    async def get_metadata_many(self, file_ids: list[str]) -> list[FileItem]:
        return [await self.get_metadata(file_id) for file_id in file_ids]

    @abstractmethod
    async def rename(self, file_id: str, new_name: str) -> FileItem:
        raise NotImplementedError

    async def rename_single(self, file_id: str, new_name: str) -> RenameFile:
        """Direct rename can return confirmed metadata without a display path."""
        return await self.rename(file_id, new_name)

    async def get_single_metadata(self, file_id: str) -> RenameFile:
        return await self.get_metadata(file_id)

    async def rename_many(
        self, requests: list[RenameRequest]
    ) -> dict[str, FileItem | AppError]:
        results: dict[str, FileItem | AppError] = {}
        for request in requests:
            try:
                results[request.file_id] = await self.rename(
                    request.file_id, request.new_name
                )
            except AppError as exc:
                results[request.file_id] = exc
        return results

    @abstractmethod
    def validate_name(self, name: str) -> NameValidationIssue | None:
        """Return a stable reason, display parameters and diagnostic, or None when valid."""
        raise NotImplementedError

    def validate_target_name(self, item: FileItem, name: str) -> NameValidationIssue | None:
        return self.validate_name(name)

    def normalize_name(self, name: str) -> str:
        return name.casefold()

    async def aclose(self) -> None:
        """Release provider-owned network resources when the app shuts down."""
