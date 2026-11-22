"""Local release runner with graceful shutdown controlled by its owning launcher."""

import argparse
import asyncio
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager, suppress
from html.parser import HTMLParser
import logging
import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

from app.core.log_config import file_logging, terminal_logging
from app.core.log_sessions import server_log_guard


logger = logging.getLogger("rename_studio.app")


class BuildReferences(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if value and (name == "src" or (tag == "link" and name == "href")):
                self.references.append(value)


def check_build(dist: Path) -> None:
    parser = BuildReferences()
    parser.feed((dist / "index.html").read_text(encoding="utf-8"))
    for reference in parser.references:
        url = urlsplit(reference)
        if url.scheme or url.netloc or not url.path:
            continue
        asset = (dist / unquote(url.path).lstrip("/")).resolve()
        if not asset.is_relative_to(dist) or not asset.is_file():
            raise RuntimeError(f"Frontend build is incomplete: {reference}")


@contextmanager
def watch_parent(parent_pid: int) -> Iterator[Callable[[], bool]]:
    if os.name != "nt":
        # A child is reparented when its owner dies; no PID lookup/reuse is involved.
        yield lambda: os.getppid() != parent_pid
        return

    import ctypes
    from ctypes import wintypes

    # Keep a handle to the actual owner, so PID reuse cannot confuse shutdown.
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    parent = kernel.OpenProcess(0x00100000, False, parent_pid)  # SYNCHRONIZE
    if not parent:
        raise ctypes.WinError(ctypes.get_last_error())

    try:
        def parent_exited() -> bool:
            owner_status = kernel.WaitForSingleObject(parent, 0)
            if owner_status == 0xFFFFFFFF:
                raise ctypes.WinError(ctypes.get_last_error())
            return owner_status == 0

        yield parent_exited
    finally:
        kernel.CloseHandle(parent)


async def serve(stop_file: Path, parent_pid: int, instance_id: str) -> None:
    import uvicorn

    def log_async_error(_loop, context) -> None:
        logger.error("Background task failed", exc_info=context.get("exception"))

    asyncio.get_running_loop().set_exception_handler(log_async_error)
    with watch_parent(parent_pid) as parent_exited:
        # Override only this child process; development .env and the PS session stay intact.
        os.environ["FRONTEND_ORIGIN"] = "http://localhost:8000"
        os.environ["STORAGE_REDIRECT_URI"] = "http://localhost:8000/auth/storage/callback"
        from app.release import create_release_app

        dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
        # launcher.py is in backend/app; the build lives beside backend.
        check_build(dist)
        app = create_release_app(dist, instance_id)
        server = uvicorn.Server(uvicorn.Config(
            app, host="127.0.0.1", port=8000,
            workers=1, reload=False, access_log=False, log_config=None, loop="asyncio",
            # Let in-flight rename requests finish before closing storage drivers.
            timeout_graceful_shutdown=None,
        ))

        async def watch_owner() -> None:
            reported_started = False
            while True:
                if server.started and not reported_started:
                    logger.info("Application started version=%s", app.version)
                    reported_started = True
                if stop_file.exists() or parent_exited():
                    server.should_exit = True
                    return
                await asyncio.sleep(0.5)

        watcher = asyncio.create_task(watch_owner())
        serving = asyncio.create_task(server.serve())
        try:
            await asyncio.wait((watcher, serving), return_when=asyncio.FIRST_COMPLETED)
        finally:
            server.should_exit = True
            try:
                await serving
            finally:
                watcher.cancel()
                with suppress(asyncio.CancelledError):
                    await watcher
        if not server.started:
            raise RuntimeError("Server did not start")
        logger.info("Application stopped")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stop-file", required=True, type=Path)
    parser.add_argument("--parent-pid", required=True, type=int)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--log-dir", type=Path)
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--terminal-relay", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    # Uvicorn's free-form messages may include URLs or exception text. The app
    # owns HTTP and lifecycle logging, including when startup fails.
    server_logger = logging.getLogger("uvicorn")
    server_logger.addHandler(logging.NullHandler())
    server_logger.propagate = False
    with ExitStack() as stack:
        log_file = None
        if args.log_dir is not None:
            try:
                stack.enter_context(server_log_guard(args.log_dir.parent.parent))
            except OSError:
                pass
            else:
                log_file = args.log_dir / "app.log"
        stack.enter_context(file_logging(log_file, debug=args.debug))
        stack.enter_context(terminal_logging(relay=args.terminal_relay))
        logger.info("Application initialization started log_level=%s", "DEBUG" if args.debug else "INFO")
        try:
            asyncio.run(serve(args.stop_file, args.parent_pid, args.instance_id))
        except SystemExit as exc:
            code = exc.code if isinstance(exc.code, int) else 1
            logger.error("Application server exited during startup exit_code=%s", code)
            return code
        except Exception:
            logger.exception("Application server failed")
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
