from abc import ABC, abstractmethod
from dataclasses import dataclass

from pydantic import BaseModel


@dataclass(frozen=True, slots=True)
class RuleContext:
    file_id: str
    index: int
    total: int
    is_directory: bool = False


class EmptyRuleConfig(BaseModel):
    pass


class RenameRule[ConfigT: BaseModel](ABC):
    type: str
    display_name: str
    description: str
    config_model: type[ConfigT]

    def parse_config(self, value: dict[str, object]) -> ConfigT:
        return self.config_model.model_validate(value)

    @abstractmethod
    def apply(self, filename: str, context: RuleContext, config: ConfigT) -> str:
        raise NotImplementedError
