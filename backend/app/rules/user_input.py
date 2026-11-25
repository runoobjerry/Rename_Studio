from functools import cached_property
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.rules.base import RenameRule, RuleContext
from app.rules.filename import split_extension


class UserInputConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = ""
    position: Literal["prefix", "suffix", "replace"] = "replace"
    ignore_extension: bool = True

    @cached_property
    def lines(self) -> list[str]:
        return self.text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


class UserInputRule(RenameRule[UserInputConfig]):
    type = "user_input"
    config_model = UserInputConfig

    def apply(self, filename: str, context: RuleContext, config: UserInputConfig) -> str:
        if context.index >= len(config.lines):
            return filename
        text = config.lines[context.index]
        if not text:
            return filename

        stem, extension = (
            split_extension(filename) if config.ignore_extension and not context.is_directory
            else (filename, "")
        )
        if config.position == "prefix":
            return text + stem + extension
        if config.position == "suffix":
            return stem + text + extension
        return text + extension
