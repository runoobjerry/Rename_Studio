import asyncio
import base64
import hashlib
import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import dependencies, storage_router
from app.core.config import Settings
from app.core.errors import AuthenticationError, ProviderError, RateLimitError, StorageBusyError, StorageConnectionChangedError
from app.main import create_app
from app.rules.registry import RuleRegistry
from app.rules.text_operations import ReplaceRule
from app.schemas.storage import AppSettingsPatch, StorageCreate, StorageUpdate
from app.providers.google_drive.auth import ABOUT_URL, SCOPE, TOKEN_URL, GoogleDriveAuthService
from app.providers.onedrive.auth import GRAPH_ME_URL, TOKEN_URL as ONEDRIVE_TOKEN_URL, OneDriveAuthService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.execute_service import ExecuteService
from app.services.rename_engine import RenameEngine
from app.services.storage_manager import StorageManager


REDIRECT_URI = "http://localhost:8000/auth/storage/callback"
CLIENT_SECRET = "fixture-client-secret"
ASYNC_CLIENT = httpx.AsyncClient


@pytest.fixture
def manager(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> StorageManager:
    settings = Settings(
        _env_file=None, local_storage_root=tmp_path / "files",
        storage_state_file=tmp_path / "settings.json", storage_redirect_uri=REDIRECT_URI,
    )
    monkeypatch.setattr(dependencies, "get_settings", lambda: settings)
    monkeypatch.setattr(storage_router, "get_settings", lambda: settings)
    # Use production registrations, but do not initialize the cached user-state singleton.
    return dependencies.get_storage_manager.__wrapped__()


def google_connection(manager: StorageManager, client_id: str = "fixture-client") -> tuple[str, GoogleDriveAuthService]:
    info = manager.create(StorageCreate(
        provider_type="google_drive", name="Google account", config={"client_id": client_id},
        client_secret=CLIENT_SECRET,
    ))
    return info.storage_id, cast(GoogleDriveAuthService, manager.auth(info.storage_id))


def mock_google(monkeypatch: pytest.MonkeyPatch, handler: Callable) -> None:
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: ASYNC_CLIENT(transport=transport, **kwargs))


def tokens(**changes: object) -> dict[str, object]:
    return {"access_token": "fixture-access", "refresh_token": "fixture-refresh", "expires_in": 3600, "scope": SCOPE, **changes}


def google_response(request: httpx.Request) -> httpx.Response:
    if str(request.url) == TOKEN_URL:
        return httpx.Response(200, json=tokens())
    assert str(request.url).startswith(ABOUT_URL)
    return httpx.Response(200, json={"user": {"permissionId": "account-a", "displayName": "Test User", "emailAddress": "test@example.com"}})


async def authorize(auth: GoogleDriveAuthService) -> None:
    state = parse_qs(urlsplit(auth.start_authorization().authorization_url).query)["state"][0]
    await auth.finish_authorization("fixture-code", state)


def api(manager: StorageManager) -> TestClient:
    app = create_app()
    app.dependency_overrides[dependencies.get_storage_manager] = lambda: manager
    rules = RuleRegistry()
    rules.register(ReplaceRule())
    preview = PreviewService(manager.registry, RenameEngine(rules), PreviewStore())
    app.dependency_overrides[dependencies.get_preview_service] = lambda: preview
    app.dependency_overrides[dependencies.get_preview_store] = lambda: preview.store
    execute = ExecuteService(manager.registry, preview.store, preview)
    app.dependency_overrides[dependencies.get_execute_service] = lambda: execute
    return TestClient(app)


