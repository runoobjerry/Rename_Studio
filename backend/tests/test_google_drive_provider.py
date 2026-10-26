import json
import re
from collections import Counter
from collections.abc import AsyncIterator, Callable
from email import policy
from email.parser import BytesParser
from urllib.parse import parse_qs, unquote, urlsplit
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from pydantic import BaseModel

from app.core.errors import AuthenticationError, NotFoundError, PermissionDeniedError, PreviewExpiredError, ProviderError, RateLimitError, RenameOutcomeUnknownError, ValidationError
from app.providers.base import RenameRequest
from app.providers.google_drive.driver import BATCH_URL, FOLDER_MIME, READ_BATCH_SIZE, SHORTCUT_MIME, GoogleDriveProvider
from app.rules.base import RenameRule, RuleContext
from app.rules.registry import RuleRegistry
from app.schemas.rename import RenamePreviewRequest, SingleRenameExecuteRequest
from app.schemas.rules import RuleSpec
from app.schemas.storage import AuthorizationStart, AuthorizationStatus, IdLocation, PathLocation, RootLocation
from app.services.execute_service import ExecuteService
from app.services.single_rename_service import SingleRenameService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine
from provider_fixtures import registry_for


class FakeAuth:
    def __init__(self) -> None:
        self.refreshes = 0

    def status(self) -> AuthorizationStatus:
        return AuthorizationStatus(configured=True, connected=True)

    def disconnect(self) -> None:
        raise AssertionError("A directory read must not disconnect the account")

    def start_authorization(self, redirect_uri: str | None = None) -> AuthorizationStart:
        raise AssertionError("A directory read must not start authorization")

    async def finish_authorization(self, code: str, state: str) -> None:
        raise AssertionError("A directory read must not finish authorization")

    async def access_token(self, *, force_refresh: bool = False) -> str:
        if force_refresh:
            self.refreshes += 1
        return f"fixture-access-{self.refreshes}"


def drive_file(file_id: str, name: str, parent: str | None = "root-id", mime: str = "text/plain", **changes: object) -> dict:
    return {
        "id": file_id, "name": name, "mimeType": mime,
        "parents": [parent] if parent is not None else [], "trashed": False,
        "capabilities": {"canRename": True, "canListChildren": mime == FOLDER_MIME}, **changes,
    }


ROOT = drive_file("root-id", "My Drive", parent=None, mime=FOLDER_MIME)


def file_page(files: list[dict] | None = None, **changes: object) -> httpx.Response:
    return httpx.Response(200, json={"kind": "drive#fileList", "files": files or [], **changes})


def batch_requests(request: httpx.Request) -> list[str]:
    assert request.method == "POST" and str(request.url) == BATCH_URL
    assert request.headers["Authorization"].startswith("Bearer fixture-access-")
    message = BytesParser(policy=policy.default).parsebytes(
        f'Content-Type: {request.headers["Content-Type"]}\r\n\r\n'.encode() + request.content
    )
    ids: list[str] = []
    for index, part in enumerate(message.iter_parts()):
        assert part.get("Content-ID") == str(index)
        raw = part.get_payload(decode=True)
        match = re.match(rb"GET (/drive/v3/files/[^\r\n ]+) HTTP/1.1\r\n", raw)
        assert match, "Metadata batches must contain only relative-path GET requests"
        url = urlsplit(match.group(1).decode())
        query = parse_qs(url.query)
        assert all(field in query["fields"][0] for field in ("id", "name", "mimeType", "parents", "trashed", "capabilities", "canRename"))
        assert query["supportsAllDrives"] == ["false"]
        ids.append(unquote(url.path.removeprefix("/drive/v3/files/")))
    assert len(ids) <= READ_BATCH_SIZE
    return ids


def batch_response(outcomes: list[tuple[int, int, dict]], *, reverse: bool = False) -> httpx.Response:
    parts = []
    for index, status, body in reversed(outcomes) if reverse else outcomes:
        parts.append(
            f"--test-boundary\r\nContent-Type: application/http\r\nContent-ID: <response-{index}>\r\n\r\n"
            f"HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nRetry-After: 0\r\n\r\n"
            f"{json.dumps(body)}\r\n"
        )
    return httpx.Response(200, headers={"Content-Type": "multipart/mixed; boundary=test-boundary"}, content="".join(parts) + "--test-boundary--\r\n")


