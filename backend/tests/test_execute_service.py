from provider_fixtures import registry_for
import asyncio
from pathlib import Path

import pytest
from pydantic import BaseModel

from app.core.errors import (
    AppError,
    PreviewExpiredError,
    PreviewNotFoundError,
    ProviderError,
    ValidationError,
)
from app.providers.local.driver import LocalProvider
from app.providers.base import RenameRequest
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


class TrackingLocalProvider(LocalProvider):
    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.rename_targets: list[str] = []

    async def rename(self, file_id: str, new_name: str) -> FileItem:
        self.rename_targets.append(new_name)
        return await super().rename(file_id, new_name)


def build_services(
    root: Path, provider: LocalProvider | None = None
) -> tuple[PreviewService, ExecuteService]:
    providers = registry_for([provider or LocalProvider(root)])
    rules = RuleRegistry()
    rules.register(MappingRule())
    store = PreviewStore()
    preview = PreviewService(providers, RenameEngine(rules), store)
    execute = ExecuteService(providers, store, preview)
    return preview, execute


def request_for(names: dict[str, str]) -> RenamePreviewRequest:
    return RenamePreviewRequest(
        storage_id="local",
        file_ids=list(names),
        rules=[RuleSpec(type="test_mapping", config={"names": names})],
    )


@pytest.mark.asyncio
async def test_progress_tracks_completed_batches_and_survives_consumption(tmp_path: Path) -> None:
    class PausingProvider(LocalProvider):
        def __init__(self, root: Path) -> None:
            super().__init__(root)
            self.calls = 0
            self.paused = asyncio.Event()
            self.resume = asyncio.Event()

        async def rename_many(self, requests: list[RenameRequest]) -> dict[str, FileItem | AppError]:
            self.calls += 1
            if self.calls == 2:
                self.paused.set()
                await self.resume.wait()
            return await super().rename_many(requests)

    names = {f"old-{index}.txt": f"new-{index}.txt" for index in range(41)}
    for name in names:
        (tmp_path / name).write_text("data", encoding="utf-8")
    provider = PausingProvider(tmp_path)
    assert provider.execution_batch_concurrency == 1
    preview_service, execute_service = build_services(tmp_path, provider)
    preview = await preview_service.preview(request_for(names))
    assert execute_service.progress(preview.preview_id).phase == "waiting"
    task = asyncio.create_task(execute_service.execute(preview.preview_id))
    try:
        await asyncio.wait_for(provider.paused.wait(), timeout=5)
        progress = execute_service.progress(preview.preview_id)
        assert progress.total == 41
        assert progress.processed == 20
        assert progress.phase == "renaming"
        progress.processed = 0
        assert execute_service.progress(preview.preview_id).processed == 20
    finally:
        provider.resume.set()
        result = await asyncio.wait_for(task, timeout=5)
    assert result.status == "completed"
    progress = execute_service.progress(preview.preview_id)
    assert progress.processed == progress.total == 41
    assert progress.phase == "finished"
    with pytest.raises(PreviewNotFoundError):
        await execute_service.execute(preview.preview_id)


