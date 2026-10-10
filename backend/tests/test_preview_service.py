from app.schemas.storage import RootLocation
from provider_fixtures import registry_for
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import BaseModel

from app.core.errors import PreviewExpiredError, PreviewNotFoundError, ValidationError
from app.providers.local import LocalProvider
from app.rules.base import RenameRule, RuleContext
from app.rules.registry import RuleRegistry
from app.schemas.files import FileItem
from app.schemas.rename import PreviewItem, RenamePreviewRequest
from app.schemas.rules import RuleSpec
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine


class ConstantConfig(BaseModel):
    value: str


class ConstantRule(RenameRule[ConstantConfig]):
    type = "test_constant"
    display_name = "Test constant"
    description = "Test-only rule"
    config_model = ConstantConfig

    def apply(
        self, filename: str, context: RuleContext, config: ConstantConfig
    ) -> str:
        return config.value


class CountingLocalProvider(LocalProvider):
    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.list_calls = 0
        self.metadata_many_calls = 0

    async def list_files(self, path: str) -> list[FileItem]:
        self.list_calls += 1
        return await super().list_files(path)

    async def get_metadata_many(self, file_ids: list[str]) -> list[FileItem]:
        self.metadata_many_calls += 1
        return await super().get_metadata_many(file_ids)


def build_service(root: Path, *, with_test_rule: bool = False) -> PreviewService:
    providers = registry_for([LocalProvider(root)])
    rules = RuleRegistry()
    if with_test_rule:
        rules.register(ConstantRule())
    return PreviewService(providers, RenameEngine(rules))


@pytest.mark.asyncio
async def test_empty_rules_produce_read_only_unchanged_preview(tmp_path: Path) -> None:
    file_path = tmp_path / "one.txt"
    file_path.write_text("unchanged", encoding="utf-8")
    service = build_service(tmp_path)

    preview = await service.preview(
        RenamePreviewRequest(storage_id="local", file_ids=["one.txt"], rules=[])
    )

    assert preview.valid is True
    assert preview.items[0].original_name == "one.txt"
    assert preview.items[0].new_name == "one.txt"
    assert preview.items[0].changed is False
    assert file_path.read_text(encoding="utf-8") == "unchanged"


