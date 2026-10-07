import json
import shutil
import logging
from pathlib import Path
from uuid import uuid4
from collections.abc import Callable

from pydantic import ValidationError as ModelValidationError

from app.core.errors import ProviderError
from app.schemas.storage import StorageRecord, StorageState


class JsonStorageRepository:
    """One atomic document commits configuration, credentials and revision together."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def load_or_migrate(self, local_root: Path, local_file: Path, auth_file: Path,
                        validate_config: Callable[[str, dict[str, object]], dict[str, object]]) -> StorageState:
        if self.path.exists():
            try:
                state = StorageState.model_validate_json(self.path.read_text(encoding="utf-8"))
                if any(key != record.storage_id for key, record in state.connections.items()):
                    raise ValueError("Connection key mismatch")
                for key, provider in (("default-local", "local"), ("default-onedrive", "onedrive")):
                    if state.connections[key].provider_type != provider:
                        raise ValueError("Default connection type mismatch")
                for record in state.connections.values():
                    record.config = validate_config(record.provider_type, record.config)
                return state
            except (OSError, ValueError, KeyError, ModelValidationError) as exc:
                raise ProviderError("Storage state is invalid; restore its backup before starting") from exc
        legacy: list[dict[str, object]] = []
        for source in (local_file, auth_file):
            if not source.exists():
                legacy.append({})
                continue
            try:
                payload = json.loads(source.read_text(encoding="utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("Expected settings object")
                backup = source.with_name(source.name + ".pre-storage-v1.bak")
                if not backup.exists():
                    shutil.copy2(source, backup)
                legacy.append(payload)
            except (OSError, ValueError) as exc:
                raise ProviderError("Could not migrate storage settings") from exc
        local, auth = legacy
        root = local.get("root_path", str(local_root))
        client_id = auth.get("client_id")
        if not isinstance(root, str) or not root or (client_id is not None and not isinstance(client_id, str)):
            raise ProviderError("Legacy storage settings are invalid")
        credentials = {
            key: value for key, value in auth.items()
            if key in {"refresh_token", "account_id", "account_display_name", "account_email"}
            and isinstance(value, str)
        }
        if "root_path" not in local:
            try:
                local_root.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                raise ProviderError("Could not initialize the local storage root") from exc
        state = StorageState(connections={
            "default-local": StorageRecord(storage_id="default-local", provider_type="local", name="Local Files", config={"root_path": root}),
            "default-onedrive": StorageRecord(storage_id="default-onedrive", provider_type="onedrive", name="OneDrive", config={"client_id": client_id}, credentials=credentials),
        })
        for record in state.connections.values():
            record.config = validate_config(record.provider_type, record.config)
        self.save(state)
        return state

    def save(self, state: StorageState) -> None:
        temporary = self.path.with_name(f"{self.path.name}.{uuid4().hex}.tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(state.model_dump_json(indent=2), encoding="utf-8")
            temporary.chmod(0o600)
            temporary.replace(self.path)
        except OSError as exc:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                logging.getLogger(__name__).warning("Could not remove temporary storage state file")
            raise ProviderError("Could not save storage state") from exc
