from abc import ABC, abstractmethod

from app.schemas.files import FileItem


class StorageProvider(ABC):
    id: str
    display_name: str

    @abstractmethod
    async def list_files(self, path: str) -> list[FileItem]:
        raise NotImplementedError

    @abstractmethod
    async def get_metadata(self, file_id: str) -> FileItem:
        raise NotImplementedError

    @abstractmethod
    def validate_name(self, name: str) -> str | None:
        """Return a user-facing validation error, or None when valid."""
        raise NotImplementedError

    def normalize_name(self, name: str) -> str:
        return name.casefold()
