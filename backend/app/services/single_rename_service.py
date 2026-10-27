import asyncio
import logging

from app.core.errors import AppError, ProviderError, ValidationError
from app.providers.base import RenameRequest, StorageProvider
from app.providers.registry import ProviderRegistry
from app.schemas.files import RenameFile
from app.schemas.rename import SingleExecuteItem, SingleRenameExecuteRequest, SingleRenameExecuteResponse
from app.services.rename_write import drain_writes, reconcile_unknown_rename


logger = logging.getLogger("rename_studio.rename")


class SingleRenameService:
    def __init__(self, providers: ProviderRegistry) -> None:
        self.providers = providers

    async def execute(self, storage_id: str, request: SingleRenameExecuteRequest) -> SingleRenameExecuteResponse:
        # StorageManager also guards batch execution and connection changes.
        with self.providers.execution(storage_id, request.revision):
            provider = self.providers.get(storage_id)
            record = self.providers.manager.record(storage_id)
            if not self.providers.definition(record.provider_type).can_rename:
                raise ValidationError("This storage does not support renaming")
            result = SingleExecuteItem(
                file_id=request.file_id, original_name=request.original_name,
                new_name=request.target_name, status="failed",
            )
            task = asyncio.create_task(self._rename(provider, RenameRequest(request.file_id, request.target_name)))
            try:
                outcome = await asyncio.shield(task)
            except asyncio.CancelledError:
                await drain_writes([task])
                raise
            if isinstance(outcome, AppError):
                result.error = outcome.message
                result.error_code = outcome.code
                result.actual_name = outcome.details.get("actual_name")
            else:
                result.status = "renamed"
                result.current_file = outcome
            logger.info(
                "single rename provider=%s operation=%s file_id=%s status=%s error_code=%s",
                storage_id, request.operation_id, request.file_id, result.status, result.error_code,
            )
            return SingleRenameExecuteResponse(
                operation_id=str(request.operation_id),
                status="completed" if result.status == "renamed" else "failed", items=[result],
            )

    @staticmethod
    async def _rename(provider: StorageProvider, request: RenameRequest) -> RenameFile | AppError:
        try:
            outcome = await provider.rename_single(request.file_id, request.new_name)
        except AppError as exc:
            return await reconcile_unknown_rename(provider.get_single_metadata, request, exc)
        if outcome.name != request.new_name:
            return ProviderError(
                "Rename target was not reached; current name was verified",
                details={"actual_name": outcome.name},
            )
        return outcome
