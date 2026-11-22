import asyncio
import logging
import random
from time import perf_counter

import httpx

from app.core.errors import (
    AppError,
    AuthenticationError,
    NotFoundError,
    PermissionDeniedError,
    ProviderError,
    RateLimitError,
    RenameOutcomeUnknownError,
    ValidationError,
)
from app.providers.auth import StorageAuth
from app.providers.shared.http_errors import http_error_details, read_error_payload
from app.providers.shared.request_policy import ConnectionCooldown, RetryBudget, retry_after_delay


RATE_REASONS = {"rateLimitExceeded", "userRateLimitExceeded"}
logger = logging.getLogger("rename_studio.google_drive")


def _extract_google_reasons(payload: object) -> list[str]:
    error = payload.get("error") if isinstance(payload, dict) else None
    entries = error.get("errors") if isinstance(error, dict) else None
    if not isinstance(entries, list):
        return []
    reasons: list[str] = []
    for entry in entries:
        reason = entry.get("reason") if isinstance(entry, dict) else None
        if isinstance(reason, str):
            reasons.append(reason)
    return reasons


def _map_google_error(status: int, reasons: list[str]) -> AppError:
    details = {**http_error_details("google_drive", status, reasons), "google_status": status}
    if status == 401:
        return AuthenticationError("Google Drive authorization was rejected; reconnect the account", details=details)
    if status == 404:
        return NotFoundError("Google Drive item is missing or inaccessible", details=details)
    if status == 429 or (status == 403 and any(reason in RATE_REASONS for reason in reasons)):
        return RateLimitError("Google Drive rate limit reached", details=details)
    if status == 403:
        return PermissionDeniedError("Google Drive permission denied", details=details)
    if status == 400:
        return ValidationError("Google Drive rejected the request; refresh before continuing", details=details)
    return ProviderError("Google Drive request failed", details=details)


class GoogleDriveClient:
    def __init__(self, auth: StorageAuth, *, timeout: float = 30.0, client: httpx.AsyncClient | None = None) -> None:
        self.auth = auth
        self.timeout = timeout
        self._client = client
        self._owns_client = client is None
        self._cooldown = ConnectionCooldown()

    async def request(self, method: str, url: str, *, params: dict[str, str] | None = None, content: bytes | None = None, headers: dict[str, str] | None = None, writing: bool = False, budget: RetryBudget | None = None) -> httpx.Response:
        budget = budget if budget is not None else RetryBudget()
        refreshed = False
        while True:
            attempt = budget.used
            await self._cooldown.wait()
            token = await self.auth.access_token()
            # Token refresh can yield while another response extends the cooldown.
            await self._cooldown.wait()
            started = perf_counter()
            budget.used += 1
            try:
                response = await self._http_client().request(method, url, params=params, content=content, headers={**(headers or {}), "Authorization": f"Bearer {token}"})
            except httpx.HTTPError as exc:
                logger.debug(
                    "Provider request transport failed method=%s writing=%s attempt=%s duration_ms=%.2f",
                    method, writing, attempt + 1, (perf_counter() - started) * 1000, exc_info=exc,
                )
                if writing:
                    raise RenameOutcomeUnknownError("Google Drive write outcome is unknown; verify metadata before continuing", details={"provider_type": "google_drive"}) from exc
                if budget.available:
                    delay = min(2**attempt + random.random(), 8)
                    logger.debug("Retrying provider read after transport failure retry_after_ms=%.0f", delay * 1000)
                    await asyncio.sleep(delay)
                    continue
                raise ProviderError("Google Drive is unavailable", details={"provider_type": "google_drive"}) from exc
            logger.debug(
                "Provider responded method=%s writing=%s attempt=%s status=%s duration_ms=%.2f",
                method, writing, attempt + 1, response.status_code, (perf_counter() - started) * 1000,
            )
            if response.is_success:
                return response
            if writing and (response.status_code == 408 or response.status_code >= 500):
                raise RenameOutcomeUnknownError("Google Drive write outcome is unknown; verify metadata before continuing", details=self._response_error(response).details)
            error = self.classify_error(response, attempt)
            if response.status_code == 401 and not refreshed and budget.available:
                logger.debug("Retrying provider request after refreshing authorization status=401")
                await self.auth.access_token(force_refresh=True)
                refreshed = True
                continue
            # Read batches can be replayed; write batches only retry explicit auth/throttle refusals.
            if self.retryable(response, error) and budget.available:
                logger.debug("Retrying provider request status=%s error_code=%s", response.status_code, error.code)
                if not isinstance(error, RateLimitError):
                    await asyncio.sleep(self.retry_delay(response, attempt))
                continue
            raise error

    @staticmethod
    def _response_error(response: httpx.Response) -> AppError:
        return _map_google_error(response.status_code, _extract_google_reasons(read_error_payload(response)))

    @staticmethod
    def retryable(response: httpx.Response, error: AppError) -> bool:
        return isinstance(error, RateLimitError) or response.status_code >= 500

    def classify_error(self, response: httpx.Response, attempt: int, *, batch_item: bool = False) -> AppError:
        """Classify once and record throttling before the caller handles the error."""
        error = self._response_error(response)
        if isinstance(error, RateLimitError):
            delay = self.retry_delay(response, attempt)
            self._cooldown.defer(delay)
            logger.log(
                logging.DEBUG if batch_item else logging.WARNING,
                "Rate limit reached status=%s retry_after_ms=%.0f error_code=%s",
                response.status_code, delay * 1000, error.code,
            )
        return error

    def classify_batch_errors(self, responses: list[httpx.Response], attempt: int) -> dict[int, AppError]:
        # Record throttling across the envelope before handling individual failures.
        errors = {
            index: self.classify_error(response, attempt, batch_item=True)
            for index, response in enumerate(responses) if not response.is_success
        }
        throttled = sum(isinstance(error, RateLimitError) for error in errors.values())
        if throttled:
            logger.warning("Provider group throttled item_count=%s error_code=RATE_LIMIT_ERROR", throttled)
        return errors

    @staticmethod
    def retry_delay(response: httpx.Response, attempt: int) -> float:
        return retry_after_delay(response.headers.get("Retry-After"), min(2**attempt + random.random(), 8))

    def _http_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
