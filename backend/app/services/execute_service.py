import asyncio
import logging
from collections.abc import Callable
from typing import Literal
from time import monotonic

from app.core.errors import AppError, NotFoundError, PreviewExpiredError, ValidationError, RenameOutcomeUnknownError, ProviderError
from app.core.log_context import request_id_context
from app.providers.base import RenameRequest, StorageProvider
from app.providers.registry import ProviderRegistry
from app.schemas.files import FileItem
from app.schemas.rename import (
    ExecuteItem,
    RenameExecuteResponse,
    RenameProgress,
)
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewSnapshot, PreviewStore
from app.services.rename_write import drain_writes, reconcile_unknown_rename


logger = logging.getLogger("rename_studio.rename")


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
            with self.providers.execution(snapshot.request.storage_id, snapshot.connection_revision):
                self._purge_progress()
                progress = RenameProgress(
                    preview_id=preview_id,
                    total=sum(item.changed for item in snapshot.response.items),
                    phase="validating",
                )
                # 活跃批次不超时清除；完成后保留十分钟供界面读取最终状态。
                self._progress[preview_id] = (float("inf"), progress)
                try:
                    try:
                        await self._revalidate(snapshot)
                    except AppError as exc:
                        # 复核只读取状态，失败时可明确告知客户端尚未开始写入。
                        exc.details["execution_started"] = False
                        raise
                    self.previews.consume(preview_id)
                    response = await self._execute_snapshot(snapshot, progress)
                    progress.processed = progress.total
                    progress.phase = "finished"
                except (Exception, asyncio.CancelledError) as exc:
                    progress.phase = "failed"
                    progress.error = exc.message if isinstance(exc, AppError) else "Rename execution interrupted"
                    raise
                finally:
                    self._progress[preview_id] = (monotonic() + 600, progress)
                for item in response.items:
                    logger.info(
                        "rename execution provider=%s file_id=%s status=%s error=%s",
                        snapshot.request.storage_id,
                        item.file_id,
                        item.status,
                        item.error,
                    )
                return response

    async def _revalidate(self, snapshot: PreviewSnapshot) -> None:
        if not snapshot.response.valid:
            raise ValidationError("Rename preview contains invalid items")

        provider = self.providers.get(snapshot.request.storage_id)
        try:
            siblings = await provider.list_siblings(snapshot.sources[0])
            by_id = {item.id: item for item in siblings}
            sources = [by_id[file_id] for file_id in snapshot.request.file_ids]
            items, _, _ = await self.preview_service.evaluate(
                snapshot.request,
                files=sources,
                siblings=siblings,
            )
        except (KeyError, NotFoundError) as exc:
            raise PreviewExpiredError(
                "Files changed after the preview was created"
            ) from exc

        # 与有效快照逐项一致即可保证有效性；源项始终按同一请求 ID 列表构建。
        if items != snapshot.response.items:
            raise PreviewExpiredError("Rename preview is no longer valid")

    @staticmethod
    async def _safe_rename_many(
        provider: StorageProvider,
        requests: list[RenameRequest],
        *,
        on_unknown: Callable[[], None] | None = None,
    ) -> dict[str, FileItem | AppError]:
        try:
            outcomes = await provider.rename_many(requests)
        except AppError as exc:
            outcomes = {request.file_id: exc for request in requests}
        if on_unknown is not None and any(isinstance(outcome, RenameOutcomeUnknownError) for outcome in outcomes.values()):
            # 核查之前暂停补组，不能等元数据读取结束后才通知调度器。
            on_unknown()
        for request in requests:
            outcomes[request.file_id] = await reconcile_unknown_rename(provider.get_metadata, request, outcomes[request.file_id])
        return outcomes

    @staticmethod
    async def _rename_in_batches(
        provider: StorageProvider,
        requests: list[RenameRequest],
        progress: RenameProgress | None = None,
    ) -> dict[str, FileItem | AppError]:
        outcomes: dict[str, FileItem | AppError] = {}
        concurrency = provider.execution_batch_concurrency
        offset = 0
        active = 0

        async def run_batch(
            index: int,
            batch: list[RenameRequest],
            on_unknown: Callable[[], None] | None = None,
        ) -> dict[str, FileItem | AppError]:
            nonlocal active
            active += 1
            started = monotonic()
            logger.info(
                "write_batch event=start provider=%s request_id=%s group=%s item_count=%s in_flight=%s",
                provider.id, request_id_context.get(), index, len(batch), active,
            )
            try:
                return await ExecuteService._safe_rename_many(provider, batch, on_unknown=on_unknown)
            finally:
                active -= 1
                logger.info(
                    "write_batch event=finish provider=%s request_id=%s group=%s item_count=%s in_flight=%s duration_ms=%.2f",
                    provider.id, request_id_context.get(), index, len(batch), active, (monotonic() - started) * 1000,
                )

        if concurrency == 1:
            for offset in range(0, len(requests), provider.execution_batch_size):
                batch = requests[offset:offset + provider.execution_batch_size]
                task = asyncio.create_task(run_batch(offset // provider.execution_batch_size + 1, batch))
                try:
                    # 单组也保护已启动的写入，取消后等待其完成再释放执行锁。
                    batch_outcomes = await asyncio.shield(task)
                except asyncio.CancelledError:
                    await drain_writes([task])
                    raise
                outcomes.update(batch_outcomes)
                if progress is not None:
                    progress.processed += len(batch)
                if any(isinstance(outcome, RenameOutcomeUnknownError) for outcome in batch_outcomes.values()):
                    for request in requests[offset + len(batch):]:
                        outcomes[request.file_id] = ProviderError(
                            "Rename was not attempted after an unknown write outcome",
                            details={"reason": "RENAME_NOT_ATTEMPTED", "stop_reason": "RENAME_OUTCOME_UNKNOWN"},
                        )
                    break
            return outcomes

        pending: dict[asyncio.Task[dict[str, FileItem | AppError]], tuple[int, list[RenameRequest]]] = {}
        reconciling: set[int] = set()
        stopped = False

        def start_batches() -> None:
            nonlocal offset
            while not stopped and not reconciling and len(pending) < concurrency and offset < len(requests):
                index = offset // provider.execution_batch_size + 1
                batch = requests[offset:offset + provider.execution_batch_size]
                task = asyncio.create_task(run_batch(index, batch, lambda index=index: reconciling.add(index)))
                pending[task] = (index, batch)
                offset += len(batch)

        try:
            start_batches()
            while pending:
                completed, _ = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                # 同一轮先收集全部已完成组，发现未知结果后不再补入任何新组。
                for task in sorted(completed, key=lambda entry: pending[entry][0]):
                    index, batch = pending[task]
                    batch_outcomes = task.result()
                    del pending[task]
                    reconciling.discard(index)
                    outcomes.update(batch_outcomes)
                    if progress is not None:
                        progress.processed += len(batch)
                    stopped |= any(isinstance(outcome, RenameOutcomeUnknownError) for outcome in batch_outcomes.values())
                start_batches()
        finally:
            if pending:
                await drain_writes(pending)
        for request in requests[offset:]:
            outcomes[request.file_id] = ProviderError(
                "Rename was not attempted after an unknown write outcome",
                details={"reason": "RENAME_NOT_ATTEMPTED", "stop_reason": "RENAME_OUTCOME_UNKNOWN"},
            )
        return outcomes

    @staticmethod
    def _record_failure(result: ExecuteItem, outcome: AppError) -> None:
        result.error = outcome.message
        result.error_code = outcome.code
        result.details = outcome.details or None
        result.actual_name = outcome.details.get("actual_name")

    @staticmethod
    def _record_success(result: ExecuteItem, current: FileItem) -> None:
        result.status = "renamed"
        result.error = None
        result.details = None
        result.current_file = current

    async def _execute_snapshot(
        self,
        snapshot: PreviewSnapshot,
        progress: RenameProgress,
    ) -> RenameExecuteResponse:
        provider = self.providers.get(snapshot.request.storage_id)
        results = {
            item.file_id: ExecuteItem(
                file_id=item.file_id,
                original_name=item.original_name,
                new_name=item.new_name,
                status="skipped" if not item.changed else "failed",
            )
            for item in snapshot.response.items
        }
        changed = [item for item in snapshot.response.items if item.changed]
        if not changed:
            return self._response(snapshot.preview_id, results)

        progress.phase = "renaming"
        outcomes = await self._rename_in_batches(
            provider,
            [RenameRequest(item.file_id, item.new_name) for item in changed],
            progress,
        )
        for item in changed:
            outcome = outcomes[item.file_id]
            if isinstance(outcome, AppError):
                self._record_failure(results[item.file_id], outcome)
            else:
                self._record_success(results[item.file_id], outcome)
        return self._response(snapshot.preview_id, results)

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
        renamed = sum(item.outcome == "renamed" for item in items)
        incomplete = any(item.outcome in {"failed", "unknown", "not_attempted"} for item in items)
        if not incomplete:
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
