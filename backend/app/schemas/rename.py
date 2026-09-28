from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.rules import RuleSpec


class RenamePreviewRequest(BaseModel):
    provider: str = "local"
    file_ids: list[str] = Field(min_length=1)
    rules: list[RuleSpec] = Field(default_factory=list)


class PreviewItem(BaseModel):
    file_id: str
    original_name: str
    new_name: str
    changed: bool
    valid: bool
    conflict: bool
    error: str | None = None


class RenamePreviewResponse(BaseModel):
    preview_id: str
    expires_at: datetime
    items: list[PreviewItem]
    valid: bool


class RenameExecuteRequest(BaseModel):
    preview_id: str = Field(min_length=1)


class ExecuteItem(BaseModel):
    file_id: str
    original_name: str
    new_name: str
    status: Literal["renamed", "skipped", "failed"]
    error: str | None = None


class RenameExecuteResponse(BaseModel):
    preview_id: str
    status: Literal["completed", "partial", "failed"]
    items: list[ExecuteItem]
