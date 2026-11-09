import pytest
from pydantic import ValidationError

from app.core.errors import RuleConfigurationError
from app.rules.base import RuleContext
from app.rules.serialize import SerializeConfig, SerializeRule


@pytest.mark.parametrize(("config", "expected"), [
    ({}, ["1", "2", "3", "4"]),
    ({"start": 5, "step": 2}, ["5", "7", "9", "11"]),
    ({"start": 5, "step": -2}, ["5", "3", "1"]),
    ({"repeat": 2}, ["1", "1", "2", "2", "3", "3"]),
    ({"reset_every": 3}, ["1", "2", "3", "1", "2", "3"]),
    ({"repeat": 2, "reset_every": 3}, ["1", "1", "2", "1", "1", "2"]),
    ({"pad_length": 3}, ["001", "002", "003"]),
    ({"start": -1, "step": 1002, "pad_length": 3}, ["-01", "1001"]),
    ({"start": 0, "step": 0}, ["0", "0"]),
    ({"start": 99_999_999}, ["99999999", "100000000"]),
    ({"start": -99_999_999, "step": -99_999_999}, ["-99999999", "-199999998"]),
    ({"numbering_system": "alphabetic"}, list("abcdefghijklmnopqrstuvwxyz") + ["ba", "bb"]),
    ({"numbering_system": "alphabetic", "start": 676}, ["zz", "baa"]),
    ({"numbering_system": "roman"}, ["I", "II", "III", "IV"]),
    ({"numbering_system": "roman", "start": 3999}, ["MMMCMXCIX"]),
    ({"numbering_system": "roman", "start": 3998, "repeat": 2, "reset_every": 3},
     ["MMMCMXCVIII", "MMMCMXCVIII", "MMMCMXCIX", "MMMCMXCVIII"]),
    ({"numbering_system": "music"}, ["C0", "C#0", "D0", "D#0"]),
    ({"numbering_system": "music", "start": 12}, ["B0", "C1"]),
    ({"numbering_system": "chinese"}, list("一二三四五六七八九") + ["一十", "一十一"]),
    ({"numbering_system": "chinese", "start": 1001, "step": 8}, ["一千零一", "一千零九", "一千零一十七"]),
])
def test_serializes_in_file_order(config: dict[str, object], expected: list[str]) -> None:
    rule = SerializeRule()
    options = SerializeConfig.model_validate({**config, "position": "replace"})
    actual = [
        rule.apply("old", RuleContext(str(index), index, len(expected)), options)
        for index in range(len(expected))
    ]
    assert actual == expected


@pytest.mark.parametrize(("name", "is_directory", "config", "expected"), [
    ("photo.raw.jpg", False, {}, "1photo.raw.jpg"),
    ("photo.raw.jpg", False, {"position": "suffix"}, "photo.raw1.jpg"),
    ("photo.raw.jpg", False, {"position": "suffix", "ignore_extension": False}, "photo.raw.jpg1"),
    ("photo.raw.jpg", False, {"position": "replace"}, "1.jpg"),
    ("photo.raw.jpg", False, {"position": "replace", "ignore_extension": False}, "1"),
    (".profile", False, {"position": "suffix"}, ".profile1"),
    ("照片.jpg", False, {"position": "index", "index": 1}, "照1片.jpg"),
    ("photo.jpg", False, {"position": "index", "index": 2, "from_right": True}, "pho1to.jpg"),
    ("photo.jpg", False, {"position": "index", "index": 255}, "photo1.jpg"),
    ("folder.v1", True, {"position": "suffix"}, "folder.v11"),
    ("folder.v1", True, {"position": "replace"}, "1"),
    ("folder.v2", True, {"position": "index", "index": 1, "from_right": True}, "folder.v12"),
    ("", False, {"position": "index", "from_right": True}, "1"),
])
def test_inserts_into_the_selected_part_of_the_name(
    name: str, is_directory: bool, config: dict[str, object], expected: str,
) -> None:
    options = SerializeConfig.model_validate(config)
    assert SerializeRule().apply(name, RuleContext("id", 0, 1, is_directory), options) == expected


@pytest.mark.parametrize("config", [
    {"start": 1.5}, {"step": True}, {"repeat": 0}, {"reset_every": -1},
    {"start": 100_000_000}, {"step": -100_000_000},
    {"repeat": 100_000_000}, {"reset_every": 100_000_000},
    {"pad_length": 0}, {"pad_length": 256}, {"index": 256},
    {"numbering_system": "roman", "start": 4000},
    {"numbering_system": "alphabetic", "start": 0},
    {"numbering_system": "chinese", "start": -1},
    {"numbering_system": "custom_numeric"},
])
def test_rejects_invalid_configuration(config: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        SerializeRule().parse_config(config)


@pytest.mark.parametrize(("system", "start", "step", "index"), [
    ("decimal", 1, 99_999_999, 100_000_000),
    ("alphabetic", 1, -1, 1),
    ("music", 120, 1, 1),
    ("chinese", 9999, 1, 1),
])
def test_rejects_generated_numbers_outside_the_supported_range(
    system: str, start: int, step: int, index: int,
) -> None:
    config = SerializeConfig.model_validate({"numbering_system": system, "start": start, "step": step})
    with pytest.raises(RuleConfigurationError) as error:
        SerializeRule().apply("old.txt", RuleContext("id", index, index + 1), config)
    assert error.value.details["reason"] == "SERIALIZE_NUMBER_OUT_OF_RANGE"
    assert error.value.details["params"]["item"] == index + 1