class DriveServer:
    def __init__(self, files: list[dict] | None = None) -> None:
        self.files = {item["id"]: item for item in [ROOT, *(files or [])]}
        self.requests: list[httpx.Request] = []
        self.pages: dict[str | None, httpx.Response] = {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.url.host == "www.googleapis.com"
        if request.method == "POST":
            ids = batch_requests(request)
            return batch_response([(index, 200, self.files[file_id]) for index, file_id in enumerate(ids)], reverse=True)
        assert request.method == "GET"
        if request.url.path == "/drive/v3/files":
            assert request.url.params["corpora"] == "user"
            assert request.url.params["spaces"] == "drive"
            assert request.url.params["includeItemsFromAllDrives"] == "false"
            assert request.url.params["supportsAllDrives"] == "false"
            assert "trashed = false" in request.url.params["q"]
            return self.pages[request.url.params.get("pageToken")]
        file_id = unquote(request.url.path.removeprefix("/drive/v3/files/"))
        if file_id == "root":
            return httpx.Response(200, json=self.files["root-id"])
        if file_id not in self.files:
            return httpx.Response(404, json={"error": {"message": "not found"}})
        return httpx.Response(200, json=self.files[file_id])


class WritableDriveServer(DriveServer):
    def __init__(self, files: list[dict]) -> None:
        super().__init__(files)
        self.writes: list[list[tuple[str, str]]] = []
        self.reject_once: dict[str, int] = {}
        self.fail_targets: set[str] = set()

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method == "PATCH":
            self.requests.append(request)
            assert request.url.params["supportsAllDrives"] == "false"
            file_id = unquote(request.url.path.removeprefix("/drive/v3/files/"))
            data = json.loads(request.content)
            assert set(data) == {"name"}
            self.writes.append([(file_id, data["name"])])
            status = self.reject_once.pop(file_id, 200)
            if data["name"] in self.fail_targets:
                status = 403
            if status != 200:
                reason = "insufficientFilePermissions" if data["name"] in self.fail_targets else "rateLimitExceeded"
                return httpx.Response(status, json={"error": {"errors": [{"reason": reason}]}})
            self.files[file_id] = {**self.files[file_id], "name": data["name"], "modifiedTime": "2026-10-18T02:00:00Z"}
            return httpx.Response(200, json=self.files[file_id])
        if request.method == "GET" and request.url.path == "/drive/v3/files":
            parent = re.search(r"'([^']+)' in parents", request.url.params["q"])
            assert parent is not None
            self.pages[None] = file_page([item for item in self.files.values() if item["parents"] == [parent[1]]])
        if request.method != "POST" or b"\r\nPATCH " not in request.content:
            return super().__call__(request)
        self.requests.append(request)
        assert str(request.url) == BATCH_URL
        message = BytesParser(policy=policy.default).parsebytes(
            f'Content-Type: {request.headers["Content-Type"]}\r\n\r\n'.encode() + request.content
        )
        writes: list[tuple[str, str]] = []
        outcomes = []
        for index, part in enumerate(message.iter_parts()):
            assert part["Content-ID"] == str(index)
            head, _, body = part.get_payload(decode=True).partition(b"\r\n\r\n")
            method, url, _ = head.split(b"\r\n", 1)[0].decode().split(" ", 2)
            assert method == "PATCH" and url.startswith("/drive/v3/files/")
            parsed = urlsplit(url)
            assert set(parse_qs(parsed.query)) == {"fields", "supportsAllDrives"}
            assert parse_qs(parsed.query)["supportsAllDrives"] == ["false"]
            file_id = unquote(parsed.path.removeprefix("/drive/v3/files/"))
            data = json.loads(body)
            assert set(data) == {"name"}
            writes.append((file_id, data["name"]))
            status = self.reject_once.pop(file_id, 200)
            if data["name"] in self.fail_targets:
                status = 403
            if status == 200:
                self.files[file_id] = {**self.files[file_id], "name": data["name"], "modifiedTime": "2026-10-18T02:00:00Z"}
                result = self.files[file_id]
            else:
                reason = "insufficientFilePermissions" if data["name"] in self.fail_targets else "rateLimitExceeded"
                result = {"error": {"errors": [{"reason": reason}]}}
            outcomes.append((index, status, result))
        assert 0 < len(writes) <= 20
        self.writes.append(writes)
        return batch_response(outcomes, reverse=True)


@pytest_asyncio.fixture
async def provider_factory() -> AsyncIterator[Callable]:
    clients: list[httpx.AsyncClient] = []

    def create(handler: Callable, auth: FakeAuth | None = None) -> GoogleDriveProvider:
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        clients.append(client)
        return GoogleDriveProvider(auth or FakeAuth(), client=client)

    yield create
    for client in clients:
        await client.aclose()


@pytest.mark.asyncio
async def test_root_pagination_continues_empty_page_and_maps_types_permissions(provider_factory: Callable) -> None:
    folder = drive_file("folder", "same", mime=FOLDER_MIME, size="123")
    document = drive_file("doc", "Budget.2026", mime="application/vnd.google-apps.spreadsheet")
    shortcut = drive_file("shortcut", "Folder link", mime=SHORTCUT_MIME, shortcutDetails={"targetId": "outside", "targetMimeType": FOLDER_MIME})
    unknown = drive_file("unknown", "unknown.txt", capabilities={})
    readonly = drive_file("readonly", "readonly.txt", size="42", modifiedTime="2026-10-18T01:02:03Z", capabilities={"canRename": False})
    server = DriveServer()
    server.pages = {
        None: file_page([folder], nextPageToken="opaque/token?value=1"),
        "opaque/token?value=1": file_page([], nextPageToken="last"),
        "last": file_page([document, shortcut, readonly, unknown]),
    }
    listing = await provider_factory(server).list_directory(RootLocation())
    assert listing.location == RootLocation() and listing.parent_location is None and listing.path == ""
    assert [(entry.name, entry.location) for entry in listing.breadcrumbs] == [("My Drive", RootLocation())]
    by_id = {item.id: item for item in listing.items}
    assert len(by_id) == 5
    assert by_id["folder"].is_directory and by_id["folder"].size is None
    assert by_id["doc"].name == "Budget.2026" and by_id["doc"].size is None
    assert by_id["doc"].mime_type == "application/vnd.google-apps.spreadsheet"
    assert not by_id["shortcut"].is_directory and by_id["shortcut"].can_rename is False
    assert by_id["unknown"].can_rename is None
    assert by_id["readonly"].can_rename is False and by_id["readonly"].size == 42
    assert by_id["readonly"].modified_at.isoformat() == "2026-10-18T01:02:03+00:00"
    assert all(item.parent_location == RootLocation() for item in listing.items)
    assert all("outside" not in request.url.path for request in server.requests)


@pytest.mark.asyncio
async def test_same_name_folders_and_separator_names_use_real_ancestor_ids(provider_factory: Callable) -> None:
    first = drive_file("a", "same", mime=FOLDER_MIME)
    second = drive_file("b", "same", mime=FOLDER_MIME)
    child = drive_file("child", "with/slash", parent="b", mime=FOLDER_MIME)
    server = DriveServer([first, second, child])
    server.pages[None] = file_page([drive_file("file", "sample.txt", parent="child")])
    provider = provider_factory(server)
    listing = await provider.list_directory(IdLocation(value="child"))
    assert listing.path == "same/with/slash"
    assert listing.parent_location == IdLocation(value="b") and listing.location == IdLocation(value="child")
    assert [entry.name for entry in listing.breadcrumbs] == ["My Drive", "same", "with/slash"]
    assert [entry.location for entry in listing.breadcrumbs] == [RootLocation(), IdLocation(value="b"), IdLocation(value="child")]
    assert listing.items[0].parent_location == IdLocation(value="child")
    assert not any(request.url.path.endswith("/a") for request in server.requests)
    item = await provider.get_metadata("child")
    assert item.location == listing.location and item.parent_location == listing.parent_location
    root = await provider.get_metadata("root")
    assert root.location == RootLocation() and root.parent_location is None and root.can_rename is False
    child["capabilities"]["canListChildren"] = False
    with pytest.raises(PermissionDeniedError):
        await provider.list_directory(item.location)

@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["shared_drive", "outside_root", "trashed_item", "trashed_ancestor", "shortcut", "cycle"])
async def test_directory_boundary_rejects_unsupported_locations_before_listing(provider_factory: Callable, failure: str) -> None:
    folder = drive_file("folder", "Folder", mime=FOLDER_MIME)
    parent = drive_file("parent", "Parent", mime=FOLDER_MIME)
    if failure == "shared_drive":
        folder["driveId"] = "shared-drive-id"
    elif failure == "outside_root":
        folder["parents"] = []
    elif failure == "trashed_item":
        folder["trashed"] = True
    elif failure == "trashed_ancestor":
        folder["parents"] = ["parent"]
        parent["trashed"] = True
    elif failure == "shortcut":
        folder["mimeType"] = SHORTCUT_MIME
        folder["shortcutDetails"] = {"targetId": "root-id", "targetMimeType": FOLDER_MIME}
    else:
        folder["parents"] = ["parent"]
        parent["parents"] = ["folder"]
    server = DriveServer([folder, parent])
    with pytest.raises((ValidationError, NotFoundError, ProviderError)):
        await provider_factory(server).list_directory(IdLocation(value="folder"))
    assert not any(request.url.path == "/drive/v3/files" for request in server.requests)


