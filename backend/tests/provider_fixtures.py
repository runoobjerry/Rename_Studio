import asyncio
from datetime import datetime

from pathlib import Path

from pydantic import BaseModel

from app.providers.base import StorageProvider
from app.providers.registry import ProviderDefinition, ProviderRegistry
from app.repositories.storage_repository import JsonStorageRepository
from app.schemas.storage import StorageRecord, StorageState
from app.services.storage_manager import StorageManager


class TestProviderConfig(BaseModel):
    pass


def registry_for(providers: list[StorageProvider]) -> ProviderRegistry:
    """Exercise service tests through the same factory/connection contract as production."""
    registry = ProviderRegistry()
    connections = {}
    for provider in providers:
        registry.register(ProviderDefinition(
            provider.id, TestProviderConfig, ("root", "id", "path"),
            lambda record, auth, instance=provider: instance,
        ))
        connections[provider.id] = StorageRecord(
            storage_id=provider.id, provider_type=provider.id,
            name=provider.id, config={},
        )
    StorageManager(registry, JsonStorageRepository(Path("unused-unit-test-state.json")),
                   StorageState(connections=connections))
    return registry


class CooldownClock:
    """Advance cooldown time explicitly while real asyncio tasks remain independently scheduled."""

    def __init__(self, monkeypatch) -> None:
        from app.providers import cooldown

        self.now = 0.0
        self.waiting: asyncio.Queue[float] = asyncio.Queue()
        self.sleepers: list[tuple[float, asyncio.Future[None]]] = []
        clock = self

        class ClockDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime.fromtimestamp(1793318400 + clock.now, tz=tz)

        monkeypatch.setattr(cooldown, "monotonic", lambda: self.now)
        monkeypatch.setattr(cooldown, "sleep", self.sleep)
        monkeypatch.setattr(cooldown, "datetime", ClockDateTime)

    async def sleep(self, delay: float) -> None:
        deadline = self.now + delay
        future = asyncio.get_running_loop().create_future()
        self.sleepers.append((deadline, future))
        self.waiting.put_nowait(deadline)
        await future

    def advance(self, now: float) -> None:
        self.now = now
        for deadline, future in self.sleepers:
            if deadline <= now and not future.done():
                future.set_result(None)

    async def next_wait(self) -> float:
        return await asyncio.wait_for(self.waiting.get(), timeout=5)
