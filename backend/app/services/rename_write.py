import asyncio
from collections.abc import Awaitable, Callable, Iterable
from typing import Literal, TypeVar

from app.core.errors import AppError, ProviderError, RenameOutcomeUnknownError
from app.providers.base import RenameRequest
from app.schemas.files import RenameFile


T = TypeVar("T")


def rename_failure_status(error: AppError) -> Literal["failed", "unknown", "not_attempted"]:
    if isinstance(error, RenameOutcomeUnknownError):
        return "unknown"
    if error.details.get("reason") == "RENAME_NOT_ATTEMPTED":
        return "not_attempted"
    return "failed"


async def reconcile_unknown_rename[FileT: RenameFile](
    read_metadata: Callable[[str], Awaitable[FileT]], request: RenameRequest, outcome: FileT | AppError,
    *, observe: Callable[[str, FileT | RenameOutcomeUnknownError], None] | None = None,
) -> FileT | AppError:
    if not isinstance(outcome, AppError):
        if observe is not None:
            observe(request.file_id, outcome)
        return outcome
    if not isinstance(outcome, RenameOutcomeUnknownError):
        return outcome
    # A lost response must be checked by ID, never replayed.
    try:
        current = await read_metadata(request.file_id)
    except AppError:
        if observe is not None:
            observe(request.file_id, outcome)
        return outcome
    if observe is not None:
        observe(request.file_id, current)
    if current.name == request.new_name:
        return current
    # This confirms the current target was not reached, not that the write never ran.
    error = ProviderError(
        "Rename target was not reached; current name was verified",
        details={**outcome.details, "actual_name": current.name},
    )
    error.__cause__ = outcome
    return error


async def drain_writes(tasks: Iterable[asyncio.Task[T]]) -> None:
    # Keep the execution lock until in-flight writes finish, even after cancellation.
    draining = asyncio.gather(*tasks, return_exceptions=True)
    while not draining.done():
        try:
            await asyncio.shield(draining)
        except asyncio.CancelledError:
            continue