@pytest.mark.asyncio
async def test_paths_are_rejected_without_network(provider_factory: Callable) -> None:
    def unexpected(request: httpx.Request) -> httpx.Response:
        raise AssertionError("Unsupported paths must not contact Google")

    provider = provider_factory(unexpected)
    for location in (PathLocation(value=""), PathLocation(value="same/child")):
        with pytest.raises(ValidationError):
            await provider.list_directory(location)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["incomplete", "repeated_token", "duplicate_item", "wrong_parent", "malformed_item", "malformed_page", "page_failed"])
async def test_listing_failure_never_returns_partial_directory(provider_factory: Callable, failure: str) -> None:
    file = drive_file("file", "file.txt")
    server = DriveServer()
    server.pages[None] = file_page([file], nextPageToken="next")
    if failure == "incomplete":
        final = file_page([], incompleteSearch=True)
    elif failure == "repeated_token":
        final = file_page([], nextPageToken="next")
    elif failure == "duplicate_item":
        final = file_page([file])
    elif failure == "wrong_parent":
        final = file_page([drive_file("other", "other.txt", parent="elsewhere")])
    elif failure == "malformed_item":
        final = file_page([{"id": "other", "name": "broken"}])
    elif failure == "malformed_page":
        final = httpx.Response(200, json={"unexpected": []})
    else:
        final = httpx.Response(400, json={"error": {"message": "invalid page token"}})
    server.pages["next"] = final
    with pytest.raises((ProviderError, ValidationError)):
        await provider_factory(server).list_directory(RootLocation())


