import re
from functools import cached_property
from typing import Literal
from unicodedata import category

from pydantic import BaseModel, ConfigDict

from app.rules.base import RenameRule, RuleContext
from app.rules.filename import split_extension


CaseMode = Literal[
    "capitalize_words", "lower", "upper", "invert", "capitalize_first", "sentence", "none",
]
_SENTENCE_BOUNDARY = re.compile(r"([.!?。！？]+)")


def _capitalize_first_letter(text: str) -> str:
    for index, character in enumerate(text):
        if character.isalpha():
            return text[:index] + character.upper() + text[index + 1 :]
    return text


def _capitalize_words(text: str) -> str:
    result: list[str] = []
    at_word_start = True
    for character in text:
        if character.isalpha():
            result.append(character.upper() if at_word_start else character)
            at_word_start = False
        else:
            result.append(character)
            # 数字、撇号和组合标记不把一个词拆成两段。
            if not (character.isnumeric() or character in "'’" or category(character).startswith("M")):
                at_word_start = True
    return "".join(result)


def _convert_case(text: str, mode: CaseMode, preserve_case: bool) -> str:
    if mode == "lower":
        return text.lower()
    if mode == "upper":
        return text.upper()
    if mode == "invert":
        return text.swapcase()
    if mode == "none":
        return text

    normalized = text if preserve_case else text.lower()
    if mode == "capitalize_words":
        return _capitalize_words(normalized)
    if mode == "capitalize_first":
        return _capitalize_first_letter(normalized)
    parts = _SENTENCE_BOUNDARY.split(normalized)
    parts[::2] = [_capitalize_first_letter(part) for part in parts[::2]]
    return "".join(parts)


class CaseConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: CaseMode = "capitalize_words"
    fragments: str = ""
    preserve_case: bool = False
    ignore_extension: bool = True
    extension_case: Literal["none", "upper", "lower"] = "none"

    @cached_property
    def fragment_replacements(self) -> list[tuple[re.Pattern[str], str]]:
        replacements: list[tuple[re.Pattern[str], str]] = []
        for part in self.fragments.split(","):
            fragment = part.strip()
            if not fragment:
                continue
            # 整体转换可能展开一个字符，例如 ß 转为 SS。
            variants = dict.fromkeys((fragment, _convert_case(fragment, self.mode, self.preserve_case)))
            expression = "|".join(re.escape(variant) for variant in variants)
            # 文件名中的下划线可以分隔片段。
            pattern = re.compile(rf"(?<![^\W_])(?:{expression})(?![^\W_])", re.IGNORECASE)
            replacements.append((pattern, fragment))
        return replacements


class CaseRule(RenameRule[CaseConfig]):
    type = "case"
    config_model = CaseConfig

    def apply(self, filename: str, context: RuleContext, config: CaseConfig) -> str:
        name, extension = (
            split_extension(filename) if config.ignore_extension and not context.is_directory
            else (filename, "")
        )
        name = _convert_case(name, config.mode, config.preserve_case)
        for pattern, fragment in config.fragment_replacements:
            name = pattern.sub(lambda _match: fragment, name)
        result = name + extension

        if context.is_directory or config.extension_case == "none":
            return result
        stem, extension = split_extension(result)
        return stem + (extension.upper() if config.extension_case == "upper" else extension.lower())
