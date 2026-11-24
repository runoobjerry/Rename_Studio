from functools import lru_cache
import logging

from app.core.config import Settings, get_settings
from app.core.errors import ProviderError
from app.providers.builtin import register_builtin_providers
from app.providers.registry import ProviderRegistry
from app.repositories.storage_repository import JsonStorageRepository
from app.schemas.storage import StorageRecord, StorageState
from app.services.storage.storage_manager import StorageManager
from app.rules.delete import DeleteRule
from app.rules.insert import InsertRule
from app.rules.padding import PaddingRule
from app.rules.registry import RuleRegistry
from app.rules.serialize import SerializeRule
from app.rules.text_operations import RemoveRule, ReplaceRule
from app.services.directory.directory_cache import DirectoryCache
from app.services.directory.directory_service import DirectoryService
from app.services.rename.batch_execute_service import ExecuteService
from app.services.rename.single_rename_service import SingleRenameService
from app.services.rename.preview_service import PreviewService
from app.services.rename.preview_store import PreviewStore
from app.services.rename.rename_engine import RenameEngine


logger = logging.getLogger("rename_studio.storage")


@lru_cache
def get_storage_services() -> tuple[StorageManager, DirectoryService]:
    settings = get_settings()
    registry = ProviderRegistry()
    register_builtin_providers(registry, settings)
    cache = DirectoryCache(settings.directory_cache.directory_listings)
    manager = build_storage_manager(settings, registry, cache)
    return manager, DirectoryService(manager, cache)


def get_storage_manager() -> StorageManager:
    manager, _ = get_storage_services()
    return manager


def get_directory_service() -> DirectoryService:
    _, directories = get_storage_services()
    return directories


def build_storage_manager(settings: Settings, registry: ProviderRegistry, directory_cache: DirectoryCache) -> StorageManager:
    repository = JsonStorageRepository(settings.storage_state_file)
    default = StorageRecord(
        storage_id="default-local", provider_type="local", name="Local Files",
        config={"root_path": str(settings.local_storage_root)},
    )
    state = repository.load()
    if state is None:
        try:
            settings.local_storage_root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise ProviderError("Could not initialize the local storage root") from exc
        initial = default.model_copy(update={"config": registry.validate_config(default.provider_type, default.config)})
        state = StorageState(connections={initial.storage_id: initial})
        repository.save(state)
    else:
        try:
            existing = state.connections[default.storage_id]
            if existing.provider_type != default.provider_type:
                raise ValueError("Default storage connection type mismatch")
            for record in state.connections.values():
                record.config = registry.validate_config(record.provider_type, record.config)
        except (OSError, KeyError, ValueError) as exc:
            raise ProviderError("Storage state is invalid; restore its backup before starting") from exc
    logger.info("Storage connections loaded connection_count=%s", len(state.connections))
    return StorageManager(
        registry, repository, state, default_connection=default,
        directory_cache=directory_cache,
    )


@lru_cache
def get_rule_registry() -> RuleRegistry:
    registry = RuleRegistry()
    registry.register(PaddingRule())
    registry.register(ReplaceRule())
    registry.register(RemoveRule())
    registry.register(InsertRule())
    registry.register(DeleteRule())
    registry.register(SerializeRule())
    return registry


@lru_cache
def get_preview_store() -> PreviewStore:
    return PreviewStore()


@lru_cache
def get_preview_service() -> PreviewService:
    manager, directories = get_storage_services()
    return PreviewService(
        manager,
        directories,
        RenameEngine(get_rule_registry()),
        get_preview_store(),
    )


@lru_cache
def get_execute_service() -> ExecuteService:
    manager, directories = get_storage_services()
    return ExecuteService(
        manager,
        directories,
        get_preview_store(),
        get_preview_service(),
    )


@lru_cache
def get_single_rename_service() -> SingleRenameService:
    manager, directories = get_storage_services()
    return SingleRenameService(manager, directories)
