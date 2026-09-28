from pathlib import Path

import pytest
from pydantic import BaseModel

from app.core.errors import (
    PreviewExpiredError,
    PreviewNotFoundError,
    ProviderError,
    ValidationError,
)
from app.providers.local import LocalProvider
from app.providers.registry import ProviderRegistry
from app.rules.base import RenameRule, RuleContext
from app.rules.registry import RuleRegistry
from app.schemas.files import FileItem
from app.schemas.rename import RenamePreviewRequest
from app.schemas.rules import RuleSpec
from app.services.execute_service import ExecuteService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine


class MappingConfig(BaseModel):
    names: dict[str, str]


class MappingRule(RenameRule[MappingConfig]):
    type = "test_mapping"
    display_name = "Test mapping"
    description = "Test-only filename mapping"
    config_model = MappingConfig

    def apply(
        self, filename: str, context: RuleContext, config: MappingConfig
    ) -> str:
        return config.names.get(filename, filename)


class FailingLocalProvider(LocalProvider):
    async def rename(self, file_id: str, new_name: str) -> FileItem:
        if new_name == "two-new.txt":
            raise ProviderError("Injected provider failure")
        return await super().rename(file_id, new_name)


def build_services(
    root: Path, provider: LocalProvider | None = None
) -> tuple[PreviewService, ExecuteService]:
    providers = ProviderRegistry([provider or LocalProvider(root)])
    rules = RuleRegistry()
    rules.register(MappingRule())
    store = PreviewStore()
    preview = PreviewService(providers, RenameEngine(rules), store)
    execute = ExecuteService(providers, store, preview)
    return preview, execute


def request_for(names: dict[str, str]) -> RenamePreviewRequest:
    return RenamePreviewRequest(
        provider="local",
        file_ids=list(names),
        rules=[RuleSpec(type="test_mapping", config={"names": names})],
    )


@pytest.mark.asyncio
async def test_executes_valid_preview_once(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    preview_service, execute_service = build_services(tmp_path)
    preview = await preview_service.preview(request_for({"one.txt": "renamed.txt"}))

    result = await execute_service.execute(preview.preview_id)

    assert result.status == "completed"
    assert result.items[0].status == "renamed"
    assert (tmp_path / "renamed.txt").exists()
    with pytest.raises(PreviewNotFoundError):
        await execute_service.execute(preview.preview_id)


@pytest.mark.asyncio
async def test_executes_swap_with_temporary_names(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("A", encoding="utf-8")
    (tmp_path / "b.txt").write_text("B", encoding="utf-8")
    preview_service, execute_service = build_services(tmp_path)
    preview = await preview_service.preview(
        request_for({"a.txt": "b.txt", "b.txt": "a.txt"})
    )

    result = await execute_service.execute(preview.preview_id)

    assert result.status == "completed"
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "B"
    assert (tmp_path / "b.txt").read_text(encoding="utf-8") == "A"
    assert not list(tmp_path.glob(".onedriver-renamer-*.tmp"))


@pytest.mark.asyncio
async def test_rejects_preview_after_source_changes(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    preview_service, execute_service = build_services(tmp_path)
    preview = await preview_service.preview(request_for({"one.txt": "new.txt"}))
    (tmp_path / "one.txt").rename(tmp_path / "external.txt")

    with pytest.raises(PreviewExpiredError):
        await execute_service.execute(preview.preview_id)


@pytest.mark.asyncio
async def test_rejects_invalid_preview(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    (tmp_path / "occupied.txt").write_text("occupied", encoding="utf-8")
    preview_service, execute_service = build_services(tmp_path)
    preview = await preview_service.preview(
        request_for({"one.txt": "occupied.txt"})
    )

    with pytest.raises(ValidationError):
        await execute_service.execute(preview.preview_id)


@pytest.mark.asyncio
async def test_reports_partial_provider_failure(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    (tmp_path / "two.txt").write_text("two", encoding="utf-8")
    provider = FailingLocalProvider(tmp_path)
    preview_service, execute_service = build_services(tmp_path, provider)
    preview = await preview_service.preview(
        request_for({"one.txt": "one-new.txt", "two.txt": "two-new.txt"})
    )

    result = await execute_service.execute(preview.preview_id)

    assert result.status == "partial"
    assert [item.status for item in result.items] == ["renamed", "failed"]
    assert (tmp_path / "one-new.txt").exists()
    assert (tmp_path / "two.txt").exists()
