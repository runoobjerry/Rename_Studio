from typing import Self

from pydantic import BaseModel, Field, model_validator

from app.schemas.rules import RuleSpec


class RenamePreviewInput(BaseModel):
    file_ids: list[str] = Field(min_length=1)
    rules: list[RuleSpec] = Field(default_factory=list, max_length=20)
    target_name: str | None = None

    @model_validator(mode="after")
    def check_single_target(self) -> Self:
        if self.target_name is not None:
            if len(self.file_ids) != 1:
                raise ValueError("A target name requires exactly one selected item")
            if self.rules:
                raise ValueError("A target name cannot be combined with rename rules")
        return self
