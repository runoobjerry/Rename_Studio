from typing import cast

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import Settings
from app.providers.onedrive.auth import OneDriveAuthService
from app.providers.onedrive.driver import OneDriveProvider
from app.providers.registry import ProviderDefinition
from app.schemas.storage import StorageConfigField
from app.services.connection_auth import ConnectionAuth


class OneDriveConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: str | None = Field(default=None, max_length=200)

    @field_validator("client_id")
    @classmethod
    def normalize_client(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.strip():
            raise ValueError("OneDrive App ID cannot be blank")
        return value.strip()


def get_definition(settings: Settings) -> ProviderDefinition:
    return ProviderDefinition(
        "onedrive", OneDriveConfig, ("root", "id", "path"),
        lambda record, auth: OneDriveProvider(cast(ConnectionAuth, auth)),
        config_fields=(StorageConfigField(
            key="client_id", nullable=True,
        ),),
        auth_factory=lambda record, persist, guard: OneDriveAuthService(
            settings.storage_redirect_uri,
            initial_state={**record.credentials, **({"client_id": str(record.config["client_id"])} if record.config["client_id"] else {})},
            persist=lambda payload: persist({"client_id": payload.get("client_id")}, {key: value for key, value in payload.items() if key != "client_id"}),
            before_change=guard,
        ),
    )
