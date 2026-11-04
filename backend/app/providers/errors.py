"""Shared diagnostics and OAuth HTTP classification; no retry decisions."""

from typing import Any

import httpx

from app.core.errors import AppError, AuthenticationError, ProviderError, RateLimitError


def read_error_payload(response: httpx.Response) -> object:
    try:
        return response.json()
    except ValueError:
        return None


def http_error_details(provider_type: str, status: int, codes: list[str] | None = None) -> dict[str, Any]:
    details: dict[str, Any] = {"provider_type": provider_type, "provider_status": status}
    if codes:
        details["provider_codes"] = codes
    return details


def auth_response_error(provider_type: str, status: int, *, service: str, token: bool = False) -> AppError:
    # Account verification and token exchange have different authentication boundaries.
    details = http_error_details(provider_type, status)
    if status == 429:
        return RateLimitError(f"{service} is rate limited; try again later", details=details)
    if status in ({400, 401, 403} if token else {401, 403}):
        return AuthenticationError(f"{service} authorization was rejected; check the connection", details=details)
    return ProviderError(f"{service} request failed", details=details)
