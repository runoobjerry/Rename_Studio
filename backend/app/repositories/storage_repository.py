import json
import logging
from pathlib import Path
from uuid import uuid4

from app.core.errors import ProviderError
from app.schemas.storage import StorageState


class JsonStorageRepository:
    """One atomic document commits configuration, credentials and revision together."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> StorageState | None:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            state = StorageState.model_validate(payload)
            if any(key != record.storage_id for key, record in state.connections.items()):
                raise ValueError("Connection key mismatch")
            return state
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as exc:
            raise ProviderError("Storage state is invalid; restore its backup before starting") from exc

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
                logging.getLogger("rename_studio.storage").warning("Could not remove temporary storage state file")
            raise ProviderError("Could not save storage state") from exc
