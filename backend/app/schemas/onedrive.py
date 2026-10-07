from pydantic import BaseModel, Field, field_validator
from app.schemas.storage import AuthorizationStart, AuthorizationStatus


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


class OneDriveAuthStatus(AuthorizationStatus):
    pass


class OneDriveAuthStartResponse(AuthorizationStart):
    pass