@pytest.mark.asyncio
async def test_executes_valid_preview_once(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    provider = TrackingLocalProvider(tmp_path)
    preview_service, execute_service = build_services(tmp_path, provider)
    preview = await preview_service.preview(request_for({"one.txt": "renamed.txt"}))

    result = await execute_service.execute(preview.preview_id)

    assert result.status == "completed"
    assert result.items[0].status == "renamed"
    assert (tmp_path / "renamed.txt").exists()
    assert provider.rename_targets == ["renamed.txt"]
    assert result.items[0].file_id == "one.txt"
    assert result.items[0].current_file.id == "renamed.txt"
    assert result.items[0].current_file.path == "renamed.txt"
    with pytest.raises(PreviewNotFoundError):
        await execute_service.execute(preview.preview_id)


@pytest.mark.asyncio
async def test_single_target_snapshot_ignores_later_request_and_response_changes(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("source", encoding="utf-8")
    preview_service, execute_service = build_services(tmp_path)
    request = RenamePreviewRequest(storage_id="local", file_ids=["one.txt"], target_name="saved.txt")
    preview = await preview_service.preview(request)
    request.target_name = "request-tampered.txt"
    preview.items[0].new_name = "response-tampered.txt"

    result = await execute_service.execute(preview.preview_id)

    assert result.status == "completed"
    assert result.items[0].new_name == "saved.txt"
    assert result.items[0].current_file.id == "saved.txt"
    assert sorted(item.name for item in tmp_path.iterdir()) == ["saved.txt"]
    assert (tmp_path / "saved.txt").read_text(encoding="utf-8") == "source"


@pytest.mark.asyncio
async def test_executes_swap_with_temporary_names(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("A", encoding="utf-8")
    (tmp_path / "b.txt").write_text("B", encoding="utf-8")
    provider = TrackingLocalProvider(tmp_path)
    preview_service, execute_service = build_services(tmp_path, provider)
    preview = await preview_service.preview(
        request_for({"a.txt": "b.txt", "b.txt": "a.txt"})
    )

    result = await execute_service.execute(preview.preview_id)

    assert result.status == "completed"
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "B"
    assert (tmp_path / "b.txt").read_text(encoding="utf-8") == "A"
    temporary_count = sum(
        name.startswith("Rename_Studio-") for name in provider.rename_targets
    )
    assert temporary_count == 2
    progress = execute_service.progress(preview.preview_id)
    assert progress.total == progress.processed == 2
    assert not list(tmp_path.glob("Rename_Studio-*"))


@pytest.mark.asyncio
async def test_rejects_preview_after_source_changes(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    preview_service, execute_service = build_services(tmp_path)
    preview = await preview_service.preview(request_for({"one.txt": "new.txt"}))
    (tmp_path / "one.txt").rename(tmp_path / "external.txt")

    with pytest.raises(PreviewExpiredError):
        await execute_service.execute(preview.preview_id)


@pytest.mark.asyncio
async def test_rejects_same_name_source_content_change_after_preview(tmp_path: Path) -> None:
    source = tmp_path / "one.txt"
    source.write_text("one", encoding="utf-8")
    provider = TrackingLocalProvider(tmp_path)
    preview_service, execute_service = build_services(tmp_path, provider)
    preview = await preview_service.preview(request_for({"one.txt": "new.txt"}))
    source.write_text("changed content", encoding="utf-8")

    with pytest.raises(PreviewExpiredError):
        await execute_service.execute(preview.preview_id)

    assert provider.rename_targets == []
    assert source.read_text(encoding="utf-8") == "changed content"
    assert not (tmp_path / "new.txt").exists()


@pytest.mark.asyncio
async def test_rejects_source_replaced_by_link_after_preview(tmp_path: Path) -> None:
    source = tmp_path / "source.txt"
    source.write_text("source", encoding="utf-8")
    target = tmp_path / "target.txt"
    target.write_text("target", encoding="utf-8")
    preview_service, execute_service = build_services(tmp_path)
    preview = await preview_service.preview(request_for({"source.txt": "renamed.txt"}))
    source.unlink()
    source.symlink_to(target)

    with pytest.raises(PreviewExpiredError):
        await execute_service.execute(preview.preview_id)

    assert target.read_text(encoding="utf-8") == "target"
    assert source.is_symlink()
    assert not (tmp_path / "renamed.txt").exists()


@pytest.mark.asyncio
async def test_rejects_invalid_preview(tmp_path: Path) -> None:
    (tmp_path / "one.txt").write_text("one", encoding="utf-8")
    (tmp_path / "occupied.txt").write_text("occupied", encoding="utf-8")
    provider = TrackingLocalProvider(tmp_path)
    preview_service, execute_service = build_services(tmp_path, provider)
    preview = await preview_service.preview(
        request_for({"one.txt": "occupied.txt"})
    )
    assert not preview.valid
    assert preview.items[0].conflict

    with pytest.raises(ValidationError):
        await execute_service.execute(preview.preview_id)
    assert provider.rename_targets == []
    progress = execute_service.progress(preview.preview_id)
    assert progress.phase == "failed"
    assert progress.processed == 0


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
    progress = execute_service.progress(preview.preview_id)
    assert progress.processed == progress.total == 2
    assert [item.status for item in result.items] == ["renamed", "failed"]
    assert (tmp_path / "one-new.txt").exists()
    assert (tmp_path / "two.txt").exists()


@pytest.mark.asyncio
async def test_renames_selected_directory_without_renaming_children(
    tmp_path: Path,
) -> None:
    folder = tmp_path / "season-one"
    folder.mkdir()
    (folder / "episode-one.txt").write_text("episode", encoding="utf-8")
    preview_service, execute_service = build_services(tmp_path)
    preview = await preview_service.preview(
        request_for({"season-one": "season-01"})
    )

    result = await execute_service.execute(preview.preview_id)

    assert result.status == "completed"
    assert (tmp_path / "season-01" / "episode-one.txt").exists()
    assert not (tmp_path / "season-01" / "episode-01.txt").exists()
