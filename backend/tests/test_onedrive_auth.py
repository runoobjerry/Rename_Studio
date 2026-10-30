from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.core.errors import AuthenticationError
from app.providers.onedrive.auth import OneDriveAuthService


def auth(state: dict[str, str], persist) -> OneDriveAuthService:
    return OneDriveAuthService("http://localhost:8000/auth/storage/callback", initial_state=state, persist=persist)


def test_authorization_url_uses_consumers_tenant_state_and_pkce() -> None:
    service = auth({"client_id": "client-id"}, lambda payload: None)
    query = parse_qs(urlparse(service.start_authorization().authorization_url).query)
    assert query["client_id"] == ["client-id"]
    assert query["scope"] == ["offline_access Files.ReadWrite User.Read"]
    assert query["redirect_uri"] == ["http://localhost:8000/auth/storage/callback"]
    assert query["prompt"] == ["select_account"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["state"][0] and query["code_challenge"][0]


@pytest.mark.parametrize("action", ["disconnect", "start_authorization"])
def test_account_actions_only_disconnect_clears_credentials(action: str) -> None:
    committed = {}
    service = auth({"client_id": "client-id", "refresh_token": "fixture-token", "account_id": "account-a"}, committed.update)
    if action == "disconnect":
        service.disconnect()
        assert not service.status().connected
        assert service.status().account_id is None
        assert committed == {"client_id": "client-id"}
    else:
        service.start_authorization()
        assert service.status().connected
        assert service.status().account_id == "account-a"
        assert committed == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("account_id", ["graph-user-id", None, "", 123])
async def test_only_valid_account_identity_is_persisted_and_restored(monkeypatch: pytest.MonkeyPatch, account_id: object) -> None:
    committed = {}
    service = auth({"client_id": "client-id"}, lambda payload: (committed.clear(), committed.update(payload)))
    state = parse_qs(urlparse(service.start_authorization().authorization_url).query)["state"][0]

    def respond(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "fixture-access", "refresh_token": "fixture-refresh"})
        return httpx.Response(200, json={"id": account_id, "displayName": "Test User", "mail": "test@example.com"})

    original_client = httpx.AsyncClient
    transport = httpx.MockTransport(respond)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original_client(transport=transport, **kwargs))
    if account_id != "graph-user-id":
        with pytest.raises(AuthenticationError, match="account ID"):
            await service.finish_authorization("fixture-code", state)
        assert not service.status().connected
        assert service.status().account_id is None
        assert committed == {}
        return
    await service.finish_authorization("fixture-code", state)
    assert service.status().account_id == "graph-user-id"
    assert committed["account_id"] == "graph-user-id"
    assert "access_token" not in committed
    restarted = auth(committed.copy(), lambda payload: None)
    assert restarted.status().connected
    assert restarted.status().account_id == "graph-user-id"
    assert restarted.status().account_email == "test@example.com"
