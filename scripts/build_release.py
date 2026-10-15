"""Assemble a platform ZIP from an existing frontend build (Python 3.12+)."""

import argparse
import hashlib
from pathlib import Path
import shutil
import tempfile
import zipfile

from set_version import ROOT, parse_version, prepare_updates


def package_files(platform: str) -> dict[str, Path]:
    files = {
        "README.md": ROOT / "docs/RELEASE_README.md",
        "LICENSE": ROOT / "LICENSE",
        "backend/pyproject.toml": ROOT / "backend/pyproject.toml",
        "backend/requirements-runtime.txt": ROOT / "backend/requirements-runtime.txt",
    }
    if platform == "windows":
        files["Start.ps1"] = ROOT / "Start.ps1"
    else:
        files["Start.sh"] = ROOT / "Start.sh"
        files["backend/scripts/start_macos.py"] = ROOT / "backend/scripts/start_macos.py"

    # Include application source, never the backend directory with user state.
    for path in sorted((ROOT / "backend/app").rglob("*.py")):
        if "__pycache__" not in path.parts:
            files[path.relative_to(ROOT).as_posix()] = path

    dist = ROOT / "frontend/dist"
    if not (dist / "index.html").is_file():
        raise ValueError("Missing frontend/dist/index.html; build the frontend first")
    for path in sorted(dist.rglob("*")):
        if path.is_file():
            files[path.relative_to(ROOT).as_posix()] = path

    required = {"backend/app/main.py", "backend/app/launcher.py", "backend/app/release.py"}
    if not required.issubset(files):
        raise ValueError("Missing required backend application files")
    for relative, source in files.items():
        # dist is generated, but still reject accidental state/credential files.
        parts = Path(relative).parts
        if any(
            part.startswith((".env", "settings.json"))
            or part in {".runtime", ".venv", "node_modules", "__pycache__", ".DS_Store"}
            or part.endswith((".pyc", ".log"))
            for part in parts
        ):
            raise ValueError(f"Unexpected local data in package input: {relative}")
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Package input must be a regular file: {relative}")
    return files


def build(version: str, python_version: str, platform: str, output: Path) -> Path:
    mismatches = prepare_updates(version, python_version)
    if mismatches:
        paths = ", ".join(path.relative_to(ROOT).as_posix() for path in mismatches)
        raise ValueError(f"Version mismatch ({paths}); run scripts/set_version.py first")
    files = package_files(platform)
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"Rename_Studio-v{version}-{platform}.zip"
    checksum = archive.with_suffix(".zip.sha256")
    if archive.exists() or checksum.exists():
        raise FileExistsError(f"Release output already exists: {archive.name}")

    with tempfile.TemporaryDirectory(prefix="rename-studio-package-") as temporary:
        staging = Path(temporary) / "Rename_Studio"
        for relative, source in files.items():
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        readme = staging / "README.md"
        readme.write_text(
            readme.read_text(encoding="utf-8").replace("{{TAG}}", f"v{version}"),
            encoding="utf-8", newline="\n",
        )
        if platform == "macos" and b"\r" in (staging / "Start.sh").read_bytes():
            raise ValueError("Start.sh must use LF line endings; check .gitattributes")

        staged_archive = Path(temporary) / archive.name
        with zipfile.ZipFile(staged_archive, "x", compression=zipfile.ZIP_DEFLATED) as bundle:
            for relative in sorted(files):
                bundle.write(staging / relative, f"Rename_Studio/{relative}")
        with zipfile.ZipFile(staged_archive) as bundle:
            expected = {f"Rename_Studio/{relative}" for relative in files}
            if set(bundle.namelist()) != expected or bundle.testzip() is not None:
                raise ValueError("ZIP content verification failed")
        # Exclusive creation also prevents overwriting an earlier local build.
        with archive.open("xb") as destination, staged_archive.open("rb") as source:
            shutil.copyfileobj(source, destination)

    with archive.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    with checksum.open("x", encoding="utf-8", newline="\n") as destination:
        destination.write(f"{digest}  {archive.name}\n")
    return archive


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", type=parse_version, help="For example: v1.0.0-alpha2")
    parser.add_argument("--platform", choices=("windows", "macos"), required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/releases")
    args = parser.parse_args()
    try:
        archive = build(*args.version, args.platform, args.output)
    except (OSError, ValueError, KeyError, SyntaxError, zipfile.BadZipFile) as exc:
        parser.exit(1, f"Packaging failed: {exc}\n")
    print(f"Created: {archive}")
    print(f"Checksum: {archive.with_suffix('.zip.sha256')}")


if __name__ == "__main__":
    main()
