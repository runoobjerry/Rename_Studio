import json
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

    def load_or_initialize(
        self, local_root: Path,
        validate_config: Callable[[str, dict[str, object]], dict[str, object]],
    ) -> StorageState:
        if self.path.exists():
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
                # Older v3 documents may still contain the retired batch-hint preference.
                if isinstance(payload, dict) and isinstance(payload.get("preferences"), dict):
                    payload["preferences"].pop("hide_batch_limit_hint", None)
                state = StorageState.model_validate(payload)
                if any(key != record.storage_id for key, record in state.connections.items()):
                    raise ValueError("Connection key mismatch")
                if state.connections["default-local"].provider_type != "local":
                    raise ValueError("Default Local connection type mismatch")
                for record in state.connections.values():
                    record.config = validate_config(record.provider_type, record.config)
                return state
            except (OSError, ValueError, KeyError, TypeError, AttributeError, ModelValidationError) as exc:
                raise ProviderError("Storage state is invalid; restore its backup before starting") from exc
        try:
            local_root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise ProviderError("Could not initialize the local storage root") from exc
        state = StorageState(connections={
            "default-local": StorageRecord(
                storage_id="default-local", provider_type="local", name="Local Files",
                config=validate_config("local", {"root_path": str(local_root)}),
            ),
        })
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
