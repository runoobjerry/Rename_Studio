import asyncio
import json
from datetime import UTC, datetime, timedelta
from html import escape
from pathlib import Path
from typing import Annotated, cast
from urllib.parse import parse_qs, urlsplit

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import HTMLResponse

from app.api.dependencies import get_preview_service, get_preview_store, get_storage_manager
from app.core.config import get_settings
from app.core.errors import AppError, AuthenticationError, StorageConnectionChangedError, ValidationError
from app.schemas.files import DirectoryListing
from app.schemas.storage import LocalFolderPickResponse
from app.schemas.rename import RenamePreviewRequest, RenamePreviewResponse
from app.schemas.storage import AuthorizationStatus, StorageAuthStartResponse, StorageCreate, StorageInfo, StorageListRequest, StoragePreviewRequest, StorageProviderInfo, StorageUpdate
from app.services.connection_auth import ConnectionAuth
from app.services.local_folder_picker import choose_local_directory
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.storage_manager import StorageManager


router = APIRouter(tags=["storages"])
Manager = Annotated[StorageManager, Depends(get_storage_manager)]


@router.get("/storage-providers", response_model=list[StorageProviderInfo])
async def storage_providers(manager: Manager) -> list[StorageProviderInfo]:
    return [StorageProviderInfo(provider_type=definition.provider_type, name=definition.name,
             config_schema=definition.config_model.model_json_schema(),
             config_fields=definition.config_fields, account_label=definition.account_label, icon=definition.icon,
             locations=definition.locations, can_rename=definition.can_rename,
             browser_auth=definition.auth_factory is not None, local_picker=definition.local_picker)
            for definition in manager.registry.definitions.values()]


@router.get("/storages", response_model=list[StorageInfo])
async def list_storages(manager: Manager) -> list[StorageInfo]:
    return [manager.info(key) for key in manager.state.connections]


@router.post("/storages", response_model=StorageInfo, status_code=201)
async def create_storage(request: StorageCreate, manager: Manager) -> StorageInfo:
    return manager.create(request)


@router.get("/storages/{storage_id}", response_model=StorageInfo)
async def get_storage(storage_id: str, manager: Manager) -> StorageInfo:
    return manager.info(storage_id)


@router.put("/storages/{storage_id}", response_model=StorageInfo)
async def update_storage(storage_id: str, request: StorageUpdate, manager: Manager) -> StorageInfo:
    return await manager.update(storage_id, request)


@router.delete("/storages/{storage_id}", status_code=204)
async def delete_storage(storage_id: str, manager: Manager) -> Response:
    await manager.delete(storage_id)
    return Response(status_code=204)


@router.post("/storages/{storage_id}/files/list", response_model=DirectoryListing)
async def list_files(storage_id: str, request: StorageListRequest, manager: Manager) -> DirectoryListing:
    before = manager.record(storage_id)
    revision = before.revision
    listing = await manager.provider(storage_id).list_directory(request.location)
    if manager.record(storage_id).revision != revision:
        raise StorageConnectionChangedError("Storage changed while reading the directory")
    listing.storage_id = before.storage_id
    listing.revision = revision
    return listing


@router.post("/storages/{storage_id}/local/pick", response_model=LocalFolderPickResponse)
async def pick_local(storage_id: str, manager: Manager) -> LocalFolderPickResponse:
    manager.ensure_mutable(storage_id)
    before = manager.record(storage_id)
    if not manager.registry.definition(before.provider_type).local_picker:
        raise ValidationError("This storage does not support a local folder picker")
    root = Path(str(before.config["root_path"]))
    selected = await asyncio.to_thread(choose_local_directory, root)
    if manager.record(storage_id).revision != before.revision:
        raise StorageConnectionChangedError("Storage changed while choosing a directory")
    if selected is not None:
        info = await manager.update(storage_id, StorageUpdate(config={"root_path": str(selected)}))
        root = Path(str(info.config["root_path"]))
    return LocalFolderPickResponse(root_path=str(root), selected=selected is not None)


