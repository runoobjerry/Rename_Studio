import pytest
from pydantic import BaseModel

from app.core.errors import RuleConfigurationError
from app.rules.base import RenameRule, RuleContext
from app.rules.insert import InsertRule
from app.rules.padding import PaddingRule
from app.rules.registry import RuleRegistry
from app.rules.text_operations import RemoveRule, ReplaceRule
from app.schemas.rules import RuleSpec
from app.services.rename_engine import RenameEngine


class PrefixConfig(BaseModel):
    value: str


class PrefixRule(RenameRule[PrefixConfig]):
    type = "test_prefix"
    display_name = "Test prefix"
    description = "Test-only rule"
    config_model = PrefixConfig

    def apply(
        self, filename: str, context: RuleContext, config: PrefixConfig
    ) -> str:
        return f"{config.value}{filename}"


def test_empty_rule_chain_preserves_filename() -> None:
    engine = RenameEngine(RuleRegistry())

    result = engine.apply("one.txt", [], RuleContext("one.txt", 0, 1))

    assert result == "one.txt"


def test_applies_registered_rules_in_order_and_skips_disabled() -> None:
    registry = RuleRegistry()
    registry.register(PrefixRule())
    engine = RenameEngine(registry)
    rules = [
        RuleSpec(type="test_prefix", config={"value": "A-"}),
        RuleSpec(type="test_prefix", enabled=False, config={"value": "X-"}),
        RuleSpec(type="test_prefix", config={"value": "B-"}),
    ]

    result = engine.apply("one.txt", rules, RuleContext("one.txt", 0, 1))

    assert result == "B-A-one.txt"


def test_empty_text_rules_do_not_block_later_rules() -> None:
    registry = RuleRegistry()
    for rule in [ReplaceRule(), RemoveRule(), InsertRule(), PaddingRule()]:
        registry.register(rule)
    rules = [
        RuleSpec(type="replace", config={"search": "", "replacement": "X"}),
        RuleSpec(type="remove", config={"search": ""}),
        RuleSpec(type="insert", config={"text": ""}),
        RuleSpec(type="insert", config={"text": "X", "position": "before_text"}),
        RuleSpec(type="padding", config={"mode": "text", "length": 10, "fill_character": ""}),
        RuleSpec(type="insert", config={"text": "猫-"}),
    ]

    result = RenameEngine(registry).apply("one.txt", rules, RuleContext("one.txt", 0, 1))

    assert result == "猫-one.txt"


def test_invalid_nonempty_rule_configuration_still_fails() -> None:
    registry = RuleRegistry()
    registry.register(InsertRule())
    rules = [RuleSpec(type="insert", config={"text": "X", "index": 0})]

    with pytest.raises(RuleConfigurationError):
        RenameEngine(registry).apply("one.txt", rules, RuleContext("one.txt", 0, 1))