def test_connection_api_separates_secret_and_advertises_rename_capability(manager: StorageManager) -> None:
    with api(manager) as client:
        definitions = client.get("/storage-providers").json()
        assert [item["provider_type"] for item in definitions] == ["local", "onedrive", "google_drive"]
        definition = next(item for item in definitions if item["provider_type"] == "google_drive")
        assert definition["browser_auth"] and definition["can_rename"]
        assert definition["locations"] == ["root", "id"]
        assert "client_secret" not in definition["config_schema"]["properties"]
        response = client.post("/storages", json={
            "provider_type": "google_drive", "name": "Google", "config": {"client_id": "fixture-client"},
            "client_secret": CLIENT_SECRET,
        })
        assert response.status_code == 201
        info = response.json()
        storage_id = info["storage_id"]
        assert info["config"] == {"client_id": "fixture-client"}
        assert info["has_client_secret"] and "credentials" not in info
        assert CLIENT_SECRET not in response.text
        assert CLIENT_SECRET not in client.get("/storages").text
        status = client.get(f"/storages/{storage_id}/auth/status").json()
        assert status["configured"] and not status["connected"]
        assert client.post(f"/storages/{storage_id}/files/list", json={}).status_code == 401
        assert client.post(f"/storages/{storage_id}/rename/preview", json={"file_ids": ["file-id"]}).status_code == 401
        assert manager.record(storage_id).credentials == {"client_secret": CLIENT_SECRET}


@pytest.mark.parametrize("invalid", [
    {"client_secret": {"unexpected": CLIENT_SECRET}},
    {"client_secret": f" {CLIENT_SECRET} ", "name": []},
    {"credentials": {"refresh_token": CLIENT_SECRET}},
    {"client_secret": " "},
    {"config": {"client_id": "fixture-client", "client_secret": CLIENT_SECRET}},
])
def test_storage_validation_never_echoes_secret_bearing_input(manager: StorageManager, invalid: dict) -> None:
    storage_id, _ = google_connection(manager)
    body = {"provider_type": "google_drive", "name": "Google", "config": {"client_id": "fixture-client"}, **invalid}
    with api(manager) as client:
        for method, url, payload in (
            ("POST", "/storages", body),
            ("PUT", f"/storages/{storage_id}", {key: value for key, value in body.items() if key != "provider_type"}),
        ):
            response = client.request(method, url, json=payload)
            assert response.status_code == 422
            assert CLIENT_SECRET not in response.text


@pytest.mark.parametrize(("config", "secret"), [({"client_id": "fixture-client"}, None), ({}, CLIENT_SECRET)])
def test_both_client_credentials_are_required_to_start(manager: StorageManager, config: dict, secret: str | None) -> None:
    info = manager.create(StorageCreate(provider_type="google_drive", name="Draft", config=config, client_secret=secret))
    with api(manager) as client:
        assert not client.get(f"/storages/{info.storage_id}/auth/status").json()["configured"]
        assert client.post(f"/storages/{info.storage_id}/auth/start").status_code == 422


def test_callback_verifies_pkce_identity_and_commits_without_access_token(manager: StorageManager, monkeypatch: pytest.MonkeyPatch) -> None:
    storage_id, auth = google_connection(manager)
    query: dict[str, list[str]] = {}

    def respond(request: httpx.Request) -> httpx.Response:
        assert not auth.status().connected
        assert manager.record(storage_id).credentials == {"client_secret": CLIENT_SECRET}
        if str(request.url) == TOKEN_URL:
            form = parse_qs(request.content.decode())
            assert form["client_id"] == ["fixture-client"]
            assert form["client_secret"] == [CLIENT_SECRET]
            assert form["redirect_uri"] == [REDIRECT_URI]
            assert form["code"] == ["fixture-code"]
            challenge = base64.urlsafe_b64encode(hashlib.sha256(form["code_verifier"][0].encode()).digest()).rstrip(b"=").decode()
            assert query["code_challenge"] == [challenge]
        else:
            assert request.headers["Authorization"] == "Bearer fixture-access"
            assert request.url.params["fields"] == "user(permissionId,displayName,emailAddress)"
        return google_response(request)

    mock_google(monkeypatch, respond)
    with api(manager) as client:
        started = client.post(f"/storages/{storage_id}/auth/start").json()
        query.update(parse_qs(urlsplit(started["authorization_url"]).query))
        assert CLIENT_SECRET not in started["authorization_url"]
        assert query["scope"] == [SCOPE]
        assert query["access_type"] == ["offline"]
        assert query["code_challenge_method"] == ["S256"]
        assert query["prompt"] == ["consent select_account"]
        response = client.get("/auth/storage/callback", params={"state": query["state"][0], "code": "fixture-code"})
        assert response.status_code == 200
        assert CLIENT_SECRET not in response.text and "fixture-access" not in response.text
        assert client.get("/auth/storage/callback", params={"state": query["state"][0], "code": "fixture-code"}).status_code == 400
        status = client.get(f"/storages/{storage_id}/auth/status").json()
        assert status["connected"] and status["account_id"] == "account-a"
        assert status["account_email"] == "test@example.com"
    saved = json.loads(manager.repository.path.read_text(encoding="utf-8"))
    assert "fixture-access" not in json.dumps(saved)
    assert saved["connections"][storage_id]["credentials"]["refresh_token"] == "fixture-refresh"


