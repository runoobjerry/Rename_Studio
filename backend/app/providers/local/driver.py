from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from app.core.errors import (
    NotFoundError,
    ProviderError,
    RenameConflictError,
    ValidationError,
)
from app.providers.base import StorageProvider
from app.providers.name_validation import validate_portable_name
from app.schemas.files import FileItem
from app.schemas.storage import PathLocation, RootLocation


class LocalProvider(StorageProvider):
    id = "local"
    display_name = "Local Files"

    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, relative_path: str) -> Path:
        normalized = relative_path.replace("\\", "/").strip("/")
        candidate = self.root
        # 必须在 resolve 跟随链接前检查每个路径分量，包含链接目录下的文件。
        for part in Path(normalized).parts:
            candidate = candidate / part
            if self._is_link(candidate):
                raise ValidationError("Symbolic links and directory junctions are not supported")
        candidate = candidate.resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise ValidationError("Path is outside the configured storage root") from exc
        return candidate

    @staticmethod
    def _is_link(path: Path) -> bool:
        return path.is_symlink() or path.is_junction()

    def _relative(self, path: Path) -> str:
        relative = path.relative_to(self.root)
        return "" if relative == Path(".") else relative.as_posix()

    def _to_item(self, path: Path) -> FileItem:
        is_link = self._is_link(path)
        stat = path.lstat()
        is_directory = not is_link and path.is_dir()
        relative = self._relative(path)
        parent = PurePosixPath(relative).parent.as_posix()
        if parent == ".":
            parent = ""
        return FileItem(
            id=relative,
            name=path.name,
            path=relative,
            parent_path=parent,
            is_directory=is_directory,
            size=None if is_directory else stat.st_size,
            modified_at=datetime.fromtimestamp(stat.st_mtime, timezone.utc),
            location=PathLocation(value=relative) if relative else RootLocation(),
            parent_location=PathLocation(value=parent) if parent else RootLocation(),
            can_rename=not is_link and path != self.root,
        )

    async def list_files(self, path: str) -> list[FileItem]:
        directory = self._resolve(path)
        if not directory.exists() or not directory.is_dir():
            raise NotFoundError("Directory not found", details={"path": path})
        # 链接保留在冲突集合中，但不读取目标元数据，也不允许进入链接目录。
        return sorted(
            (self._to_item(child) for child in directory.iterdir()),
            key=lambda item: (not item.is_directory, item.name.casefold()),
        )

    async def get_metadata(self, file_id: str) -> FileItem:
        path = self._resolve(file_id)
        if not path.exists():
            raise NotFoundError("File not found", details={"file_id": file_id})
        return self._to_item(path)

    async def rename(self, file_id: str, new_name: str) -> FileItem:
        source = self._resolve(file_id)
        if source == self.root:
            raise ValidationError("Configured storage root cannot be renamed")
        if not source.exists():
            raise NotFoundError("File or directory not found", details={"file_id": file_id})
        validation_error = self.validate_name(new_name)
        if validation_error is not None:
            raise ValidationError(validation_error, details={"new_name": new_name})

        target = source.with_name(new_name)
        if (target.exists() or self._is_link(target)) and target != source:
            raise RenameConflictError(
                "Target filename already exists",
                details={"file_id": file_id, "new_name": new_name},
            )
        try:
            renamed = source.rename(target)
        except OSError as exc:
            raise ProviderError(
                "Local file rename failed",
                details={"file_id": file_id, "new_name": new_name},
            ) from exc
        return self._to_item(renamed)

    def validate_name(self, name: str) -> str | None:
        return validate_portable_name(name)
