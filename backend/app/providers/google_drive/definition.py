from typing import cast

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import Settings
from app.providers.google_drive.auth import GoogleDriveAuthService
from app.providers.google_drive.driver import GoogleDriveProvider
from app.providers.registry import ProviderDefinition
from app.schemas.storage import StorageConfigField
from app.services.connection_auth import ConnectionAuth


class GoogleDriveConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: str | None = Field(default=None, max_length=200)

    @field_validator("client_id")
    @classmethod
    def normalize_client(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.strip():
            raise ValueError("Google OAuth Client ID cannot be blank")
        return value.strip()


def get_definition(settings: Settings) -> ProviderDefinition:
    return ProviderDefinition(
        "google_drive", GoogleDriveConfig, ("root", "id"),
        lambda record, auth: GoogleDriveProvider(cast(ConnectionAuth, auth)),
        config_fields=(
            StorageConfigField(
                key="client_id", nullable=True,
            ),
            StorageConfigField(
                key="client_secret", input_type="text", target="client_secret",
            ),
        ),
        auth_factory=lambda record, persist, guard: GoogleDriveAuthService(
            settings.storage_redirect_uri,
            client_id=cast(str | None, record.config["client_id"]),
            credentials=record.credentials, persist=persist, before_change=guard,
        ),
    )
