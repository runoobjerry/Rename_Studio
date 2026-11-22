"""Log sessions shared by the launchers and server."""

import argparse
import os
import re
import stat
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

# Recognize older launcher sessions so existing logs still follow retention.
_SESSION_NAME = re.compile(r"session-[0-9]{8}T[0-9]{12}Z-(?:[0-9a-f]{32}|[a-zA-Z0-9]{6})")
_SESSION_FILES = {"launcher.log", "app.log", ".closed"}
_RETAINED_SESSIONS = 10


def _is_link(path: Path) -> bool:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
    )


def create_log_session(log_root: Path) -> Path:
    if any(_is_link(path) for path in (log_root, log_root.parent)):
        raise OSError("Log directory is a link")
    log_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    session = log_root / f"session-{stamp}-{uuid4().hex[:6]}"
    session.mkdir()
    return session


def prune_log_sessions(current: Path, *, closed_only: bool = False) -> None:
    """Require an exclusive server log guard unless cleaning already closed sessions."""
    sessions = sorted(
        (path for path in current.parent.iterdir()
         if path != current and _SESSION_NAME.fullmatch(path.name)
         and not _is_link(path) and path.is_dir()),
        reverse=True,
    )
    for session in sessions[_RETAINED_SESSIONS - 1:]:
        try:
            files = list(session.iterdir())
            if closed_only and session / ".closed" not in files:
                continue
            if any(path.name not in _SESSION_FILES or _is_link(path) or not path.is_file() for path in files):
                continue
            for path in files:
                path.unlink()
            session.rmdir()
        except OSError:
            continue


@contextmanager
def _windows_cleanup_guard(path: Path) -> Iterator[None]:
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = (
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
        wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
    )
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel.CloseHandle.restype = wintypes.BOOL
    # GENERIC_READ | GENERIC_WRITE, no sharing, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL.
    handle = kernel.CreateFileW(str(path), 0xC0000000, 0, None, 4, 0x80, None)
    if handle == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        yield
    finally:
        kernel.CloseHandle(handle)


@contextmanager
def server_log_guard(runtime: Path, *, pruning: bool = False) -> Iterator[None]:
    path = runtime / "service-logs.lock"
    if os.name == "nt" and pruning:
        with _windows_cleanup_guard(path):
            yield
        return
    with path.open("a+b") as guard:
        if os.name != "nt":
            import fcntl

            mode = fcntl.LOCK_EX | fcntl.LOCK_NB if pruning else fcntl.LOCK_SH
            fcntl.flock(guard, mode)
        yield


def prepare_log_session(runtime: Path) -> Path:
    session = create_log_session(runtime / "logs")
    with suppress(OSError), server_log_guard(runtime, pruning=True):
        prune_log_sessions(session)
    return session


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare an application log session.")
    parser.add_argument("--runtime", required=True, type=Path)
    args = parser.parse_args()
    session = prepare_log_session(args.runtime)
    # The PowerShell caller already knows the root. Only emit the ASCII directory name.
    print(session.name)


if __name__ == "__main__":
    main()
