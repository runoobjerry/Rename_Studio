import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from app.services.onedrive_auth import OneDriveAuthService


def test_settings_only_require_app_id() -> None:
    service = OneDriveAuthService("http://localhost:8000/auth/onedrive/callback")

    settings = service.configure("client-id")

    assert settings.configured is True
    assert settings.client_id == "client-id"
    assert "client_secret" not in settings.model_dump()


def test_authorization_url_uses_consumers_tenant_state_and_pkce() -> None:
    service = OneDriveAuthService("http://localhost:8000/auth/onedrive/callback")
    service.configure("client-id")

    start = service.start_authorization()
    parsed = urlparse(start.authorization_url)
    query = parse_qs(parsed.query)

    assert "/consumers/" in parsed.path
    assert query["client_id"] == ["client-id"]
    assert query["scope"] == ["offline_access Files.ReadWrite User.Read"]
    assert query["prompt"] == ["select_account"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["state"][0]
    assert query["code_challenge"][0]


def test_clear_removes_configuration_and_connection_state() -> None:
    service = OneDriveAuthService("http://localhost:8000/auth/onedrive/callback")
    service.configure("client-id")
    service.start_authorization()

    service.clear()

    assert service.settings().configured is False
    assert service.settings().client_id is None
    assert service.status().connected is False


def test_disconnect_removes_token_and_retains_app_id(tmp_path: Path) -> None:
    credentials_file = tmp_path / ".onedrive_credentials.json"
    credentials_file.write_text(
        json.dumps({"client_id": "client-id", "refresh_token": "refresh-token"}),
        encoding="utf-8",
    )
    service = OneDriveAuthService(
        "http://localhost:8000/auth/onedrive/callback",
        credentials_file=credentials_file,
    )

    assert service.status().connected is True

    service.disconnect()

    assert service.settings().configured is True
    assert service.settings().client_id == "client-id"
    assert service.status().connected is False
    assert json.loads(credentials_file.read_text(encoding="utf-8")) == {
        "client_id": "client-id"
    }


def test_credentials_survive_restart_until_explicit_clear(tmp_path: Path) -> None:
    credentials_file = tmp_path / ".onedrive_credentials.json"
    first = OneDriveAuthService(
        "http://localhost:8000/auth/onedrive/callback",
        credentials_file=credentials_file,
    )
    first.configure("persisted-client-id")

    restarted = OneDriveAuthService(
        "http://localhost:8000/auth/onedrive/callback",
        credentials_file=credentials_file,
    )

    assert restarted.settings().client_id == "persisted-client-id"
    assert restarted.status().connected is False

    restarted.clear()

    assert not credentials_file.exists()
    after_clear = OneDriveAuthService(
        "http://localhost:8000/auth/onedrive/callback",
        credentials_file=credentials_file,
    )
    assert after_clear.settings().configured is False
