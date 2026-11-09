import asyncio
from collections.abc import Awaitable, Callable, Iterable
from typing import Literal, TypeVar

from app.core.errors import AppError, ProviderError, RenameOutcomeUnknownError
from app.providers.base import RenameRequest
from app.schemas.files import RenameFile


T = TypeVar("T")
type RenameObserver[FileT: RenameFile] = Callable[[str, FileT | AppError, bool], None]


def rename_failure_status(error: AppError) -> Literal["failed", "unknown", "not_attempted"]:
    if isinstance(error, RenameOutcomeUnknownError):
        return "unknown"
    if error.details.get("reason") == "RENAME_NOT_ATTEMPTED":
        return "not_attempted"
    return "failed"


async def resolve_rename_outcome[FileT: RenameFile](
    read_metadata: Callable[[str], Awaitable[FileT]], request: RenameRequest, outcome: FileT | AppError,
    *, observe: RenameObserver[FileT] | None = None, require_direct_target: bool = False,
) -> FileT | AppError:
    unknown = outcome if isinstance(outcome, RenameOutcomeUnknownError) else None
    if unknown is not None:
        # A lost response must be checked by ID, never replayed.
        try:
            outcome = await read_metadata(request.file_id)
        except AppError:
            outcome = unknown

    target_confirmed = not isinstance(outcome, AppError) and outcome.name == request.new_name
    if observe is not None:
        observe(request.file_id, outcome, target_confirmed)
    # Direct batch responses keep the Provider's outcome, while cache updates require a confirmed name.
    if isinstance(outcome, AppError) or target_confirmed or (unknown is None and not require_direct_target):
        return outcome

    details = dict(unknown.details) if unknown is not None else {}
    details["actual_name"] = outcome.name
    error = ProviderError(
        "Rename target was not reached; current name was verified",
        details=details,
    )
    error.__cause__ = unknown
    return error


async def drain_writes(tasks: Iterable[asyncio.Task[T]]) -> None:
    # Keep the execution lock until in-flight writes finish, even after cancellation.
    draining = asyncio.gather(*tasks, return_exceptions=True)
    while not draining.done():
        try:
            await asyncio.shield(draining)
        except asyncio.CancelledError:
            continue