@pytest.mark.asyncio
async def test_metadata_batches_keep_requested_order_and_reuse_batched_ancestors(provider_factory: Callable) -> None:
    left = drive_file("left", "same", mime=FOLDER_MIME)
    right = drive_file("right", "same", mime=FOLDER_MIME)
    files = [drive_file(str(index), f"file-{index}", parent="left" if index % 2 else "right") for index in range(READ_BATCH_SIZE + 1)]
    server = DriveServer([left, right, *files])
    requested = [str(index) for index in reversed(range(len(files)))]
    items = await provider_factory(server).get_metadata_many(requested)
    assert [item.id for item in items] == requested
    assert {item.parent_location.value for item in items} == {"left", "right"}
    batches = [batch_requests(request) for request in server.requests if request.method == "POST"]
    assert [len(ids) for ids in batches] == [READ_BATCH_SIZE, 1, 2]
    assert Counter(file_id for ids in batches for file_id in ids) == Counter([*requested, "left", "right"])


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["outside_root", "shared_drive", "trashed", "wrong_id", "nonfolder_parent"])
async def test_metadata_batches_cannot_bypass_my_drive_boundary(provider_factory: Callable, failure: str) -> None:
    first = drive_file("first", "first")
    second = drive_file("second", "second")
    if failure == "outside_root":
        second["parents"] = []
    elif failure == "shared_drive":
        second["driveId"] = "shared-drive"
    elif failure == "trashed":
        second["trashed"] = True
    elif failure == "wrong_id":
        second["id"] = "unexpected"
    else:
        second["parents"] = ["first"]
    server = DriveServer([first, second])

    def respond(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            batch_requests(request)
            return batch_response([(0, 200, first), (1, 200, second)])
        return server(request)

    with pytest.raises((ValidationError, NotFoundError, ProviderError)):
        await provider_factory(respond).get_metadata_many(["first", "second"])


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["not_multipart", "missing", "duplicate", "unexpected", "bad_http", "bad_json", "truncated"])
async def test_malformed_batch_never_returns_partial_metadata(provider_factory: Callable, failure: str) -> None:
    server = DriveServer()
    first, second = drive_file("first", "first"), drive_file("second", "second")

    def respond(request: httpx.Request) -> httpx.Response:
        if request.method != "POST":
            return server(request)
        batch_requests(request)
        if failure == "not_multipart":
            return httpx.Response(200, json={"files": [first, second]})
        outcomes = [(0, 200, first), (1, 200, second)]
        if failure == "missing":
            outcomes.pop()
        elif failure == "duplicate":
            outcomes[1] = (0, 200, second)
        elif failure == "unexpected":
            outcomes[1] = (2, 200, second)
        response = batch_response(outcomes)
        content = response.content
        if failure == "bad_http":
            content = content.replace(b"HTTP/1.1 200", b"INVALID 200", 1)
        elif failure == "bad_json":
            content = content.replace(json.dumps(first).encode(), b"not-json", 1)
        elif failure == "truncated":
            content = content.removesuffix(b"--test-boundary--\r\n")
        return httpx.Response(200, headers=response.headers, content=content)

    with pytest.raises(ProviderError):
        await provider_factory(respond).get_metadata_many(["first", "second"])


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403, 429, 503])
async def test_only_failed_metadata_parts_are_retried(provider_factory: Callable, status: int) -> None:
    first, second = drive_file("first", "first"), drive_file("second", "second")
    server = DriveServer([first, second])
    auth = FakeAuth()
    batches: list[list[str]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        if request.method != "POST":
            return server(request)
        ids = batch_requests(request)
        batches.append(ids)
        if len(batches) == 1:
            return batch_response([(0, 200, first), (1, status, {"error": {"errors": [{"reason": "userRateLimitExceeded"}]}})])
        return batch_response([(0, 200, second)])

    items = await provider_factory(respond, auth).get_metadata_many(["first", "second"])
    assert [item.id for item in items] == ["first", "second"]
    assert batches == [["first", "second"], ["second"]]
    assert auth.refreshes == (1 if status == 401 else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize(("status", "reason", "error_type"), [(401, "authError", AuthenticationError), (403, "insufficientFilePermissions", PermissionDeniedError), (403, "rateLimitExceeded", RateLimitError), (404, "notFound", NotFoundError), (429, "rateLimitExceeded", RateLimitError), (503, "backendError", ProviderError)])
async def test_read_errors_are_classified_and_retries_bounded(provider_factory: Callable, status: int, reason: str, error_type: type[Exception]) -> None:
    calls = 0
    auth = FakeAuth()

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status, headers={"Retry-After": "0"}, json={"error": {"message": "fixture-secret-must-not-echo", "errors": [{"reason": reason}]}})

    with pytest.raises(error_type) as caught:
        await provider_factory(respond, auth).list_directory(RootLocation())
    assert "fixture-secret-must-not-echo" not in str(caught.value)
    assert calls == (2 if status == 401 else 4 if status in (429, 503) or reason == "rateLimitExceeded" else 1)
    assert auth.refreshes == (1 if status == 401 else 0)


@pytest.mark.asyncio
async def test_ancestry_is_reloaded_after_external_move(provider_factory: Callable) -> None:
    folder = drive_file("folder", "Folder", mime=FOLDER_MIME)
    server = DriveServer([folder])
    server.pages[None] = file_page([])
    provider = provider_factory(server)
    assert (await provider.list_directory(IdLocation(value="folder"))).parent_location == RootLocation()
    folder["parents"] = []
    with pytest.raises(ValidationError):
        await provider.list_directory(IdLocation(value="folder"))


@pytest.mark.asyncio
async def test_name_policy_and_single_native_document_rename(provider_factory: Callable) -> None:
    mime = "application/vnd.google-apps.spreadsheet"
    server = WritableDriveServer([drive_file("doc/?", "Budget", parent="external-parent", mime=mime, driveId="shared-drive")])
    provider = provider_factory(server)
    for name in ("", " \t", "bad\x00name"):
        assert provider.validate_name(name) is not None
    for name in ("CON", "a/b\\c:*?", "trailing. ", "文" * 300):
        assert provider.validate_name(name) is None
        assert provider.normalize_name(name) == name
    assert provider.normalize_name("A") != provider.normalize_name("a")
    item = await provider.rename_single("doc/?", "预算/2026")
    assert item.id == "doc/?" and item.name == "预算/2026"
    assert item.location == IdLocation(value="doc/?") and item.parent_location == IdLocation(value="external-parent")
    assert item.mime_type == mime
    assert item.modified_at is not None
    assert server.writes == [[("doc/?", "预算/2026")]]
    assert [request.method for request in server.requests] == ["PATCH"]
    assert item.path is None and item.parent_path is None
    metadata = await provider.get_single_metadata(item.id)
    assert metadata == item
    assert [request.method for request in server.requests] == ["PATCH", "GET"]


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["transport", "503", "malformed", "wrong_id", "moved"])
async def test_single_patch_handles_response_without_replaying_writes(provider_factory: Callable, fault: str) -> None:
    server = WritableDriveServer([drive_file("a", "A")])

    def respond(request: httpx.Request) -> httpx.Response:
        response = server(request)
        if request.method != "PATCH":
            return response
        if fault == "transport":
            raise httpx.ReadTimeout("Response lost", request=request)
        if fault == "503":
            return httpx.Response(503)
        if fault == "malformed":
            return httpx.Response(200, text="Response lost")
        data = {**server.files["a"], **({"id": "other"} if fault == "wrong_id" else {"parents": ["elsewhere"]})}
        return httpx.Response(200, json=data)

    if fault == "moved":
        result = await provider_factory(respond).rename_single("a", "AA")
        assert result.name == "AA"
        assert result.parent_location == IdLocation(value="elsewhere")
        assert result.path is None
    else:
        with pytest.raises(RenameOutcomeUnknownError):
            await provider_factory(respond).rename_single("a", "AA")
    assert server.writes == [[("a", "AA")]]
    assert [request.method for request in server.requests] == ["PATCH"]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 429])
