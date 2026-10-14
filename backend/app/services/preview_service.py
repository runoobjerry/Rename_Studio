import logging
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from time import perf_counter

from app.core.log_context import request_id_context
from app.core.errors import StorageConnectionChangedError, ValidationError
from app.schemas.storage import RootLocation
from app.providers.registry import ProviderRegistry
from app.rules.base import RuleContext
from app.schemas.files import FileItem
from app.schemas.rename import PreviewItem, RenamePreviewRequest, RenamePreviewResponse
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine


logger = logging.getLogger("rename_studio.preview")


@contextmanager
def _timed_phase(storage_id: str, phase: str, item_count: int) -> Iterator[None]:
    started = perf_counter()
    try:
        yield
    finally:
        # 失败阶段也记录耗时；不记录文件名、规则内容或授权数据。
        logger.info(
            "preview phase=%s storage_id=%s request_id=%s item_count=%s duration_ms=%.2f",
            phase, storage_id, request_id_context.get(), item_count,
            (perf_counter() - started) * 1000,
        )


class PreviewService:
    def __init__(
        self,
        providers: ProviderRegistry,
        engine: RenameEngine,
        store: PreviewStore | None = None,
    ) -> None:
        self.providers = providers
        self.engine = engine
        self.store = store or PreviewStore()

    async def preview(
        self, request: RenamePreviewRequest, *, previous_preview_id: str | None = None,
    ) -> RenamePreviewResponse:
        revision = self.providers.revision(request.storage_id)
        request = request.model_copy(deep=True)
        with _timed_phase(request.storage_id, "evaluate", len(request.file_ids)):
            items, files, valid = await self.evaluate(request)
        if self.providers.revision(request.storage_id) != revision:
            raise StorageConnectionChangedError("Storage changed while creating the preview")
        with _timed_phase(request.storage_id, "snapshot", len(files)):
            response = self.store.save(request, items, valid, files, revision)
            # 新快照保存成功后才释放旧快照；替代 ID 不属于执行快照内容。
            if previous_preview_id is not None:
                self.store.release(previous_preview_id, request.storage_id)
            return response

    async def evaluate(
        self,
        request: RenamePreviewRequest,
        *,
        files: list[FileItem] | None = None,
        siblings: list[FileItem] | None = None,
    ) -> tuple[list[PreviewItem], list[FileItem], bool]:
        provider = self.providers.get(request.storage_id)
        record = self.providers.manager.record(request.storage_id)
        supports_rename = self.providers.definition(record.provider_type).can_rename
        if len(request.file_ids) != len(set(request.file_ids)):
            raise ValidationError("Duplicate file IDs are not allowed")

        prefetched_siblings: list[FileItem] | None = None
        if files is None and request.location is not None:
            # 浏览器已知父目录时，一次目录读取即可同时提供源元数据和冲突集合。
            with _timed_phase(request.storage_id, "source_directory", len(request.file_ids)):
                listing = await provider.list_directory(request.location)
            prefetched_siblings = listing.items
            request.location = listing.location
            by_id = {item.id: item for item in prefetched_siblings}
            missing_ids = [
                file_id for file_id in request.file_ids if file_id not in by_id
            ]
            if missing_ids:
                raise ValidationError(
                    "Selected items are not present in the requested directory",
                    details={"file_ids": missing_ids},
                )
            files = [by_id[file_id] for file_id in request.file_ids]
        elif files is None:
            with _timed_phase(request.storage_id, "source_metadata", len(request.file_ids)):
                files = await provider.get_metadata_many(request.file_ids)
        if any(item.id == "" or isinstance(item.location, RootLocation) for item in files):
            raise ValidationError("Configured storage root cannot be selected")
        if len({provider.parent_key(item) for item in files}) != 1:
            raise ValidationError("All selected items must be in the same directory")

        # 配置仅在本轮评估中解析一次；执行前重新评估时仍会重新校验。
        with _timed_phase(request.storage_id, "rules", len(files)):
            prepared_rules = self.engine.prepare_rules(request.rules)
            candidates = [
                self.engine.apply_prepared(
                    item.name,
                    prepared_rules,
                    RuleContext(
                        file_id=item.id,
                        index=index,
                        total=len(files),
                        is_directory=item.is_directory,
                    ),
                )
                for index, item in enumerate(files)
            ]
            normalized_targets = [provider.normalize_name(name) for name in candidates]

        with _timed_phase(request.storage_id, "conflict_directory", len(files)):
            if siblings is None:
                siblings = (
                    prefetched_siblings
                    if prefetched_siblings is not None
                    else await provider.list_siblings(files[0])
                )
        with _timed_phase(request.storage_id, "validation", len(files)):
            duplicate_targets = {
                name for name, count in Counter(normalized_targets).items() if count > 1
            }

            selected_ids = {item.id for item in files}
            # 选中项的名称依赖由重复目标检查和执行规划器处理；未选中项仍占用名称。
            occupied_names = {
                provider.normalize_name(sibling.name)
                for sibling in siblings
                if sibling.id not in selected_ids
            }
            results: list[PreviewItem] = []
            for item, new_name, normalized_target in zip(
                files, candidates, normalized_targets, strict=True
            ):
                error = provider.validate_target_name(item, new_name)
                if (not supports_rename or item.can_rename is False) and item.name != new_name:
                    error = "This item cannot be renamed with the current permissions"
                conflict = (
                    normalized_target in duplicate_targets
                    or normalized_target in occupied_names
                )
                if conflict and error is None:
                    error = "目标名称出现重复"
                results.append(
                    PreviewItem(
                        file_id=item.id,
                        original_name=item.name,
                        new_name=new_name,
                        changed=item.name != new_name,
                        valid=error is None and not conflict,
                        conflict=conflict,
                        error=error,
                    )
                )

        return results, files, all(item.valid for item in results)
