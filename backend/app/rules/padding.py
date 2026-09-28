import re
from enum import StrEnum

from pydantic import BaseModel, Field

from app.rules.base import RenameRule, RuleContext


class PaddingMode(StrEnum):
    NUMBER = "number"
    TEXT = "text"


class PaddingSide(StrEnum):
    LEFT = "left"
    RIGHT = "right"


class PaddingConfig(BaseModel):
    mode: PaddingMode
    length: int = Field(ge=1, le=255)
    fill_character: str = Field(default="_", min_length=1, max_length=1)
    side: PaddingSide = PaddingSide.LEFT


class PaddingRule(RenameRule[PaddingConfig]):
    type = "padding"
    display_name = "填充"
    description = "为数字序列补零，或从左侧、右侧填充文本"
    config_model = PaddingConfig

    def apply(
        self, filename: str, context: RuleContext, config: PaddingConfig
    ) -> str:
        stem, extension = self._split_extension(filename)

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

    @staticmethod
    def _split_extension(filename: str) -> tuple[str, str]:
        # 仅把最后一个非首位句点视为扩展名，隐藏文件名按无扩展名处理。
        dot_index = filename.rfind(".")
        if dot_index <= 0:
            return filename, ""
        return filename[:dot_index], filename[dot_index:]