@pytest.mark.parametrize("failure", ["wrong_state", "expired", "cancelled"])
def test_invalid_callback_never_commits_account(manager: StorageManager, failure: str) -> None:
    storage_id, auth = google_connection(manager)
    with api(manager) as client:
        started = client.post(f"/storages/{storage_id}/auth/start").json()
        state = parse_qs(urlsplit(started["authorization_url"]).query)["state"][0]
        params = {"state": state, "code": "fixture-code"}
        if failure == "wrong_state":
            params["state"] = "unrelated-state"
        elif failure == "expired":
            session = manager.authorization_sessions[state]
            manager.authorization_sessions[state] = (*session[:3], datetime.now(UTC) - timedelta(seconds=1))
        else:
            params["error"] = "access_denied"
        assert client.get("/auth/storage/callback", params=params).status_code == 400
    assert not auth.status().connected
    assert manager.record(storage_id).credentials == {"client_secret": CLIENT_SECRET}


@pytest.mark.asyncio
@pytest.mark.parametrize("existing_account", [False, True])
@pytest.mark.parametrize(("failure", "error_type"), [
    ("no_scope", AuthenticationError), ("wrong_scope", AuthenticationError),
    ("no_refresh", ProviderError), ("no_identity", ProviderError),
    ("denied_identity", AuthenticationError), ("invalid_client", AuthenticationError),
    ("token_throttled", RateLimitError), ("token_unavailable", ProviderError),
    ("invalid_token_data", ProviderError), ("profile_throttled", RateLimitError),
    ("profile_unavailable", ProviderError), ("profile_timeout", ProviderError),
])
async def test_incomplete_or_rejected_grant_is_never_connected(
    manager: StorageManager, monkeypatch: pytest.MonkeyPatch, failure: str,
    error_type: type[Exception], existing_account: bool,
) -> None:
    storage_id, auth = google_connection(manager)
    if existing_account:
        mock_google(monkeypatch, google_response)
        await authorize(auth)
    before = manager.record(storage_id).model_copy(deep=True)
    saved = manager.repository.path.read_bytes()
    calls: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        calls.append(request.method)
        if str(request.url) == TOKEN_URL:
            if failure == "invalid_client":
                return httpx.Response(400, json={"error": "invalid_client", "error_description": CLIENT_SECRET})
            if failure == "token_throttled":
                return httpx.Response(429, text=CLIENT_SECRET)
            if failure == "token_unavailable":
                return httpx.Response(503, text=CLIENT_SECRET)
            if failure == "invalid_token_data":
                return httpx.Response(200, text=CLIENT_SECRET)
            return httpx.Response(200, json=tokens(
                scope=None if failure == "no_scope" else SCOPE + ".readonly" if failure == "wrong_scope" else SCOPE,
                refresh_token=None if failure == "no_refresh" else "fixture-refresh",
            ))
        if failure == "no_identity":
            return httpx.Response(200, json={"user": {"displayName": "Test User"}})
        if failure == "denied_identity":
            return httpx.Response(403, json={"error": {"message": CLIENT_SECRET}})
        if failure == "profile_throttled":
            return httpx.Response(429, text=CLIENT_SECRET)
        if failure == "profile_unavailable":
            return httpx.Response(503, text=CLIENT_SECRET)
        if failure == "profile_timeout":
            raise httpx.ReadTimeout(CLIENT_SECRET, request=request)
        return google_response(request)

    mock_google(monkeypatch, respond)
    with pytest.raises(error_type) as caught:
        await authorize(auth)
    assert CLIENT_SECRET not in str(caught.value)
    assert auth.status().connected is existing_account
    assert auth.status().account_id == ("account-a" if existing_account else None)
    assert manager.record(storage_id) == before
    assert manager.repository.path.read_bytes() == saved
    profile_failures = {"no_identity", "denied_identity", "profile_throttled", "profile_unavailable", "profile_timeout"}
    assert calls == (["POST", "GET"] if failure in profile_failures else ["POST"])


