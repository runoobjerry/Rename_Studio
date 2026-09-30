import pytest
from pydantic import ValidationError

from app.rules.base import RuleContext
from app.rules.padding import PaddingConfig, PaddingMode, PaddingRule, PaddingSide


CONTEXT = RuleContext(file_id="test", index=0, total=1)


@pytest.mark.parametrize(
    ("filename", "length", "expected"),
    [
        ("episode1-part12.mp4", 3, "episode001-part012.mp4"),
        ("123.txt", 2, "123.txt"),
        ("文件7.txt", 3, "文件007.txt"),
        (".env", 3, ".env"),
        ("archive2.tar.gz", 3, "archive002.tar.gz"),
        ("", 3, ""),
    ],
)
def test_number_padding_preserves_extension(
    filename: str, length: int, expected: str
) -> None:
    rule = PaddingRule()
    config = PaddingConfig(mode=PaddingMode.NUMBER, length=length)

    assert rule.apply(filename, CONTEXT, config) == expected


@pytest.mark.parametrize(
    ("side", "expected"),
    [
        (PaddingSide.LEFT, "___猫.txt"),
        (PaddingSide.RIGHT, "猫___.txt"),
    ],
)
def test_text_padding_supports_custom_character_and_side(
    side: PaddingSide, expected: str
) -> None:
    rule = PaddingRule()
    config = PaddingConfig(
        mode=PaddingMode.TEXT, length=4, fill_character="_", side=side
    )

    assert rule.apply("猫.txt", CONTEXT, config) == expected


def test_text_longer_than_target_is_unchanged() -> None:
    rule = PaddingRule()
    config = PaddingConfig(
        mode=PaddingMode.TEXT,
        length=3,
        fill_character="-",
        side=PaddingSide.RIGHT,
    )

    assert rule.apply("already-long.txt", CONTEXT, config) == "already-long.txt"


@pytest.mark.parametrize(
    "config",
    [
        {"mode": "number", "length": 0},
        {"mode": "text", "length": 3, "fill_character": "ab"},
        {"mode": "text", "length": 3, "side": "middle"},
    ],
)
def test_rejects_invalid_configuration(config: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        PaddingConfig.model_validate(config)


def test_empty_text_fill_preserves_filename() -> None:
    config = PaddingConfig(mode=PaddingMode.TEXT, length=10, fill_character="")
    assert PaddingRule().apply("猫.txt", CONTEXT, config) == "猫.txt"


def test_text_padding_treats_full_directory_name_as_stem() -> None:
    context = RuleContext(file_id="a.b", index=0, total=1, is_directory=True)
    config = PaddingConfig(
        mode=PaddingMode.TEXT,
        length=5,
        fill_character="_",
        side=PaddingSide.RIGHT,
    )

    assert PaddingRule().apply("a.b", context, config) == "a.b__"
