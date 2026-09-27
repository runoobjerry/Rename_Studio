import re
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from app.core.errors import NotFoundError, ValidationError
from app.providers.base import StorageProvider
from app.schemas.files import FileItem


_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
_INVALID_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


class LocalProvider(StorageProvider):
    id = "local"
    display_name = "Local Files"

    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, relative_path: str) -> Path:
        normalized = relative_path.replace("\\", "/").strip("/")
        candidate = (self.root / normalized).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise ValidationError("Path is outside the configured storage root") from exc
        return candidate

    def _relative(self, path: Path) -> str:
        relative = path.relative_to(self.root)
        return "" if relative == Path(".") else relative.as_posix()

    def _to_item(self, path: Path) -> FileItem:
        stat = path.stat()
        relative = self._relative(path)
        parent = PurePosixPath(relative).parent.as_posix()
        if parent == ".":
            parent = ""
        return FileItem(
            id=relative,
            name=path.name,
            path=relative,
            parent_path=parent,
            is_directory=path.is_dir(),
            size=None if path.is_dir() else stat.st_size,
            modified_at=datetime.fromtimestamp(stat.st_mtime, timezone.utc),
        )

    async def list_files(self, path: str) -> list[FileItem]:
        directory = self._resolve(path)
        if not directory.exists() or not directory.is_dir():
            raise NotFoundError("Directory not found", details={"path": path})
        children = sorted(
            directory.iterdir(),
            key=lambda item: (not item.is_dir(), item.name.casefold()),
        )
        return [self._to_item(child) for child in children]

    async def get_metadata(self, file_id: str) -> FileItem:
        path = self._resolve(file_id)
        if not path.exists():
            raise NotFoundError("File not found", details={"file_id": file_id})
        return self._to_item(path)

    def validate_name(self, name: str) -> str | None:
        if not name or not name.strip():
            return "Filename cannot be empty"
        if name in {".", ".."}:
            return "Filename cannot be '.' or '..'"
        if _INVALID_NAME.search(name):
            return "Filename contains invalid characters"
        if name.endswith((" ", ".")):
            return "Filename cannot end with a space or period"
        stem = name.split(".", maxsplit=1)[0].upper()
        if stem in _WINDOWS_RESERVED_NAMES:
            return "Filename uses a reserved Windows name"
        if len(name) > 255:
            return "Filename is longer than 255 characters"
        return None
