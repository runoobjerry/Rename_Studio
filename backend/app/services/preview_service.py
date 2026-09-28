from collections import Counter, defaultdict

from app.core.errors import ValidationError
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
        self, request: RenamePreviewRequest
    ) -> tuple[list[PreviewItem], list[FileItem], bool]:
        provider = self.providers.get(request.provider)
        if len(request.file_ids) != len(set(request.file_ids)):
            raise ValidationError("Duplicate file IDs are not allowed")

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
                # A selected source moving away is not an immediate collision; M3 will
                # plan temporary names for swaps and cycles.
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
