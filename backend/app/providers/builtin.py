from app.core.config import Settings
from app.providers.google_drive.definition import get_definition as google_drive_definition
from app.providers.local.definition import get_definition as local_definition
from app.providers.onedrive.definition import get_definition as onedrive_definition
from app.providers.registry import ProviderRegistry


def register_builtin_providers(registry: ProviderRegistry, settings: Settings) -> None:
    registry.register(local_definition(settings))
    registry.register(onedrive_definition(settings))
    registry.register(google_drive_definition(settings))