@pytest.mark.asyncio
@pytest.mark.parametrize("rotate", [False, True])
async def test_restart_refresh_retains_or_rotates_refresh_token_without_changing_revision(manager: StorageManager, monkeypatch: pytest.MonkeyPatch, rotate: bool) -> None:
    storage_id, auth = google_connection(manager)
    mock_google(monkeypatch, google_response)
    await authorize(auth)
    revision = manager.record(storage_id).revision
    restarted = dependencies.get_storage_manager.__wrapped__()
    restored = cast(GoogleDriveAuthService, restarted.auth(storage_id))
    assert restored.status().connected and restored.status().account_id == "account-a"
    calls = 0

    async def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        assert str(request.url) == TOKEN_URL
        form = parse_qs(request.content.decode())
        assert form["grant_type"] == ["refresh_token"]
        assert form["refresh_token"] == ["fixture-refresh"]
        assert form["client_id"] == ["fixture-client"] and form["client_secret"] == [CLIENT_SECRET]
        calls += 1
        await asyncio.sleep(0)
        # Google need not return scope or another refresh token on refresh.
        payload = {"access_token": "refreshed-access", "expires_in": 3600}
        if rotate:
            payload["refresh_token"] = "rotated-refresh"
        return httpx.Response(200, json=payload)

    mock_google(monkeypatch, respond)
    assert await asyncio.gather(restored.access_token(), restored.access_token()) == ["refreshed-access"] * 2
    assert calls == 1
    record = restarted.record(storage_id)
    assert record.revision == revision
    assert record.credentials["refresh_token"] == ("rotated-refresh" if rotate else "fixture-refresh")
    assert record.credentials["client_secret"] == CLIENT_SECRET
    assert "refreshed-access" not in restarted.repository.path.read_text(encoding="utf-8")


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_type", ["onedrive", "google_drive"])
@pytest.mark.parametrize(("failure", "error_type", "connected"), [
    ("scope", AuthenticationError, False),
    (400, AuthenticationError, False), (401, AuthenticationError, False), (403, AuthenticationError, False),
    (429, RateLimitError, True), (503, ProviderError, True), (408, ProviderError, True),
    ("timeout", ProviderError, True), ("malformed", ProviderError, True),
    ("missing_access", ProviderError, True),
])
async def test_refresh_revocation_invalidates_but_service_failure_preserves_authorization(
    manager: StorageManager, monkeypatch: pytest.MonkeyPatch, provider_type: str,
    failure: int | str, error_type: type[Exception], connected: bool,
) -> None:
    if provider_type == "onedrive" and failure == "scope":
        pytest.skip("OneDrive does not validate a returned scope")
    info = manager.create(StorageCreate(
        provider_type=provider_type, name="Cloud account", config={"client_id": "fixture-client"},
        client_secret=CLIENT_SECRET if provider_type == "google_drive" else None,
    ))
    storage_id = info.storage_id
    auth = cast(OneDriveAuthService | GoogleDriveAuthService, manager.auth(storage_id))

    def respond(request: httpx.Request) -> httpx.Response:
        if str(request.url) == ONEDRIVE_TOKEN_URL:
            return httpx.Response(200, json=tokens())
        if str(request.url) == GRAPH_ME_URL:
            return httpx.Response(200, json={"id": "account-a"})
        return google_response(request)

    mock_google(monkeypatch, respond)
    state = parse_qs(urlsplit(auth.start_authorization().authorization_url).query)["state"][0]
    await auth.finish_authorization("fixture-code", state)
    before = manager.record(storage_id).model_copy(deep=True)
    saved = manager.repository.path.read_bytes()
    calls = 0

    def reject(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert str(request.url) == (ONEDRIVE_TOKEN_URL if provider_type == "onedrive" else TOKEN_URL)
        if failure == "timeout":
            raise httpx.ReadTimeout(CLIENT_SECRET, request=request)
        if failure == "malformed":
            return httpx.Response(200, text=CLIENT_SECRET)
        if failure == "missing_access":
            return httpx.Response(200, json={"expires_in": 3600})
        if failure == "scope":
            return httpx.Response(200, json=tokens(scope=SCOPE + ".readonly"))
        # No JSON body: the HTTP status alone must distinguish rejection from an outage.
        return httpx.Response(failure, text=CLIENT_SECRET)

    mock_google(monkeypatch, reject)
    with pytest.raises(error_type) as caught:
        await auth.access_token(force_refresh=True)
    assert calls == 1
    assert CLIENT_SECRET not in str(caught.value)
    assert auth.status().connected is connected
    record = manager.record(storage_id)
    assert ("refresh_token" in record.credentials) is connected
    assert record.revision == before.revision + (0 if connected else 1)
    if connected:
        assert auth.status().account_id == "account-a"
        assert record == before
        assert manager.repository.path.read_bytes() == saved
    elif provider_type == "google_drive":
        assert record.credentials == {"client_secret": CLIENT_SECRET}
    else:
        assert record.credentials == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["client_id", "client_secret"])
