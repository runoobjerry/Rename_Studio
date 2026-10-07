from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.storage import StorageLocation


class FileItem(BaseModel):
    id: str
    name: str
    path: str
    parent_path: str
    is_directory: bool
    size: int | None = None
    modified_at: datetime | None = None
    location: StorageLocation | None = None
    parent_location: StorageLocation | None = None
    can_rename: bool | None = None


class DirectoryListing(BaseModel):
    provider: str
    path: str
    parent_path: str | None
    items: list[FileItem] = Field(default_factory=list)
    storage_id: str | None = None
    revision: int | None = None
    location: StorageLocation | None = None
    parent_location: StorageLocation | None = None