async def test_single_patch_retries_explicit_auth_and_throttle_refusals(provider_factory: Callable, status: int) -> None:
    server = WritableDriveServer([drive_file("a", "A")])
    server.reject_once["a"] = status
    auth = FakeAuth()
    result = await provider_factory(server, auth).rename_single("a", "AA")
    assert result.name == "AA"
    assert server.writes == [[("a", "AA")], [("a", "AA")]]
    assert auth.refreshes == (1 if status == 401 else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403, 429])
async def test_write_batch_retries_only_explicitly_refused_parts(provider_factory: Callable, status: int) -> None:
    server = WritableDriveServer([drive_file("a", "A"), drive_file("b", "B")])
    server.reject_once["b"] = status
    auth = FakeAuth()
    result = await provider_factory(server, auth).rename_many([RenameRequest("a", "AA"), RenameRequest("b", "BB")])
    assert result["a"].name == "AA" and result["b"].name == "BB"
    assert server.writes == [[("a", "AA"), ("b", "BB")], [("b", "BB")]]
    assert auth.refreshes == (1 if status == 401 else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize(("status", "error_type", "attempts"), [(401, AuthenticationError, 2), (429, RateLimitError, 4)])
async def test_write_part_retry_is_bounded(provider_factory: Callable, status: int, error_type: type[Exception], attempts: int) -> None:
    server = WritableDriveServer([drive_file("a", "A")])

    def respond(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and b"\r\nPATCH " in request.content:
            server.reject_once["a"] = status
        return server(request)

    result = await provider_factory(respond).rename_many([RenameRequest("a", "AA")])
    assert isinstance(result["a"], error_type)
    assert len(server.writes) == attempts
    assert server.files["a"]["name"] == "A"


@pytest.mark.asyncio
async def test_unknown_part_prevents_retry_of_other_refused_parts(provider_factory: Callable) -> None:
    server = WritableDriveServer([drive_file("a", "A"), drive_file("b", "B")])
    server.reject_once = {"a": 503, "b": 429}
    result = await provider_factory(server).rename_many([RenameRequest("a", "AA"), RenameRequest("b", "BB")])
    assert isinstance(result["a"], RenameOutcomeUnknownError)
    assert isinstance(result["b"], ProviderError)
    assert len(server.writes) == 1


@pytest.mark.asyncio
async def test_write_batches_keep_successes_and_permanent_failures(provider_factory: Callable) -> None:
    mimes = ["text/plain", FOLDER_MIME, "application/vnd.google-apps.document"]
    server = WritableDriveServer([drive_file(str(index), f"old-{index}", mime=mimes[index % len(mimes)]) for index in range(21)])
    server.fail_targets.add("new-1")
    result = await provider_factory(server).rename_many([RenameRequest(str(index), f"new-{index}") for index in range(21)])
    assert [len(batch) for batch in server.writes] == [20, 1]
    assert isinstance(result["1"], PermissionDeniedError)
    assert all(result[str(index)].name == f"new-{index}" for index in range(21) if index != 1)
    assert all(result[str(index)].mime_type == mimes[index % len(mimes)] for index in range(21) if index != 1)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["root", "shortcut", "readonly", "outside", "shared", "trashed"])
async def test_batch_write_preflight_enforces_scope_and_permissions(provider_factory: Callable, kind: str) -> None:
    item = drive_file("item", "Old")
    if kind == "shortcut":
        item["mimeType"] = SHORTCUT_MIME
    elif kind == "readonly":
        item["capabilities"] = {"canRename": False}
    elif kind == "outside":
        item["parents"] = []
    elif kind == "shared":
        item["driveId"] = "shared-drive"
    elif kind == "trashed":
        item["trashed"] = True
    server = WritableDriveServer([item])
    file_id = "root-id" if kind == "root" else "item"
    result = await provider_factory(server).rename_many([RenameRequest(file_id, "New")])
    assert isinstance(result[file_id], (ValidationError, PermissionDeniedError, NotFoundError))
    assert not server.writes


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["outer_503", "part_503", "malformed", "missing_part", "wrong_id", "moved"])
async def test_ambiguous_write_response_is_never_replayed(provider_factory: Callable, fault: str) -> None:
    server = WritableDriveServer([drive_file("a", "A"), drive_file("b", "B")])

    def respond(request: httpx.Request) -> httpx.Response:
        response = server(request)
        if request.method != "POST" or b"\r\nPATCH " not in request.content:
            return response
        if fault == "outer_503":
            return httpx.Response(503)
        if fault == "malformed":
            return httpx.Response(200, text="Response lost")
        if fault == "part_503":
            return batch_response([(0, 503, {}), (1, 200, server.files["b"])])
        if fault == "missing_part":
            return batch_response([(1, 200, server.files["b"])])
        data = {**server.files["a"], **({"id": "other"} if fault == "wrong_id" else {"parents": ["elsewhere"]})}
        return batch_response([(0, 200, data), (1, 200, server.files["b"])])

    result = await provider_factory(respond).rename_many([RenameRequest("a", "AA"), RenameRequest("b", "BB")])
    assert isinstance(result["a"], RenameOutcomeUnknownError)
    assert len(server.writes) == 1


