"""Synchronize release versions using only the Python 3.12+ standard library."""

import argparse
import ast
import json
from pathlib import Path
import re
import tomllib


ROOT = Path(__file__).resolve().parents[1]
NUMBER = r"(?:0|[1-9][0-9]*)"
VERSION = re.compile(
    rf"v?(?P<release>{NUMBER}\.{NUMBER}\.{NUMBER})"
    rf"(?:-(?P<stage>alpha|beta|rc)(?P<number>{NUMBER}))?"
)


def parse_version(value: str) -> tuple[str, str]:
    match = VERSION.fullmatch(value)
    if match is None:
        raise argparse.ArgumentTypeError(
            "Use X.Y.Z or X.Y.Z-alphaN/betaN/rcN, optionally prefixed with v "
            "(for example, v1.0.0-alpha2)."
        )
    release, stage, number = match.group("release", "stage", "number")
    if stage is None:
        return release, release
    python_stage = {"alpha": "a", "beta": "b", "rc": "rc"}[stage]
    return f"{release}-{stage}{number}", f"{release}{python_stage}{number}"


def update_project(source: str, version: str) -> str:
    project = tomllib.loads(source)["project"]
    if project["version"] == version:
        return source
    section = re.search(r"(?ms)^\[project\][^\n]*\n.*?(?=^\[|\Z)", source)
    if section is None:
        raise ValueError("backend/pyproject.toml: missing [project] section")
    updated, count = re.subn(
        r'(?m)^(version\s*=\s*)"[^"\r\n]*"',
        lambda match: f'{match[1]}"{version}"',
        section[0],
    )
    if count != 1:
        raise ValueError("backend/pyproject.toml: expected one quoted project version")
    return source[:section.start()] + updated + source[section.end():]


def update_json(source: str, version: str, *, lockfile: bool = False) -> str:
    document = json.loads(source)
    targets = [document]
    if lockfile:
        # Only the root package changes; dependency versions stay locked.
        targets.append(document["packages"][""])
    if all(target["version"] == version for target in targets):
        return source
    for target in targets:
        target["version"] = version
    newline = "\r\n" if "\r\n" in source else "\n"
    ending = newline if source.endswith("\n") else ""
    return json.dumps(document, ensure_ascii=False, indent=2).replace("\n", newline) + ending


def update_api(source: str, version: str) -> str:
    versions = [
        keyword.value
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "FastAPI"
        for keyword in node.keywords
        if keyword.arg == "version"
    ]
    if len(versions) != 1 or not isinstance(versions[0], ast.Constant):
        raise ValueError("backend/app/main.py: expected one literal FastAPI version")
    node = versions[0]
    if not isinstance(node.value, str):
        raise ValueError("backend/app/main.py: FastAPI version must be a string")
    if node.value == version:
        return source
    # AST columns count UTF-8 bytes, so slice bytes to preserve surrounding code.
    lines = source.encode("utf-8").splitlines(keepends=True)
    start = sum(map(len, lines[:node.lineno - 1])) + node.col_offset
    end = sum(map(len, lines[:node.end_lineno - 1])) + node.end_col_offset
    content = b"".join(lines)
    return (content[:start] + json.dumps(version).encode("utf-8") + content[end:]).decode("utf-8")


def update_changelog(source: str, version: str) -> str:
    headings = list(re.finditer(
        r"(?m)^## \[[^\]\r\n]+\](?=\r?$)",
        source,
    ))
    if len(headings) != 1:
        raise ValueError("CHANGELOG.md: expected one current version heading")
    heading = headings[0]
    updated = f"## [v{version}]"
    return source[:heading.start()] + updated + source[heading.end():]


def prepare_updates(version: str, python_version: str) -> dict[Path, str]:
    updates: dict[Path, str] = {}
    # Prepare every file before writing, so invalid input or layout cannot cause
    # a partial update. Filesystem write errors still require reviewing git diff.
    for relative in (
        "backend/pyproject.toml",
        "frontend/package.json",
        "frontend/package-lock.json",
        "backend/app/main.py",
        "CHANGELOG.md",
    ):
        path = ROOT / relative
        source = path.read_bytes().decode("utf-8")
        if relative == "backend/pyproject.toml":
            updated = update_project(source, python_version)
        elif relative == "backend/app/main.py":
            updated = update_api(source, version)
        elif relative == "CHANGELOG.md":
            updated = update_changelog(source, version)
        else:
            updated = update_json(source, version, lockfile=path.name == "package-lock.json")
        if updated != source:
            updates[path] = updated
    return updates


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", type=parse_version, help="For example: 1.0.0-alpha2 or v1.0.0")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="List changes without writing files")
    mode.add_argument("--check", action="store_true", help="Do not write; exit 1 if versions differ")
    args = parser.parse_args()
    version, python_version = args.version
    print(f"Release: v{version}; Python package: {python_version}")
    try:
        updates = prepare_updates(version, python_version)
        for path, content in updates.items():
            if not (args.dry_run or args.check):
                path.write_bytes(content.encode("utf-8"))
            action = "Needs update" if args.dry_run or args.check else "Updated"
            print(f"{action}: {path.relative_to(ROOT).as_posix()}")
    except (OSError, ValueError, KeyError, SyntaxError) as exc:
        parser.exit(1, f"Version update failed: {exc}\n")
    if not updates:
        print("All version fields already match.")
    return 1 if args.check and updates else 0


if __name__ == "__main__":
    raise SystemExit(main())
