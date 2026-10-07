from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_execute_service, get_rule_registry
from app.rules.registry import RuleRegistry
from app.schemas.common import HealthResponse
from app.schemas.rename import RenameExecuteRequest, RenameExecuteResponse, RenameProgress
from app.schemas.rules import RuleDefinition
from app.services.execute_service import ExecuteService


router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/rules", response_model=list[RuleDefinition], tags=["rules"])
async def list_rules(
    registry: Annotated[RuleRegistry, Depends(get_rule_registry)],
) -> list[RuleDefinition]:
    return registry.definitions()


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


@router.get("/rename/progress/{preview_id}", response_model=RenameProgress, tags=["rename"])
async def get_rename_progress(
    preview_id: str,
    service: Annotated[ExecuteService, Depends(get_execute_service)],
) -> RenameProgress:
    return service.progress(preview_id)
