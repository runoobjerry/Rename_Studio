from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ValidationError as ModelValidationError

from app.core.errors import ValidationError
from app.providers.auth import StorageAuth
from app.providers.base import StorageDriver
from app.schemas.storage import StorageConfigField, StorageRecord


@dataclass(frozen=True)
class ProviderDefinition:
    provider_type: str
    config_model: type[BaseModel]
    locations: tuple[str, ...]
    driver_factory: Callable[[StorageRecord, StorageAuth | None], StorageDriver]
    auth_factory: Callable[[StorageRecord, Callable[[dict[str, object], dict[str, str]], None], Callable[[], None]], StorageAuth] | None = None
    local_picker: bool = False
    can_rename: bool = True
    config_fields: tuple[StorageConfigField, ...] = ()
    icon: Literal["computer", "cloud"] = "cloud"
    browser_navigation: str | None = None
    cache_directories: bool = False
    accepts_client_secret: bool = False


class ProviderRegistry:
    def __init__(self) -> None:
        self.definitions: dict[str, ProviderDefinition] = {}

    def register(self, definition: ProviderDefinition) -> None:
        if definition.provider_type in self.definitions:
            raise ValueError("Provider is already registered")
        self.definitions[definition.provider_type] = definition

    def definition(self, provider_type: str) -> ProviderDefinition:
        if provider_type not in self.definitions:
            raise ValidationError("Unknown storage provider", details={"provider": provider_type})
        return self.definitions[provider_type]

    def validate_config(self, provider_type: str, config: dict[str, object]) -> dict[str, object]:
        try:
            return self.definition(provider_type).config_model.model_validate(config).model_dump(mode="json")
        except ModelValidationError as exc:
            raise ValidationError("Invalid storage configuration", details={"provider": provider_type}) from exc
