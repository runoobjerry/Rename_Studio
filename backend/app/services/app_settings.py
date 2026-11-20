from app.schemas.storage import AppSettingsResponse
from app.services.preview_store import PreviewStore
from app.services.storage_manager import StorageManager


def factory_reset(manager: StorageManager, previews: PreviewStore) -> AppSettingsResponse:
    # Publish the reset and clear snapshots without yielding to another request.
    result = manager.reset()
    previews.clear()
    return result
