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
    items: list[PreviewItem]
    valid: bool
