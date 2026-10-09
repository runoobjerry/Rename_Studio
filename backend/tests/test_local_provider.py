from pathlib import Path
import os

import pytest

from app.core.errors import NotFoundError, RenameConflictError, ValidationError
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


@pytest.mark.asyncio
async def test_renames_file_without_leaving_its_parent(tmp_path: Path) -> None:
    (tmp_path / "old.txt").write_text("content", encoding="utf-8")
    provider = LocalProvider(tmp_path)

    renamed = await provider.rename("old.txt", "new.txt")

    assert renamed.id == "new.txt"
    assert not (tmp_path / "old.txt").exists()
    assert (tmp_path / "new.txt").read_text(encoding="utf-8") == "content"


@pytest.mark.asyncio
async def test_rename_rejects_existing_target(tmp_path: Path) -> None:
    (tmp_path / "old.txt").write_text("old", encoding="utf-8")
    (tmp_path / "new.txt").write_text("new", encoding="utf-8")
    provider = LocalProvider(tmp_path)

    with pytest.raises(RenameConflictError):
        await provider.rename("old.txt", "new.txt")


@pytest.mark.asyncio
async def test_renames_directory_without_touching_children(tmp_path: Path) -> None:
    folder = tmp_path / "old-folder"
    folder.mkdir()
    (folder / "child.txt").write_text("child", encoding="utf-8")
    provider = LocalProvider(tmp_path)

    renamed = await provider.rename("old-folder", "new-folder")

    assert renamed.is_directory is True
    assert renamed.id == "new-folder"
    assert (tmp_path / "new-folder" / "child.txt").read_text(encoding="utf-8") == "child"


@pytest.mark.asyncio
async def test_cannot_rename_configured_storage_root(tmp_path: Path) -> None:
    provider = LocalProvider(tmp_path)

    with pytest.raises(ValidationError):
        await provider.rename("", "renamed-root")


@pytest.mark.asyncio
@pytest.mark.parametrize("target_kind", ["file", "directory", "missing"])
async def test_links_are_listed_but_cannot_be_read_or_renamed(
    tmp_path: Path, target_kind: str,
) -> None:
    target = tmp_path / "target"
    if target_kind == "file":
        target.write_text("unchanged", encoding="utf-8")
    elif target_kind == "directory":
        target.mkdir()
    link = tmp_path / "link"
    link.symlink_to(target, target_is_directory=target_kind == "directory")
    provider = LocalProvider(tmp_path)

    items = await provider.list_files("")
    link_item = next(item for item in items if item.name == "link")
    assert link_item.id == "link"
    assert link_item.can_rename is False
    assert link_item.is_directory is False
    with pytest.raises(ValidationError):
        await provider.get_metadata("link")
    with pytest.raises(ValidationError):
        await provider.rename("link", "renamed")
    with pytest.raises(ValidationError):
        await provider.list_files("link")
    assert link.is_symlink()
    assert not (tmp_path / "renamed").exists()
    if target_kind == "file":
        assert target.read_text(encoding="utf-8") == "unchanged"
    elif target_kind == "directory":
        assert target.is_dir()


@pytest.mark.asyncio
async def test_rejects_files_beneath_linked_directory(tmp_path: Path) -> None:
    target = tmp_path / "target"
    target.mkdir()
    (target / "child.txt").write_text("unchanged", encoding="utf-8")
    (tmp_path / "link").symlink_to(target, target_is_directory=True)
    provider = LocalProvider(tmp_path)

    with pytest.raises(ValidationError):
        await provider.get_metadata("link/child.txt")
    with pytest.raises(ValidationError):
        await provider.rename("link/child.txt", "renamed.txt")
    assert (target / "child.txt").read_text(encoding="utf-8") == "unchanged"


@pytest.mark.asyncio
async def test_rename_rejects_dangling_link_target(tmp_path: Path) -> None:
    (tmp_path / "source.txt").write_text("unchanged", encoding="utf-8")
    (tmp_path / "occupied.txt").symlink_to(tmp_path / "missing.txt")
    provider = LocalProvider(tmp_path)

    with pytest.raises(RenameConflictError):
        await provider.rename("source.txt", "occupied.txt")
    assert (tmp_path / "source.txt").read_text(encoding="utf-8") == "unchanged"
    assert (tmp_path / "occupied.txt").is_symlink()


@pytest.mark.asyncio
@pytest.mark.skipif(os.name != "nt", reason="Directory junctions are Windows-specific")
async def test_rejects_directory_junction(tmp_path: Path) -> None:
    from _winapi import CreateJunction

    target = tmp_path / "target"
    target.mkdir()
    (target / "child.txt").write_text("unchanged", encoding="utf-8")
    junction = tmp_path / "junction"
    try:
        CreateJunction(str(target), str(junction))
    except PermissionError:
        pytest.skip("The current environment does not permit directory junction creation")
    provider = LocalProvider(tmp_path)

    items = await provider.list_files("")
    assert next(item for item in items if item.name == "junction").can_rename is False
    with pytest.raises(ValidationError):
        await provider.list_files("junction")
    with pytest.raises(ValidationError):
        await provider.rename("junction", "renamed")
    with pytest.raises(ValidationError):
        await provider.rename("junction/child.txt", "renamed.txt")
    assert junction.is_junction()
    assert (target / "child.txt").read_text(encoding="utf-8") == "unchanged"
