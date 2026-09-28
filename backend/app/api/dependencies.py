from functools import lru_cache

from app.core.config import get_settings
from app.providers.local import LocalProvider
from app.providers.onedrive import OneDriveProvider
from app.providers.registry import ProviderRegistry
from app.rules.insert import InsertRule
from app.rules.padding import PaddingRule
from app.rules.registry import RuleRegistry
from app.rules.text_operations import RemoveRule, ReplaceRule
from app.services.execute_service import ExecuteService
from app.services.file_service import FileService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine
from app.services.onedrive_auth import OneDriveAuthService


@lru_cache
def get_onedrive_auth_service() -> OneDriveAuthService:
    settings = get_settings()
    return OneDriveAuthService(settings.onedrive_redirect_uri)


@lru_cache
def get_provider_registry() -> ProviderRegistry:
    return ProviderRegistry(
        [
            LocalProvider(get_settings().local_storage_root),
            OneDriveProvider(get_onedrive_auth_service()),
        ]
    )


@lru_cache
def get_rule_registry() -> RuleRegistry:
    registry = RuleRegistry()
    registry.register(PaddingRule())
    registry.register(ReplaceRule())
    registry.register(RemoveRule())
    registry.register(InsertRule())
    return registry


def get_file_service() -> FileService:
    return FileService(get_provider_registry())


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
