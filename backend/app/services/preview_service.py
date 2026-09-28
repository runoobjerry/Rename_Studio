from collections import Counter, defaultdict

from app.core.errors import ValidationError
from app.core.paths import normalize_storage_path
from app.providers.registry import ProviderRegistry
from app.rules.base import RuleContext
from app.schemas.files import FileItem
from app.schemas.rename import PreviewItem, RenamePreviewRequest, RenamePreviewResponse
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine


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

    async def preview(self, request: RenamePreviewRequest) -> RenamePreviewResponse:
        items, files, valid = await self.evaluate(request)
        return self.store.save(request, items, valid, files)

    async def evaluate(
        self,
        request: RenamePreviewRequest,
        *,
        files: list[FileItem] | None = None,
        siblings_by_parent: dict[str, list[FileItem]] | None = None,
    ) -> tuple[list[PreviewItem], list[FileItem], bool]:
        provider = self.providers.get(request.provider)
        if len(request.file_ids) != len(set(request.file_ids)):
            raise ValidationError("Duplicate file IDs are not allowed")

        prefetched_siblings: list[FileItem] | None = None
        if files is None and request.path is not None:
            # 浏览器已知父目录时，一次目录读取即可同时提供源元数据和冲突集合。
            prefetched_siblings = await provider.list_files(
                normalize_storage_path(request.path)
            )
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
            files = await provider.get_metadata_many(request.file_ids)
        if any(item.id == "" for item in files):
            raise ValidationError("Configured storage root cannot be selected")
        if len({item.parent_path for item in files}) != 1:
            raise ValidationError("All selected items must be in the same directory")

        candidates = [
            self.engine.apply(
                item.name,
                request.rules,
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
        duplicate_targets = {
            name for name, count in Counter(normalized_targets).items() if count > 1
        }

        by_parent: dict[str, list[FileItem]] = defaultdict(list)
        for item in files:
            by_parent[item.parent_path].append(item)

        existing_by_parent: dict[str, dict[str, FileItem]] = {}
        for parent_path in by_parent:
            if siblings_by_parent is not None and parent_path in siblings_by_parent:
                siblings = siblings_by_parent[parent_path]
            elif prefetched_siblings is not None:
                siblings = prefetched_siblings
            else:
                siblings = await provider.list_files(parent_path)
            existing_by_parent[parent_path] = {
                provider.normalize_name(sibling.name): sibling for sibling in siblings
            }

        selected_ids = {item.id for item in files}
        results: list[PreviewItem] = []
        for item, new_name, normalized_target in zip(
            files, candidates, normalized_targets, strict=True
        ):
            error = provider.validate_target_name(item, new_name)
            conflict = normalized_target in duplicate_targets
            existing = existing_by_parent[item.parent_path].get(normalized_target)
            if existing is not None and existing.id != item.id:
                # 选中且会移走的源名称由执行规划器处理交换和循环依赖。
                conflict = conflict or existing.id not in selected_ids
            if conflict and error is None:
                error = "Target filename conflicts with another file"
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
