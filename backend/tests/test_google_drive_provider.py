import json
import re
from collections import Counter
from collections.abc import AsyncIterator, Callable
from email import policy
from email.parser import BytesParser
from urllib.parse import parse_qs, unquote, urlsplit

import httpx
import pytest
import pytest_asyncio

from app.core.errors import AuthenticationError, NotFoundError, PermissionDeniedError, ProviderError, RateLimitError, ValidationError
from app.providers.base import RenameRequest
from app.providers.google_drive import BATCH_URL, FOLDER_MIME, READ_BATCH_SIZE, SHORTCUT_MIME, GoogleDriveProvider
from app.schemas.storage import AuthorizationStart, AuthorizationStatus, IdLocation, PathLocation, RootLocation


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
    readonly = drive_file("readonly", "readonly.txt", size="42", modifiedTime="2026-10-18T01:02:03Z", capabilities={"canRename": False})
    server = DriveServer()
    server.pages = {
        None: file_page([folder], nextPageToken="opaque/token?value=1"),
        "opaque/token?value=1": file_page([], nextPageToken="last"),
        "last": file_page([document, shortcut, readonly]),
    }
    listing = await provider_factory(server).list_directory(RootLocation())
    assert listing.location == RootLocation() and listing.parent_location is None and listing.path == ""
    assert [(entry.name, entry.location) for entry in listing.breadcrumbs] == [("My Drive", RootLocation())]
    by_id = {item.id: item for item in listing.items}
    assert len(by_id) == 4
    assert by_id["folder"].is_directory and by_id["folder"].size is None
    assert by_id["doc"].name == "Budget.2026" and by_id["doc"].size is None
    assert by_id["doc"].mime_type == "application/vnd.google-apps.spreadsheet"
    assert not by_id["shortcut"].is_directory and by_id["shortcut"].can_rename is False
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
    listing = await provider_factory(server).list_directory(IdLocation(value="child"))
    assert listing.path == "same/with/slash"
    assert listing.parent_location == IdLocation(value="b") and listing.location == IdLocation(value="child")
    assert [entry.name for entry in listing.breadcrumbs] == ["My Drive", "same", "with/slash"]
    assert [entry.location for entry in listing.breadcrumbs] == [RootLocation(), IdLocation(value="b"), IdLocation(value="child")]
    assert listing.items[0].parent_location == IdLocation(value="child")
    assert not any(request.url.path.endswith("/a") for request in server.requests)


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
async def test_paths_and_writes_are_rejected_without_network(provider_factory: Callable) -> None:
    def unexpected(request: httpx.Request) -> httpx.Response:
        raise AssertionError("Unsupported path/write must not contact Google")

    provider = provider_factory(unexpected)
    for location in (PathLocation(value=""), PathLocation(value="same/child")):
        with pytest.raises(ValidationError):
            await provider.list_directory(location)
    with pytest.raises(ValidationError):
        await provider.rename("file", "renamed")
    with pytest.raises(ValidationError):
        await provider.rename_many([RenameRequest("file", "renamed")])


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
async def test_single_metadata_and_siblings_use_same_canonical_root_parent(provider_factory: Callable) -> None:
    server = DriveServer([drive_file("file", "file.txt")])
    server.pages[None] = file_page([server.files["file"]])
    provider = provider_factory(server)
    item = await provider.get_metadata("file")
    assert item.parent_location == RootLocation() and item.location == IdLocation(value="file")
    assert provider.parent_key(item) == provider.parent_key((await provider.list_siblings(item))[0])
    root = await provider.get_metadata("root")
    assert root.location == RootLocation() and root.can_rename is False and root.parent_location is None
    assert not any(request.method == "POST" for request in server.requests)


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
async def test_listing_permission_denied_locally_and_unknown_rename_permission_preserved(provider_factory: Callable) -> None:
    folder = drive_file("folder", "Folder", mime=FOLDER_MIME, capabilities={"canListChildren": False})
    server = DriveServer([folder])
    provider = provider_factory(server)
    with pytest.raises(PermissionDeniedError):
        await provider.list_directory(IdLocation(value="folder"))
    folder["capabilities"] = {"canListChildren": True}
    server.pages[None] = file_page([drive_file("unknown", "unknown.txt", parent="folder", capabilities={})])
    assert (await provider.list_directory(IdLocation(value="folder"))).items[0].can_rename is None
