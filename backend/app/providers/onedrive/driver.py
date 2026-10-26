import asyncio
import logging
from time import perf_counter
from collections.abc import Awaitable, Callable
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.parse import quote, urlsplit

import httpx

from app.core.log_context import request_id_context
from app.core.errors import (
    AppError,
    AuthenticationError,
    NotFoundError,
    PermissionDeniedError,
    ProviderError,
    RateLimitError,
    RenameConflictError,
    ValidationError,
    RenameOutcomeUnknownError,
)
from app.providers.base import RenameRequest, StorageProvider
from app.providers.name_validation import validate_onedrive_name
from app.schemas.files import DirectoryListing, FileItem
from app.schemas.storage import IdLocation, PathLocation, RootLocation, StorageLocation
from app.services.connection_auth import ConnectionAuth


logger = logging.getLogger("rename_studio.onedrive_performance")


GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
MAX_BATCH_SIZE = 20
MAX_RETRIES = 3
READ_BATCH_CONCURRENCY = 3
WRITE_BATCH_CONCURRENCY = 2
DRIVE_ITEM_SELECT = "id,name,parentReference,folder,root,size,lastModifiedDateTime"


class OneDriveProvider(StorageProvider):
    id = "onedrive"
    execution_batch_concurrency = WRITE_BATCH_CONCURRENCY

    def __init__(
        self,
        auth: ConnectionAuth,
        *,
        timeout: float = 30.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.auth = auth
        self.timeout = timeout
        self._client = client
        self._owns_client = client is None
        self._root_id: str | None = None
        self._root_item: FileItem | None = None

    async def list_directory(self, location: StorageLocation) -> DirectoryListing:
        if self._root_id is None:
            root = await self._request_json("GET", f"{GRAPH_ROOT}/me/drive/root")
            self._root_item = self._to_item(root)
            self._root_id = self._root_item.id
        directory_id = self._root_id
        if isinstance(location, IdLocation):
            directory_id = location.value
        elif isinstance(location, PathLocation):
            # Resolve every segment explicitly: remote duplicate names must not pick an arbitrary object.
            for segment in location.value.split("/") if location.value else []:
                listing = await self._list_url(f"{GRAPH_ROOT}/me/drive/items/{quote(directory_id, safe='')}/children")
                matches = [item for item in listing if item.is_directory and self.normalize_name(item.name) == self.normalize_name(segment)]
                if not matches:
                    raise NotFoundError("Directory not found")
                if len(matches) != 1:
                    raise ValidationError("Directory path is ambiguous; navigate using its ID")
                directory_id = matches[0].id
        directory = self._root_item if directory_id == self._root_id else await self.get_metadata(directory_id)
        assert directory is not None
        if not directory.is_directory:
            raise ValidationError("Selected location is not a directory")
        canonical = RootLocation() if directory_id == self._root_id else IdLocation(value=directory_id)
        parent = None if directory_id == self._root_id else directory.parent_location
        if parent is None and directory_id != self._root_id:
            raise ProviderError("Microsoft Graph omitted the parent directory ID")
        if isinstance(parent, IdLocation) and parent.value == self._root_id:
            parent = RootLocation()
        items = await self._list_url(f"{GRAPH_ROOT}/me/drive/items/{quote(directory_id, safe='')}/children")
        for item in items:
            if item.parent_location is not None and item.parent_location != IdLocation(value=directory_id):
                raise ProviderError("Microsoft Graph returned an item outside the requested directory")
            item.parent_location = IdLocation(value=directory_id)
        path = "" if isinstance(canonical, RootLocation) else directory.path
        return DirectoryListing(provider=self.id, path=path, parent_path=None if parent is None else directory.parent_path,
                                location=canonical, parent_location=parent, items=items)

    async def list_files(self, path: str) -> list[FileItem]:
        normalized = path.replace("\\", "/").strip("/")
        if normalized:
            encoded = quote(normalized, safe="/")
            url = f"{GRAPH_ROOT}/me/drive/root:/{encoded}:/children"
        else:
            url = f"{GRAPH_ROOT}/me/drive/root/children"
        return await self._list_url(url)

    async def _list_url(self, url: str) -> list[FileItem]:
        url = f"{url}?$select={DRIVE_ITEM_SELECT}&$top=200"

        items: list[FileItem] = []
        visited: set[str] = set()
        page = 0
        while url:
            parsed = urlsplit(url)
            if parsed.scheme != "https" or parsed.netloc != "graph.microsoft.com" or not parsed.path.startswith("/v1.0/") or url in visited:
                raise ProviderError("Microsoft Graph returned an invalid pagination link")
            visited.add(url)
            page += 1
            page_started = perf_counter()
            payload = await self._request_json("GET", url)
            raw_items = payload.get("value")
            if not isinstance(raw_items, list):
                raise ProviderError(
                    "Microsoft Graph returned an invalid directory listing"
                )
            if any(not isinstance(item, dict) for item in raw_items):
                raise ProviderError("Microsoft Graph returned an invalid directory item")
            items.extend(self._to_item(item) for item in raw_items)
            logger.info(
                "directory_page provider=onedrive request_id=%s page=%s item_count=%s duration_ms=%.2f",
                request_id_context.get(), page, len(raw_items), (perf_counter() - page_started) * 1000,
            )
            next_link = payload.get("@odata.nextLink")
            if next_link is not None and (not isinstance(next_link, str) or not next_link):
                raise ProviderError("Microsoft Graph returned an invalid pagination link")
            url = next_link if isinstance(next_link, str) else ""
        if len({item.id for item in items}) != len(items):
            raise ProviderError("Microsoft Graph returned duplicate directory IDs; refresh the directory")
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
        chunks = [
            file_ids[offset : offset + MAX_BATCH_SIZE]
            for offset in range(0, len(file_ids), MAX_BATCH_SIZE)
        ]
        chunk_results = await self._run_bounded(
            chunks, self._metadata_batch, READ_BATCH_CONCURRENCY
        )
        results = {
            file_id: outcome
            for chunk_result in chunk_results
            for file_id, outcome in chunk_result.items()
        }
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
                    "url": (
                        f"/me/drive/items/{quote(file_id, safe='')}"
                        f"?$select={DRIVE_ITEM_SELECT}"
                    ),
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
        try:
            return self._to_item(payload)
        except ProviderError as exc:
            raise RenameOutcomeUnknownError("Microsoft Graph returned incomplete write metadata") from exc

    async def rename_many(
        self, requests: list[RenameRequest]
    ) -> dict[str, FileItem | AppError]:
        chunks = [
            requests[offset : offset + MAX_BATCH_SIZE]
            for offset in range(0, len(requests), MAX_BATCH_SIZE)
        ]
        chunk_results = await self._run_bounded(
            chunks, self._rename_batch, WRITE_BATCH_CONCURRENCY
        )
        return {
            file_id: outcome
            for chunk_result in chunk_results
            for file_id, outcome in chunk_result.items()
        }

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
        try:
            payload = await self._request_json("POST", f"{GRAPH_ROOT}/$batch", json=body)
        except AppError as exc:
            return {**invalid, **{request.file_id: exc for request in valid}}
        raw_responses = payload.get("responses")
        if not isinstance(raw_responses, list):
            return {**invalid, **{request.file_id: RenameOutcomeUnknownError("Microsoft Graph returned an invalid write batch response") for request in valid}}

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
                results[request.file_id] = RenameOutcomeUnknownError(
                    "Microsoft Graph omitted a write response"
                )
                continue
            status = response.get("status")
            response_body = response.get("body")
            if not isinstance(status, int):
                results[request.file_id] = RenameOutcomeUnknownError(
                    "Microsoft Graph returned an invalid write response"
                )
            elif 200 <= status < 300:
                try:
                    if not isinstance(response_body, dict):
                        raise ProviderError("Missing write metadata")
                    results[request.file_id] = self._to_item(response_body)
                except ProviderError:
                    results[request.file_id] = RenameOutcomeUnknownError("Microsoft Graph returned incomplete write metadata")
            elif status >= 500:
                results[request.file_id] = RenameOutcomeUnknownError("Remote write outcome is unknown")
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
            try:
                if retry_auth:
                    await self.auth.access_token(force_refresh=True)
                results.update(await self._rename_batch(retry, attempt=attempt + 1))
            except AppError as exc:
                results.update({request.file_id: exc for request in retry})
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
        writing = method == "PATCH" or (method == "POST" and json is not None and any(
            request["method"] == "PATCH" for request in json["requests"]
        ))
        for attempt in range(MAX_RETRIES + 1):
            attempt_started = perf_counter()
            token = await self.auth.access_token(force_refresh=force_refresh)
            force_refresh = False
            try:
                response = await self._http_client().request(
                    method,
                    url,
                    headers={"Authorization": f"Bearer {token}"},
                    json=json,
                )
            except httpx.HTTPError as exc:
                logger.info(
                    "graph_request provider=onedrive request_id=%s method=%s attempt=%s status=transport_error duration_ms=%.2f",
                    request_id_context.get(), method, attempt + 1, (perf_counter() - attempt_started) * 1000,
                )
                if writing:
                    raise RenameOutcomeUnknownError("Remote write outcome is unknown; metadata must be checked") from exc
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(min(2**attempt, 8))
                    continue
                raise ProviderError("Microsoft Graph request failed") from exc

            logger.info(
                "graph_request provider=onedrive request_id=%s method=%s attempt=%s status=%s duration_ms=%.2f",
                request_id_context.get(), method, attempt + 1, response.status_code, (perf_counter() - attempt_started) * 1000,
            )
            if response.status_code == 401 and attempt < MAX_RETRIES:
                force_refresh = True
                continue
            if response.status_code >= 500 and writing:
                raise RenameOutcomeUnknownError("Remote write outcome is unknown; metadata must be checked")
            if self._is_retryable(response.status_code) and attempt < MAX_RETRIES:
                await asyncio.sleep(
                    self._retry_delay(response.headers.get("Retry-After"), attempt)
                )
                continue
            try:
                payload = response.json()
            except ValueError as exc:
                if writing:
                    raise RenameOutcomeUnknownError("Microsoft Graph returned an unreadable write response") from exc
                raise ProviderError("Microsoft Graph returned invalid data") from exc
            if not isinstance(payload, dict):
                if writing:
                    raise RenameOutcomeUnknownError("Microsoft Graph returned an unreadable write response")
                raise ProviderError("Microsoft Graph returned invalid data")
            if response.is_error:
                raise self._graph_error(response.status_code, payload)
            return payload
        raise ProviderError("Microsoft Graph request failed after retries")

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
    async def _run_bounded[InputT, ResultT](
        values: list[InputT],
        operation: Callable[[InputT], Awaitable[ResultT]],
        concurrency: int,
    ) -> list[ResultT]:
        semaphore = asyncio.Semaphore(concurrency)

        async def run(value: InputT) -> ResultT:
            async with semaphore:
                return await operation(value)

        return list(await asyncio.gather(*(run(value) for value in values)))

    @staticmethod
    def _to_item(payload: dict[str, object]) -> FileItem:
        item_id = payload.get("id")
        name = payload.get("name")
        if not isinstance(item_id, str) or not isinstance(name, str):
            raise ProviderError("Microsoft Graph returned incomplete file metadata")
        parent = OneDriveProvider._parent_path(payload.get("parentReference"))
        parent_reference = payload.get("parentReference")
        parent_id = parent_reference.get("id") if isinstance(parent_reference, dict) else None
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
            location=RootLocation() if "root" in payload else IdLocation(value=item_id),
            parent_location=IdLocation(value=parent_id) if isinstance(parent_id, str) and parent_id else None,
            can_rename=False if "root" in payload else None,
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
        if status == 403:
            return PermissionDeniedError(
                message or "OneDrive permission denied", details=details
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