async def test_client_edits_invalidate_authorization_but_name_edits_do_not(manager: StorageManager, monkeypatch: pytest.MonkeyPatch, field: str) -> None:
    storage_id, auth = google_connection(manager)
    mock_google(monkeypatch, google_response)
    await authorize(auth)
    revision = manager.record(storage_id).revision
    manager.update_app_settings(AppSettingsPatch(cloud_default_locations={
        storage_id: {"account_id": "account-a", "location": {"kind": "root"}},
    }))
    await manager.update(storage_id, StorageUpdate(name="Renamed connection", client_secret=CLIENT_SECRET))
    assert manager.record(storage_id).revision == revision and auth.status().connected
    patch = StorageUpdate(config={"client_id": "replacement-client"}) if field == "client_id" else StorageUpdate(client_secret="replacement-secret")
    await manager.update(storage_id, patch)
    current = manager.record(storage_id)
    assert current.revision == revision + 1
    assert current.credentials == {"client_secret": "replacement-secret" if field == "client_secret" else CLIENT_SECRET}
    assert storage_id not in manager.state.preferences.cloud_default_locations
    assert not cast(GoogleDriveAuthService, manager.auth(storage_id)).status().connected
    with pytest.raises(StorageConnectionChangedError):
        with manager.execution(storage_id, revision):
            pass
    with pytest.raises(StorageConnectionChangedError):
        auth.disconnect()


