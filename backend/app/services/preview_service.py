from collections import Counter, defaultdict

from app.core.errors import StorageConnectionChangedError, ValidationError
from app.schemas.storage import RootLocation
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
        revision = self.providers.revision(request.storage_id)
        request = request.model_copy(deep=True)
        items, files, valid = await self.evaluate(request)
        if self.providers.revision(request.storage_id) != revision:
            raise StorageConnectionChangedError("Storage changed while creating the preview")
        return self.store.save(request, items, valid, files, revision)

    async def evaluate(
        self,
        request: RenamePreviewRequest,
        *,
        files: list[FileItem] | None = None,
        siblings_by_parent: dict[str, list[FileItem]] | None = None,
    ) -> tuple[list[PreviewItem], list[FileItem], bool]:
        provider = self.providers.get(request.storage_id)
        record = self.providers.manager.record(request.storage_id)
        supports_rename = self.providers.definition(record.provider_type).can_rename
        if len(request.file_ids) != len(set(request.file_ids)):
            raise ValidationError("Duplicate file IDs are not allowed")

        prefetched_siblings: list[FileItem] | None = None
        if files is None and request.location is not None:
            # 浏览器已知父目录时，一次目录读取即可同时提供源元数据和冲突集合。
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
            files = await provider.get_metadata_many(request.file_ids)
        if any(item.id == "" or isinstance(item.location, RootLocation) for item in files):
            raise ValidationError("Configured storage root cannot be selected")
        if len({provider.parent_key(item) for item in files}) != 1:
            raise ValidationError("All selected items must be in the same directory")

        # 配置仅在本轮评估中解析一次；执行前重新评估时仍会重新校验。
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
        duplicate_targets = {
            name for name, count in Counter(normalized_targets).items() if count > 1
        }

        by_parent: dict[str, list[FileItem]] = defaultdict(list)
        for item in files:
            by_parent[provider.parent_key(item)].append(item)

        existing_by_parent: dict[str, dict[str, list[FileItem]]] = {}
        for parent_path in by_parent:
            if siblings_by_parent is not None and parent_path in siblings_by_parent:
                siblings = siblings_by_parent[parent_path]
            elif prefetched_siblings is not None:
                siblings = prefetched_siblings
            else:
                siblings = await provider.list_siblings(by_parent[parent_path][0])
            names: dict[str, list[FileItem]] = defaultdict(list)
            for sibling in siblings:
                names[provider.normalize_name(sibling.name)].append(sibling)
            existing_by_parent[parent_path] = names

        selected_ids = {item.id for item in files}
        results: list[PreviewItem] = []
        for item, new_name, normalized_target in zip(
            files, candidates, normalized_targets, strict=True
        ):
            error = provider.validate_target_name(item, new_name)
            if (not supports_rename or item.can_rename is False) and item.name != new_name:
                error = "This item cannot be renamed with the current permissions"
            conflict = normalized_target in duplicate_targets
            existing = existing_by_parent[provider.parent_key(item)].get(normalized_target, [])
            if any(sibling.id != item.id for sibling in existing):
                # 选中且会移走的源名称由执行规划器处理交换和循环依赖。
                conflict = conflict or any(sibling.id not in selected_ids for sibling in existing)
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
