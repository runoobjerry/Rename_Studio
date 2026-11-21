import asyncio
import logging

from app.core.errors import AppError, ValidationError
from app.providers.base import RenameRequest, StorageDriver
from app.schemas.files import RenameFile
from app.schemas.rename import SingleExecuteItem, SingleRenameExecuteRequest, SingleRenameExecuteResponse
from app.services.directory.directory_cache import RenameCacheScope
from app.services.directory.directory_service import DirectoryService
from app.services.rename.write_outcome import RenameObserver, drain_writes, rename_failure_status, resolve_rename_outcome
from app.services.storage.storage_manager import StorageManager


logger = logging.getLogger("rename_studio.rename")


class SingleRenameService:
    def __init__(self, manager: StorageManager, directories: DirectoryService) -> None:
        self.manager = manager
        self.directories = directories

    async def execute(self, storage_id: str, request: SingleRenameExecuteRequest) -> SingleRenameExecuteResponse:
        # StorageManager also guards batch execution and connection changes.
        with self.manager.execution(storage_id, request.revision):
            driver = self.manager.get_driver(storage_id)
            if not self.manager.provider_definition(storage_id).can_rename:
                raise ValidationError("This storage does not support renaming")
            result = SingleExecuteItem(
                file_id=request.file_id, original_name=request.original_name,
                new_name=request.target_name, status="failed",
            )
            scope = RenameCacheScope(folder_ids={request.file_id})
            with self.directories.writing(storage_id, request.revision, scope):
                task = asyncio.create_task(self._rename(
                    driver, RenameRequest(request.file_id, request.target_name),
                    lambda file_id, outcome, target_confirmed: scope.observe(
                        file_id, request.location, request.original_name, outcome, target_confirmed=target_confirmed,
                    ),
                ))
                try:
                    outcome = await asyncio.shield(task)
                except asyncio.CancelledError:
                    await drain_writes([task])
                    raise
            if isinstance(outcome, AppError):
                result.status = rename_failure_status(outcome)
                result.error = outcome.message
                result.error_code = outcome.code
                result.details = outcome.details or None
                result.actual_name = outcome.details.get("actual_name")
            else:
                result.status = "renamed"
                result.current_file = outcome
                result.actual_name = outcome.name
            logger.info(
                "single rename storage_id=%s operation=%s file_id=%s status=%s error_code=%s",
                storage_id, request.operation_id, request.file_id, result.status, result.error_code,
            )
            return SingleRenameExecuteResponse(
                operation_id=str(request.operation_id),
                status="completed" if result.status == "renamed" else "incomplete", items=[result],
            )

    @staticmethod
    async def _rename(
        driver: StorageDriver, request: RenameRequest,
        observe: RenameObserver[RenameFile],
    ) -> RenameFile | AppError:
        outcome: RenameFile | AppError
        try:
            outcome = await driver.rename_single(request.file_id, request.new_name)
        except AppError as exc:
            outcome = exc
        return await resolve_rename_outcome(
            driver.get_single_metadata, request, outcome, observe=observe, require_direct_target=True,
        )
