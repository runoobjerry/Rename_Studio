import pytest
from pydantic import ValidationError

from app.rules.base import RuleContext
from app.rules.insert import InsertConfig, InsertPosition, InsertRule


CONTEXT = RuleContext(file_id="test", index=0, total=1)


@pytest.mark.parametrize(
    ("position", "text", "expected"),
    [
        (InsertPosition.PREFIX, "PRE_", "PRE_episode.txt"),
        (InsertPosition.SUFFIX, "_PRE", "episode_PRE.txt"),
    ],
)
def test_inserts_prefix_or_suffix_before_extension(
    position: InsertPosition, text: str, expected: str
) -> None:
    config = InsertConfig(text=text, position=position)

    assert InsertRule().apply("episode.txt", CONTEXT, config) == expected


def test_inserts_after_nth_character_from_left() -> None:
    config = InsertConfig(
        text="-",
        position=InsertPosition.INDEX,
        index=2,
    )

    assert InsertRule().apply("猫咪合集.mp4", CONTEXT, config) == "猫咪-合集.mp4"


def test_inserts_before_nth_character_from_right() -> None:
    config = InsertConfig(
        text="-",
        position=InsertPosition.INDEX,
        index=1,
        from_right=True,
    )

    assert InsertRule().apply("abcde.txt", CONTEXT, config) == "abcd-e.txt"


@pytest.mark.parametrize(
    ("position", "expected"),
    [
        (InsertPosition.BEFORE_TEXT, "season-S01episode.txt"),
        (InsertPosition.AFTER_TEXT, "seasonS01-episode.txt"),
    ],
)
def test_inserts_around_first_anchor(
    position: InsertPosition, expected: str
) -> None:
    config = InsertConfig(text="-", position=position, anchor="S01")

    assert InsertRule().apply("seasonS01episode.txt", CONTEXT, config) == expected


def test_missing_anchor_leaves_filename_unchanged() -> None:
    config = InsertConfig(
        text="-",
        position=InsertPosition.BEFORE_TEXT,
        anchor="missing",
    )

    assert InsertRule().apply("episode.txt", CONTEXT, config) == "episode.txt"


def test_out_of_range_index_clamps_to_filename_edge() -> None:
    from_left = InsertConfig(
        text="X",
        position=InsertPosition.INDEX,
        index=20,
    )
    from_right = InsertConfig(
        text="X",
        position=InsertPosition.INDEX,
        index=20,
        from_right=True,
    )
    rule = InsertRule()

    assert rule.apply("abc.txt", CONTEXT, from_left) == "abcX.txt"
    assert rule.apply("abc.txt", CONTEXT, from_right) == "Xabc.txt"


@pytest.mark.parametrize(
    "values",
    [
        {"text": ""},
        {"text": "X", "position": "index", "index": 0},
        {"text": "X", "position": "before_text", "anchor": ""},
        {"text": "X", "position": "after_text", "anchor": ""},
    ],
)
def test_rejects_invalid_configuration(values: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        InsertConfig.model_validate(values)


def test_directory_name_does_not_have_extension_semantics() -> None:
    context = RuleContext(file_id="folder.v1", index=0, total=1, is_directory=True)
    config = InsertConfig(text="-new", position=InsertPosition.SUFFIX)

    assert InsertRule().apply("folder.v1", context, config) == "folder.v1-new"
