from functools import lru_cache
import os
from pathlib import Path
import sys
import tomllib

from pydantic import BaseModel, Field, PositiveInt, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_ROOT = Path(__file__).resolve().parents[2]


class DirectoryListingCacheSettings(BaseModel, extra="forbid", strict=True):
    ttl: float = Field(default=600, gt=0, allow_inf_nan=False)
    empty_ttl: float = Field(default=30, gt=0, allow_inf_nan=False)
    max_entries: PositiveInt = 64
    max_bytes: PositiveInt = 32 * 1024**2
    max_entry_bytes: PositiveInt = 8 * 1024**2


class DirectoryMetadataCacheSettings(BaseModel, extra="forbid", strict=True):
    ttl: float = Field(default=120, gt=0, allow_inf_nan=False)
    max_entries: PositiveInt = 2048


class DirectoryCacheSettings(BaseModel, extra="forbid"):
    directory_listings: DirectoryListingCacheSettings = Field(default_factory=DirectoryListingCacheSettings)
    directory_metadata: DirectoryMetadataCacheSettings = Field(default_factory=DirectoryMetadataCacheSettings)


def load_directory_cache_settings(path: Path) -> DirectoryCacheSettings:
    try:
        with path.open("rb") as config_file:
            return DirectoryCacheSettings.model_validate(tomllib.load(config_file))
    except FileNotFoundError:
        return DirectoryCacheSettings()
    except (OSError, ValueError) as exc:
        raise ValueError(f"Invalid directory cache configuration in {path}: {exc}") from exc


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
    app_name: str = "Rename_Studio"
    local_storage_root: Path = Field(default_factory=lambda: default_documents_directory())
    frontend_origin: str = "http://localhost:5173"
    storage_state_file: Path = _BACKEND_ROOT / "settings.json"
    storage_redirect_uri: str = "http://localhost:8000/auth/storage/callback"
    directory_caches: DirectoryCacheSettings = Field(default_factory=DirectoryCacheSettings)

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
    return Settings(directory_caches=load_directory_cache_settings(_BACKEND_ROOT / "cache.toml"))
