from enum import StrEnum
from typing import Self

from pydantic import BaseModel, Field, model_validator

from app.rules.base import RenameRule, RuleContext
from app.rules.filename import split_extension


class InsertPosition(StrEnum):
    PREFIX = "prefix"
    SUFFIX = "suffix"
    INDEX = "index"
    BEFORE_TEXT = "before_text"
    AFTER_TEXT = "after_text"


class InsertConfig(BaseModel):
    text: str = Field(min_length=1, max_length=255)
    position: InsertPosition = InsertPosition.PREFIX
    index: int = Field(default=1, ge=1, le=255)
    from_right: bool = False
    anchor: str = Field(default="", max_length=255)

    @model_validator(mode="after")
    def validate_anchor(self) -> Self:
        if self.position in {
            InsertPosition.BEFORE_TEXT,
            InsertPosition.AFTER_TEXT,
        } and not self.anchor:
            raise ValueError("anchor cannot be empty for text-relative insertion")
        return self


class InsertRule(RenameRule[InsertConfig]):
    type = "insert"
    display_name = "插入"
    description = "在前缀、后缀、字符位置或指定文本旁插入内容"
    config_model = InsertConfig

    def apply(
        self, filename: str, context: RuleContext, config: InsertConfig
    ) -> str:
        stem, extension = split_extension(filename)
        insert_at = self._resolve_position(stem, config)
        if insert_at is None:
            return filename
        return stem[:insert_at] + config.text + stem[insert_at:] + extension

    @staticmethod
    def _resolve_position(stem: str, config: InsertConfig) -> int | None:
        if config.position == InsertPosition.PREFIX:
            return 0
        if config.position == InsertPosition.SUFFIX:
            return len(stem)
        if config.position == InsertPosition.INDEX:
            # 位置按字符间隙计算；越界时安全收敛到主文件名两端。
            if config.from_right:
                return max(len(stem) - config.index, 0)
            return min(config.index, len(stem))

        # 文本相对插入只采用首个字面量匹配，避免一次规则产生多次插入。
        anchor_at = stem.find(config.anchor)
        if anchor_at < 0:
            return None
        if config.position == InsertPosition.BEFORE_TEXT:
            return anchor_at
        return anchor_at + len(config.anchor)
