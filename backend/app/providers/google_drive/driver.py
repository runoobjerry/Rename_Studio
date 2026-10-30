import asyncio
import json
import logging
import random
from datetime import datetime
from email import policy
from email.parser import BytesParser
from time import perf_counter
from typing import Literal
from urllib.parse import quote, urlencode
from uuid import uuid4

import httpx
from pydantic import BaseModel, Field, ValidationError as ModelValidationError

from app.core.errors import AppError, AuthenticationError, NotFoundError, PermissionDeniedError, ProviderError, RateLimitError, RenameConflictError, RenameOutcomeUnknownError, ValidationError
from app.core.log_context import request_id_context
from app.providers.base import RenameRequest, StorageProvider
from app.providers.cooldown import ConnectionCooldown, retry_after_delay
from app.schemas.files import DirectoryBreadcrumb, DirectoryListing, FileItem, RenameFile
from app.schemas.storage import IdLocation, PathLocation, RootLocation, StorageLocation
from app.services.connection_auth import ConnectionAuth


DRIVE_ROOT = "https://www.googleapis.com/drive/v3"
BATCH_URL = "https://www.googleapis.com/batch/drive/v3"
FOLDER_MIME = "application/vnd.google-apps.folder"
SHORTCUT_MIME = "application/vnd.google-apps.shortcut"
FILE_FIELDS = "id,name,mimeType,parents,trashed,driveId,size,modifiedTime,capabilities(canRename,canListChildren)"
READ_BATCH_SIZE = 100
MAX_RETRIES = 3
RATE_REASONS = {"rateLimitExceeded", "userRateLimitExceeded"}
logger = logging.getLogger("rename_studio.google_drive")


class _Capabilities(BaseModel):
    canRename: bool | None = None
    canListChildren: bool | None = None


class _DriveFile(BaseModel):
    id: str = Field(min_length=1)
    name: str
    mimeType: str = Field(min_length=1)
    parents: list[str] = Field(default_factory=list)
    trashed: bool
    driveId: str | None = None
    size: int | None = Field(default=None, ge=0)
    modifiedTime: datetime | None = None
    capabilities: _Capabilities = Field(default_factory=_Capabilities)


class _FilePage(BaseModel):
    kind: Literal["drive#fileList"]
    files: list[_DriveFile] = Field(default_factory=list)
    nextPageToken: str | None = Field(default=None, min_length=1)
    incompleteSearch: bool = False


class _ErrorReason(BaseModel):
    reason: str


class _GoogleError(BaseModel):
    errors: list[_ErrorReason] = Field(default_factory=list)


class _ErrorResponse(BaseModel):
    error: _GoogleError


