import sys
from pathlib import Path
from shutil import which

from app.core.errors import ProviderError


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
