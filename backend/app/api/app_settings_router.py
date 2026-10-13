from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_preview_store, get_storage_manager
from app.core.config import get_settings
from app.schemas.storage import AppSettingsPatch, AppSettingsResponse
from app.services.preview_store import PreviewStore
from app.services.storage_manager import StorageManager


router = APIRouter(tags=["app-settings"])
Manager = Annotated[StorageManager, Depends(get_storage_manager)]


@router.get("/app-settings", response_model=AppSettingsResponse)
async def get_app_settings(manager: Manager) -> AppSettingsResponse:
    return manager.app_settings()


@router.patch("/app-settings", response_model=AppSettingsResponse)
async def patch_app_settings(request: AppSettingsPatch, manager: Manager) -> AppSettingsResponse:
    return manager.update_app_settings(request)


@router.post("/app-settings/factory-reset", response_model=AppSettingsResponse)
async def factory_reset(
    manager: Manager, previews: Annotated[PreviewStore, Depends(get_preview_store)],
) -> AppSettingsResponse:
    return await manager.factory_reset(get_settings().local_storage_root, previews)