class GoogleDriveProvider(StorageProvider):
    id = "google_drive"

    def __init__(self, auth: ConnectionAuth, *, timeout: float = 30.0, client: httpx.AsyncClient | None = None) -> None:
        self.auth = auth
        self.timeout = timeout
        self._client = client
        self._owns_client = client is None
        self._cooldown = ConnectionCooldown()

    async def list_directory(self, location: StorageLocation) -> DirectoryListing:
        if isinstance(location, PathLocation):
            raise ValidationError("Google Drive directories must be addressed by ID")
        root, cache = await self._root_context()
        directory_id = root.id if isinstance(location, RootLocation) else location.value
        await self._load_files([directory_id], cache)
        directory = cache[directory_id]
        self._require_folder(directory)
        await self._load_ancestors([directory], root, cache)
        chain = self._chain(directory, root, cache)
        if directory.capabilities.canListChildren is False:
            raise PermissionDeniedError("Google Drive does not permit listing this folder")

        items: list[FileItem] = []
        seen_ids: set[str] = set()
        seen_tokens: set[str] = set()
        escaped_id = directory.id.replace("\\", "\\\\").replace("'", "\\'")
        params = {
            "q": f"'{escaped_id}' in parents and trashed = false",
            "spaces": "drive", "corpora": "user", "pageSize": "1000",
            "includeItemsFromAllDrives": "false", "supportsAllDrives": "false",
            "fields": f"kind,nextPageToken,incompleteSearch,files({FILE_FIELDS})",
        }
        while True:
            response = await self._request("GET", f"{DRIVE_ROOT}/files", params=params)
            try:
                page = _FilePage.model_validate_json(response.content)
            except ModelValidationError:
                raise ProviderError("Google Drive returned an invalid directory listing") from None
            if page.incompleteSearch:
                raise ProviderError("Google Drive returned an incomplete directory; refresh before continuing")
            for item in page.files:
                self._require_available(item)
                if item.parents != [directory.id] or item.id in seen_ids:
                    raise ProviderError("Google Drive directory changed or contains invalid items; refresh it")
                seen_ids.add(item.id)
                items.append(self._to_item([*chain, item]))
            token = page.nextPageToken
            if token is None:
                break
            if token in seen_tokens:
                raise ProviderError("Google Drive returned a repeated page token")
            seen_tokens.add(token)
            # Tokens remain opaque query values; never follow them as URLs or stop at an empty page.
            params["pageToken"] = token

        return DirectoryListing(
            provider=self.id, path=self._display_path(chain),
            parent_path=self._display_path(chain[:-1]) if len(chain) > 1 else None,
            location=self._location(directory, root),
            directory_id=directory.id,
            parent_location=self._location(chain[-2], root) if len(chain) > 1 else None,
            breadcrumbs=[DirectoryBreadcrumb(name=item.name, location=self._location(item, root)) for item in chain],
            items=sorted(items, key=lambda item: (not item.is_directory, item.name.casefold(), item.name, item.id)),
        )

    async def list_files(self, path: str) -> list[FileItem]:
        if path:
            raise ValidationError("Google Drive directories must be addressed by ID")
        return (await self.list_directory(RootLocation())).items

    async def get_metadata(self, file_id: str) -> FileItem:
        return (await self.get_metadata_many([file_id]))[0]

    async def get_metadata_many(self, file_ids: list[str]) -> list[FileItem]:
        if not file_ids:
            return []
        root, cache = await self._root_context()
        await self._load_files(file_ids, cache)
        sources = [cache[file_id] for file_id in file_ids]
        await self._load_ancestors(sources, root, cache)
        return [self._to_item(self._chain(item, root, cache)) for item in sources]

    async def _root_context(self) -> tuple[_DriveFile, dict[str, _DriveFile]]:
        root = await self._get_file("root")
        self._require_available(root)
        self._require_folder(root)
        if root.parents:
            raise ProviderError("Google Drive returned an invalid My Drive root")
        # Scope/ancestry metadata is reused within this read only, not across external moves or account changes.
        return root, {"root": root, root.id: root}

    async def _load_files(self, file_ids: list[str], cache: dict[str, _DriveFile]) -> None:
        missing = list(dict.fromkeys(file_id for file_id in file_ids if file_id not in cache))
        if len(missing) == 1:
            cache[missing[0]] = await self._get_file(missing[0])
            return
        # One batch at a time bounds both HTTP requests and Google's inner metadata calls.
        for offset in range(0, len(missing), READ_BATCH_SIZE):
            cache.update(await self._metadata_batch(missing[offset:offset + READ_BATCH_SIZE]))

    async def _load_ancestors(self, items: list[_DriveFile], root: _DriveFile, cache: dict[str, _DriveFile]) -> None:
        pending = items
        visited: set[str] = set()
        while pending:
            parents: list[str] = []
            for item in pending:
                self._require_available(item)
                visited.add(item.id)
                if item.id != root.id:
                    if len(item.parents) != 1 or not item.parents[0]:
                        raise ValidationError("The item is outside My Drive")
                    parents.append(item.parents[0])
            await self._load_files(parents, cache)
            for parent_id in dict.fromkeys(parents):
                self._require_folder(cache[parent_id])
            pending = [cache[parent_id] for parent_id in dict.fromkeys(parents) if parent_id not in visited]

    @staticmethod
    def _chain(item: _DriveFile, root: _DriveFile, cache: dict[str, _DriveFile]) -> list[_DriveFile]:
        chain = [item]
        seen = {item.id}
        while chain[-1].id != root.id:
            parent = cache[chain[-1].parents[0]]
            if parent.id in seen:
                raise ProviderError("Google Drive folder ancestry changed; refresh before continuing")
            seen.add(parent.id)
            chain.append(parent)
        return list(reversed(chain))

    @staticmethod
    def _require_available(item: _DriveFile) -> None:
        if item.trashed:
            raise NotFoundError("The Google Drive item is in the trash")
        if item.driveId is not None:
            raise ValidationError("Only My Drive items are supported")

    @staticmethod
    def _require_folder(item: _DriveFile) -> None:
        if item.mimeType != FOLDER_MIME:
            raise ValidationError("The Google Drive location is not a regular folder")

    @staticmethod
    def _location(item: _DriveFile, root: _DriveFile) -> StorageLocation:
        return RootLocation() if item.id == root.id else IdLocation(value=item.id)

    @staticmethod
    def _display_path(chain: list[_DriveFile]) -> str:
        return "/".join(item.name for item in chain[1:])

    @classmethod
    def _to_item(cls, chain: list[_DriveFile]) -> FileItem:
        item, root = chain[-1], chain[0]
        is_directory = item.mimeType == FOLDER_MIME
        return FileItem(
            id=item.id, name=item.name, path=cls._display_path(chain),
            parent_path=cls._display_path(chain[:-1]), is_directory=is_directory,
            size=None if is_directory else item.size, modified_at=item.modifiedTime,
            location=cls._location(item, root),
            parent_location=cls._location(chain[-2], root) if len(chain) > 1 else None,
            can_rename=False if len(chain) == 1 or item.mimeType == SHORTCUT_MIME else item.capabilities.canRename,
            mime_type=item.mimeType,
        )

    async def _get_file(self, file_id: str) -> _DriveFile:
        response = await self._request("GET", f"{DRIVE_ROOT}/files/{quote(file_id, safe='')}", params={"fields": FILE_FIELDS, "supportsAllDrives": "false"})
        return self._parse_file(response, file_id)

    @staticmethod
    def _parse_file(response: httpx.Response, expected_id: str) -> _DriveFile:
        try:
            item = _DriveFile.model_validate_json(response.content)
        except ModelValidationError:
            raise ProviderError("Google Drive returned invalid file metadata") from None
        if expected_id != "root" and item.id != expected_id:
            raise ProviderError("Google Drive returned metadata for a different file")
        return item

    async def _metadata_batch(self, file_ids: list[str]) -> dict[str, _DriveFile]:
        pending = file_ids
        results: dict[str, _DriveFile] = {}
        refreshed = False
        attempt = 0
        while True:
            boundary = f"rename-studio-{uuid4().hex}"
            parts: list[str] = []
            query = urlencode({"fields": FILE_FIELDS, "supportsAllDrives": "false"})
            for index, file_id in enumerate(pending):
                parts.append(
                    f"--{boundary}\r\nContent-Type: application/http\r\nContent-ID: {index}\r\n\r\n"
                    f"GET /drive/v3/files/{quote(file_id, safe='')}?{query} HTTP/1.1\r\n\r\n"
                )
            content = ("".join(parts) + f"--{boundary}--\r\n").encode("utf-8")
            response = await self._request("POST", BATCH_URL, content=content, headers={"Content-Type": f"multipart/mixed; boundary={boundary}"})
            responses = self._batch_responses(response, len(pending))
            # Classify all failures before processing can stop on another item.
            errors = {
                index: self._classify_error(outcome, attempt)
                for index, outcome in enumerate(responses) if not outcome.is_success
            }
            retry: list[str] = []
            retry_delay = 0.0
            refresh = False
            for index, (file_id, outcome) in enumerate(zip(pending, responses, strict=True)):
                if outcome.is_success:
                    results[file_id] = self._parse_file(outcome, file_id)
                    continue
                error = errors[index]
                if outcome.status_code == 401 and not refreshed and attempt < MAX_RETRIES:
                    refresh = True
                elif self._retryable(outcome, error) and attempt < MAX_RETRIES:
                    if not isinstance(error, RateLimitError):
                        retry_delay = max(retry_delay, self._retry_delay(outcome, attempt))
                else:
                    raise error
                retry.append(file_id)
            if not retry:
                return results
            if refresh:
                await self.auth.access_token(force_refresh=True)
                refreshed = True
            if retry_delay:
                await asyncio.sleep(retry_delay)
            pending = retry
            attempt += 1

    @staticmethod
    def _batch_responses(response: httpx.Response, count: int) -> list[httpx.Response]:
        content_type = response.headers.get("Content-Type", "")
        try:
            message = BytesParser(policy=policy.default).parsebytes(
                f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii") + response.content
            )
        except UnicodeEncodeError:
            raise ProviderError("Google Drive returned an invalid metadata content type") from None
        if message.get_content_type() != "multipart/mixed" or not message.is_multipart() or message.defects:
            raise ProviderError("Google Drive returned an invalid metadata batch")
        outcomes: dict[str, httpx.Response] = {}
        expected_ids = {f"response-{index}" for index in range(count)}
        for part in message.iter_parts():
            content_id = str(part.get("Content-ID", "")).strip().removeprefix("<").removesuffix(">")
            if content_id not in expected_ids or content_id in outcomes:
                raise ProviderError("Google Drive returned invalid metadata batch IDs")
            raw = part.get_payload(decode=True)
            if part.get_content_type() != "application/http" or not isinstance(raw, bytes) or part.defects:
                raise ProviderError("Google Drive returned an invalid metadata batch part")
            head, separator, body = raw.partition(b"\r\n\r\n")
            status_line, _, header_bytes = head.partition(b"\r\n")
            status = status_line.split(b" ", 2)
            if not separator or len(status) < 2 or not status[0].startswith(b"HTTP/1.") or len(status[1]) != 3 or not status[1].isdigit():
                raise ProviderError("Google Drive returned an invalid metadata HTTP response")
            headers = BytesParser(policy=policy.default).parsebytes(header_bytes + b"\r\n\r\n")
            outcomes[content_id] = httpx.Response(int(status[1]), headers=list(headers.items()), content=body)
        if len(outcomes) != count:
            raise ProviderError("Google Drive omitted a metadata batch response")
        return [outcomes[f"response-{index}"] for index in range(count)]

    async def _request(self, method: str, url: str, *, params: dict[str, str] | None = None, content: bytes | None = None, headers: dict[str, str] | None = None, writing: bool = False) -> httpx.Response:
        refreshed = False
        attempt = 0
        while True:
            await self._cooldown.wait()
            token = await self.auth.access_token()
            # Token refresh can yield while another response extends the cooldown.
            await self._cooldown.wait()
            started = perf_counter()
            try:
                response = await self._http_client().request(method, url, params=params, content=content, headers={**(headers or {}), "Authorization": f"Bearer {token}"})
            except httpx.HTTPError as exc:
                logger.info("drive_request provider=google_drive request_id=%s method=%s writing=%s status=transport_error duration_ms=%.2f", request_id_context.get(), method, writing, (perf_counter() - started) * 1000)
                if writing:
                    raise RenameOutcomeUnknownError("Google Drive write outcome is unknown; verify metadata before continuing") from exc
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(min(2**attempt + random.random(), 8))
                    attempt += 1
                    continue
                raise ProviderError("Google Drive is unavailable") from exc
            logger.info("drive_request provider=google_drive request_id=%s method=%s writing=%s status=%s duration_ms=%.2f", request_id_context.get(), method, writing, response.status_code, (perf_counter() - started) * 1000)
            if response.is_success:
                return response
            if writing and response.status_code >= 500:
                raise RenameOutcomeUnknownError("Google Drive write outcome is unknown; verify metadata before continuing")
            error = self._classify_error(response, attempt)
            if response.status_code == 401 and not refreshed and attempt < MAX_RETRIES:
                await self.auth.access_token(force_refresh=True)
                refreshed = True
                attempt += 1
                continue
            # Read batches can be replayed; write batches only retry explicit auth/throttle refusals.
            if self._retryable(response, error) and attempt < MAX_RETRIES:
                if not isinstance(error, RateLimitError):
                    await asyncio.sleep(self._retry_delay(response, attempt))
                attempt += 1
                continue
            raise error

    @staticmethod
    def _response_error(response: httpx.Response) -> AppError:
        details = {"google_status": response.status_code}
        if response.status_code == 401:
            return AuthenticationError("Google Drive authorization was rejected; reconnect the account", details=details)
        if response.status_code == 404:
            return NotFoundError("Google Drive item is missing or inaccessible", details=details)
        if response.status_code == 429:
            return RateLimitError("Google Drive rate limit reached", details=details)
        if response.status_code == 403:
            try:
                payload = _ErrorResponse.model_validate_json(response.content)
            except ModelValidationError:
                return ProviderError("Google Drive returned an invalid error response", details=details)
            if any(error.reason in RATE_REASONS for error in payload.error.errors):
                return RateLimitError("Google Drive rate limit reached", details=details)
            return PermissionDeniedError("Google Drive permission denied", details=details)
        if response.status_code == 400:
            return ValidationError("Google Drive rejected the request; refresh before continuing", details=details)
        if response.status_code in (409, 412):
            return RenameConflictError("Google Drive rejected the rename because the file changed", details=details)
        return ProviderError("Google Drive request failed", details=details)

    @staticmethod
    def _retryable(response: httpx.Response, error: AppError) -> bool:
        return isinstance(error, RateLimitError) or response.status_code >= 500

    def _classify_error(self, response: httpx.Response, attempt: int) -> AppError:
        """Classify once and record throttling before the caller handles the error."""
        error = self._response_error(response)
        if isinstance(error, RateLimitError):
            self._cooldown.defer(self._retry_delay(response, attempt))
        return error

    @staticmethod
    def _retry_delay(response: httpx.Response, attempt: int) -> float:
        return retry_after_delay(response.headers.get("Retry-After"), min(2**attempt + random.random(), 8))

    def _http_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()

    async def rename(self, file_id: str, new_name: str) -> FileItem:
        outcome = (await self.rename_many([RenameRequest(file_id, new_name)]))[file_id]
        if isinstance(outcome, AppError):
            raise outcome
        return outcome

    @staticmethod
    def _to_rename_file(item: _DriveFile) -> RenameFile:
        # Identity and confirmed metadata do not require resolving ancestor names.
        is_directory = item.mimeType == FOLDER_MIME
        return RenameFile(
            id=item.id, name=item.name, is_directory=is_directory,
            size=None if is_directory else item.size, modified_at=item.modifiedTime,
            location=IdLocation(value=item.id),
            parent_location=IdLocation(value=item.parents[0]) if item.parents else None,
            can_rename=item.capabilities.canRename, mime_type=item.mimeType,
        )

    async def get_single_metadata(self, file_id: str) -> RenameFile:
        return self._to_rename_file(await self._get_file(file_id))

    async def rename_single(self, file_id: str, new_name: str) -> RenameFile:
        response = await self._request(
            "PATCH", f"{DRIVE_ROOT}/files/{quote(file_id, safe='')}",
            params={"fields": FILE_FIELDS, "supportsAllDrives": "false"},
            content=json.dumps({"name": new_name}, ensure_ascii=True).encode("utf-8"),
            headers={"Content-Type": "application/json"}, writing=True,
        )
        try:
            current = self._parse_file(response, file_id)
        except ProviderError as exc:
            raise RenameOutcomeUnknownError("Google Drive returned invalid write metadata") from exc
        return self._to_rename_file(current)

    async def rename_many(self, requests: list[RenameRequest]) -> dict[str, FileItem | AppError]:
        results: dict[str, FileItem | AppError] = {}
        for offset in range(0, len(requests), self.execution_batch_size):
            batch = requests[offset:offset + self.execution_batch_size]
            outcomes = await self._rename_batch(batch)
            results.update(outcomes)
            if any(isinstance(outcome, RenameOutcomeUnknownError) for outcome in outcomes.values()):
                for request in requests[offset + len(batch):]:
                    results[request.file_id] = ProviderError("Rename was not attempted after an unknown write outcome")
                break
        return results

    async def _rename_batch(self, requests: list[RenameRequest]) -> dict[str, FileItem | AppError]:
        results: dict[str, FileItem | AppError] = {}
        try:
            root, cache = await self._root_context()
            await self._load_files([request.file_id for request in requests], cache)
            sources = {request.file_id: cache[request.file_id] for request in requests}
            await self._load_ancestors(list(sources.values()), root, cache)
        except AppError as exc:
            return {request.file_id: exc for request in requests}

        pending: list[RenameRequest] = []
        for request in requests:
            source = self._to_item(self._chain(sources[request.file_id], root, cache))
            error = self.validate_target_name(source, request.new_name)
            if error is not None:
                results[request.file_id] = ValidationError(error)
            elif source.can_rename is False:
                results[request.file_id] = PermissionDeniedError("This Google Drive item cannot be renamed")
            else:
                pending.append(request)

        refreshed = False
        attempt = 0
        while pending:
            boundary = f"rename-studio-{uuid4().hex}"
            query = urlencode({"fields": FILE_FIELDS, "supportsAllDrives": "false"})
            parts: list[str] = []
            for index, request in enumerate(pending):
                body = json.dumps({"name": request.new_name}, ensure_ascii=True)
                parts.append(
                    f"--{boundary}\r\nContent-Type: application/http\r\nContent-ID: {index}\r\n\r\n"
                    f"PATCH /drive/v3/files/{quote(request.file_id, safe='')}?{query} HTTP/1.1\r\n"
                    f"Content-Type: application/json\r\n\r\n{body}\r\n"
                )
            content = ("".join(parts) + f"--{boundary}--\r\n").encode("utf-8")
            try:
                response = await self._request("POST", BATCH_URL, content=content, headers={"Content-Type": f"multipart/mixed; boundary={boundary}"}, writing=True)
            except AppError as exc:
                results.update({request.file_id: exc for request in pending})
                break
            try:
                responses = self._batch_responses(response, len(pending))
            except ProviderError:
                # An incomplete envelope can include committed writes. Reconcile by ID, never replay it.
                results.update({request.file_id: RenameOutcomeUnknownError("Google Drive returned an incomplete write batch response") for request in pending})
                break

            # Classify all failures before processing can stop on another item.
            errors = {
                index: self._classify_error(outcome, attempt)
                for index, outcome in enumerate(responses) if not outcome.is_success
            }
            retry: list[RenameRequest] = []
            refresh = False
            for index, (request, outcome) in enumerate(zip(pending, responses, strict=True)):
                if outcome.is_success:
                    try:
                        current = self._parse_file(outcome, request.file_id)
                    except ProviderError:
                        results[request.file_id] = RenameOutcomeUnknownError("Google Drive returned invalid write metadata")
                        continue
                    source = sources[request.file_id]
                    if current.parents != source.parents or current.mimeType != source.mimeType or current.trashed or current.driveId is not None:
                        results[request.file_id] = RenameOutcomeUnknownError("Google Drive item changed location or type during the write")
                    elif current.name != request.new_name:
                        results[request.file_id] = ProviderError("Google Drive did not confirm the requested name", details={"actual_name": current.name})
                    else:
                        cache[current.id] = current
                        results[request.file_id] = self._to_item(self._chain(current, root, cache))
                    continue
                if outcome.status_code >= 500:
                    results[request.file_id] = RenameOutcomeUnknownError("Google Drive write outcome is unknown")
                    continue
                error = errors[index]
                if outcome.status_code == 401 and not refreshed and attempt < MAX_RETRIES:
                    refresh = True
                elif not (isinstance(error, RateLimitError) and attempt < MAX_RETRIES):
                    results[request.file_id] = error
                    continue
                retry.append(request)
            if any(isinstance(outcome, RenameOutcomeUnknownError) for outcome in results.values()):
                for request in retry:
                    results[request.file_id] = ProviderError("Rename retry was not attempted after an unknown write outcome")
                break
            if refresh:
                try:
                    await self.auth.access_token(force_refresh=True)
                except AppError as exc:
                    results.update({request.file_id: exc for request in retry})
                    break
                refreshed = True
            pending = retry
            attempt += 1
        return results

    def validate_name(self, name: str) -> str | None:
        # Application policy for metadata titles; do not impose Windows names or a guessed length limit.
        if not name.strip():
            return "Google Drive name cannot be empty"
        if "\x00" in name:
            return "Google Drive name cannot contain a null character"
        return None

    def validate_target_name(self, item: FileItem, name: str) -> str | None:
        if isinstance(item.location, RootLocation):
            return "The My Drive root cannot be renamed"
        if item.mime_type == SHORTCUT_MIME:
            return "Google Drive shortcuts cannot be renamed by this application"
        return self.validate_name(name)

    def normalize_name(self, name: str) -> str:
        return name
