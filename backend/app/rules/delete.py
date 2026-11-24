from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.rules.base import RenameRule, RuleContext
from app.rules.filename import split_extension


CharacterCount = Annotated[int, Field(strict=True, ge=1, le=255)]
Delimiter = Annotated[str, Field(max_length=255)]


class DeleteConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_mode: Literal["position", "delimiter"] = "position"
    from_position: CharacterCount = 1
    from_delimiter: Delimiter = ""
    until_mode: Literal["count", "delimiter", "end"] = "count"
    until_count: CharacterCount = 1
    until_delimiter: Delimiter = ""
    delete_current_name: bool = False
    ignore_extension: bool = True
    from_right: bool = False
    keep_delimiters: bool = False


class DeleteRule(RenameRule[DeleteConfig]):
    type = "delete"
    config_model = DeleteConfig

    def apply(self, filename: str, context: RuleContext, config: DeleteConfig) -> str:
        name, extension = (
            split_extension(filename) if config.ignore_extension and not context.is_directory
            else (filename, "")
        )
        if config.delete_current_name:
            return extension

        # 在选定的方向上计算同一个切片。反向时分隔符仍按用户输入的原文匹配。
        direction = -1 if config.from_right else 1
        name = name[::direction]
        if config.from_mode == "delimiter":
            delimiter = config.from_delimiter
            match = name.find(delimiter[::direction])
            if not delimiter or match == -1:
                return filename
            search_from = match + len(delimiter)
            start = search_from if config.keep_delimiters else match
        else:
            start = search_from = config.from_position - 1

        if config.until_mode == "delimiter":
            delimiter = config.until_delimiter
            match = name.find(delimiter[::direction], search_from)
            if not delimiter or match == -1:
                return filename
            end = match if config.keep_delimiters else match + len(delimiter)
        elif config.until_mode == "count":
            end = start + config.until_count
        else:
            end = len(name)

        return (name[:start] + name[end:])[::direction] + extension
