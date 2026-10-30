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


class AuthenticationError(AppError):
    code = "AUTHENTICATION_ERROR"
    status_code = 401


class RateLimitError(AppError):
    code = "RATE_LIMIT_ERROR"
    status_code = 429


class PermissionDeniedError(AppError):
    code = "PERMISSION_DENIED"
    status_code = 403


class ValidationError(AppError):
    code = "VALIDATION_ERROR"
    status_code = 422


class RuleConfigurationError(ValidationError):
    code = "RULE_CONFIGURATION_ERROR"


class RenameConflictError(AppError):
    code = "RENAME_CONFLICT"
    status_code = 409


class PreviewExpiredError(AppError):
    code = "PREVIEW_EXPIRED"
    status_code = 409


class PreviewNotFoundError(AppError):
    code = "PREVIEW_NOT_FOUND"
    status_code = 404


class StorageBusyError(AppError):
    code = "STORAGE_BUSY"
    status_code = 409


class StorageAccountAlreadyConnectedError(AppError):
    code = "STORAGE_ACCOUNT_ALREADY_CONNECTED"
    status_code = 409


class StorageConnectionChangedError(AppError):
    code = "STORAGE_CONNECTION_CHANGED"
    status_code = 409


class RenameOutcomeUnknownError(ProviderError):
    code = "RENAME_OUTCOME_UNKNOWN"
