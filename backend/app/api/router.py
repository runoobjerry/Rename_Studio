import json
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import HTMLResponse

from app.api.dependencies import (
    get_execute_service,
    get_file_service,
    get_onedrive_auth_service,
    get_preview_service,
    get_rule_registry,
)
from app.core.config import get_settings
from app.core.errors import AppError, AuthenticationError
from app.rules.registry import RuleRegistry
from app.schemas.common import HealthResponse
from app.schemas.files import DirectoryListing, ProviderInfo
from app.schemas.rename import (
    RenameExecuteRequest,
    RenameExecuteResponse,
    RenamePreviewRequest,
    RenamePreviewResponse,
)
from app.schemas.onedrive import (
    OneDriveAuthStartResponse,
    OneDriveAuthStatus,
    OneDriveSettingsResponse,
    OneDriveSettingsUpdate,
)
from app.schemas.rules import RuleDefinition
from app.services.execute_service import ExecuteService
from app.services.file_service import FileService
from app.services.onedrive_auth import OneDriveAuthService
from app.services.preview_service import PreviewService


router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/providers", response_model=list[ProviderInfo], tags=["providers"])
async def list_providers(
    service: Annotated[FileService, Depends(get_file_service)],
) -> list[ProviderInfo]:
    return service.list_providers()


@router.get("/files", response_model=DirectoryListing, tags=["files"])
async def list_files(
    service: Annotated[FileService, Depends(get_file_service)],
    provider: str = Query(default="local"),
    path: str = Query(default=""),
) -> DirectoryListing:
    return await service.list_files(provider, path)


@router.get(
    "/onedrive/settings",
    response_model=OneDriveSettingsResponse,
    tags=["onedrive"],
)
async def get_onedrive_settings(
    service: Annotated[OneDriveAuthService, Depends(get_onedrive_auth_service)],
) -> OneDriveSettingsResponse:
    return service.settings()


@router.put(
    "/onedrive/settings",
    response_model=OneDriveSettingsResponse,
    tags=["onedrive"],
)
async def update_onedrive_settings(
    request: OneDriveSettingsUpdate,
    service: Annotated[OneDriveAuthService, Depends(get_onedrive_auth_service)],
) -> OneDriveSettingsResponse:
    return service.configure(request.client_id, request.client_secret.get_secret_value())


@router.delete("/onedrive/settings", status_code=204, tags=["onedrive"])
async def clear_onedrive_settings(
    service: Annotated[OneDriveAuthService, Depends(get_onedrive_auth_service)],
) -> Response:
    service.clear()
    return Response(status_code=204)


@router.get(
    "/onedrive/auth/status",
    response_model=OneDriveAuthStatus,
    tags=["onedrive"],
)
async def get_onedrive_auth_status(
    service: Annotated[OneDriveAuthService, Depends(get_onedrive_auth_service)],
) -> OneDriveAuthStatus:
    return service.status()


@router.post(
    "/onedrive/auth/start",
    response_model=OneDriveAuthStartResponse,
    tags=["onedrive"],
)
async def start_onedrive_auth(
    service: Annotated[OneDriveAuthService, Depends(get_onedrive_auth_service)],
) -> OneDriveAuthStartResponse:
    return service.start_authorization()


@router.get("/auth/onedrive/callback", response_class=HTMLResponse, tags=["onedrive"])
async def finish_onedrive_auth(
    service: Annotated[OneDriveAuthService, Depends(get_onedrive_auth_service)],
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
) -> HTMLResponse:
    success = False
    message = "OneDrive authorization failed. You can close this window."
    try:
        if error or not code or not state:
            raise AuthenticationError("OneDrive authorization was cancelled or rejected")
        await service.finish_authorization(code, state)
        success = True
        message = "OneDrive connected. You can close this window."
    except AppError:
        pass

    # 只向已配置的前端源通知结果，不把授权码或错误详情写入页面。
    target_origin = json.dumps(get_settings().frontend_origin)
    status = json.dumps("connected" if success else "failed")
    html = f"""<!doctype html>
<html lang=\"en\"><head><meta charset=\"utf-8\"><title>OneDrive authorization</title></head>
<body><p>{message}</p><script>
if (window.opener) window.opener.postMessage({{type: "onedrive-auth", status: {status}}}, {target_origin});
setTimeout(() => window.close(), 500);
</script></body></html>"""
    return HTMLResponse(content=html, status_code=200 if success else 400)


@router.get("/rules", response_model=list[RuleDefinition], tags=["rules"])
async def list_rules(
    registry: Annotated[RuleRegistry, Depends(get_rule_registry)],
) -> list[RuleDefinition]:
    return registry.definitions()


@router.post(
    "/rename/preview",
    response_model=RenamePreviewResponse,
    tags=["rename"],
)
async def preview_rename(
    request: RenamePreviewRequest,
    service: Annotated[PreviewService, Depends(get_preview_service)],
) -> RenamePreviewResponse:
    return await service.preview(request)


@router.post(
    "/rename/execute",
    response_model=RenameExecuteResponse,
    tags=["rename"],
)
async def execute_rename(
    request: RenameExecuteRequest,
    service: Annotated[ExecuteService, Depends(get_execute_service)],
) -> RenameExecuteResponse:
    return await service.execute(request.preview_id)
