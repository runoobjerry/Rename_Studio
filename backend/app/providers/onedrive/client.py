import asyncio
import logging
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
    RenameConflictError,
)
from app.providers.auth import StorageAuth
from app.providers.shared.http_errors import http_error_details, read_error_payload
from app.providers.shared.request_policy import ConnectionCooldown, RetryBudget, retry_after_delay


logger = logging.getLogger("rename_studio.onedrive")


def _extract_graph_codes(payload: object) -> list[str]:
    codes: list[str] = []
    error = payload.get("error") if isinstance(payload, dict) else None
    while isinstance(error, dict):
        code = error.get("code")
        if isinstance(code, str):
            codes.append(code)
        error = error.get("innerError") or error.get("innererror")
    return codes


def _map_graph_error(status: int, codes: list[str]) -> AppError:
    details = {**http_error_details("onedrive", status, codes), "graph_status": status}
    if status == 401:
        return AuthenticationError("OneDrive authorization failed", details=details)
    if status == 403:
        return PermissionDeniedError("OneDrive permission denied", details=details)
    if status == 404:
        return NotFoundError("OneDrive item was not found", details=details)
    if status == 412 or (status in {400, 409} and "resourceModified" in codes):
        return RenameConflictError(
            "OneDrive item changed before the request could be applied",
            details={**details, "reason": "SOURCE_CHANGED"},
        )
    if status in {400, 409} and "nameAlreadyExists" in codes:
        return RenameConflictError("An item with the target name already exists in OneDrive", details=details)
    if status == 409:
        return RenameConflictError("OneDrive rename conflict", details=details)
    if status == 429:
        return RateLimitError("Microsoft Graph rate limit reached", details=details)
    if status == 400:
        return ValidationError("Microsoft Graph rejected the request", details=details)
    return ProviderError("Microsoft Graph request failed", details=details)


class OneDriveClient:
    def __init__(
        self,
        auth: StorageAuth,
        *,
        timeout: float = 30.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.auth = auth
        self.timeout = timeout
        self._client = client
        self._owns_client = client is None
        self._cooldown = ConnectionCooldown()

    async def request_json(
        self,
        method: str,
        url: str,
        *,
        json: dict[str, object] | None = None,
        budget: RetryBudget | None = None,
    ) -> dict[str, object]:
        budget = budget if budget is not None else RetryBudget()
        force_refresh = False
        writing = method == "PATCH" or (method == "POST" and json is not None and any(
            request["method"] == "PATCH" for request in json["requests"]
        ))
        while True:
            attempt = budget.used
            await self._cooldown.wait()
            token = await self.auth.access_token(force_refresh=force_refresh)
            force_refresh = False
            # Token refresh can yield while another response extends the cooldown.
            await self._cooldown.wait()
            attempt_started = perf_counter()
            budget.used += 1
            try:
                response = await self._http_client().request(
                    method,
                    url,
                    headers={"Authorization": f"Bearer {token}"},
                    json=json,
                )
            except httpx.HTTPError as exc:
                logger.debug(
                    "Provider request transport failed method=%s writing=%s attempt=%s duration_ms=%.2f",
                    method, writing, attempt + 1, (perf_counter() - attempt_started) * 1000, exc_info=exc,
                )
                if writing:
                    raise RenameOutcomeUnknownError("Remote write outcome is unknown; metadata must be checked", details={"provider_type": "onedrive"}) from exc
                if budget.available:
                    delay = min(2**attempt, 8)
                    logger.debug("Retrying provider read after transport failure retry_after_ms=%.0f", delay * 1000)
                    await asyncio.sleep(delay)
                    continue
                raise ProviderError("Microsoft Graph request failed", details={"provider_type": "onedrive"}) from exc

            logger.debug(
                "Provider responded method=%s writing=%s attempt=%s status=%s duration_ms=%.2f",
                method, writing, attempt + 1, response.status_code, (perf_counter() - attempt_started) * 1000,
            )
            if response.status_code == 429:
                delay = self.retry_delay(response.headers.get("Retry-After"), attempt)
                self._cooldown.defer(delay)
                logger.warning("Rate limit reached status=429 retry_after_ms=%.0f error_code=RATE_LIMIT_ERROR", delay * 1000)
                if budget.available:
                    logger.debug("Retrying a throttled provider request")
                    continue
                raise self.graph_error(429, read_error_payload(response))
            if response.status_code == 401 and budget.available:
                logger.debug("Retrying provider request after refreshing authorization status=401")
                force_refresh = True
                continue
            if writing and (response.status_code == 408 or response.status_code >= 500):
                raise RenameOutcomeUnknownError("Remote write outcome is unknown; metadata must be checked", details=self.graph_error(response.status_code, read_error_payload(response)).details)
            if self.retryable(response.status_code) and budget.available:
                delay = self.retry_delay(response.headers.get("Retry-After"), attempt)
                logger.debug("Retrying provider request status=%s retry_after_ms=%.0f", response.status_code, delay * 1000)
                await asyncio.sleep(delay)
                continue
            if response.is_error:
                raise self.graph_error(response.status_code, read_error_payload(response))
            try:
                payload = response.json()
            except ValueError as exc:
                if writing:
                    raise RenameOutcomeUnknownError("Microsoft Graph returned an unreadable write response") from exc
                raise ProviderError("Microsoft Graph returned invalid data", details={"provider_type": "onedrive"}) from exc
            if not isinstance(payload, dict):
                if writing:
                    raise RenameOutcomeUnknownError("Microsoft Graph returned an unreadable write response")
                raise ProviderError("Microsoft Graph returned invalid data")
            return payload

    def _http_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
            self._owns_client = True
        return self._client

    async def aclose(self) -> None:
        if (
            self._owns_client
            and self._client is not None
            and not self._client.is_closed
        ):
            await self._client.aclose()

    @staticmethod
    def retryable(status: int) -> bool:
        return status in {429, 500, 502, 503, 504}

    def record_batch_throttle(self, responses: list[object], attempt: int) -> None:
        count = 0
        longest_delay = 0.0
        for response in responses:
            if isinstance(response, dict) and response.get("status") == 429:
                headers = response.get("headers")
                value = httpx.Headers(headers).get("Retry-After") if isinstance(headers, dict) else None
                delay = self.retry_delay(value, attempt)
                self._cooldown.defer(delay)
                count += 1
                longest_delay = max(longest_delay, delay)
        if count:
            logger.warning("Provider group throttled status=429 item_count=%s retry_after_ms=%.0f error_code=RATE_LIMIT_ERROR",
                           count, longest_delay * 1000)

    @staticmethod
    def retry_delay(value: str | None, attempt: int) -> float:
        return retry_after_delay(value, min(2**attempt, 8))

    @staticmethod
    def graph_error(status: int, payload: object) -> AppError:
        return _map_graph_error(status, _extract_graph_codes(payload))
