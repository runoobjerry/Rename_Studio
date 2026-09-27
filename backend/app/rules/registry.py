from app.core.errors import RuleConfigurationError
from app.rules.base import RenameRule
from app.schemas.rules import RuleDefinition


class RuleRegistry:
    def __init__(self) -> None:
        self._rules: dict[str, RenameRule] = {}

    def register(self, rule: RenameRule) -> None:
        if rule.type in self._rules:
            raise ValueError(f"Rule type already registered: {rule.type}")
        self._rules[rule.type] = rule

    def get(self, rule_type: str) -> RenameRule:
        rule = self._rules.get(rule_type)
        if rule is None:
            raise RuleConfigurationError(
                "Unknown rename rule", details={"rule_type": rule_type}
            )
        return rule

    def definitions(self) -> list[RuleDefinition]:
        return [
            RuleDefinition(
                type=rule.type,
                name=rule.display_name,
                description=rule.description,
                config_schema=rule.config_model.model_json_schema(),
            )
            for rule in self._rules.values()
        ]
