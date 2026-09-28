import asyncio
import logging
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

from app.core.errors import AppError, PreviewExpiredError, ValidationError
from app.providers.base import StorageProvider
from app.providers.registry import ProviderRegistry
from app.schemas.files import FileItem
from app.schemas.rename import (
    ExecuteItem,
    PreviewItem,
    RenameExecuteResponse,
)
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewSnapshot, PreviewStore


logger = logging.getLogger("onedriver_renamer.rename")


@dataclass(slots=True)
class StagedRename:
    preview: PreviewItem
    temporary: FileItem


class ExecuteService:
    def __init__(
        self,
        providers: ProviderRegistry,
        previews: PreviewStore,
        preview_service: PreviewService,
    ) -> None:
        self.providers = providers
        self.previews = previews
        self.preview_service = preview_service
        self._lock = asyncio.Lock()

    async def execute(self, preview_id: str) -> RenameExecuteResponse:
        # 单进程内串行执行，避免两个批次同时争用相同的本地文件名。
        async with self._lock:
            snapshot = self.previews.get(preview_id)
            await self._revalidate(snapshot)
            self.previews.consume(preview_id)
            response = await self._execute_snapshot(snapshot)
            for item in response.items:
                logger.info(
                    "rename execution provider=%s file_id=%s status=%s error=%s",
                    snapshot.request.provider,
                    item.file_id,
                    item.status,
                    item.error,
                )
            return response

    async def _revalidate(self, snapshot: PreviewSnapshot) -> None:
        if not snapshot.response.valid:
            raise ValidationError("Rename preview contains invalid items")

        try:
            items, sources, valid = await self.preview_service.evaluate(
                snapshot.request
            )
        except AppError as exc:
            raise PreviewExpiredError(
                "Files changed after the preview was created"
            ) from exc

        if not valid or items != snapshot.response.items:
            raise PreviewExpiredError("Rename preview is no longer valid")
        if len(sources) != len(snapshot.sources):
            raise PreviewExpiredError("Rename preview source files changed")
        if any(
            self._source_changed(before, current)
            for before, current in zip(snapshot.sources, sources, strict=True)
        ):
            raise PreviewExpiredError("Files changed after the preview was created")

    @staticmethod
    def _source_changed(before: FileItem, current: FileItem) -> bool:
        identity_changed = (
            before.id != current.id
            or before.name != current.name
            or before.parent_path != current.parent_path
            or before.is_directory != current.is_directory
        )
        if identity_changed:
            return True
        # 子文件夹内容不在本批次范围内，因此不以目录时间戳判断预览失效。
        if before.is_directory:
            return False
        return before.size != current.size or before.modified_at != current.modified_at

    async def _execute_snapshot(
        self, snapshot: PreviewSnapshot
    ) -> RenameExecuteResponse:
        provider = self.providers.get(snapshot.request.provider)
        results = {
            item.file_id: ExecuteItem(
                file_id=item.file_id,
                original_name=item.original_name,
                new_name=item.new_name,
                status="skipped" if not item.changed else "failed",
                error=None if not item.changed else "Rename was not attempted",
            )
            for item in snapshot.response.items
        }
        changed = [item for item in snapshot.response.items if item.changed]
        if not changed:
            return self._response(snapshot.preview_id, results)

        temp_names = await self._temporary_names(provider, changed)
        staged: list[StagedRename] = []
        for item, temp_name in zip(changed, temp_names, strict=True):
            try:
                temporary = await provider.rename(item.file_id, temp_name)
                staged.append(StagedRename(preview=item, temporary=temporary))
            except AppError as exc:
                results[item.file_id].error = exc.message
                await self._rollback_staging(provider, staged, results)
                return self._response(snapshot.preview_id, results)

        for staged_item in staged:
            item = staged_item.preview
            try:
                await provider.rename(staged_item.temporary.id, item.new_name)
                results[item.file_id].status = "renamed"
                results[item.file_id].error = None
            except AppError as exc:
                results[item.file_id].error = exc.message
                await self._rollback_one(provider, staged_item, results[item.file_id])

        return self._response(snapshot.preview_id, results)

    async def _temporary_names(
        self, provider: StorageProvider, items: list[PreviewItem]
    ) -> list[str]:
        occupied_by_parent: dict[str, set[str]] = {}
        names: list[str] = []
        for item in items:
            parent = item.file_id.rpartition("/")[0]
            if parent not in occupied_by_parent:
                siblings = await provider.list_files(parent)
                occupied_by_parent[parent] = {
                    provider.normalize_name(sibling.name) for sibling in siblings
                }

            occupied = occupied_by_parent[parent]
            while True:
                candidate = f".onedriver-renamer-{uuid4().hex}.tmp"
                normalized = provider.normalize_name(candidate)
                if normalized not in occupied and provider.validate_name(candidate) is None:
                    occupied.add(normalized)
                    names.append(candidate)
                    break
        return names

    async def _rollback_staging(
        self,
        provider: StorageProvider,
        staged: list[StagedRename],
        results: dict[str, ExecuteItem],
    ) -> None:
        for staged_item in reversed(staged):
            result = results[staged_item.preview.file_id]
            result.error = "Batch staging failed; rename was rolled back"
            await self._rollback_one(provider, staged_item, result)

    @staticmethod
    async def _rollback_one(
        provider: StorageProvider,
        staged: StagedRename,
        result: ExecuteItem,
    ) -> None:
        try:
            await provider.rename(staged.temporary.id, staged.preview.original_name)
        except AppError as rollback_error:
            # 明确报告恢复失败，避免把遗留临时文件误报为已恢复。
            result.error = f"{result.error}; rollback failed: {rollback_error.message}"

    @staticmethod
    def _response(
        preview_id: str, results: dict[str, ExecuteItem]
    ) -> RenameExecuteResponse:
        items = list(results.values())
        renamed = sum(item.status == "renamed" for item in items)
        failed = sum(item.status == "failed" for item in items)
        if failed == 0:
            status: Literal["completed", "partial", "failed"] = "completed"
        elif renamed > 0:
            status = "partial"
        else:
            status = "failed"
        return RenameExecuteResponse(
            preview_id=preview_id,
            status=status,
            items=items,
        )
