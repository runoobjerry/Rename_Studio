from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import Settings
from app.providers.local.driver import LocalProvider
from app.providers.registry import ProviderDefinition
from app.schemas.storage import StorageConfigField


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


def get_definition(settings: Settings) -> ProviderDefinition:
    return ProviderDefinition(
        "local", "Local Files", LocalConfig, ("root", "path", "id"),
        lambda record, auth: LocalProvider(Path(str(record.config["root_path"]))),
        local_picker=True, icon="computer",
        config_fields=(StorageConfigField(
            key="root_path", label="本地根目录", input_type="directory", required=True,
        ),),
    )