@pytest.mark.asyncio
async def test_unexpected_returned_name_is_reported_as_actual_name(provider_factory: Callable) -> None:
    server = WritableDriveServer([drive_file("a", "A")])

    def respond(request: httpx.Request) -> httpx.Response:
        response = server(request)
        if request.method == "PATCH":
            server.files["a"]["name"] = "External"
            return httpx.Response(200, json=server.files["a"])
        return response

    provider = provider_factory(respond)
    result = await SingleRenameService(registry_for([provider])).execute(provider.id, SingleRenameExecuteRequest(
        operation_id=uuid4(), revision=1, file_id="a", original_name="A", target_name="AA",
    ))
    assert result.status == "failed"
    assert result.items[0].error_code == "PROVIDER_ERROR"
    assert result.items[0].actual_name == "External"
    assert len(server.writes) == 1


class MappingConfig(BaseModel):
    names: dict[str, str]


class MappingRule(RenameRule[MappingConfig]):
    type = "mapping"
    config_model = MappingConfig

    def apply(self, filename: str, context: RuleContext, config: MappingConfig) -> str:
        return config.names.get(filename, filename)


def rename_services(provider: GoogleDriveProvider) -> tuple[PreviewService, ExecuteService]:
    registry = registry_for([provider])
    rules = RuleRegistry()
    rules.register(MappingRule())
    preview = PreviewService(registry, RenameEngine(rules), PreviewStore())
    return preview, ExecuteService(registry, preview.store, preview)


