from pathlib import Path

import pytest
from pydantic import BaseModel

from app.core.errors import ValidationError
from app.providers.local import LocalProvider
from app.providers.registry import ProviderRegistry
from app.rules.base import RenameRule, RuleContext
from app.rules.registry import RuleRegistry
from app.schemas.rename import RenamePreviewRequest
from app.schemas.rules import RuleSpec
from app.services.preview_service import PreviewService
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


def build_service(root: Path, *, with_test_rule: bool = False) -> PreviewService:
    providers = ProviderRegistry([LocalProvider(root)])
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
        RenamePreviewRequest(provider="local", file_ids=["one.txt"], rules=[])
    )

    assert preview.valid is True
    assert preview.items[0].original_name == "one.txt"
    assert preview.items[0].new_name == "one.txt"
    assert preview.items[0].changed is False
    assert file_path.read_text(encoding="utf-8") == "unchanged"


@pytest.mark.asyncio
async def test_rejects_duplicate_file_ids(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    service = build_service(tmp_path)

    with pytest.raises(ValidationError):
        await service.preview(
            RenamePreviewRequest(
                provider="local", file_ids=["one.txt", "one.txt"], rules=[]
            )
        )


@pytest.mark.asyncio
async def test_detects_duplicate_targets(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    (tmp_path / "two.txt").write_text("two", encoding="utf-8")
    service = build_service(tmp_path, with_test_rule=True)

    preview = await service.preview(
        RenamePreviewRequest(
            provider="local",
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
            provider="local",
            file_ids=["one.txt"],
            rules=[RuleSpec(type="test_constant", config={"value": "occupied.txt"})],
        )
    )

    assert preview.valid is False
    assert preview.items[0].conflict is True