@pytest.mark.asyncio
async def test_known_directory_preview_uses_one_listing(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    provider = CountingLocalProvider(tmp_path)
    service = PreviewService(
        registry_for([provider]), RenameEngine(RuleRegistry())
    )

    preview = await service.preview(
        RenamePreviewRequest(
            storage_id="local", location=RootLocation(), file_ids=["one.txt"], rules=[]
        )
    )

    assert preview.valid is True
    assert provider.list_calls == 1
    assert provider.metadata_many_calls == 0


@pytest.mark.asyncio
async def test_rejects_duplicate_file_ids(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    service = build_service(tmp_path)

    with pytest.raises(ValidationError):
        await service.preview(
            RenamePreviewRequest(
                storage_id="local", file_ids=["one.txt", "one.txt"], rules=[]
            )
        )


@pytest.mark.asyncio
async def test_detects_duplicate_targets(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    (tmp_path / "two.txt").write_text("two", encoding="utf-8")
    service = build_service(tmp_path, with_test_rule=True)

    preview = await service.preview(
        RenamePreviewRequest(
            storage_id="local",
            file_ids=["one.txt", "two.txt"],
            rules=[RuleSpec(type="test_constant", config={"value": "same.txt"})],
        )
    )

    assert preview.valid is False
    assert all(item.conflict for item in preview.items)


@pytest.mark.asyncio
async def test_detects_existing_file_conflict(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    (tmp_path / "occupied.txt").write_text("occupied", encoding="utf-8")
    service = build_service(tmp_path, with_test_rule=True)

    preview = await service.preview(
        RenamePreviewRequest(
            storage_id="local",
            file_ids=["one.txt"],
            rules=[RuleSpec(type="test_constant", config={"value": "occupied.txt"})],
        )
    )

    assert preview.valid is False
    assert preview.items[0].conflict is True


@pytest.mark.asyncio
async def test_allows_directory_name_in_preview(tmp_path: Path) -> None:
    (tmp_path / "folder").mkdir()
    service = build_service(tmp_path)

    preview = await service.preview(
        RenamePreviewRequest(storage_id="local", file_ids=["folder"], rules=[])
    )

    assert preview.valid is True
    assert preview.items[0].original_name == "folder"


@pytest.mark.asyncio
async def test_rejects_items_from_different_parent_directories(tmp_path: Path) -> None:
    (tmp_path / "root.txt").write_text("root", encoding="utf-8")
    (tmp_path / "folder").mkdir()
    (tmp_path / "folder" / "child.txt").write_text("child", encoding="utf-8")
    service = build_service(tmp_path)

    with pytest.raises(ValidationError):
        await service.preview(
            RenamePreviewRequest(
                storage_id="local",
                file_ids=["root.txt", "folder/child.txt"],
                rules=[],
            )
        )


@pytest.mark.asyncio
async def test_rejects_configured_storage_root(tmp_path: Path) -> None:
    service = build_service(tmp_path)

    with pytest.raises(ValidationError):
        await service.preview(
            RenamePreviewRequest(storage_id="local", file_ids=["/"], rules=[])
        )


@pytest.mark.asyncio
async def test_known_directory_preview_cannot_rename_link(tmp_path: Path) -> None:
    (tmp_path / "target.txt").write_text("unchanged", encoding="utf-8")
    (tmp_path / "link.txt").symlink_to(tmp_path / "target.txt")
    service = build_service(tmp_path, with_test_rule=True)

    preview = await service.preview(RenamePreviewRequest(
        storage_id="local", location=RootLocation(), file_ids=["link.txt"],
        rules=[RuleSpec(type="test_constant", config={"value": "renamed.txt"})],
    ))

    assert preview.valid is False
    assert preview.items[0].valid is False
    assert preview.items[0].error == "This item cannot be renamed with the current permissions"
    assert (tmp_path / "target.txt").read_text(encoding="utf-8") == "unchanged"


@pytest.mark.asyncio
async def test_known_directory_preview_detects_dangling_link_conflict(tmp_path: Path) -> None:
    (tmp_path / "source.txt").write_text("unchanged", encoding="utf-8")
    (tmp_path / "occupied.txt").symlink_to(tmp_path / "missing.txt")
    service = build_service(tmp_path, with_test_rule=True)

    preview = await service.preview(RenamePreviewRequest(
        storage_id="local", location=RootLocation(), file_ids=["source.txt"],
        rules=[RuleSpec(type="test_constant", config={"value": "occupied.txt"})],
    ))

    assert preview.valid is False
    assert preview.items[0].conflict is True


def test_expired_preview_cannot_be_loaded() -> None:
    store = PreviewStore(ttl_seconds=0)
    source = FileItem(
        id="one.txt",
        name="one.txt",
        path="one.txt",
        parent_path="",
        is_directory=False,
        size=1,
        modified_at=datetime.now(timezone.utc),
    )
    response = store.save(
        RenamePreviewRequest(storage_id="local", file_ids=["one.txt"]),
        items=[],
        valid=True,
        sources=[source],
    )

    with pytest.raises(PreviewExpiredError):
        store.get(response.preview_id)


def test_expiry_cleanup_without_new_preview_preserves_live_snapshot() -> None:
    store = PreviewStore()
    request = RenamePreviewRequest(storage_id="local", file_ids=["one.txt"])
    source = FileItem(id="one.txt", name="one.txt", path="one.txt", parent_path="", is_directory=False)
    items = [PreviewItem(file_id=source.id, original_name=source.name, new_name=source.name,
                         changed=False, valid=True, conflict=False)]
    live = store.save(request, items=items, valid=True, sources=[source])
    store.ttl = timedelta(seconds=0)
    expired = store.save(request, items=items, valid=True, sources=[source])

    store.purge_expired()

    with pytest.raises(PreviewNotFoundError):
        store.get(expired.preview_id)
    assert store.get(live.preview_id).response == live
