from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ValidationError as ModelValidationError

from app.core.errors import ValidationError
from app.providers.base import StorageProvider
from app.schemas.storage import StorageConfigField, StorageRecord
from app.services.connection_auth import ConnectionAuth

if TYPE_CHECKING:
    from app.services.storage_manager import StorageManager


@dataclass(frozen=True)
class ProviderDefinition:
    provider_type: str
    name: str
    config_model: type[BaseModel]
    locations: tuple[str, ...]
    factory: Callable[[StorageRecord, ConnectionAuth | None], StorageProvider]
    auth_factory: Callable[[StorageRecord, Callable[[dict[str, object], dict[str, str]], None], Callable[[], None]], ConnectionAuth] | None = None
    local_picker: bool = False
    can_rename: bool = True
    config_fields: tuple[StorageConfigField, ...] = ()
    account_label: str = "用户"
    icon: Literal["computer", "cloud"] = "cloud"


class ProviderRegistry:
    def __init__(self) -> None:
        self.definitions: dict[str, ProviderDefinition] = {}
        self.manager: StorageManager

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

    def revision(self, provider_id: str) -> int:
        return self.manager.record(provider_id).revision

    @contextmanager
    def execution(self, provider_id: str, revision: int) -> Iterator[None]:
        with self.manager.execution(provider_id, revision):
            yield

    def get(self, provider_id: str) -> StorageProvider:
        return self.manager.provider(provider_id)

    async def aclose(self) -> None:
        await self.manager.aclose()
