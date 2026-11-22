import asyncio
import logging
from time import perf_counter

from app.core.errors import AppError, ValidationError
from app.core.log_config import terminal_logger
from app.core.log_context import log_operation
from app.providers.base import RenameRequest, StorageDriver
from app.schemas.files import RenameFile
from app.schemas.rename import RenameExecutionStatus, SingleExecuteItem, SingleRenameExecuteRequest, SingleRenameExecuteResponse
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
        operation_id = str(request.operation_id)
        with self.manager.execution(storage_id, request.revision), log_operation(operation_id, storage_id):
            driver = self.manager.get_driver(storage_id)
            if not self.manager.provider_definition(storage_id).can_rename:
                raise ValidationError("This storage does not support renaming")
            storage_name = self.manager.record(storage_id).name
            started = perf_counter()
            logger.info("Single rename started provider=%s", driver.provider_type)
            result = SingleExecuteItem(
                file_id=request.file_id, original_name=request.original_name,
                new_name=request.target_name, status="failed",
            )
            scope = RenameCacheScope(folder_ids={request.file_id})
            terminal_logger.info("%r Rename in progress", storage_name, extra={"terminal_progress": True})
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
                    terminal_logger.info("%r Rename outcome needs verification", storage_name)
                    raise
            duration_ms = (perf_counter() - started) * 1000
            execution_status: RenameExecutionStatus
            if isinstance(outcome, AppError):
                result.status = rename_failure_status(outcome)
                result.error = outcome.message
                result.error_code = outcome.code
                result.details = outcome.details or None
                result.actual_name = outcome.details.get("actual_name")
                logger.warning("Single rename incomplete status=%s error_code=%s duration_ms=%.2f",
                               result.status, result.error_code, duration_ms)
                status_label = "outcome needs verification" if result.status == "unknown" else "failed"
                terminal_logger.error("%r Rename %s (%s)", storage_name, status_label, result.error_code)
                execution_status = "incomplete"
            else:
                result.status = "renamed"
                result.current_file = outcome
                result.actual_name = outcome.name
                logger.info("Single rename completed duration_ms=%.2f", duration_ms)
                terminal_logger.info("%r Rename succeeded", storage_name)
                execution_status = "completed"
            return SingleRenameExecuteResponse(
                operation_id=operation_id, status=execution_status, items=[result],
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