@pytest.mark.asyncio
async def test_save_failure_preserves_committed_session_and_configuration(manager: StorageManager, monkeypatch: pytest.MonkeyPatch) -> None:
    storage_id, auth = google_connection(manager)
    mock_google(monkeypatch, google_response)
    await authorize(auth)
    before = manager.record(storage_id).model_copy(deep=True)
    saved = manager.repository.path.read_bytes()

    def fail_save(state):
        raise ProviderError("Disk unavailable")

    monkeypatch.setattr(manager.repository, "save", fail_save)
    with pytest.raises(ProviderError):
        await manager.update(storage_id, StorageUpdate(client_secret="replacement-secret"))
    with pytest.raises(ProviderError):
        auth.disconnect()
    with pytest.raises(ProviderError):
        await auth.access_token(force_refresh=True)
    assert auth.status().connected
    assert manager.record(storage_id) == before
    assert manager.repository.path.read_bytes() == saved


@pytest.mark.asyncio
async def test_callback_save_failure_never_publishes_uncommitted_tokens(manager: StorageManager, monkeypatch: pytest.MonkeyPatch) -> None:
    storage_id, auth = google_connection(manager)
    mock_google(monkeypatch, google_response)
    state = parse_qs(urlsplit(auth.start_authorization().authorization_url).query)["state"][0]
    before = manager.record(storage_id).model_copy(deep=True)
    saved = manager.repository.path.read_bytes()

    def fail_save(state):
        raise ProviderError("Disk unavailable")

    monkeypatch.setattr(manager.repository, "save", fail_save)
    with pytest.raises(ProviderError):
        await auth.finish_authorization("fixture-code", state)
    assert not auth.status().connected
    assert manager.record(storage_id) == before
    assert manager.repository.path.read_bytes() == saved


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["secret", "disconnect", "busy"])
async def test_late_callback_cannot_commit_after_connection_changes(manager: StorageManager, monkeypatch: pytest.MonkeyPatch, change: str) -> None:
    storage_id, auth = google_connection(manager)
    waiting, release = asyncio.Event(), asyncio.Event()

    async def respond(request: httpx.Request) -> httpx.Response:
        if str(request.url) == TOKEN_URL:
            waiting.set()
            await release.wait()
        return google_response(request)

    mock_google(monkeypatch, respond)
    task = asyncio.create_task(authorize(auth))
    await asyncio.wait_for(waiting.wait(), timeout=5)
    if change == "busy":
        with manager.execution(storage_id, manager.record(storage_id).revision):
            release.set()
            with pytest.raises(StorageBusyError):
                await task
    else:
        if change == "secret":
            await manager.update(storage_id, StorageUpdate(client_secret="replacement-secret"))
        else:
            auth.disconnect()
        release.set()
        with pytest.raises(StorageConnectionChangedError):
            await task
    assert not auth.status().connected
    assert "refresh_token" not in manager.record(storage_id).credentials


@pytest.mark.asyncio
async def test_late_refresh_failure_cannot_disconnect_a_new_login(manager: StorageManager, monkeypatch: pytest.MonkeyPatch) -> None:
    storage_id, auth = google_connection(manager)
    mock_google(monkeypatch, google_response)
    await authorize(auth)
    waiting, release = asyncio.Event(), asyncio.Event()

    async def respond(request: httpx.Request) -> httpx.Response:
        if str(request.url) == TOKEN_URL and parse_qs(request.content.decode())["grant_type"] == ["refresh_token"]:
            waiting.set()
            await release.wait()
            return httpx.Response(400, json={"error": "invalid_grant"})
        return google_response(request)

    mock_google(monkeypatch, respond)
    task = asyncio.create_task(auth.access_token(force_refresh=True))
    await asyncio.wait_for(waiting.wait(), timeout=5)
    await authorize(auth)
    revision = manager.record(storage_id).revision
    release.set()
    with pytest.raises(StorageConnectionChangedError):
        await task
    assert auth.status().connected
    assert manager.record(storage_id).revision == revision


