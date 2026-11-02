from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.core.errors import AuthenticationError, ProviderError, RateLimitError
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
@pytest.mark.parametrize("existing_account", [False, True])
@pytest.mark.parametrize(("account_id", "profile_result", "error_type"), [
    ("graph-user-id", 200, None),
    (None, 200, ProviderError), ("", 200, ProviderError), (123, 200, ProviderError),
    ("graph-user-id", 401, AuthenticationError), ("graph-user-id", 403, AuthenticationError),
    ("graph-user-id", 429, RateLimitError), ("graph-user-id", 503, ProviderError),
    ("graph-user-id", "timeout", ProviderError), ("graph-user-id", "malformed", ProviderError),
])
async def test_only_valid_account_identity_is_persisted_and_restored(
    monkeypatch: pytest.MonkeyPatch, account_id: object, profile_result: int | str,
    error_type: type[Exception] | None, existing_account: bool,
) -> None:
    initial = {"client_id": "client-id"}
    if existing_account:
        initial.update(refresh_token="old-refresh", account_id="old-account")
    committed = initial.copy()
    service = auth(initial.copy(), lambda payload: (committed.clear(), committed.update(payload)))
    state = parse_qs(urlparse(service.start_authorization().authorization_url).query)["state"][0]

    calls: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        calls.append(request.method)
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "fixture-access", "refresh_token": "fixture-refresh"})
        if profile_result == "timeout":
            raise httpx.ReadTimeout("fixture-secret", request=request)
        if profile_result == "malformed":
            return httpx.Response(200, text="fixture-secret")
        if profile_result != 200:
            return httpx.Response(profile_result, text="fixture-secret")
        return httpx.Response(200, json={"id": account_id, "displayName": "Test User", "mail": "test@example.com"})

    original_client = httpx.AsyncClient
    transport = httpx.MockTransport(respond)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original_client(transport=transport, **kwargs))
    if error_type is not None:
        with pytest.raises(error_type) as caught:
            await service.finish_authorization("fixture-code", state)
        assert "fixture-secret" not in str(caught.value)
        assert service.status().connected is existing_account
        assert service.status().account_id == ("old-account" if existing_account else None)
        assert committed == initial
        assert calls == ["POST", "GET"]
        return
    await service.finish_authorization("fixture-code", state)
    assert calls == ["POST", "GET"]
    assert service.status().account_id == "graph-user-id"
    assert committed["account_id"] == "graph-user-id"
    assert "access_token" not in committed
    restarted = auth(committed.copy(), lambda payload: None)
    assert restarted.status().connected
    assert restarted.status().account_id == "graph-user-id"
    assert restarted.status().account_email == "test@example.com"
