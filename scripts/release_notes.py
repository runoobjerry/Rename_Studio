"""Extract one tagged version from CHANGELOG.md for the release draft."""

import argparse
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def release_notes(changelog: str, tag: str) -> str:
    lines = changelog.splitlines()
    heading = re.compile(rf"## \[{re.escape(tag)}\] - \d{{4}}-\d{{2}}-\d{{2}}")
    starts = [index for index, line in enumerate(lines) if heading.fullmatch(line)]
    if len(starts) != 1:
        raise ValueError(f"Expected exactly one CHANGELOG section for {tag}")
    start = starts[0]
    end = next(
        (index for index in range(start + 1, len(lines)) if lines[index].startswith("## ")),
        len(lines),
    )
    section = lines[start:end]
    categories = [line for line in section if line.startswith("### ")]
    if categories != [f"### {name}" for name in ("新增", "改进", "修复", "移除")]:
        raise ValueError("Release notes must contain 新增、改进、修复、移除 in order")
    entries = [line[2:].strip() for line in section if line.startswith("- ")]
    if not any(entry not in ("", "无", "无。") for entry in entries):
        raise ValueError(f"No release changes recorded for {tag}")
    return "\n".join(section).strip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag", help="Exact Git tag, for example v1.0.0-alpha4")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        notes = release_notes((ROOT / "CHANGELOG.md").read_text(encoding="utf-8"), args.tag)
        args.output.write_text(notes, encoding="utf-8", newline="\n")
    except (OSError, ValueError) as exc:
        parser.exit(1, f"Release notes failed: {exc}\n")


if __name__ == "__main__":
    main()
