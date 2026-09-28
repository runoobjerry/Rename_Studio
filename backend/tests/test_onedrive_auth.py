from urllib.parse import parse_qs, urlparse

from app.services.onedrive_auth import OneDriveAuthService


def test_settings_do_not_expose_client_secret() -> None:
    service = OneDriveAuthService("http://localhost:8000/auth/onedrive/callback")

    settings = service.configure("client-id", "top-secret")

    assert settings.configured is True
    assert settings.client_id == "client-id"
    assert settings.client_secret_configured is True
    assert "client_secret" not in settings.model_dump()


def test_authorization_url_uses_consumers_tenant_state_and_pkce() -> None:
    service = OneDriveAuthService("http://localhost:8000/auth/onedrive/callback")
    service.configure("client-id", "top-secret")

    start = service.start_authorization()
    parsed = urlparse(start.authorization_url)
    query = parse_qs(parsed.query)

    assert "/consumers/" in parsed.path
    assert query["client_id"] == ["client-id"]
    assert query["scope"] == ["offline_access Files.ReadWrite"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["state"][0]
    assert query["code_challenge"][0]


def test_clear_removes_configuration_and_connection_state() -> None:
    service = OneDriveAuthService("http://localhost:8000/auth/onedrive/callback")
    service.configure("client-id", "top-secret")
    service.start_authorization()

    service.clear()

    assert service.settings().configured is False
    assert service.settings().client_id is None
    assert service.status().connected is False