@pytest.mark.asyncio
async def test_connections_keep_independent_identity_tokens_and_disconnect(manager: StorageManager, monkeypatch: pytest.MonkeyPatch) -> None:
    first_id, first = google_connection(manager, "client-a")
    second_id, second = google_connection(manager, "client-b")

    def respond(request: httpx.Request) -> httpx.Response:
        if str(request.url) == TOKEN_URL:
            client_id = parse_qs(request.content.decode())["client_id"][0]
            return httpx.Response(200, json=tokens(access_token=client_id, refresh_token=f"refresh-{client_id}"))
        client_id = request.headers["Authorization"].removeprefix("Bearer ")
        return httpx.Response(200, json={"user": {"permissionId": f"account-{client_id}"}})

    mock_google(monkeypatch, respond)
    await asyncio.gather(authorize(first), authorize(second))
    first.disconnect()
    assert not first.status().connected and second.status().connected
    assert manager.record(first_id).credentials == {"client_secret": CLIENT_SECRET}
    assert manager.record(second_id).credentials["refresh_token"] == "refresh-client-b"
    assert second.status().account_id == "account-client-b"


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["delete", "reset"])
async def test_delete_and_reset_remove_google_client_secret(manager: StorageManager, action: str) -> None:
    storage_id, _ = google_connection(manager)
    if action == "delete":
        await manager.delete(storage_id)
    else:
        await manager.factory_reset(Path(str(manager.record("default-local").config["root_path"])), PreviewStore())
    assert storage_id not in manager.state.connections
    assert CLIENT_SECRET not in manager.repository.path.read_text(encoding="utf-8")


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [None, "source", "credentials"])
async def test_google_api_executes_server_snapshot_or_rejects_changes(manager: StorageManager, monkeypatch: pytest.MonkeyPatch, change: str | None) -> None:
    from test_google_drive_provider import WritableDriveServer, drive_file

    storage_id, auth = google_connection(manager)
    mock_google(monkeypatch, google_response)
    await authorize(auth)
    server = WritableDriveServer([drive_file("file", "old.txt")])
    mock_google(monkeypatch, server)
    try:
        async with ASYNC_CLIENT(transport=httpx.ASGITransport(app=api(manager).app), base_url="http://test") as client:
            response = await client.post(f"/storages/{storage_id}/files/list", json={"location": {"kind": "root"}})
            assert response.status_code == 200
            listing = response.json()
            assert listing["storage_id"] == storage_id and listing["revision"] == manager.record(storage_id).revision
            assert listing["breadcrumbs"] == [{"name": "My Drive", "location": {"kind": "root"}}]
            assert listing["items"][0]["mime_type"] == "text/plain"
            response = await client.post(f"/storages/{storage_id}/rename/preview", json={
                "location": {"kind": "root"}, "file_ids": ["file"],
                "rules": [{"type": "replace", "config": {"search": "old", "replacement": "new"}}],
            })
            assert response.status_code == 200 and response.json()["valid"]
            assert not server.writes
            preview_id = response.json()["preview_id"]
            if change == "source":
                server.files["file"]["name"] = "external.txt"
            elif change == "credentials":
                updated = await client.put(f"/storages/{storage_id}", json={"client_secret": "replacement-fixture-secret"})
                assert updated.status_code == 200
            response = await client.post("/rename/execute", json={
                "preview_id": preview_id,
                "items": [{"file_id": "file", "new_name": "tampered.txt"}],
            })
            if change is not None:
                assert response.status_code == 409 and not server.writes
            else:
                assert response.status_code == 200 and response.json()["status"] == "completed"
                assert server.writes == [[("file", "new.txt")]]
                assert (await client.get(f"/rename/progress/{preview_id}")).json()["phase"] == "finished"
                assert (await client.post("/rename/execute", json={"preview_id": preview_id})).status_code == 404
    finally:
        await manager.aclose()
