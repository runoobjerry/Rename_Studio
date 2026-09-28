from pydantic import BaseModel, Field, field_validator


class LocalSettingsUpdate(BaseModel):
    root_path: str = Field(min_length=1, max_length=4096)

    @field_validator("root_path")
    @classmethod
    def strip_root_path(cls, value: str) -> str:
        return value.strip()


class LocalSettingsResponse(BaseModel):
    root_path: str


class LocalFolderPickResponse(LocalSettingsResponse):
    selected: bool
