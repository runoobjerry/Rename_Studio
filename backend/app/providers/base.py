from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.core.errors import AppError
from app.schemas.files import FileItem


@dataclass(frozen=True, slots=True)
class RenameRequest:
    file_id: str
    new_name: str


class StorageProvider(ABC):
    id: str
    display_name: str

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
    def validate_name(self, name: str) -> str | None:
        """Return a user-facing validation error, or None when valid."""
        raise NotImplementedError

    def validate_target_name(self, item: FileItem, name: str) -> str | None:
        return self.validate_name(name)

    def normalize_name(self, name: str) -> str:
        return name.casefold()

    async def aclose(self) -> None:
        """Release provider-owned network resources when the app shuts down."""
