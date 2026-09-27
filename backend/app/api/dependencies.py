from functools import lru_cache

from app.core.config import get_settings
from app.providers.local import LocalProvider
from app.providers.registry import ProviderRegistry
from app.rules.registry import RuleRegistry
from app.services.file_service import FileService
from app.services.preview_service import PreviewService
from app.services.rename_engine import RenameEngine


@lru_cache
def get_provider_registry() -> ProviderRegistry:
    return ProviderRegistry([LocalProvider(get_settings().local_storage_root)])


@lru_cache
def get_rule_registry() -> RuleRegistry:
    # Concrete rules are intentionally registered after their product behavior is
    # specified. The engine and API already support ordered rule chains.
    return RuleRegistry()


def get_file_service() -> FileService:
    return FileService(get_provider_registry())


def get_preview_service() -> PreviewService:
    return PreviewService(
        get_provider_registry(), RenameEngine(get_rule_registry())
    )
