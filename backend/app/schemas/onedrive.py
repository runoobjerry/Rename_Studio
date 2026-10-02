from pydantic import BaseModel, Field, field_validator


class OneDriveSettingsUpdate(BaseModel):
    client_id: str = Field(min_length=1, max_length=200)

    @field_validator("client_id")
    @classmethod
    def strip_client_id(cls, value: str) -> str:
        return value.strip()


class OneDriveSettingsResponse(BaseModel):
    configured: bool
    client_id: str | None
    redirect_uri: str


class OneDriveAuthStatus(BaseModel):
    configured: bool
    connected: bool
    account_id: str | None = None
    account_display_name: str | None = None
    account_email: str | None = None


class OneDriveAuthStartResponse(BaseModel):
    authorization_url: str
