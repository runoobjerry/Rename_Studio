from functools import lru_cache

from app.core.config import get_settings
from app.providers.builtin import register_builtin_providers
from app.providers.registry import ProviderRegistry
from app.repositories.storage_repository import JsonStorageRepository
from app.services.storage_manager import StorageManager
from app.rules.insert import InsertRule
from app.rules.padding import PaddingRule
from app.rules.registry import RuleRegistry
from app.rules.text_operations import RemoveRule, ReplaceRule
from app.services.execute_service import ExecuteService
from app.services.single_rename_service import SingleRenameService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine


@lru_cache
def get_provider_registry() -> ProviderRegistry:
    return get_storage_manager().registry


@lru_cache
def get_storage_manager() -> StorageManager:
    settings = get_settings()
    registry = ProviderRegistry()
    register_builtin_providers(registry, settings)
    repository = JsonStorageRepository(settings.storage_state_file)
    state = repository.load_or_initialize(settings.local_storage_root, registry.validate_config)
    return StorageManager(registry, repository, state)


@lru_cache
def get_rule_registry() -> RuleRegistry:
    registry = RuleRegistry()
    registry.register(PaddingRule())
    registry.register(ReplaceRule())
    registry.register(RemoveRule())
    registry.register(InsertRule())
    return registry


@lru_cache
def get_preview_store() -> PreviewStore:
    return PreviewStore()


@lru_cache
def get_preview_service() -> PreviewService:
    return PreviewService(
        get_provider_registry(),
        RenameEngine(get_rule_registry()),
        get_preview_store(),
    )


@lru_cache
def get_execute_service() -> ExecuteService:
    return ExecuteService(
        get_provider_registry(),
        get_preview_store(),
        get_preview_service(),
    )


@lru_cache
def get_single_rename_service() -> SingleRenameService:
    return SingleRenameService(get_provider_registry())