def rename_request(provider: GoogleDriveProvider, ids: list[str], names: dict[str, str]) -> RenamePreviewRequest:
    return RenamePreviewRequest(storage_id=provider.id, location=RootLocation(), file_ids=ids,
                                rules=[RuleSpec(type="mapping", config={"names": names})])


@pytest.mark.asyncio
@pytest.mark.parametrize(("names", "valid"), [({}, True), ({"Old": "New"}, True), ({"Old": "Same"}, False), ({"Old": "same"}, True), ({"Same": "New", "Old": "New"}, False)])
async def test_preview_preserves_existing_duplicates_but_blocks_new_conflicts(provider_factory: Callable, names: dict[str, str], valid: bool) -> None:
    server = WritableDriveServer([drive_file("a", "Same"), drive_file("b", "Same"), drive_file("c", "Old")])
    provider = provider_factory(server)
    preview, execute = rename_services(provider)
    result = await preview.preview(rename_request(provider, ["a", "b", "c"], names))
    assert result.valid is valid
    assert not server.writes
    # 执行只保留一个代表场景，其余参数专门检查名称冲突策略。
    if names == {"Old": "New"}:
        executed = await execute.execute(result.preview_id)
        assert executed.status == "completed"
        assert all(item.status == "skipped" for item in executed.items[:2])
        assert server.files["a"]["name"] == server.files["b"]["name"] == "Same"
        assert server.files["c"]["name"] == "New"


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["swap", "rollback", "rollback_failed"])
async def test_dependency_execution_reports_final_or_rollback_names(provider_factory: Callable, outcome: str) -> None:
    server = WritableDriveServer([drive_file("a", "A"), drive_file("b", "B")])
    provider = provider_factory(server)
    preview, execute = rename_services(provider)
    names = {"A": "B", "B": "A" if outcome == "swap" else "C"}
    snapshot = await preview.preview(rename_request(provider, ["a", "b"], names))
    assert snapshot.valid and not server.writes
    if outcome != "swap":
        server.fail_targets = {"C", "A"} if outcome == "rollback_failed" else {"C"}
    result = await execute.execute(snapshot.preview_id)
    assert any(target not in {"A", "B", "C"} for batch in server.writes for _, target in batch)
    assert all(item.actual_name == server.files[item.file_id]["name"] for item in result.items if item.actual_name is not None)
    if outcome == "swap":
        assert result.status == "completed"
        assert [server.files[key]["name"] for key in ("a", "b")] == ["B", "A"]
        assert [item.actual_name for item in result.items] == ["B", "A"]
    else:
        assert result.status == "failed" and server.files["b"]["name"] == "B"
        restored = next(item for item in result.items if item.file_id == "a")
        if outcome == "rollback":
            assert restored.actual_name == "A"
        else:
            assert "rollback failed" in restored.error
            assert restored.actual_name not in {"A", "B", "C"}


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["permission", "occupied"])
async def test_execute_revalidates_google_snapshot_before_any_write(provider_factory: Callable, change: str) -> None:
    server = WritableDriveServer([drive_file("a", "A")])
    provider = provider_factory(server)
    preview, execute = rename_services(provider)
    snapshot = await preview.preview(rename_request(provider, ["a"], {"A": "B"}))
    if change == "permission":
        server.files["a"]["capabilities"]["canRename"] = False
    else:
        server.files["other"] = drive_file("other", "B")
    with pytest.raises(PreviewExpiredError):
        await execute.execute(snapshot.preview_id)
    assert not server.writes


