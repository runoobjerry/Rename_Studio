from collections import Counter
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.schemas.files import FileItem, RenameFile
from app.schemas.rename_input import RenamePreviewInput
from app.schemas.storage import RootLocation, StorageLocation


RenameItemStatus = Literal["renamed", "skipped", "failed", "unknown", "not_attempted"]
RenameExecutionStatus = Literal["completed", "incomplete"]


class RenamePreviewRequest(RenamePreviewInput):
    storage_id: str
    location: StorageLocation | None = None


class PreviewItem(BaseModel):
    file_id: str
    original_name: str
    new_name: str
    changed: bool
    valid: bool
    conflict: bool
    error: str | None = None
    details: dict[str, Any] | None = None


class RenamePreviewResponse(BaseModel):
    preview_id: str
    expires_at: datetime
    items: list[PreviewItem]
    valid: bool


class RenameExecuteRequest(BaseModel):
    preview_id: str = Field(min_length=1)


class RenameItemResult(BaseModel):
    file_id: str
    original_name: str
    new_name: str
    status: RenameItemStatus
    error: str | None = None
    error_code: str | None = None
    details: dict[str, Any] | None = None
    actual_name: str | None = None


class ExecuteItem(RenameItemResult):
    current_file: FileItem | None = None


class SingleExecuteItem(RenameItemResult):
    current_file: RenameFile | None = None


class RenameResultCounts(BaseModel):
    renamed: int
    skipped: int
    failed: int
    unknown: int
    not_attempted: int

    @classmethod
    def from_items(cls, items: Sequence[RenameItemResult]) -> "RenameResultCounts":
        counts = Counter(item.status for item in items)
        return cls(
            renamed=counts["renamed"], skipped=counts["skipped"], failed=counts["failed"],
            unknown=counts["unknown"], not_attempted=counts["not_attempted"],
        )


class RenameExecuteResponse(BaseModel):
    preview_id: str
    status: RenameExecutionStatus
    items: list[ExecuteItem]

    @computed_field
    @property
    def counts(self) -> RenameResultCounts:
        return RenameResultCounts.from_items(self.items)


class SingleRenameExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: UUID
    file_id: str = Field(min_length=1)
    original_name: str  # Display/history context; direct rename does not compare the current name.
    target_name: str
    revision: int = Field(ge=1)
    location: StorageLocation = Field(default_factory=RootLocation)


class SingleRenameExecuteResponse(BaseModel):
    operation_id: str
    status: RenameExecutionStatus
    items: list[SingleExecuteItem]

    @computed_field
    @property
    def counts(self) -> RenameResultCounts:
        return RenameResultCounts.from_items(self.items)


class RenameProgress(BaseModel):
    preview_id: str
    total: int = Field(ge=0)
    processed: int = Field(default=0, ge=0)
    phase: Literal["waiting", "validating", "renaming", "finished", "failed"] = "waiting"
    error: str | None = None
