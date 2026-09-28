import asyncio
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.parse import quote

import httpx

from app.core.errors import (
    AppError,
    AuthenticationError,
    NotFoundError,
    ProviderError,
    RateLimitError,
    RenameConflictError,
    ValidationError,
)
from app.providers.base import RenameRequest, StorageProvider
from app.providers.name_validation import validate_onedrive_name
from app.schemas.files import FileItem
from app.services.onedrive_auth import OneDriveAuthService


GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
MAX_BATCH_SIZE = 20
MAX_RETRIES = 3


class OneDriveProvider(StorageProvider):
    id = "onedrive"
    display_name = "OneDrive Personal"

    def __init__(self, auth: OneDriveAuthService, *, timeout: float = 30.0) -> None:
        self.auth = auth
        self.timeout = timeout

    async def list_files(self, path: str) -> list[FileItem]:
        normalized = path.replace("\\", "/").strip("/")
        if normalized:
            encoded = quote(normalized, safe="/")
            url = f"{GRAPH_ROOT}/me/drive/root:/{encoded}:/children"
        else:
            url = f"{GRAPH_ROOT}/me/drive/root/children"

        items: list[FileItem] = []
        while url:
            payload = await self._request_json("GET", url)
            raw_items = payload.get("value")
            if not isinstance(raw_items, list):
                raise ProviderError(
                    "Microsoft Graph returned an invalid directory listing"
                )
            items.extend(
                self._to_item(item)
                for item in raw_items
                if isinstance(item, dict)
            )
            next_link = payload.get("@odata.nextLink")
            url = next_link if isinstance(next_link, str) else ""
        return sorted(
            items,
            key=lambda item: (not item.is_directory, item.name.casefold()),
        )

    async def get_metadata(self, file_id: str) -> FileItem:
        encoded_id = quote(file_id, safe="")
        payload = await self._request_json(
            "GET", f"{GRAPH_ROOT}/me/drive/items/{encoded_id}"
        )
        return self._to_item(payload)

    async def get_metadata_many(self, file_ids: list[str]) -> list[FileItem]:
        results: dict[str, FileItem | AppError] = {}
        for offset in range(0, len(file_ids), MAX_BATCH_SIZE):
            chunk = file_ids[offset : offset + MAX_BATCH_SIZE]
            results.update(await self._metadata_batch(chunk))
        items: list[FileItem] = []
        for file_id in file_ids:
            outcome = results[file_id]
            if isinstance(outcome, AppError):
                raise outcome
            items.append(outcome)
        return items

    async def _metadata_batch(
        self,
        file_ids: list[str],
        *,
        attempt: int = 0,
    ) -> dict[str, FileItem | AppError]:
        body = {
            "requests": [
                {
                    "id": str(index),
                    "method": "GET",
                    "url": f"/me/drive/items/{quote(file_id, safe='')}",
                }
                for index, file_id in enumerate(file_ids)
            ]
        }
        payload = await self._request_json("POST", f"{GRAPH_ROOT}/$batch", json=body)
        raw_responses = payload.get("responses")
        if not isinstance(raw_responses, list):
            raise ProviderError("Microsoft Graph returned an invalid batch response")
        by_index = {
            str(response.get("id")): response
            for response in raw_responses
            if isinstance(response, dict)
        }
        retry: list[str] = []
        retry_auth = False
        retry_after = 0.0
        results: dict[str, FileItem | AppError] = {}
        for index, file_id in enumerate(file_ids):
            response = by_index.get(str(index))
            if response is None:
                results[file_id] = ProviderError(
                    "Microsoft Graph omitted a batch response"
                )
                continue
            status = response.get("status")
            response_body = response.get("body")
            if not isinstance(status, int):
                results[file_id] = ProviderError(
                    "Microsoft Graph returned an invalid batch item"
                )
            elif 200 <= status < 300 and isinstance(response_body, dict):
                results[file_id] = self._to_item(response_body)
            elif self._is_retryable(status) and attempt < MAX_RETRIES:
                retry.append(file_id)
                headers = response.get("headers")
                if isinstance(headers, dict):
                    retry_after = max(
                        retry_after,
                        self._retry_delay(headers.get("Retry-After"), attempt),
                    )
            elif status == 401 and attempt < MAX_RETRIES:
                retry.append(file_id)
                retry_auth = True
            else:
                body_value = response_body if isinstance(response_body, dict) else {}
                results[file_id] = self._graph_error(status, body_value)
        if retry:
            await asyncio.sleep(retry_after or min(2**attempt, 8))
            if retry_auth:
                await self.auth.access_token(force_refresh=True)
            results.update(await self._metadata_batch(retry, attempt=attempt + 1))
        return results

    async def rename(self, file_id: str, new_name: str) -> FileItem:
        validation_error = self.validate_name(new_name)
        if validation_error is not None:
            raise ValidationError(validation_error, details={"new_name": new_name})
        encoded_id = quote(file_id, safe="")
        payload = await self._request_json(
            "PATCH",
            f"{GRAPH_ROOT}/me/drive/items/{encoded_id}",
            json={"name": new_name},
        )
        return self._to_item(payload)

    async def rename_many(
        self, requests: list[RenameRequest]
    ) -> dict[str, FileItem | AppError]:
        results: dict[str, FileItem | AppError] = {}
        for offset in range(0, len(requests), MAX_BATCH_SIZE):
            chunk = requests[offset : offset + MAX_BATCH_SIZE]
            results.update(await self._rename_batch(chunk))
        return results

    async def _rename_batch(
        self,
        requests: list[RenameRequest],
        *,
        attempt: int = 0,
    ) -> dict[str, FileItem | AppError]:
        invalid: dict[str, FileItem | AppError] = {}
        valid: list[RenameRequest] = []
        for request in requests:
            error = self.validate_name(request.new_name)
            if error is None:
                valid.append(request)
            else:
                invalid[request.file_id] = ValidationError(
                    error, details={"new_name": request.new_name}
                )
        if not valid:
            return invalid

        body = {
            "requests": [
                {
                    "id": str(index),
                    "method": "PATCH",
                    "url": f"/me/drive/items/{quote(request.file_id, safe='')}",
                    "headers": {"Content-Type": "application/json"},
                    "body": {"name": request.new_name},
                }
                for index, request in enumerate(valid)
            ]
        }
        payload = await self._request_json("POST", f"{GRAPH_ROOT}/$batch", json=body)
        raw_responses = payload.get("responses")
        if not isinstance(raw_responses, list):
            raise ProviderError("Microsoft Graph returned an invalid batch response")

        by_index = {
            str(response.get("id")): response
            for response in raw_responses
            if isinstance(response, dict)
        }
        retry: list[RenameRequest] = []
        retry_auth = False
        retry_after = 0.0
        results = dict(invalid)
        for index, request in enumerate(valid):
            response = by_index.get(str(index))
            if response is None:
                results[request.file_id] = ProviderError(
                    "Microsoft Graph omitted a batch response"
                )
                continue
            status = response.get("status")
            response_body = response.get("body")
            if not isinstance(status, int):
                results[request.file_id] = ProviderError(
                    "Microsoft Graph returned an invalid batch item"
                )
            elif 200 <= status < 300 and isinstance(response_body, dict):
                results[request.file_id] = self._to_item(response_body)
            elif self._is_retryable(status) and attempt < MAX_RETRIES:
                retry.append(request)
                headers = response.get("headers")
                if isinstance(headers, dict):
                    retry_after = max(
                        retry_after,
                        self._retry_delay(headers.get("Retry-After"), attempt),
                    )
            elif status == 401 and attempt < MAX_RETRIES:
                retry.append(request)
                retry_auth = True
            else:
                body_value = response_body if isinstance(response_body, dict) else {}
                results[request.file_id] = self._graph_error(status, body_value)

        if retry:
            # Graph 批处理需单独重试被限流的子请求，而不是重放已成功的项目。
            await asyncio.sleep(retry_after or min(2**attempt, 8))
            if retry_auth:
                await self.auth.access_token(force_refresh=True)
            results.update(await self._rename_batch(retry, attempt=attempt + 1))
        return results

    def validate_name(self, name: str) -> str | None:
        # OneDrive 同样会同步到 Windows，本阶段沿用更严格的跨平台文件名规则。
        return validate_onedrive_name(name)

    def validate_target_name(self, item: FileItem, name: str) -> str | None:
        error = self.validate_name(name)
        if error is not None:
            return error
        if item.parent_path == "" and name.casefold() == "forms":
            return "'forms' is reserved at the OneDrive root"
        if item.is_directory and name.startswith(("゛", "ဧ")):
            return "OneDrive folder name starts with a restricted character"
        decoded_path = f"{item.parent_path}/{name}".strip("/")
        if len(decoded_path) > 400:
            return "OneDrive path is longer than 400 characters"
        return None

    async def _request_json(
        self,
        method: str,
        url: str,
        *,
        json: dict[str, object] | None = None,
    ) -> dict[str, object]:
        force_refresh = False
        for attempt in range(MAX_RETRIES + 1):
            token = await self.auth.access_token(force_refresh=force_refresh)
            force_refresh = False
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.request(
                        method,
                        url,
                        headers={"Authorization": f"Bearer {token}"},
                        json=json,
                    )
            except httpx.HTTPError as exc:
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(min(2**attempt, 8))
                    continue
                raise ProviderError("Microsoft Graph request failed") from exc

            if response.status_code == 401 and attempt < MAX_RETRIES:
                force_refresh = True
                continue
            if self._is_retryable(response.status_code) and attempt < MAX_RETRIES:
                await asyncio.sleep(
                    self._retry_delay(response.headers.get("Retry-After"), attempt)
                )
                continue
            try:
                payload = response.json()
            except ValueError as exc:
                raise ProviderError("Microsoft Graph returned invalid data") from exc
            if not isinstance(payload, dict):
                raise ProviderError("Microsoft Graph returned invalid data")
            if response.is_error:
                raise self._graph_error(response.status_code, payload)
            return payload
        raise ProviderError("Microsoft Graph request failed after retries")

    @staticmethod
    def _to_item(payload: dict[str, object]) -> FileItem:
        item_id = payload.get("id")
        name = payload.get("name")
        if not isinstance(item_id, str) or not isinstance(name, str):
            raise ProviderError("Microsoft Graph returned incomplete file metadata")
        parent = OneDriveProvider._parent_path(payload.get("parentReference"))
        modified = payload.get("lastModifiedDateTime")
        try:
            modified_at = (
                datetime.fromisoformat(modified.replace("Z", "+00:00"))
                if isinstance(modified, str)
                else None
            )
        except ValueError:
            modified_at = None
        is_directory = isinstance(payload.get("folder"), dict)
        size = payload.get("size")
        return FileItem(
            id=item_id,
            name=name,
            path=f"{parent}/{name}".strip("/"),
            parent_path=parent,
            is_directory=is_directory,
            size=None if is_directory or not isinstance(size, int) else size,
            modified_at=modified_at,
        )

    @staticmethod
    def _parent_path(value: object) -> str:
        if not isinstance(value, dict):
            return ""
        path = value.get("path")
        if not isinstance(path, str) or "root:" not in path:
            return ""
        return path.split("root:", maxsplit=1)[1].strip("/")

    @staticmethod
    def _is_retryable(status: int) -> bool:
        return status in {429, 500, 502, 503, 504}

    @staticmethod
    def _retry_delay(value: object, attempt: int) -> float:
        if isinstance(value, str):
            try:
                return min(max(float(value), 0.0), 30.0)
            except ValueError:
                try:
                    delay = (
                        parsedate_to_datetime(value) - datetime.now().astimezone()
                    ).total_seconds()
                    return min(max(delay, 0.0), 30.0)
                except (TypeError, ValueError, OverflowError):
                    pass
        return min(2**attempt, 8)

    @staticmethod
    def _graph_error(status: int, payload: dict[str, object]) -> AppError:
        error = payload.get("error")
        message = None
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            message = error["message"]
        details = {"graph_status": status}
        if status == 401:
            return AuthenticationError(
                message or "OneDrive authorization failed", details=details
            )
        if status == 404:
            return NotFoundError(message or "OneDrive item was not found", details=details)
        if status in {409, 412}:
            return RenameConflictError(
                message or "OneDrive rename conflict", details=details
            )
        if status == 429:
            return RateLimitError(
                message or "Microsoft Graph rate limit reached", details=details
            )
        if status == 400:
            return ValidationError(
                message or "Microsoft Graph rejected the request", details=details
            )
        return ProviderError(message or "Microsoft Graph request failed", details=details)
