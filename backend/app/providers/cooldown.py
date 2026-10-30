from asyncio import sleep
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from math import isfinite
from time import monotonic


class ConnectionCooldown:
    """One cached Provider represents one connection; all its requests share this gate."""

    def __init__(self) -> None:
        self._until = 0.0

    def defer(self, delay: float) -> None:
        # No await between reading and updating: concurrent responses can only extend the deadline.
        self._until = max(self._until, monotonic() + delay)

    async def wait(self) -> None:
        while True:
            remaining = self._until - monotonic()
            if remaining <= 0:
                return
            await sleep(remaining)
            # Another in-flight response may have extended the deadline while we slept.


def retry_after_delay(value: str | None, fallback: float) -> float:
    if value is None:
        return fallback
    try:
        delay = float(value)
    except ValueError:
        try:
            delay = (parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return fallback
    return max(0.0, delay) if isfinite(delay) else fallback
