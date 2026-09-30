import re
from enum import StrEnum

from pydantic import BaseModel, Field

from app.rules.base import RenameRule, RuleContext
from app.rules.filename import split_extension


class PaddingMode(StrEnum):
    NUMBER = "number"
    TEXT = "text"


class PaddingSide(StrEnum):
    LEFT = "left"
    RIGHT = "right"


class PaddingConfig(BaseModel):
    mode: PaddingMode
    length: int = Field(ge=1, le=255)
    fill_character: str = Field(default="_", max_length=1)
    side: PaddingSide = PaddingSide.LEFT


class PaddingRule(RenameRule[PaddingConfig]):
    type = "padding"
    display_name = "填充"
    description = "为数字序列补零，或从左侧、右侧填充文本"
    config_model = PaddingConfig

    def apply(
        self, filename: str, context: RuleContext, config: PaddingConfig
    ) -> str:
        # 文本填充字符为空表示跳过，数字模式始终使用零填充。
        if config.mode == PaddingMode.TEXT and config.fill_character == "":
            return filename
        # 文件夹没有扩展名语义，即使名称中包含句点也处理完整名称。
        stem, extension = (
            (filename, "") if context.is_directory else split_extension(filename)
        )

        if config.mode == PaddingMode.NUMBER:
            # 每段连续数字独立补零，超过目标长度的数字保持不变。
            padded = re.sub(
                r"[0-9]+",
                lambda match: match.group(0).zfill(config.length),
                stem,
            )
        else:
            missing = max(config.length - len(stem), 0)
            fill = config.fill_character * missing
            padded = fill + stem if config.side == PaddingSide.LEFT else stem + fill

        return padded + extension
