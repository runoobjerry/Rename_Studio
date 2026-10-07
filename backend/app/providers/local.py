import json
import logging
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


logger = logging.getLogger("onedriver_renamer.local_provider")


class LocalProvider(StorageProvider):
    id = "local"
    display_name = "Local Files"

    def __init__(self, root: Path, *, settings_file: Path | None = None) -> None:
        self.settings_file = settings_file
        self.root = self._load_root(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def configure_root(self, root: str) -> Path:
        candidate = Path(root).expanduser().resolve()
        if not candidate.exists() or not candidate.is_dir():
            raise ValidationError(
                "Local root must be an existing directory",
                details={"root_path": root},
            )
        self._save_root(candidate)
        self.root = candidate
        return self.root

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
            location=PathLocation(value=relative) if relative else RootLocation(),
            parent_location=PathLocation(value=parent) if parent else RootLocation(),
            can_rename=path != self.root,
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
        if target.exists() and target != source:
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

    def _load_root(self, fallback: Path) -> Path:
        if self.settings_file is None or not self.settings_file.exists():
            return fallback
        try:
            payload = json.loads(self.settings_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("could not load local settings path=%s", self.settings_file)
            return fallback
        root_path = payload.get("root_path") if isinstance(payload, dict) else None
        if not isinstance(root_path, str) or not root_path:
            return fallback
        configured = Path(root_path).expanduser().resolve()
        if configured.exists() and configured.is_dir():
            return configured
        logger.warning("configured local root is unavailable path=%s", configured)
        return fallback

    def _save_root(self, root: Path) -> None:
        if self.settings_file is None:
            return
        temporary = self.settings_file.with_name(f"{self.settings_file.name}.tmp")
        try:
            self.settings_file.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(
                json.dumps({"root_path": str(root)}, ensure_ascii=False),
                encoding="utf-8",
            )
            temporary.replace(self.settings_file)
        except OSError as exc:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                logger.warning("could not remove temporary local settings path=%s", temporary)
            raise ProviderError("Could not save the local root directory") from exc
