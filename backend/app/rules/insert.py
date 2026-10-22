from enum import StrEnum
from pydantic import BaseModel, Field

from app.rules.base import RenameRule, RuleContext
from app.rules.filename import split_extension


class InsertPosition(StrEnum):
    PREFIX = "prefix"
    SUFFIX = "suffix"
    INDEX = "index"
    BEFORE_TEXT = "before_text"
    AFTER_TEXT = "after_text"


class InsertConfig(BaseModel):
    text: str = Field(max_length=255)
    position: InsertPosition = InsertPosition.PREFIX
    index: int = Field(default=1, ge=1, le=255)
    from_right: bool = False
    anchor: str = Field(default="", max_length=255)

class InsertRule(RenameRule[InsertConfig]):
    type = "insert"
    config_model = InsertConfig

    def apply(
        self, filename: str, context: RuleContext, config: InsertConfig
    ) -> str:
        # 必要文本为空时跳过；纯空格仍是用户可指定的有效插入内容。
        if config.text == "" or (
            config.position in {InsertPosition.BEFORE_TEXT, InsertPosition.AFTER_TEXT}
            and config.anchor == ""
        ):
            return filename
        stem, extension = (
            (filename, "") if context.is_directory else split_extension(filename)
        )
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
