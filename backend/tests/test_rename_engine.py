from pydantic import BaseModel

from app.rules.base import RenameRule, RuleContext
from app.rules.registry import RuleRegistry
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
