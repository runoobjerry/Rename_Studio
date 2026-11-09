from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from app.core.errors import RuleConfigurationError
from app.rules.base import RenameRule, RuleContext
from app.rules.filename import character_gap, split_extension


MAX_SAFE_INTEGER = 2**53 - 1
MAX_CONFIG_INTEGER = 99_999_999
NumberingSystem = Literal["decimal", "alphabetic", "roman", "music", "chinese"]
ConfigInteger = Annotated[int, Field(strict=True, ge=-MAX_CONFIG_INTEGER, le=MAX_CONFIG_INTEGER)]
PositiveCount = Annotated[int, Field(strict=True, ge=1, le=MAX_CONFIG_INTEGER)]
NameLength = Annotated[int, Field(strict=True, ge=1, le=255)]

NOTES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
NUMBER_RANGES: dict[NumberingSystem, tuple[int, int]] = {
    "decimal": (-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER),
    "alphabetic": (1, MAX_SAFE_INTEGER),
    "roman": (1, 3999),
    "music": (1, 120),
    "chinese": (1, 9999),
}

ROMAN_SYMBOLS = (
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"),
    (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"),
    (5, "V"), (4, "IV"), (1, "I"),
)
CHINESE_DIGITS = "零一二三四五六七八九"
CHINESE_UNITS = ("千", "百", "十", "")


class SerializeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    numbering_system: NumberingSystem = "decimal"
    start: ConfigInteger = 1
    repeat: PositiveCount = 1
    step: ConfigInteger = 1
    reset_every: PositiveCount | None = None
    pad_length: NameLength | None = None
    position: Literal["prefix", "suffix", "index", "replace"] = "prefix"
    index: NameLength = 1
    from_right: bool = False
    ignore_extension: bool = True

    @model_validator(mode="after")
    def validate_numbering_system(self) -> Self:
        minimum, maximum = NUMBER_RANGES[self.numbering_system]
        if not minimum <= self.start <= maximum:
            raise PydanticCustomError(
                "serialize_start_out_of_range", "Start must be between {min} and {max}",
                {"min": minimum, "max": maximum},
            )
        if self.pad_length is not None and self.numbering_system != "decimal":
            raise PydanticCustomError(
                "serialize_padding_unsupported", "Padding requires decimal digits"
            )
        return self


def _alphabetic(number: int) -> str:
    # a is the zero digit. Subtract one only once to map sequence 1 to a.
    value = number - 1
    digits = [chr(ord("a") + value % 26)]
    value //= 26
    while value:
        value, digit = divmod(value, 26)
        digits.append(chr(ord("a") + digit))
    return "".join(reversed(digits))


def _roman(number: int) -> str:
    parts = []
    for value, symbol in ROMAN_SYMBOLS:
        count, number = divmod(number, value)
        parts.append(symbol * count)
    return "".join(parts)


def _chinese(number: int) -> str:
    parts = []
    pending_zero = False
    for digit, unit in zip(f"{number:04d}", CHINESE_UNITS, strict=True):
        if digit == "0":
            pending_zero = bool(parts)
            continue
        if pending_zero:
            parts.append("零")
            pending_zero = False
        parts.append(CHINESE_DIGITS[int(digit)] + unit)
    return "".join(parts)


def _format_number(number: int, config: SerializeConfig) -> str:
    system = config.numbering_system
    if system == "decimal":
        return str(number).zfill(config.pad_length or 0)
    if system == "alphabetic":
        return _alphabetic(number)
    if system == "roman":
        return _roman(number)
    if system == "music":
        octave, note = divmod(number - 1, len(NOTES))
        return f"{NOTES[note]}{octave}"
    return _chinese(number)


class SerializeRule(RenameRule[SerializeConfig]):
    type = "serialize"
    config_model = SerializeConfig

    def apply(self, filename: str, context: RuleContext, config: SerializeConfig) -> str:
        offset = context.index
        if config.reset_every is not None:
            offset %= config.reset_every
        number = config.start + (offset // config.repeat) * config.step
        minimum, maximum = NUMBER_RANGES[config.numbering_system]
        if not minimum <= number <= maximum:
            raise RuleConfigurationError(
                "Generated sequence number is outside the supported range",
                details={
                    "rule_type": self.type,
                    "reason": "SERIALIZE_NUMBER_OUT_OF_RANGE",
                    "params": {"item": context.index + 1, "min": minimum, "max": maximum},
                },
            )

        serial = _format_number(number, config)
        stem, extension = (
            split_extension(filename) if config.ignore_extension and not context.is_directory
            else (filename, "")
        )
        if config.position == "replace":
            return serial + extension
        if config.position == "prefix":
            return serial + stem + extension
        if config.position == "suffix":
            return stem + serial + extension
        gap = character_gap(stem, config.index, config.from_right)
        return stem[:gap] + serial + stem[gap:] + extension
