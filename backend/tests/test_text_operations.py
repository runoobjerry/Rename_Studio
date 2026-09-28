import pytest
from pydantic import ValidationError

from app.rules.base import RuleContext
from app.rules.text_operations import (
    MatchOccurrence,
    RemoveConfig,
    RemoveRule,
    ReplaceConfig,
    ReplaceRule,
    TextMatchConfig,
)


CONTEXT = RuleContext(file_id="test", index=0, total=1)


@pytest.mark.parametrize(
    ("occurrence", "expected"),
    [
        (MatchOccurrence.ALL, "bar-bar-bar.txt"),
        (MatchOccurrence.FIRST, "bar-foo-foo.txt"),
        (MatchOccurrence.LAST, "foo-foo-bar.txt"),
    ],
)
def test_replace_supports_each_occurrence(
    occurrence: MatchOccurrence, expected: str
) -> None:
    config = ReplaceConfig(
        search="foo",
        replacement="bar",
        occurrence=occurrence,
    )

    assert ReplaceRule().apply("foo-foo-foo.txt", CONTEXT, config) == expected


def test_replace_can_match_without_case_sensitivity() -> None:
    config = ReplaceConfig(
        search="cat",
        replacement="dog",
        case_sensitive=False,
    )

    assert ReplaceRule().apply("Cat-cat-CAT.txt", CONTEXT, config) == "dog-dog-dog.txt"


def test_whole_word_uses_unicode_word_boundaries() -> None:
    config = ReplaceConfig(
        search="猫",
        replacement="狗",
        whole_word=True,
    )

    result = ReplaceRule().apply("猫 猫咪 cat猫.txt", CONTEXT, config)

    assert result == "狗 猫咪 cat猫.txt"


def test_ignore_extension_controls_extension_matching() -> None:
    ignored = ReplaceConfig(search="txt", replacement="md", ignore_extension=True)
    included = ReplaceConfig(search="txt", replacement="md", ignore_extension=False)
    rule = ReplaceRule()

    assert rule.apply("txt-file.txt", CONTEXT, ignored) == "md-file.txt"
    assert rule.apply("txt-file.txt", CONTEXT, included) == "md-file.md"


def test_remove_shares_matching_options() -> None:
    config = RemoveConfig(
        search="draft",
        occurrence=MatchOccurrence.LAST,
        case_sensitive=False,
        ignore_extension=True,
    )

    result = RemoveRule().apply("DRAFT-final-draft.txt", CONTEXT, config)

    assert result == "DRAFT-final-.txt"


def test_replacement_is_literal_text() -> None:
    config = ReplaceConfig(search="name", replacement=r"\1-final")

    assert ReplaceRule().apply("name.txt", CONTEXT, config) == r"\1-final.txt"


@pytest.mark.parametrize(
    "config_model",
    [ReplaceConfig, RemoveConfig],
)
def test_empty_search_is_rejected(config_model: type[TextMatchConfig]) -> None:
    with pytest.raises(ValidationError):
        config_model.model_validate({"search": ""})


def test_ignore_extension_does_not_hide_part_of_directory_name() -> None:
    context = RuleContext(file_id="folder.v1", index=0, total=1, is_directory=True)
    config = ReplaceConfig(
        search="v1",
        replacement="v2",
        ignore_extension=True,
    )

    assert ReplaceRule().apply("folder.v1", context, config) == "folder.v2"
