from dataclasses import dataclass

from app.core.errors import ProviderError
from app.schemas.files import DirectoryBreadcrumb, FileItem
from app.schemas.storage import IdLocation, StorageLocation


class DirectoryMetadataConflict(ProviderError):
    """A live directory response conflicts with the ancestry used for the read."""


@dataclass(frozen=True, slots=True)
class DirectoryMetadata:
    id: str
    name: str
    parent_id: str | None
    parent_path: str = ""
    drive_id: str | None = None


@dataclass(frozen=True, slots=True)
class DirectoryHint:
    folder: FileItem
    parent_id: str
    parent_location: StorageLocation
    parent_path: str
    parent_breadcrumbs: list[DirectoryBreadcrumb]
    drive_id: str | None

    def breadcrumbs(self, name: str) -> list[DirectoryBreadcrumb]:
        return [*self.parent_breadcrumbs, DirectoryBreadcrumb(name=name, location=IdLocation(value=self.folder.id))]