@pytest.mark.asyncio
@pytest.mark.parametrize("unreadable", [False, True])
async def test_engine_reconciles_lost_google_write_without_replay(provider_factory: Callable, unreadable: bool) -> None:
    server = WritableDriveServer([drive_file(str(index), f"old-{index}") for index in range(21)])

    def respond(request: httpx.Request) -> httpx.Response:
        if unreadable and server.writes:
            return httpx.Response(503, headers={"Retry-After": "0"})
        response = server(request)
        if len(server.writes) == 1 and request.method == "POST" and b"\r\nPATCH " in request.content:
            raise httpx.ReadTimeout("Response lost after commit", request=request)
        return response

    provider = provider_factory(respond)
    preview, execute = rename_services(provider)
    names = {f"old-{index}": f"new-{index}" for index in range(21)}
    snapshot = await preview.preview(rename_request(provider, [str(index) for index in range(21)], names))
    result = await execute.execute(snapshot.preview_id)
    counts = Counter(file_id for batch in server.writes for file_id, _ in batch)
    assert all(count == 1 for count in counts.values())
    if unreadable:
        assert len(server.writes) == 1 and result.status != "completed"
        assert all(item.error_code == "RENAME_OUTCOME_UNKNOWN" and item.actual_name is None for item in result.items[:20])
        assert server.files["20"]["name"] == "old-20"
    else:
        assert result.status == "completed" and [len(batch) for batch in server.writes] == [20, 1]
    assert execute.progress(snapshot.preview_id).processed == 21
