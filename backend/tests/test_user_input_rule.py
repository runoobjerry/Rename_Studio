import pytest

from app.rules.base import RuleContext
from app.rules.user_input import UserInputRule


@pytest.mark.parametrize(("filename", "is_directory", "options", "expected"), [
    ("raw.photo.jpg", False, {}, "新.jpg"),
    ("raw.photo.jpg", False, {"position": "prefix"}, "新raw.photo.jpg"),
    ("raw.photo.jpg", False, {"position": "suffix"}, "raw.photo新.jpg"),
    ("raw.photo.jpg", False, {"ignore_extension": False}, "新"),
    ("raw.photo.jpg", False, {"position": "suffix", "ignore_extension": False}, "raw.photo.jpg新"),
    ("folder.v1", True, {}, "新"),
    (".profile", False, {}, "新"),
])
def test_applies_the_line_to_the_selected_part_of_the_name(
    filename: str, is_directory: bool, options: dict[str, object], expected: str,
) -> None:
    rule = UserInputRule()
    config = rule.parse_config({"text": "新\nunused", **options})
    assert rule.apply(filename, RuleContext("id", 0, 1, is_directory), config) == expected


@pytest.mark.parametrize(("text", "expected"), [
    ("", ["old.txt"] * 4),
    ("A\r\n\r\n B\rC", ["A.txt", "old.txt", " B.txt", "C.txt"]),
    ("A\n\nB\n", ["A.txt", "old.txt", "B.txt", "old.txt"]),
    ("A\nB", ["A.txt", "B.txt", "old.txt", "old.txt"]),
])
def test_preserves_positions_and_skips_empty_or_missing_lines(text: str, expected: list[str]) -> None:
    rule = UserInputRule()
    config = rule.parse_config({"text": text})
    assert [
        rule.apply("old.txt", RuleContext(str(index), index, len(expected)), config)
        for index in range(len(expected))
    ] == expected
