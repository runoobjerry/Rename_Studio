import asyncio
import logging
from time import perf_counter
from collections.abc import Awaitable, Callable
from datetime import datetime
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
from app.providers.errors import http_error_details, read_error_payload
from app.providers.retry import RetryBudget
from app.providers.base import RenameRequest, StorageProvider
from app.providers.directory_metadata import DirectoryHint, DirectoryMetadata, DirectoryMetadataConflict
from app.providers.cooldown import ConnectionCooldown, retry_after_delay
from app.providers.name_validation import NameValidationIssue, validate_onedrive_name
from app.schemas.files import DirectoryBreadcrumb, DirectoryListing, FileItem
from app.schemas.storage import IdLocation, PathLocation, RootLocation, StorageLocation
from app.services.connection_auth import ConnectionAuth


logger = logging.getLogger("rename_studio.onedrive_performance")


GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
MAX_BATCH_SIZE = 20
READ_BATCH_CONCURRENCY = 3
WRITE_BATCH_CONCURRENCY = 2
DRIVE_ITEM_SELECT = "id,name,parentReference,folder,root,size,lastModifiedDateTime"


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
        self._cooldown = ConnectionCooldown()

    async def list_directory(self, location: StorageLocation) -> DirectoryListing:
        return await self.read_directory(location)

    async def read_directory(
        self, location: StorageLocation, *,
        hint: DirectoryHint | None = None, include_breadcrumbs: bool = True,
    ) -> DirectoryListing:
        if isinstance(location, PathLocation):
            raise ValidationError("OneDrive directories must be addressed by ID")
        if hint is not None:
            folder = hint.folder
            breadcrumbs = hint.breadcrumbs(folder.name)
            items = await self._children(folder.id)
            self._check_directory_items(items, {crumb.location for crumb in breadcrumbs} | {IdLocation(value=hint.parent_id)})
            parent_path = folder.parent_path or "/".join(quote(crumb.name, safe="") for crumb in hint.parent_breadcrumbs[1:])
            return DirectoryListing(
                provider=self.id, path="/".join(filter(None, (parent_path, folder.name))),
                parent_path=parent_path, location=location, directory_id=folder.id,
                drive_id=hint.drive_id, parent_location=hint.parent_location, items=items, breadcrumbs=breadcrumbs,
            )

        root = await self._read_root()
        directory = root
        if isinstance(location, IdLocation) and location.value != root.id:
            directory = await self._load_folder(location.value)

        items = await self._children(directory.id)
        canonical = RootLocation() if directory.id == root.id else IdLocation(value=directory.id)
        parent = (None if directory.parent_id is None else RootLocation() if directory.parent_id == root.id
                  else IdLocation(value=directory.parent_id))
        display_parent = directory.parent_path
        breadcrumbs = None
        if include_breadcrumbs:
            chain = await self._directory_chain(directory, root)
            self._check_directory_items(items, {IdLocation(value=folder.id) for folder in chain})
            breadcrumbs = [
                DirectoryBreadcrumb(name=folder.name, location=RootLocation() if folder.id == root.id else IdLocation(value=folder.id))
                for folder in chain
            ]
            if not display_parent:
                display_parent = "/".join(quote(folder.name, safe="") for folder in chain[1:-1])
        path = "" if parent is None else f"{display_parent}/{directory.name}".strip("/")
        return DirectoryListing(provider=self.id, path=path, parent_path=None if parent is None else display_parent,
                                location=canonical, directory_id=directory.id, drive_id=root.drive_id,
                                parent_location=parent, items=items, breadcrumbs=breadcrumbs)

    async def _read_root(self) -> DirectoryMetadata:
        payload = await self._request_json("GET", f"{GRAPH_ROOT}/me/drive/root")
        item = self._to_item(payload)
        if not item.is_directory:
            raise ValidationError("Selected location is not a directory")
        parent_reference = payload.get("parentReference")
        drive_id = parent_reference.get("driveId") if isinstance(parent_reference, dict) else None
        return DirectoryMetadata(item.id, item.name, None, drive_id=drive_id if isinstance(drive_id, str) and drive_id else None)

    async def _load_folder(self, directory_id: str, *, ancestor: bool = False) -> DirectoryMetadata:
        item = await self.get_metadata(directory_id)
        if item.id != directory_id or isinstance(item.location, RootLocation):
            raise DirectoryMetadataConflict("Microsoft Graph returned invalid directory identity")
        if not item.is_directory:
            if ancestor:
                raise DirectoryMetadataConflict("Microsoft Graph returned a non-directory ancestor")
            raise ValidationError("Selected location is not a directory")
        parent = item.parent_location
        if not isinstance(parent, IdLocation) or parent.value == directory_id:
            raise DirectoryMetadataConflict("Microsoft Graph returned an invalid parent directory ID")
        return DirectoryMetadata(item.id, item.name, parent.value, parent_path=item.parent_path)

    async def _directory_chain(self, directory: DirectoryMetadata, root: DirectoryMetadata) -> list[DirectoryMetadata]:
        chain = [directory]
        seen = {directory.id}
        while (parent_id := chain[-1].parent_id) is not None:
            if parent_id in seen:
                raise DirectoryMetadataConflict("Microsoft Graph returned a cycle in the directory ancestors")
            seen.add(parent_id)
            chain.append(root if parent_id == root.id else await self._load_folder(parent_id, ancestor=True))
        return list(reversed(chain))

    async def _children(self, directory_id: str) -> list[FileItem]:
        items = await self._list_url(f"{GRAPH_ROOT}/me/drive/items/{quote(directory_id, safe='')}/children")
        parent = IdLocation(value=directory_id)
        for item in items:
            if item.id == directory_id or (item.parent_location is not None and item.parent_location != parent):
                raise DirectoryMetadataConflict("Microsoft Graph returned an item outside the requested directory")
            item.parent_location = parent
        return items

    @staticmethod
    def _check_directory_items(items: list[FileItem], ancestors: set[StorageLocation]) -> None:
        if any(IdLocation(value=item.id) in ancestors or isinstance(item.location, RootLocation) for item in items):
            raise DirectoryMetadataConflict("Microsoft Graph returned inconsistent directory ancestry")

    async def list_files(self, path: str) -> list[FileItem]:
        if path:
            raise ValidationError("OneDrive directories must be addressed by ID")
        return await self._list_url(f"{GRAPH_ROOT}/me/drive/root/children")

    async def _list_url(self, url: str) -> list[FileItem]:
        url = f"{url}?$select={DRIVE_ITEM_SELECT}&$top=200"

        items: list[FileItem] = []
        visited: set[str] = set()
        page = 0
        while url:
            parsed = urlsplit(url)
            if parsed.scheme != "https" or parsed.netloc != "graph.microsoft.com" or not parsed.path.startswith("/v1.0/") or url in visited:
                raise DirectoryMetadataConflict("Microsoft Graph returned an invalid pagination link")
            visited.add(url)
            page += 1
            page_started = perf_counter()
            payload = await self._request_json("GET", url)
            raw_items = payload.get("value")
            if not isinstance(raw_items, list):
                raise DirectoryMetadataConflict(
                    "Microsoft Graph returned an invalid directory listing"
                )
            if any(not isinstance(item, dict) for item in raw_items):
                raise DirectoryMetadataConflict("Microsoft Graph returned an invalid directory item")
            items.extend(self._to_item(item) for item in raw_items)
            logger.info(
                "directory_page provider=onedrive request_id=%s page=%s item_count=%s duration_ms=%.2f",
                request_id_context.get(), page, len(raw_items), (perf_counter() - page_started) * 1000,
            )
            next_link = payload.get("@odata.nextLink")
            if next_link is not None and (not isinstance(next_link, str) or not next_link):
                raise DirectoryMetadataConflict("Microsoft Graph returned an invalid pagination link")
            url = next_link if isinstance(next_link, str) else ""
        if len({item.id for item in items}) != len(items):
            raise DirectoryMetadataConflict("Microsoft Graph returned duplicate directory IDs; refresh the directory")
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
        budget: RetryBudget | None = None,
    ) -> dict[str, FileItem | AppError]:
        budget = budget if budget is not None else RetryBudget()
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
        payload = await self._request_json("POST", f"{GRAPH_ROOT}/$batch", json=body, budget=budget)
        raw_responses = payload.get("responses")
        if not isinstance(raw_responses, list):
            raise ProviderError("Microsoft Graph returned an invalid batch response")
        attempt = budget.used - 1
        self._record_batch_throttle(raw_responses, attempt)
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
            elif self._is_retryable(status) and budget.available:
                retry.append(file_id)
                if status != 429:
                    headers = response.get("headers")
                    value = httpx.Headers(headers).get("Retry-After") if isinstance(headers, dict) else None
                    retry_after = max(retry_after, self._retry_delay(value, attempt))
            elif status == 401 and budget.available:
                retry.append(file_id)
                retry_auth = True
                retry_after = max(retry_after, min(2**attempt, 8))
            else:
                results[file_id] = self._graph_error(status, response_body)
        if retry:
            if retry_after:
                await asyncio.sleep(retry_after)
            if retry_auth:
                await self.auth.access_token(force_refresh=True)
            results.update(await self._metadata_batch(retry, budget=budget))
        return results

    async def rename(self, file_id: str, new_name: str) -> FileItem:
        validation_error = self.validate_name(new_name)
        if validation_error is not None:
            raise ValidationError(validation_error.message, details={"new_name": new_name, **validation_error.details})
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
        budget: RetryBudget | None = None,
    ) -> dict[str, FileItem | AppError]:
        budget = budget if budget is not None else RetryBudget()
        invalid: dict[str, FileItem | AppError] = {}
        valid: list[RenameRequest] = []
        for request in requests:
            error = self.validate_name(request.new_name)
            if error is None:
                valid.append(request)
            else:
                invalid[request.file_id] = ValidationError(
                    error.message, details={"new_name": request.new_name, **error.details}
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
            payload = await self._request_json("POST", f"{GRAPH_ROOT}/$batch", json=body, budget=budget)
        except AppError as exc:
            return {**invalid, **{request.file_id: exc for request in valid}}
        raw_responses = payload.get("responses")
        if not isinstance(raw_responses, list):
            return {**invalid, **{request.file_id: RenameOutcomeUnknownError("Microsoft Graph returned an invalid write batch response") for request in valid}}

        attempt = budget.used - 1
        self._record_batch_throttle(raw_responses, attempt)
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
                    current = self._to_item(response_body)
                    results[request.file_id] = current if current.name == request.new_name else ProviderError(
                        "Rename target was not reached; current name was verified",
                        details={"actual_name": current.name},
                    )
                except ProviderError:
                    results[request.file_id] = RenameOutcomeUnknownError("Microsoft Graph returned incomplete write metadata")
            elif status == 408 or status >= 500:
                results[request.file_id] = RenameOutcomeUnknownError("Remote write outcome is unknown", details=self._graph_error(status, response_body).details)
            elif status == 429 and budget.available:
                results[request.file_id] = self._graph_error(status, response_body)
                retry.append(request)
            elif status == 401 and budget.available:
                results[request.file_id] = self._graph_error(status, response_body)
                retry.append(request)
                retry_auth = True
                retry_after = max(retry_after, min(2**attempt, 8))
            else:
                results[request.file_id] = self._graph_error(status, response_body)

        if retry and not any(isinstance(outcome, RenameOutcomeUnknownError) for outcome in results.values()):
            # An uncertain part goes to reconciliation before any more writes are sent.
            # Graph 批处理需单独重试被限流的子请求，而不是重放已成功的项目。
            if retry_after:
                await asyncio.sleep(retry_after)
            try:
                if retry_auth:
                    await self.auth.access_token(force_refresh=True)
                results.update(await self._rename_batch(retry, budget=budget))
            except AppError as exc:
                results.update({request.file_id: exc for request in retry})
        return results

    def validate_name(self, name: str) -> NameValidationIssue | None:
        # OneDrive 同样会同步到 Windows，本阶段沿用更严格的跨平台文件名规则。
        return validate_onedrive_name(name)

    def validate_target_name(self, item: FileItem, name: str) -> NameValidationIssue | None:
        error = self.validate_name(name)
        if error is not None:
            return error
        reserved_root_name = "forms"
        if item.parent_path == "" and name.casefold() == reserved_root_name:
            return NameValidationIssue("NAME_RESERVED_IN_ROOT", "'forms' is reserved at the OneDrive root", {"name": reserved_root_name})
        invalid_folder_prefixes = ("゛", "ဧ")
        if item.is_directory and name.startswith(invalid_folder_prefixes):
            return NameValidationIssue("ONEDRIVE_FOLDER_INVALID_PREFIX", "OneDrive folder name starts with a restricted character", {"prefixes": list(invalid_folder_prefixes)})
        decoded_path = f"{item.parent_path}/{name}".strip("/")
        max_path_length = 400
        if len(decoded_path) > max_path_length:
            return NameValidationIssue("ONEDRIVE_PATH_TOO_LONG", f"OneDrive path is longer than {max_path_length} characters", {"max_length": max_path_length})
        return None

    async def _request_json(
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
                logger.info(
                    "graph_request provider=onedrive request_id=%s method=%s attempt=%s status=transport_error duration_ms=%.2f",
                    request_id_context.get(), method, attempt + 1, (perf_counter() - attempt_started) * 1000,
                )
                if writing:
                    raise RenameOutcomeUnknownError("Remote write outcome is unknown; metadata must be checked", details={"provider_type": "onedrive"}) from exc
                if budget.available:
                    await asyncio.sleep(min(2**attempt, 8))
                    continue
                raise ProviderError("Microsoft Graph request failed", details={"provider_type": "onedrive"}) from exc

            logger.info(
                "graph_request provider=onedrive request_id=%s method=%s attempt=%s status=%s duration_ms=%.2f",
                request_id_context.get(), method, attempt + 1, response.status_code, (perf_counter() - attempt_started) * 1000,
            )
            if response.status_code == 429:
                self._cooldown.defer(self._retry_delay(response.headers.get("Retry-After"), attempt))
                if budget.available:
                    continue
                raise self._graph_error(429, read_error_payload(response))
            if response.status_code == 401 and budget.available:
                force_refresh = True
                continue
            if writing and (response.status_code == 408 or response.status_code >= 500):
                raise RenameOutcomeUnknownError("Remote write outcome is unknown; metadata must be checked", details=self._graph_error(response.status_code, read_error_payload(response)).details)
            if self._is_retryable(response.status_code) and budget.available:
                await asyncio.sleep(
                    self._retry_delay(response.headers.get("Retry-After"), attempt)
                )
                continue
            if response.is_error:
                raise self._graph_error(response.status_code, read_error_payload(response))
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
        if not isinstance(item_id, str) or not item_id or not isinstance(name, str):
            raise DirectoryMetadataConflict("Microsoft Graph returned incomplete file metadata")
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

    def _record_batch_throttle(self, responses: list[object], attempt: int) -> None:
        for response in responses:
            if isinstance(response, dict) and response.get("status") == 429:
                headers = response.get("headers")
                value = httpx.Headers(headers).get("Retry-After") if isinstance(headers, dict) else None
                self._cooldown.defer(self._retry_delay(value, attempt))

    @staticmethod
    def _retry_delay(value: str | None, attempt: int) -> float:
        return retry_after_delay(value, min(2**attempt, 8))

    @staticmethod
    def _graph_error(status: int, payload: object) -> AppError:
        return _map_graph_error(status, _extract_graph_codes(payload))
