from functools import lru_cache
from pathlib import Path
from typing import cast

from app.core.config import get_settings
from app.providers.local import LocalProvider
from app.providers.onedrive import OneDriveProvider
from app.providers.google_drive import GoogleDriveProvider
from app.providers.registry import ProviderDefinition, ProviderRegistry
from app.repositories.storage_repository import JsonStorageRepository
from app.schemas.storage import GoogleDriveConfig, LocalConfig, OneDriveConfig
from app.services.connection_auth import ConnectionAuth
from app.services.storage_manager import StorageManager
from app.rules.insert import InsertRule
from app.rules.padding import PaddingRule
from app.rules.registry import RuleRegistry
from app.rules.text_operations import RemoveRule, ReplaceRule
from app.services.execute_service import ExecuteService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine
from app.services.onedrive_auth import OneDriveAuthService
from app.services.google_drive_auth import GoogleDriveAuthService


@lru_cache
def get_provider_registry() -> ProviderRegistry:
    return get_storage_manager().registry


@lru_cache
def get_storage_manager() -> StorageManager:
    settings = get_settings()
    registry = ProviderRegistry()
    registry.register(ProviderDefinition(
        "local", "Local Files", LocalConfig, ("root", "path", "id"),
        lambda record, auth: LocalProvider(Path(str(record.config["root_path"]))),
        local_picker=True,
    ))
    registry.register(ProviderDefinition(
        "onedrive", "OneDrive", OneDriveConfig, ("root", "id", "path"),
        lambda record, auth: OneDriveProvider(cast(ConnectionAuth, auth)),
        auth_factory=lambda record, persist, guard: OneDriveAuthService(
            settings.storage_redirect_uri,
            initial_state={**record.credentials, **({"client_id": str(record.config["client_id"])} if record.config["client_id"] else {})},
            persist=lambda payload: persist({"client_id": payload.get("client_id")}, {key: value for key, value in payload.items() if key != "client_id"}),
            before_change=guard,
        ),
    ))
    registry.register(ProviderDefinition(
        "google_drive", "Google Drive", GoogleDriveConfig, ("root", "id"),
        lambda record, auth: GoogleDriveProvider(cast(ConnectionAuth, auth)),
        auth_factory=lambda record, persist, guard: GoogleDriveAuthService(
            settings.storage_redirect_uri,
            client_id=cast(str | None, record.config["client_id"]),
            credentials=record.credentials, persist=persist, before_change=guard,
        ),
    ))
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
