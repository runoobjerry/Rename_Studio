from typing import Any

from pydantic import BaseModel, Field


class RuleSpec(BaseModel):
    type: str = Field(min_length=1)
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)


class RuleDefinition(BaseModel):
    type: str
    name: str
    description: str
    config_schema: dict[str, Any]
