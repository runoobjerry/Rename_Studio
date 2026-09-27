from pydantic import ValidationError as PydanticValidationError

from app.core.errors import RuleConfigurationError
from app.rules.base import RuleContext
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
        result = filename
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
            result = rule.apply(result, context, config)
        return result
