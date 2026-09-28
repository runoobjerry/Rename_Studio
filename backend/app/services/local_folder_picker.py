from pathlib import Path

from app.core.errors import ProviderError


def choose_local_directory(initial_directory: Path) -> Path | None:
    """Open the backend machine's native directory chooser."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise ProviderError("System folder picker is unavailable") from exc

    window: tk.Tk | None = None
    try:
        window = tk.Tk()
        window.withdraw()
        # 将系统对话框置顶，避免它隐藏在浏览器窗口后方。
        window.attributes("-topmost", True)
        selected = filedialog.askdirectory(
            parent=window,
            title="选择本地根文件夹",
            initialdir=str(initial_directory),
            mustexist=True,
        )
    except tk.TclError as exc:
        raise ProviderError(
            "System folder picker requires a desktop environment"
        ) from exc
    finally:
        if window is not None:
            window.destroy()

    return Path(selected).resolve() if selected else None
