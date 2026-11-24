import pytest
from pydantic import ValidationError

from app.rules.base import RuleContext
from app.rules.delete import DeleteRule


@pytest.mark.parametrize(
    ("name", "config", "expected"),
    [
        ("照片.raw.jpg", {}, "片.raw.jpg"),
        ("abcde.txt", {"from_position": 2, "until_count": 2}, "ade.txt"),
        ("abc.txt", {"from_position": 4, "until_mode": "end"}, "abc.txt"),
        ("abc.txt", {"from_position": 2, "until_count": 255}, "a.txt"),
        ("aXX++b.txt", {"from_position": 2, "until_mode": "delimiter", "until_delimiter": "++"}, "ab.txt"),
        ("prefix2026.jpg", {"from_position": 5, "until_mode": "end", "from_right": True}, "2026.jpg"),
        (
            "a[[x]]b[[y]]c.txt",
            {
                "from_mode": "delimiter", "from_delimiter": "]]",
                "until_mode": "delimiter", "until_delimiter": "[[", "from_right": True,
            },
            "a[[x]]bc.txt",
        ),
        (
            "a--one--two--b.txt",
            {
                "from_mode": "delimiter", "from_delimiter": "--",
                "until_mode": "delimiter", "until_delimiter": "--", "keep_delimiters": True,
            },
            "a----two--b.txt",
        ),
        (
            "a++123.txt",
            {"from_mode": "delimiter", "from_delimiter": "++", "until_count": 2, "keep_delimiters": True},
            "a++3.txt",
        ),
        (
            "a++123.txt",
            {"from_mode": "delimiter", "from_delimiter": "++"},
            "a+123.txt",
        ),
        ("abc.txt", {"from_mode": "delimiter", "until_mode": "end"}, "abc.txt"),
        ("abc.txt", {"from_mode": "delimiter", "from_delimiter": "ABC", "until_mode": "end"}, "abc.txt"),
        (
            "a++b--c.txt",
            {
                "from_mode": "delimiter", "from_delimiter": "--",
                "until_mode": "delimiter", "until_delimiter": "++",
            },
            "a++b--c.txt",
        ),
        (
            "a--b.txt",
            {"from_mode": "delimiter", "from_delimiter": "--", "until_mode": "delimiter"},
            "a--b.txt",
        ),
        (
            "raw.name.txt",
            {
                "delete_current_name": True, "from_mode": "delimiter",
                "from_delimiter": "missing", "from_right": True, "keep_delimiters": True,
            },
            ".txt",
        ),
    ],
)
def test_deletes_the_selected_name_range(
    name: str, config: dict[str, object], expected: str,
) -> None:
    rule = DeleteRule()
    assert rule.apply(name, RuleContext("id", 0, 1), rule.parse_config(config)) == expected


def test_treats_a_dotted_directory_name_as_a_whole() -> None:
    rule = DeleteRule()
    config = rule.parse_config({"from_right": True, "until_count": 3})
    assert rule.apply("dir.v1", RuleContext("id", 0, 1, is_directory=True), config) == "dir"


@pytest.mark.parametrize("config", [{"from_position": 0}, {"until_count": 256}, {"until_count": True}])
def test_rejects_invalid_position_or_count(config: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        DeleteRule().parse_config(config)
