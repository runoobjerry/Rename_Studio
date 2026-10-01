from pathlib import Path

from fastapi.testclient import TestClient

from app.api.dependencies import (
    get_execute_service,
    get_file_service,
    get_onedrive_auth_service,
    get_preview_service,
)
from app.main import create_app
from app.providers.local import LocalProvider
from app.providers.registry import ProviderRegistry
from app.rules.registry import RuleRegistry
from app.services.execute_service import ExecuteService
from app.services.file_service import FileService
from app.services.onedrive_auth import OneDriveAuthService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine


def test_onedrive_status_returns_account_id(tmp_path: Path) -> None:
    import json

    credentials_file = tmp_path / ".onedrive_credentials.json"
    credentials_file.write_text(json.dumps({
        "client_id": "client-id", "refresh_token": "test-refresh-token",
        "account_id": "graph-user-id",
    }), encoding="utf-8")
    service = OneDriveAuthService(
        "http://localhost:8000/auth/onedrive/callback",
        credentials_file=credentials_file,
    )
    app = create_app()
    app.dependency_overrides[get_onedrive_auth_service] = lambda: service
    with TestClient(app) as client:
        response = client.get("/onedrive/auth/status")
    assert response.status_code == 200
    assert response.json()["account_id"] == "graph-user-id"


def test_local_browse_and_preview_api(tmp_path: Path) -> None:
    (tmp_path / "demo.txt").write_text("demo", encoding="utf-8")
    providers = ProviderRegistry([LocalProvider(tmp_path)])
    app = create_app()
    app.dependency_overrides[get_file_service] = lambda: FileService(providers)
    app.dependency_overrides[get_preview_service] = lambda: PreviewService(
        providers, RenameEngine(RuleRegistry())
    )

    with TestClient(app) as client:
        listing = client.get("/files", params={"provider": "local", "path": ""})
        preview = client.post(
            "/rename/preview",
            json={"provider": "local", "file_ids": ["demo.txt"], "rules": []},
        )

    assert listing.status_code == 200
    assert listing.json()["items"][0]["name"] == "demo.txt"
    assert preview.status_code == 200
    assert preview.json()["items"][0]["new_name"] == "demo.txt"


def test_validation_errors_use_standard_shape() -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.post(
            "/rename/preview",
            json={"provider": "local", "file_ids": [], "rules": []},
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REQUEST_VALIDATION_ERROR"


def test_execute_requires_a_server_generated_preview(tmp_path: Path) -> None:
    providers = ProviderRegistry([LocalProvider(tmp_path)])
    store = PreviewStore()
    preview = PreviewService(providers, RenameEngine(RuleRegistry()), store)
    execute = ExecuteService(providers, store, preview)
    app = create_app()
    app.dependency_overrides[get_execute_service] = lambda: execute

    with TestClient(app) as client:
        response = client.post(
            "/rename/execute",
            json={"preview_id": "not-created-by-preview"},
        )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PREVIEW_NOT_FOUND"


def test_updates_local_root_directory(tmp_path: Path) -> None:
    initial = tmp_path / "initial"
    selected = tmp_path / "selected"
    initial.mkdir()
    selected.mkdir()
    providers = ProviderRegistry([LocalProvider(initial)])
    app = create_app()
    app.dependency_overrides[get_file_service] = lambda: FileService(providers)

    with TestClient(app) as client:
        response = client.put(
            "/local/settings",
            json={"root_path": str(selected)},
        )

    assert response.status_code == 200
    assert Path(response.json()["root_path"]) == selected.resolve()
