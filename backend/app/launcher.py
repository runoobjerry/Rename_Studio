"""Local release runner with graceful shutdown controlled by the owning PS1."""

import argparse
import asyncio
from contextlib import suppress
import ctypes
from ctypes import wintypes
from html.parser import HTMLParser
import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

import uvicorn


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


async def serve(stop_file: Path, parent_pid: int, instance_id: str) -> None:
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
        # Override only this child process; development .env and the PS session stay intact.
        os.environ["FRONTEND_ORIGIN"] = "http://localhost:8000"
        os.environ["STORAGE_REDIRECT_URI"] = "http://localhost:8000/auth/storage/callback"
        from app.release import create_release_app

        dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
        # launcher.py is in backend/app; the build lives beside backend.
        check_build(dist)
        server = uvicorn.Server(uvicorn.Config(
            create_release_app(dist, instance_id), host="127.0.0.1", port=8000,
            workers=1, reload=False, access_log=False, loop="asyncio",
            # Let in-flight rename requests finish before closing provider clients.
            timeout_graceful_shutdown=None,
        ))

        async def watch_owner() -> None:
            while True:
                owner_status = kernel.WaitForSingleObject(parent, 0)
                if owner_status == 0xFFFFFFFF:
                    raise ctypes.WinError(ctypes.get_last_error())
                if stop_file.exists() or owner_status == 0:
                    server.should_exit = True
                    return
                await asyncio.sleep(0.5)

        watcher = asyncio.create_task(watch_owner())
        serving = asyncio.create_task(server.serve())
        try:
            # Surface watcher failures instead of silently leaving an orphan server.
            done, _ = await asyncio.wait((watcher, serving), return_when=asyncio.FIRST_COMPLETED)
            if watcher in done:
                await watcher
        finally:
            server.should_exit = True
            try:
                await serving
            finally:
                watcher.cancel()
                with suppress(asyncio.CancelledError):
                    await watcher
    finally:
        kernel.CloseHandle(parent)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stop-file", required=True, type=Path)
    parser.add_argument("--parent-pid", required=True, type=int)
    parser.add_argument("--instance-id", required=True)
    args = parser.parse_args()
    asyncio.run(serve(args.stop_file, args.parent_pid, args.instance_id))


if __name__ == "__main__":
    main()
