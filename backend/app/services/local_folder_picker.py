import asyncio
import sys
from pathlib import Path
from shutil import which

from app.core.errors import ProviderError, StorageConnectionChangedError, ValidationError
from app.schemas.storage import LocalFolderPickResponse, StorageUpdate
from app.services.storage_manager import StorageManager


async def pick_connection_directory(storage_id: str, manager: StorageManager) -> LocalFolderPickResponse:
    manager.ensure_mutable(storage_id)
    before = manager.record(storage_id)
    if not manager.provider_definition(storage_id).local_picker:
        raise ValidationError("This storage does not support a local folder picker")
    root = Path(str(before.config["root_path"]))
    selected = await asyncio.to_thread(choose_local_directory, root)
    if manager.revision(storage_id) != before.revision:
        raise StorageConnectionChangedError("Storage changed while choosing a directory")
    if selected is not None:
        info = await manager.update(storage_id, StorageUpdate(config={"root_path": str(selected)}))
        root = Path(str(info.config["root_path"]))
    return LocalFolderPickResponse(root_path=str(root), selected=selected is not None)


async def pick_draft_directory(root: Path) -> LocalFolderPickResponse:
    selected = await asyncio.to_thread(choose_local_directory, root)
    return LocalFolderPickResponse(root_path=str(selected if selected is not None else root),
                                   selected=selected is not None)


def choose_local_directory(initial_directory: Path) -> Path | None:
    """Open the backend machine's native directory chooser."""
    # crossfiledialog 在导入时选择后端，提前说明 Linux 缺少的系统依赖。
    if sys.platform == "linux" and not (which("zenity") or which("kdialog")):
        raise ProviderError("System folder picker requires Zenity or KDialog on Linux")

    try:
        import crossfiledialog
        from crossfiledialog.exceptions import FileDialogException
    except ImportError as exc:
        raise ProviderError("System folder picker is unavailable") from exc

    try:
        selected = crossfiledialog.choose_folder(
            title="选择本地根文件夹",
            start_dir=str(initial_directory),
        )
    except FileDialogException as exc:
        # crossfiledialog 1.3.1 的 macOS 后端将用户取消 (-128) 作为异常返回。
        if sys.platform == "darwin" and str(exc).endswith("(-128)"):
            return None
        raise ProviderError("System folder picker failed") from exc
    except OSError as exc:
        raise ProviderError("System folder picker is unavailable") from exc

    return Path(selected).resolve() if selected else None
