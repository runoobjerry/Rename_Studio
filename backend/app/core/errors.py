from typing import Any


class AppError(Exception):
    code = "APPLICATION_ERROR"
    status_code = 400

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(AppError):
    code = "NOT_FOUND"
    status_code = 404


class ProviderError(AppError):
    code = "PROVIDER_ERROR"
    status_code = 502


class ValidationError(AppError):
    code = "VALIDATION_ERROR"
    status_code = 422


class RuleConfigurationError(ValidationError):
    code = "RULE_CONFIGURATION_ERROR"