@router.post("/local/folder-picker", response_model=LocalFolderPickResponse)
async def pick_local_draft() -> LocalFolderPickResponse:
    """Choose a directory for a new connection without writing connection state."""
    root = get_settings().local_storage_root
    selected = await asyncio.to_thread(choose_local_directory, root)
    return LocalFolderPickResponse(root_path=str(selected if selected is not None else root),
                                   selected=selected is not None)


@router.get("/storages/{storage_id}/auth/status", response_model=AuthorizationStatus)
async def auth_status(storage_id: str, manager: Manager) -> AuthorizationStatus:
    return cast(ConnectionAuth, manager.auth(storage_id)).status()


@router.post("/storages/{storage_id}/auth/start", response_model=StorageAuthStartResponse)
async def auth_start(storage_id: str, manager: Manager) -> StorageAuthStartResponse:
    manager.ensure_mutable(storage_id)
    record = manager.record(storage_id)
    auth = cast(ConnectionAuth, manager.auth(storage_id))
    result = auth.start_authorization(get_settings().storage_redirect_uri)
    provider_state = parse_qs(urlsplit(result.authorization_url).query)["state"][0]
    now = datetime.now(UTC)
    manager.authorization_sessions = {key: value for key, value in manager.authorization_sessions.items() if value[3] > now and value[0] != record.storage_id}
    manager.authorization_sessions[provider_state] = (record.storage_id, manager.record(storage_id).revision, provider_state, now + timedelta(minutes=10))
    return StorageAuthStartResponse(authorization_url=result.authorization_url, redirect_uri=get_settings().storage_redirect_uri)


@router.delete("/storages/{storage_id}/auth/session", status_code=204)
async def disconnect(storage_id: str, manager: Manager) -> Response:
    cast(ConnectionAuth, manager.auth(storage_id)).disconnect()
    return Response(status_code=204)


@router.get("/auth/storage/callback", response_class=HTMLResponse)
async def callback(manager: Manager, code: str | None = Query(default=None), state: str | None = Query(default=None),
                   error: str | None = Query(default=None)) -> HTMLResponse:
    success = False
    message = "Authorization failed. You can close this window."
    storage_id: str | None = None
    try:
        session = manager.authorization_sessions.pop(state or "", None)
        if session is None or session[3] <= datetime.now(UTC) or error or not code:
            raise AuthenticationError("Authorization is invalid, expired or cancelled")
        storage_id, revision, provider_state, _ = session
        if manager.record(storage_id).revision != revision:
            raise StorageConnectionChangedError("Storage changed during authorization")
        manager.ensure_mutable(storage_id)
        await cast(ConnectionAuth, manager.auth(storage_id)).finish_authorization(code, provider_state)
        success = True
        message = "Storage connected. You can close this window."
    except AppError as exc:
        message = exc.message
    payload = json.dumps({"type": "storage-auth", "storage_id": storage_id, "status": "connected" if success else "failed", "message": message}).replace("<", "\\u003c")
    origin = json.dumps(get_settings().frontend_origin)
    return HTMLResponse(f'<!doctype html><html><head><meta charset="utf-8"><title>Storage authorization</title></head><body><p>{escape(message)}</p><script>if(window.opener)window.opener.postMessage({payload},{origin});setTimeout(()=>window.close(),500);</script></body></html>', status_code=200 if success else 400)


@router.post("/storages/{storage_id}/rename/preview", response_model=RenamePreviewResponse)
async def preview(storage_id: str, request: StoragePreviewRequest, manager: Manager,
                  service: Annotated[PreviewService, Depends(get_preview_service)]) -> RenamePreviewResponse:
    record = manager.record(storage_id)
    if not manager.registry.definition(record.provider_type).can_rename:
        raise ValidationError("This storage does not support rename previews")
    return await service.preview(RenamePreviewRequest(storage_id=storage_id, location=request.location,
                                                      file_ids=request.file_ids, rules=request.rules),
                                 previous_preview_id=request.previous_preview_id)


@router.delete("/storages/{storage_id}/rename/previews/{preview_id}", status_code=204)
async def release_preview(
    storage_id: str, preview_id: str,
    store: Annotated[PreviewStore, Depends(get_preview_store)],
) -> Response:
    # 连接被删除后仍允许释放遗留快照，不读取 Provider，也不取消已经开始的执行。
    store.release(preview_id, storage_id)
    return Response(status_code=204)
