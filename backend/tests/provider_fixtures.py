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
