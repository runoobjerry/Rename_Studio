import asyncio
from collections.abc import Awaitable, Callable, Iterable
from typing import TypeVar

from app.core.errors import AppError, ProviderError, RenameOutcomeUnknownError
from app.providers.base import RenameRequest
from app.schemas.files import RenameFile


T = TypeVar("T")


async def reconcile_unknown_rename[FileT: RenameFile](
    read_metadata: Callable[[str], Awaitable[FileT]], request: RenameRequest, outcome: FileT | AppError,
) -> FileT | AppError:
    if not isinstance(outcome, RenameOutcomeUnknownError):
        return outcome
    # A lost response must be checked by ID, never replayed.
    try:
        current = await read_metadata(request.file_id)
    except AppError:
        return outcome
    if current.name == request.new_name:
        return current
    return ProviderError(
        "Rename target was not reached; current name was verified",
        details={"actual_name": current.name},
    )


async def drain_writes(tasks: Iterable[asyncio.Task[T]]) -> None:
    # Keep the execution lock until in-flight writes finish, even after cancellation.
    draining = asyncio.gather(*tasks, return_exceptions=True)
    while not draining.done():
        try:
            await asyncio.shield(draining)
        except asyncio.CancelledError:
            continue
