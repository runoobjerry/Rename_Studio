from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from provider_fixtures import registry_for
from app.api.dependencies import get_execute_service, get_storage_manager, get_preview_service
from app.main import create_app
from app.providers.local import LocalProvider
from app.rules.registry import RuleRegistry
from app.services.execute_service import ExecuteService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/providers"),
        ("GET", "/files"),
        ("GET", "/local/settings"),
        ("PUT", "/local/settings"),
        ("POST", "/local/settings/pick"),
        ("GET", "/onedrive/settings"),
        ("PUT", "/onedrive/settings"),
        ("DELETE", "/onedrive/settings"),
        ("GET", "/onedrive/auth/status"),
        ("POST", "/onedrive/auth/start"),
        ("DELETE", "/onedrive/auth/session"),
        ("GET", "/auth/onedrive/callback"),
        ("POST", "/rename/preview"),
    ],
)
def test_removed_storage_routes_are_not_registered(
    tmp_path: Path, method: str, path: str,
) -> None:
    providers = registry_for([LocalProvider(tmp_path)])
    app = create_app()
    app.dependency_overrides[get_storage_manager] = lambda: providers.manager
    app.dependency_overrides[get_preview_service] = lambda: PreviewService(
        providers, RenameEngine(RuleRegistry())
    )
    # Verify HTTP behavior without relying on FastAPI's internal router representation.
    with TestClient(app) as client:
        response = client.request(method, path)
    assert response.status_code == 404
    # A registered endpoint's item-not-found error does not prove the route was removed.
    assert response.json() == {"detail": "Not Found"}


def test_validation_errors_use_standard_shape(tmp_path: Path) -> None:
    providers = registry_for([LocalProvider(tmp_path)])
    app = create_app()
    app.dependency_overrides[get_storage_manager] = lambda: providers.manager
    app.dependency_overrides[get_preview_service] = lambda: PreviewService(providers, RenameEngine(RuleRegistry()))
    with TestClient(app) as client:
        response = client.post("/storages/local/rename/preview", json={"file_ids": [], "rules": []})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REQUEST_VALIDATION_ERROR"


def test_execute_requires_a_server_generated_preview(tmp_path: Path) -> None:
    providers = registry_for([LocalProvider(tmp_path)])
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


def test_execution_progress_api(tmp_path: Path) -> None:
    (tmp_path / "demo.txt").write_text("demo", encoding="utf-8")
    providers = registry_for([LocalProvider(tmp_path)])
    store = PreviewStore()
    preview = PreviewService(providers, RenameEngine(RuleRegistry()), store)
    execute = ExecuteService(providers, store, preview)
    app = create_app()
    app.dependency_overrides[get_storage_manager] = lambda: providers.manager
    app.dependency_overrides[get_preview_service] = lambda: preview
    app.dependency_overrides[get_execute_service] = lambda: execute
    with TestClient(app) as client:
        response = client.post("/storages/local/rename/preview", json={"file_ids": ["demo.txt"]})
        preview_id = response.json()["preview_id"]
        progress = client.get(f"/rename/progress/{preview_id}")
        assert progress.status_code == 200
        assert progress.json()["phase"] == "waiting"
        assert progress.json()["processed"] == progress.json()["total"] == 0
        result = client.post("/rename/execute", json={"preview_id": preview_id})
        assert result.status_code == 200
        assert client.get(f"/rename/progress/{preview_id}").json()["phase"] == "finished"
        assert client.get("/rename/progress/unknown").status_code == 404
