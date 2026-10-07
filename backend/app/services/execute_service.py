import asyncio
import logging
from dataclasses import dataclass
from typing import Literal
from time import monotonic
from uuid import uuid4

from app.core.errors import AppError, NotFoundError, PreviewExpiredError, ValidationError, RenameOutcomeUnknownError, ProviderError
from app.providers.base import RenameRequest, StorageProvider
from app.providers.registry import ProviderRegistry
from app.schemas.files import FileItem
from app.schemas.rename import (
    ExecuteItem,
    PreviewItem,
    RenameExecuteResponse,
    RenameProgress,
)
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewSnapshot, PreviewStore


logger = logging.getLogger("onedriver_renamer.rename")


@dataclass(slots=True)
class StagedRename:
    preview: PreviewItem
    temporary: FileItem


@dataclass(slots=True)
class DirectRename:
    preview: PreviewItem
    current: FileItem


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
        self._progress: dict[str, tuple[float, RenameProgress]] = {}

    def progress(self, preview_id: str) -> RenameProgress:
        self._purge_progress()
        if preview_id in self._progress:
            return self._progress[preview_id][1].model_copy(deep=True)
        snapshot = self.previews.get(preview_id)
        return RenameProgress(preview_id=preview_id, total=sum(item.changed for item in snapshot.response.items))

    def _purge_progress(self) -> None:
        now = monotonic()
        for preview_id in [key for key, (expires, _) in self._progress.items() if expires <= now]:
            self._progress.pop(preview_id, None)

    async def execute(self, preview_id: str) -> RenameExecuteResponse:
        # 单进程内串行执行，避免两个批次同时争用相同目录中的目标名称。
        async with self._lock:
            snapshot = self.previews.get(preview_id)
            with self.providers.execution(snapshot.request.provider, snapshot.connection_revision):
                self._purge_progress()
                progress = RenameProgress(
                    preview_id=preview_id,
                    total=sum(item.changed for item in snapshot.response.items),
                    phase="validating",
                )
                # 活跃批次不超时清除；完成后保留十分钟供界面读取最终状态。
                self._progress[preview_id] = (float("inf"), progress)
                try:
                    siblings = await self._revalidate(snapshot)
                    self.previews.consume(preview_id)
                    response = await self._execute_snapshot(snapshot, siblings, progress)
                    progress.processed = progress.total
                    progress.phase = "finished"
                except BaseException as exc:
                    progress.phase = "failed"
                    progress.error = exc.message if isinstance(exc, AppError) else "Rename execution interrupted"
                    raise
                finally:
                    self._progress[preview_id] = (monotonic() + 600, progress)
                for item in response.items:
                    logger.info(
                        "rename execution provider=%s file_id=%s status=%s error=%s",
                        snapshot.request.provider,
                        item.file_id,
                        item.status,
                        item.error,
                    )
                return response

    async def _revalidate(self, snapshot: PreviewSnapshot) -> list[FileItem]:
        if not snapshot.response.valid:
            raise ValidationError("Rename preview contains invalid items")

        provider = self.providers.get(snapshot.request.provider)
        parent_paths = {provider.parent_key(source) for source in snapshot.sources}
        if len(parent_paths) != 1:
            raise PreviewExpiredError("Rename preview source directory changed")
        parent_path = next(iter(parent_paths))
        try:
            siblings = await provider.list_siblings(snapshot.sources[0])
            by_id = {item.id: item for item in siblings}
            sources = [by_id[file_id] for file_id in snapshot.request.file_ids]
            items, sources, valid = await self.preview_service.evaluate(
                snapshot.request,
                files=sources,
                siblings_by_parent={parent_path: siblings},
            )
        except (KeyError, NotFoundError) as exc:
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
        return siblings

    @staticmethod
    async def _safe_rename_many(provider: StorageProvider, requests: list[RenameRequest]) -> dict[str, FileItem | AppError]:
        try:
            outcomes = await provider.rename_many(requests)
        except AppError as exc:
            outcomes = {request.file_id: exc for request in requests}
        # Never replay a write whose response was lost. Reconcile each opaque ID instead.
        for request in requests:
            outcome = outcomes[request.file_id]
            if not isinstance(outcome, RenameOutcomeUnknownError):
                continue
            try:
                current = await provider.get_metadata(request.file_id)
            except AppError:
                continue
            if current.name == request.new_name:
                outcomes[request.file_id] = current
            else:
                outcomes[request.file_id] = ProviderError(
                    "Rename target was not reached; current name was verified",
                    details={"actual_name": current.name},
                )
        return outcomes

    @staticmethod
    async def _rename_in_batches(
        provider: StorageProvider,
        requests: list[RenameRequest],
        progress: RenameProgress | None = None,
    ) -> dict[str, FileItem | AppError]:
        outcomes: dict[str, FileItem | AppError] = {}
        # 保留 Provider 的批处理能力；每批完成后发布真实计数并让出事件循环。
        for offset in range(0, len(requests), provider.execution_batch_size):
            batch = requests[offset:offset + provider.execution_batch_size]
            batch_outcomes = await ExecuteService._safe_rename_many(provider, batch)
            outcomes.update(batch_outcomes)
            if progress is not None:
                progress.processed += len(batch)
            if any(isinstance(outcome, RenameOutcomeUnknownError) for outcome in batch_outcomes.values()):
                for request in requests[offset + len(batch):]:
                    outcomes[request.file_id] = ProviderError("Rename was not attempted after an unknown write outcome")
                break
            await asyncio.sleep(0)
        return outcomes

    @staticmethod
    def _source_changed(before: FileItem, current: FileItem) -> bool:
        identity_changed = (
            before.id != current.id
            or before.name != current.name
            or StorageProvider.parent_key(before) != StorageProvider.parent_key(current)
            or before.is_directory != current.is_directory
        )
        if identity_changed:
            return True
        # 子文件夹内容不在本批次范围内，因此不以目录时间戳判断预览失效。
        if before.is_directory:
            return False
        return before.size != current.size or before.modified_at != current.modified_at

    async def _execute_snapshot(
        self,
        snapshot: PreviewSnapshot,
        siblings: list[FileItem],
        progress: RenameProgress,
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

        original_owners: dict[str, set[str]] = {}
        for item in snapshot.response.items:
            original_owners.setdefault(provider.normalize_name(item.original_name), set()).add(item.file_id)
        staged_items: list[PreviewItem] = []
        direct_items: list[PreviewItem] = []
        for item in changed:
            owners = original_owners.get(provider.normalize_name(item.new_name), set())
            if owners - {item.file_id}:
                staged_items.append(item)
            else:
                direct_items.append(item)

        temp_names = self._temporary_names(provider, staged_items, siblings)
        staged: list[StagedRename] = []
        staging_requests = [
            RenameRequest(item.file_id, temp_name)
            for item, temp_name in zip(staged_items, temp_names, strict=True)
        ]
        progress.phase = "staging"
        staging_results = await self._rename_in_batches(provider, staging_requests)
        for item in staged_items:
            outcome = staging_results[item.file_id]
            if isinstance(outcome, AppError):
                results[item.file_id].error = outcome.message
                results[item.file_id].error_code = outcome.code
                results[item.file_id].actual_name = outcome.details.get("actual_name")
            else:
                staged.append(StagedRename(preview=item, temporary=outcome))
        if len(staged) != len(staged_items):
            progress.phase = "rollback"
            await self._rollback_staging(
                provider,
                staged,
                results,
                "Batch staging failed; rename was rolled back",
            )
            return self._response(snapshot.preview_id, results)

        direct_requests = [
            RenameRequest(item.file_id, item.new_name) for item in direct_items
        ]
        progress.phase = "renaming"
        direct_results = await self._rename_in_batches(provider, direct_requests, progress if not staged_items else None)
        renamed_direct: list[DirectRename] = []
        for item in direct_items:
            outcome = direct_results[item.file_id]
            if isinstance(outcome, AppError):
                results[item.file_id].error = outcome.message
                results[item.file_id].error_code = outcome.code
                results[item.file_id].actual_name = outcome.details.get("actual_name")
            else:
                renamed_direct.append(DirectRename(preview=item, current=outcome))
        if len(renamed_direct) != len(direct_items):
            if staged:
                progress.phase = "rollback"
                await self._rollback_direct(provider, renamed_direct, results)
                await self._rollback_staging(
                    provider,
                    staged,
                    results,
                    "Direct rename failed; staged rename was rolled back",
                )
            else:
                # 独立目标互不占用，允许保留已成功项目并明确报告 partial。
                for renamed in renamed_direct:
                    results[renamed.preview.file_id].status = "renamed"
                    results[renamed.preview.file_id].error = None
            return self._response(snapshot.preview_id, results)
        for renamed in renamed_direct:
            results[renamed.preview.file_id].status = "renamed"
            results[renamed.preview.file_id].error = None

        if staged_items:
            # 有依赖的直接重命名可能回滚，只有整个直接阶段成功才计入。
            progress.processed += len(direct_items)

        for offset in range(0, len(staged), provider.execution_batch_size):
            batch = staged[offset:offset + provider.execution_batch_size]
            final_results = await self._safe_rename_many(provider, [
                RenameRequest(item.temporary.id, item.preview.new_name) for item in batch
            ])
            for staged_item in batch:
                item = staged_item.preview
                outcome = final_results[staged_item.temporary.id]
                if not isinstance(outcome, AppError):
                    results[item.file_id].status = "renamed"
                    results[item.file_id].error = None
                else:
                    progress.phase = "rollback"
                    results[item.file_id].error = outcome.message
                    results[item.file_id].error_code = outcome.code
                    results[item.file_id].actual_name = outcome.details.get("actual_name")
                    await self._rollback_one(provider, staged_item, results[item.file_id])
                    progress.phase = "renaming"
                progress.processed += 1
            if any(isinstance(outcome, RenameOutcomeUnknownError) for outcome in final_results.values()):
                remaining = staged[offset + len(batch):]
                await self._rollback_staging(provider, remaining, results, "Stopped after an unknown write outcome")
                return self._response(snapshot.preview_id, results)
            await asyncio.sleep(0)

        return self._response(snapshot.preview_id, results)

    @staticmethod
    def _temporary_names(
        provider: StorageProvider,
        items: list[PreviewItem],
        siblings: list[FileItem],
    ) -> list[str]:
        occupied = {provider.normalize_name(sibling.name) for sibling in siblings}
        names: list[str] = []
        sources = {item.id: item for item in siblings}
        for item in items:
            # Shorten only when provider path limits reject the usual temporary name.
            candidates = [f"onedriver-renamer-{uuid4().hex}"] + [uuid4().hex[:width] for width in (32, 16, 8, 4, 2, 1) for _ in range(8)]
            for candidate in candidates:
                normalized = provider.normalize_name(candidate)
                if normalized not in occupied and provider.validate_target_name(sources[item.file_id], candidate) is None:
                    occupied.add(normalized)
                    names.append(candidate)
                    break
            else:
                raise ValidationError("Could not allocate a valid temporary name in this directory")
        return names

    async def _rollback_staging(
        self,
        provider: StorageProvider,
        staged: list[StagedRename],
        results: dict[str, ExecuteItem],
        reason: str,
    ) -> None:
        requests = [
            RenameRequest(item.temporary.id, item.preview.original_name)
            for item in reversed(staged)
        ]
        outcomes = await ExecuteService._safe_rename_many(provider, requests)
        for staged_item in staged:
            result = results[staged_item.preview.file_id]
            result.error = reason
            outcome = outcomes[staged_item.temporary.id]
            if isinstance(outcome, AppError):
                result.error = f"{result.error}; rollback failed: {outcome.message}"
                result.error_code = outcome.code
                result.actual_name = None if isinstance(outcome, RenameOutcomeUnknownError) else outcome.details.get("actual_name", staged_item.temporary.name)
            else:
                result.actual_name = outcome.name

    @staticmethod
    async def _rollback_direct(
        provider: StorageProvider,
        renamed: list[DirectRename],
        results: dict[str, ExecuteItem],
    ) -> None:
        requests = [
            RenameRequest(item.current.id, item.preview.original_name)
            for item in reversed(renamed)
        ]
        outcomes = await ExecuteService._safe_rename_many(provider, requests)
        for item in renamed:
            result = results[item.preview.file_id]
            result.status = "failed"
            result.error = "Batch rename failed; direct rename was rolled back"
            outcome = outcomes[item.current.id]
            if isinstance(outcome, AppError):
                result.error = f"{result.error}; rollback failed: {outcome.message}"
                result.error_code = outcome.code
                result.actual_name = None if isinstance(outcome, RenameOutcomeUnknownError) else outcome.details.get("actual_name", item.current.name)
            else:
                result.actual_name = outcome.name

    @staticmethod
    async def _rollback_one(
        provider: StorageProvider,
        staged: StagedRename,
        result: ExecuteItem,
    ) -> None:
        if result.error_code == "RENAME_OUTCOME_UNKNOWN":
            return
        if result.actual_name is not None and result.actual_name != staged.temporary.name:
            result.error = f"{result.error}; rollback skipped because the item changed externally"
            return
        outcomes = await ExecuteService._safe_rename_many(provider, [RenameRequest(staged.temporary.id, staged.preview.original_name)])
        outcome = outcomes[staged.temporary.id]
        if isinstance(outcome, AppError):
            # 明确报告恢复失败，避免把遗留临时文件误报为已恢复。
            result.error = f"{result.error}; rollback failed: {outcome.message}"
            result.error_code = outcome.code
            result.actual_name = None if isinstance(outcome, RenameOutcomeUnknownError) else outcome.details.get("actual_name", staged.temporary.name)
        else:
            result.actual_name = outcome.name

    @staticmethod
    def _response(
        preview_id: str, results: dict[str, ExecuteItem]
    ) -> RenameExecuteResponse:
        items = list(results.values())
        for item in items:
            if item.status == "renamed":
                item.actual_name = item.new_name
                item.error_code = None
            elif item.status == "skipped":
                item.actual_name = item.original_name
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
