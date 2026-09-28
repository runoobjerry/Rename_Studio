from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import (
    get_execute_service,
    get_file_service,
    get_preview_service,
    get_rule_registry,
)
from app.rules.registry import RuleRegistry
from app.schemas.common import HealthResponse
from app.schemas.files import DirectoryListing, ProviderInfo
from app.schemas.rename import (
    RenameExecuteRequest,
    RenameExecuteResponse,
    RenamePreviewRequest,
    RenamePreviewResponse,
)
from app.schemas.rules import RuleDefinition
from app.services.execute_service import ExecuteService
from app.services.file_service import FileService
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
