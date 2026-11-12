from dataclasses import dataclass
from collections.abc import Awaitable, Callable

from app.core.errors import ProviderError
from app.schemas.files import DirectoryBreadcrumb, FileItem
from app.schemas.storage import IdLocation, RootLocation, StorageLocation


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
class DirectoryAncestry:
    # Root is represented by its real ID internally, and RootLocation on the wire.
    chain: tuple[tuple[str, str], ...]
    drive_id: str | None
    expires_at: float | None = None

    def breadcrumbs(self) -> list[DirectoryBreadcrumb]:
        return [DirectoryBreadcrumb(name=name, location=RootLocation() if index == 0 else IdLocation(value=file_id))
                for index, (file_id, name) in enumerate(self.chain)]


# RootLocation requests the root prefix without knowing its opaque ID.
type AncestorLookup = Callable[[str | RootLocation], DirectoryAncestry | None]


async def resolve_ancestry(
    directory: DirectoryMetadata, root: DirectoryMetadata,
    load: Callable[[str], Awaitable[DirectoryMetadata]], lookup: AncestorLookup | None,
) -> DirectoryAncestry:
    """Join live parent IDs to a complete cached prefix; metadata stays local to this read."""
    suffix: list[tuple[str, str]] = []
    seen: set[str] = set()
    current = directory
    while current.id != root.id:
        if current.parent_id is None:
            raise DirectoryMetadataConflict("Provider returned invalid directory ancestry")
        if current.drive_id is not None and current.drive_id != root.drive_id:
            raise DirectoryMetadataConflict("Provider returned ancestry from a different drive")
        seen.add(current.id)
        suffix.append((current.id, current.name))
        parent_id = current.parent_id
        if parent_id in seen:
            raise DirectoryMetadataConflict("Provider returned a cycle in directory ancestry")
        prefix = lookup(parent_id) if lookup is not None else None
        if prefix is not None:
            ids = [file_id for file_id, _ in prefix.chain]
            if (ids[0] == root.id and ids[-1] == parent_id and not seen.intersection(ids)
                    and prefix.drive_id == root.drive_id):
                return DirectoryAncestry((*prefix.chain, *reversed(suffix)), root.drive_id)
        current = root if parent_id == root.id else await load(parent_id)
    return DirectoryAncestry(((root.id, root.name), *reversed(suffix)), root.drive_id)


@dataclass(frozen=True, slots=True)
class DirectoryHint:
    folder: FileItem
    parent_id: str
    parent_location: StorageLocation
    parent_path: str
    parent_breadcrumbs: list[DirectoryBreadcrumb]
    drive_id: str | None
    root_id: str | None = None

    def breadcrumbs(self, name: str) -> list[DirectoryBreadcrumb]:
        return [*self.parent_breadcrumbs, DirectoryBreadcrumb(name=name, location=IdLocation(value=self.folder.id))]
