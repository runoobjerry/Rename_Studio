from datetime import datetime

from pydantic import BaseModel, Field


class ProviderInfo(BaseModel):
    id: str
    name: str
    writable: bool


class FileItem(BaseModel):
    id: str
    name: str
    path: str
    parent_path: str
    is_directory: bool
    size: int | None = None
    modified_at: datetime | None = None


class DirectoryListing(BaseModel):
    provider: str
    path: str
    parent_path: str | None
    items: list[FileItem] = Field(default_factory=list)
