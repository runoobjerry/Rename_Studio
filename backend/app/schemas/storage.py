import json
from typing import Annotated, Literal
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from app.core.paths import normalize_storage_path
from app.schemas.rules import RuleSpec


class RootLocation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: Literal["root"] = "root"


class IdLocation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: Literal["id"] = "id"
    value: str = Field(min_length=1)


class PathLocation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: Literal["path"] = "path"
    value: str

    @field_validator("value")
    @classmethod
    def normalize(cls, value: str) -> str:
        return normalize_storage_path(value)


StorageLocation = Annotated[RootLocation | IdLocation | PathLocation, Field(discriminator="kind")]


class CloudDefaultLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    account_id: str = Field(min_length=1, max_length=200)
    location: StorageLocation

    @field_validator("location")
    @classmethod
    def check_location_length(cls, location: StorageLocation) -> StorageLocation:
        if isinstance(location, (IdLocation, PathLocation)) and len(location.value) > 4096:
            raise ValueError("Invalid cloud location length")
        return location


def validate_preferences_size(preferences: "AppPreferences | AppSettingsPatch") -> None:
    if len(preferences.cloud_default_locations) > 100:
        raise ValueError("Too many cloud connections")
    for storage_id in preferences.cloud_default_locations:
        if not storage_id or len(storage_id) > 200:
            raise ValueError("Invalid cloud connection key")
    encoded = json.dumps(preferences.model_dump(mode="json"), ensure_ascii=False)
    if len(encoded.encode("utf-8")) > 131072:
        raise ValueError("Preferences exceed the size limit")


class AppPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    theme: Literal["light", "dark", "system"] = "system"
    hide_batch_limit_hint: bool = False
    cloud_default_locations: dict[str, CloudDefaultLocation] = Field(default_factory=dict)

    @model_validator(mode="after")
    def check_size(self) -> "AppPreferences":
        validate_preferences_size(self)
        return self


class AppSettingsResponse(BaseModel):
    preferences: AppPreferences


class AppSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    theme: Literal["light", "dark", "system"] = "system"
    hide_batch_limit_hint: bool = False
    # Replace one connection's current-account default; null removes it.
    cloud_default_locations: dict[str, CloudDefaultLocation | None] = Field(default_factory=dict)

    @model_validator(mode="after")
    def check_size(self) -> "AppSettingsPatch":
        validate_preferences_size(self)
        return self


class LocalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    root_path: str = Field(min_length=1, max_length=4096)

    @field_validator("root_path")
    @classmethod
    def existing_root(cls, value: str) -> str:
        root = Path(value).expanduser().resolve()
        if not root.is_dir():
            raise ValueError("Local root must be an existing directory")
        return str(root)


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


class StorageClientSecret(BaseModel):
    client_secret: SecretStr | None = Field(default=None, min_length=1, max_length=4096)

    @field_validator("client_secret")
    @classmethod
    def normalize_secret(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None:
            return None
        secret = value.get_secret_value().strip()
        if not secret:
            raise ValueError("OAuth client secret cannot be blank")
        return SecretStr(secret)


class StorageCreate(StorageClientSecret):
    model_config = ConfigDict(extra="forbid")
    provider_type: str
    name: str = Field(min_length=1, max_length=200)
    config: dict[str, object]


class StorageUpdate(StorageClientSecret):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=200)
    config: dict[str, object] | None = None


class AuthorizationStatus(BaseModel):
    configured: bool
    connected: bool
    account_id: str | None = None
    account_display_name: str | None = None
    account_email: str | None = None


class AuthorizationStart(BaseModel):
    authorization_url: str


class StorageRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    storage_id: str
    provider_type: str
    name: str
    config: dict[str, object]
    revision: int = Field(default=1, ge=1)
    credentials: dict[str, str] = Field(default_factory=dict)


class StorageState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[3] = 3
    preferences: AppPreferences = Field(default_factory=AppPreferences)
    connections: dict[str, StorageRecord]


class StorageInfo(BaseModel):
    storage_id: str
    provider_type: str
    name: str
    config: dict[str, object]
    revision: int
    busy: bool = False
    has_client_secret: bool = False
    account_id: str | None = None
    account_display_name: str | None = None
    account_email: str | None = None


class StorageListRequest(BaseModel):
    location: StorageLocation = Field(default_factory=RootLocation)


class StoragePreviewRequest(StorageListRequest):
    file_ids: list[str] = Field(min_length=1, max_length=1000)
    rules: list[RuleSpec] = Field(default_factory=list, max_length=20)
    previous_preview_id: str | None = Field(default=None, min_length=1)


class StorageAuthStartResponse(BaseModel):
    authorization_url: str
    redirect_uri: str


class StorageProviderInfo(BaseModel):
    provider_type: str
    name: str
    config_schema: dict[str, object]
    locations: tuple[str, ...]
    can_rename: bool
    browser_auth: bool
    local_picker: bool


class LocalFolderPickResponse(BaseModel):
    root_path: str
    selected: bool
