from functools import lru_cache
import os
from pathlib import Path
import sys

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def default_documents_directory() -> Path:
    if sys.platform == "win32":
        import winreg

        # Documents may be redirected to OneDrive or another drive.
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as key:
            documents, _ = winreg.QueryValueEx(key, "Personal")
        return Path(os.path.expandvars(documents))
    return Path.home() / "Documents"


class Settings(BaseSettings):
    app_name: str = "OneDriver Renamer"
    local_storage_root: Path = Field(default_factory=lambda: default_documents_directory())
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
