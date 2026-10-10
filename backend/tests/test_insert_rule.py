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


@pytest.mark.parametrize(
    ("filename", "text", "index", "from_right", "expected"),
    [
        ("猫咪合集.mp4", "-", 2, False, "猫咪-合集.mp4"),
        ("abcde.txt", "-", 1, True, "abcd-e.txt"),
        ("abc.txt", "X", 20, False, "abcX.txt"),
        ("abc.txt", "X", 20, True, "Xabc.txt"),
    ],
    ids=["from-left", "from-right", "clamp-left", "clamp-right"],
)
def test_inserts_at_character_index_and_clamps_to_edge(
    filename: str, text: str, index: int, from_right: bool, expected: str,
) -> None:
    config = InsertConfig(
        text=text,
        position=InsertPosition.INDEX,
        index=index,
        from_right=from_right,
    )

    assert InsertRule().apply(filename, CONTEXT, config) == expected


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


@pytest.mark.parametrize(
    "values",
    [
        {"text": "X", "position": "index", "index": 0},
        {"text": "X", "position": "unknown"},
    ],
)
def test_rejects_invalid_configuration(values: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        InsertConfig.model_validate(values)


@pytest.mark.parametrize(
    "values",
    [
        {"text": ""},
        {"text": "X", "position": "before_text", "anchor": ""},
        {"text": "X", "position": "after_text", "anchor": ""},
    ],
)
def test_empty_required_text_preserves_filename(values: dict[str, object]) -> None:
    config = InsertConfig.model_validate(values)
    assert InsertRule().apply("猫-file.txt", CONTEXT, config) == "猫-file.txt"


def test_directory_name_does_not_have_extension_semantics() -> None:
    context = RuleContext(file_id="folder.v1", index=0, total=1, is_directory=True)
    config = InsertConfig(text="-new", position=InsertPosition.SUFFIX)

    assert InsertRule().apply("folder.v1", context, config) == "folder.v1-new"
