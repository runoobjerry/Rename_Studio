from pathlib import Path

import pytest

from app.core.errors import NotFoundError, ValidationError
from app.providers.local import LocalProvider


@pytest.mark.asyncio
async def test_lists_directories_before_files(tmp_path: Path) -> None:
    (tmp_path / "zeta.txt").write_text("z", encoding="utf-8")
    (tmp_path / "Folder").mkdir()
    (tmp_path / "alpha.txt").write_text("a", encoding="utf-8")
    provider = LocalProvider(tmp_path)

    items = await provider.list_files("")

    assert [item.name for item in items] == ["Folder", "alpha.txt", "zeta.txt"]
    assert items[0].is_directory is True


@pytest.mark.asyncio
async def test_rejects_path_outside_root(tmp_path: Path) -> None:
    provider = LocalProvider(tmp_path / "root")

    with pytest.raises(ValidationError):
        await provider.list_files("../")


@pytest.mark.asyncio
async def test_missing_file_has_domain_error(tmp_path: Path) -> None:
    provider = LocalProvider(tmp_path)

    with pytest.raises(NotFoundError):
        await provider.get_metadata("missing.txt")


@pytest.mark.parametrize(
    ("name", "is_valid"),
    [
        ("episode 01.mp4", True),
        ("你好.txt", True),
        ("", False),
        ("CON.txt", False),
        ("bad?.txt", False),
        ("trailing. ", False),
    ],
)
def test_validates_windows_compatible_names(
    tmp_path: Path, name: str, is_valid: bool
) -> None:
    provider = LocalProvider(tmp_path)
    assert (provider.validate_name(name) is None) is is_valid
