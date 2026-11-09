import errno
import stat
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from app.core.errors import (
    AppError,
    PermissionDeniedError,
    RenameOutcomeUnknownError,
    NotFoundError,
    ProviderError,
    RenameConflictError,
    ValidationError,
)
from app.providers.base import StorageDriver
from app.providers.name_validation import NameValidationIssue, validate_portable_name
from app.schemas.files import FileItem
from app.schemas.storage import PathLocation, RootLocation


class LocalDriver(StorageDriver):
    provider_type = "local"

    def __init__(self, root: Path) -> None:
        try:
            self.root = root.expanduser().resolve()
            self.root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise self._os_error(exc) from exc

    def _resolve(self, relative_path: str) -> Path:
        normalized = relative_path.replace("\\", "/").strip("/")
        candidate = self.root
        # 必须在 resolve 跟随链接前检查每个路径分量，包含链接目录下的文件。
        for part in Path(normalized).parts:
            candidate = candidate / part
            if self._is_link(candidate):
                raise ValidationError("Symbolic links and directory junctions are not supported", details={"reason": "SYMBOLIC_LINK_UNSUPPORTED", "params": {}})
        candidate = candidate.resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise ValidationError("Path is outside the configured storage root", details={"reason": "LOCATION_OUTSIDE_ROOT", "params": {}}) from exc
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
        try:
            directory = self._resolve(path)
            if not stat.S_ISDIR(directory.stat().st_mode):
                raise NotFoundError("Directory not found", details={"path": path})
            # 链接保留在冲突集合中，但不读取目标元数据，也不允许进入链接目录。
            return sorted(
                (self._to_item(child) for child in directory.iterdir()),
                key=lambda item: (not item.is_directory, item.name.casefold()),
            )
        except OSError as exc:
            error = self._os_error(exc)
            error.details.update({"path": path})
            raise error from exc

    async def get_metadata(self, file_id: str) -> FileItem:
        try:
            path = self._resolve(file_id)
            return self._to_item(path)
        except OSError as exc:
            error = self._os_error(exc)
            error.details.update({"file_id": file_id})
            raise error from exc

    async def rename(self, file_id: str, new_name: str) -> FileItem:
        try:
            source = self._resolve(file_id)
            if source == self.root:
                raise ValidationError("Configured storage root cannot be renamed", details={"reason": "ROOT_RENAME_UNSUPPORTED", "params": {}})
            source.stat()
            validation_error = self.validate_name(new_name)
            if validation_error is not None:
                raise ValidationError(validation_error.message, details={"new_name": new_name, **validation_error.details})

            target = source.with_name(new_name)
            if (target.exists() or self._is_link(target)) and target != source:
                raise RenameConflictError(
                    "Target filename already exists",
                    details={"file_id": file_id, "new_name": new_name},
                )
            renamed = source.rename(target)
            try:
                return self._to_item(renamed)
            except OSError as exc:
                # The rename returned successfully; metadata failure cannot undo that fact.
                raise RenameOutcomeUnknownError(
                    "Local rename completed but confirmation metadata could not be read",
                    details=self._os_error(exc).details,
                ) from exc
        except OSError as exc:
            error = self._os_error(exc)
            error.details.update({"file_id": file_id, "new_name": new_name})
            raise error from exc

    @staticmethod
    def _os_error(exc: OSError) -> AppError:
        details = {"provider_type": "local", "errno": exc.errno}
        # winerror is exposed only by Windows OS exceptions, not all OSError instances.
        if hasattr(exc, "winerror"):
            details["winerror"] = exc.winerror
            if exc.winerror in {32, 33}:
                return ProviderError("Local file is in use", details=details)
        error_type = {
            errno.ENOENT: NotFoundError,
            errno.ENOTDIR: NotFoundError,
            errno.EACCES: PermissionDeniedError,
            errno.EPERM: PermissionDeniedError,
            errno.EROFS: PermissionDeniedError,
            errno.EEXIST: RenameConflictError,
            errno.ENOTEMPTY: RenameConflictError,
            errno.EINVAL: ValidationError,
            errno.ENAMETOOLONG: ValidationError,
        }.get(exc.errno, ProviderError)
        return error_type("Local filesystem operation failed", details=details)

    def validate_name(self, name: str) -> NameValidationIssue | None:
        return validate_portable_name(name)
