from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "OneDriver Renamer"
    local_storage_root: Path = Path("local_storage")
    frontend_origin: str = "http://localhost:5173"
    storage_state_file: Path = _BACKEND_ROOT / ".storage_connections.json"
    storage_redirect_uri: str = "http://localhost:8000/auth/storage/callback"

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("local_storage_root")
    @classmethod
    def resolve_storage_root(cls, value: Path) -> Path:
        return value.expanduser().resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
