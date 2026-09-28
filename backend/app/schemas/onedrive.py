from pydantic import BaseModel, Field, SecretStr, field_validator


class OneDriveSettingsUpdate(BaseModel):
    client_id: str = Field(min_length=1, max_length=200)
    client_secret: SecretStr = Field(min_length=1, max_length=500)

    @field_validator("client_id")
    @classmethod
    def strip_client_id(cls, value: str) -> str:
        return value.strip()


class OneDriveSettingsResponse(BaseModel):
    configured: bool
    client_id: str | None
    client_secret_configured: bool
    redirect_uri: str


class OneDriveAuthStatus(BaseModel):
    configured: bool
    connected: bool


class OneDriveAuthStartResponse(BaseModel):
    authorization_url: str
