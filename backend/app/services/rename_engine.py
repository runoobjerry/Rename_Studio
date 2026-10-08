from pydantic import BaseModel, ValidationError as PydanticValidationError

from app.core.errors import RuleConfigurationError
from app.rules.base import RenameRule, RuleContext
from app.rules.registry import RuleRegistry
from app.schemas.rules import RuleSpec


class RenameEngine:
    def __init__(self, registry: RuleRegistry) -> None:
        self.registry = registry

    def apply(
        self,
        filename: str,
        rules: list[RuleSpec],
        context: RuleContext,
    ) -> str:
        return self.apply_prepared(filename, self.prepare_rules(rules), context)

    def prepare_rules(
        self, rules: list[RuleSpec]
    ) -> list[tuple[RenameRule, BaseModel]]:
        prepared: list[tuple[RenameRule, BaseModel]] = []
        for spec in rules:
            if not spec.enabled:
                continue
            rule = self.registry.get(spec.type)
            try:
                config = rule.parse_config(spec.config)
            except PydanticValidationError as exc:
                raise RuleConfigurationError(
                    "Invalid rule configuration",
                    details={"rule_type": spec.type, "errors": exc.errors()},
                ) from exc
            prepared.append((rule, config))
        return prepared

    def apply_prepared(
        self,
        filename: str,
        rules: list[tuple[RenameRule, BaseModel]],
        context: RuleContext,
    ) -> str:
        result = filename
        for rule, config in rules:
            result = rule.apply(result, context, config)
        return result
