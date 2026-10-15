"""Smoke-check an extracted release using an already provisioned runtime Python."""

import argparse
from importlib.metadata import version as installed_version
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import ProxyHandler, build_opener
from uuid import uuid4
import zipfile


def check_release(archive: Path) -> None:
    instance_id = uuid4().hex
    opener = build_opener(ProxyHandler({}))

    def request(path: str) -> bytes:
        with opener.open(f"http://127.0.0.1:8000{path}", timeout=3) as response:
            if response.headers["x-rename-studio-instance"] != instance_id:
                raise RuntimeError("Port 8000 belongs to another service")
            return response.read()

    with tempfile.TemporaryDirectory(prefix="rename-studio-check-") as temporary:
        scratch = Path(temporary)
        with zipfile.ZipFile(archive) as bundle:
            for name in bundle.namelist():
                target = (scratch / name).resolve()
                if not name.startswith("Rename_Studio/") or not target.is_relative_to(scratch):
                    raise ValueError(f"Unexpected ZIP entry: {name}")
            bundle.extractall(scratch)
        package = scratch / "Rename_Studio"
        requirements = package / "backend/requirements-runtime.txt"
        for line in requirements.read_text(encoding="utf-8").splitlines():
            if line and not line.startswith("#"):
                name, expected = line.split("==")
                actual = installed_version(name)
                if actual != expected:
                    raise ValueError(f"Runtime dependency mismatch: {name} {actual} != {expected}")

        local_root = scratch / "local-files"
        local_root.mkdir()
        stop_file = scratch / "service.stop"
        environment = os.environ.copy()
        environment.pop("PYTHONPATH", None)
        environment.update({
            "LOCAL_STORAGE_ROOT": str(local_root),
            "STORAGE_STATE_FILE": str(scratch / "settings.json"),
            "PYTHONDONTWRITEBYTECODE": "1",
        })
        # No launcher interaction, user credentials, cloud access or rename writes.
        with (scratch / "service.log").open("w+", encoding="utf-8") as log:
            process = subprocess.Popen(
                [sys.executable, "-m", "app.launcher", "--stop-file", str(stop_file),
                 "--parent-pid", str(os.getpid()), "--instance-id", instance_id],
                cwd=package / "backend", env=environment, stdout=log, stderr=log,
            )
            try:
                try:
                    deadline = time.monotonic() + 30
                    while True:
                        if process.poll() is not None:
                            raise RuntimeError("Release service exited before becoming ready")
                        try:
                            health = json.loads(request("/health"))
                            break
                        except (URLError, TimeoutError):
                            if time.monotonic() >= deadline:
                                raise RuntimeError("Release service was not ready within 30 seconds")
                            time.sleep(0.25)
                    if health != {"status": "ok"} or json.loads(request("/api/health")) != health:
                        raise RuntimeError("Health API response mismatch")
                    dist = package / "frontend/dist"
                    if request("/") != (dist / "index.html").read_bytes():
                        raise RuntimeError("Root page does not match the packaged frontend")
                    for asset in dist.rglob("*"):
                        if asset.is_file():
                            path = quote(asset.relative_to(dist).as_posix(), safe="/")
                            if request(f"/{path}") != asset.read_bytes():
                                raise RuntimeError(f"Static resource mismatch: {path}")
                    for path in ("/api/rules", "/api/storages", "/api/app-settings"):
                        json.loads(request(path))
                    try:
                        request("/api/not-a-real-route")
                    except HTTPError as exc:
                        if exc.code != 404:
                            raise
                    else:
                        raise RuntimeError("Unknown API route should return 404")
                finally:
                    stop_file.write_text("stop", encoding="utf-8")
                    try:
                        process.wait(timeout=30)
                    except subprocess.TimeoutExpired as exc:
                        # Only this isolated, read-only check process can be killed.
                        process.kill()
                        process.wait()
                        raise RuntimeError("Release check service did not stop gracefully") from exc
                if process.returncode != 0:
                    raise RuntimeError(f"Release service exited with code {process.returncode}")
            except (OSError, ValueError, RuntimeError):
                log.seek(0)
                print(log.read(), file=sys.stderr)
                raise
    print("Release smoke check passed: dependencies, page, static resources, APIs, shutdown")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    check_release(args.archive)


if __name__ == "__main__":
    main()
