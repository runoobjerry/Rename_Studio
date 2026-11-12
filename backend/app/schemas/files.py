from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.storage import StorageLocation


class RenameFile(BaseModel):
    id: str
    name: str
    path: str | None = None
    parent_path: str | None = None
    is_directory: bool
    size: int | None = None
    modified_at: datetime | None = None
    location: StorageLocation | None = None
    parent_location: StorageLocation | None = None
    can_rename: bool | None = None
    mime_type: str | None = None


class FileItem(RenameFile):
    path: str
    parent_path: str
    can_list_children: bool | None = None


class DirectoryBreadcrumb(BaseModel):
    name: str
    location: StorageLocation


class DirectoryListing(BaseModel):
    # Internal root identity for cache ancestry; never part of the HTTP payload.
    root_id: str | None = Field(default=None, exclude=True)
    provider: str
    path: str
    parent_path: str | None
    items: list[FileItem] = Field(default_factory=list)
    storage_id: str | None = None
    revision: int | None = None
    location: StorageLocation | None = None
    parent_location: StorageLocation | None = None
    breadcrumbs: list[DirectoryBreadcrumb] | None = None
    directory_id: str | None = None
    drive_id: str | None = None
