import re
from enum import StrEnum

from pydantic import BaseModel, Field

from app.rules.base import RenameRule, RuleContext
from app.rules.filename import split_extension


class MatchOccurrence(StrEnum):
    ALL = "all"
    FIRST = "first"
    LAST = "last"


class TextMatchConfig(BaseModel):
    search: str = Field(min_length=1, max_length=255)
    occurrence: MatchOccurrence = MatchOccurrence.ALL
    case_sensitive: bool = True
    whole_word: bool = False
    ignore_extension: bool = True


class ReplaceConfig(TextMatchConfig):
    replacement: str = Field(default="", max_length=255)


class RemoveConfig(TextMatchConfig):
    pass


def _replace_matches(
    text: str,
    *,
    search: str,
    replacement: str,
    occurrence: MatchOccurrence,
    case_sensitive: bool,
    whole_word: bool,
) -> str:
    expression = re.escape(search)
    if whole_word:
        # Unicode 字母、数字或下划线相邻时，不视为完整单词。
        expression = rf"(?<!\w){expression}(?!\w)"
    flags = 0 if case_sensitive else re.IGNORECASE
    pattern = re.compile(expression, flags)

    if occurrence == MatchOccurrence.ALL:
        # 使用回调可确保替换文本中的反斜杠不会被正则引擎解释。
        return pattern.sub(lambda _match: replacement, text)
    if occurrence == MatchOccurrence.FIRST:
        return pattern.sub(lambda _match: replacement, text, count=1)

    matches = list(pattern.finditer(text))
    if not matches:
        return text
    last = matches[-1]
    return text[: last.start()] + replacement + text[last.end() :]


def _apply_to_filename(
    filename: str,
    config: TextMatchConfig,
    replacement: str,
) -> str:
    if config.ignore_extension:
        target, extension = split_extension(filename)
    else:
        target, extension = filename, ""

    result = _replace_matches(
        target,
        search=config.search,
        replacement=replacement,
        occurrence=config.occurrence,
        case_sensitive=config.case_sensitive,
        whole_word=config.whole_word,
    )
    return result + extension


class ReplaceRule(RenameRule[ReplaceConfig]):
    type = "replace"
    display_name = "替换"
    description = "查找文本并替换为新文本"
    config_model = ReplaceConfig

    def apply(
        self, filename: str, context: RuleContext, config: ReplaceConfig
    ) -> str:
        return _apply_to_filename(filename, config, config.replacement)


class RemoveRule(RenameRule[RemoveConfig]):
    type = "remove"
    display_name = "移除"
    description = "删除匹配的文本"
    config_model = RemoveConfig

    def apply(
        self, filename: str, context: RuleContext, config: RemoveConfig
    ) -> str:
        return _apply_to_filename(filename, config, "")
