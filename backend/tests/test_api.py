from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from provider_fixtures import registry_for
from app.api.dependencies import get_execute_service, get_storage_manager, get_preview_service, get_preview_store
from app.main import create_app
from app.providers.local.driver import LocalProvider
from app.rules.registry import RuleRegistry
from app.services.execute_service import ExecuteService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine


@pytest.fixture
def api_client(tmp_path: Path) -> Iterator[TestClient]:
    providers = registry_for([LocalProvider(tmp_path)])
    store = PreviewStore()
    preview = PreviewService(providers, RenameEngine(RuleRegistry()), store)
    execute = ExecuteService(providers, store, preview)
    app = create_app()
    app.dependency_overrides[get_storage_manager] = lambda: providers.manager
    app.dependency_overrides[get_preview_service] = lambda: preview
    app.dependency_overrides[get_preview_store] = lambda: store
    app.dependency_overrides[get_execute_service] = lambda: execute
    with TestClient(app) as client:
        yield client


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
    api_client: TestClient, method: str, path: str,
) -> None:
    # Verify HTTP behavior without relying on FastAPI's internal router representation.
    response = api_client.request(method, path)
    assert response.status_code == 404
    # A registered endpoint's item-not-found error does not prove the route was removed.
    assert response.json() == {"detail": "Not Found"}


def test_validation_errors_use_standard_shape(api_client: TestClient) -> None:
    response = api_client.post("/storages/local/rename/preview", json={"file_ids": [], "rules": []})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REQUEST_VALIDATION_ERROR"


def test_rules_metadata_contains_identifiers_and_validation_schema(api_client: TestClient) -> None:
    response = api_client.get("/rules")
    assert response.status_code == 200
    definitions = response.json()
    assert {item["type"] for item in definitions} == {"padding", "replace", "remove", "insert"}
    assert all(set(item) == {"type", "config_schema"} for item in definitions)
    padding = next(item["config_schema"] for item in definitions if item["type"] == "padding")
    assert padding["type"] == "object"
    assert padding["properties"]["length"]["minimum"] == 1
    assert padding["properties"]["length"]["maximum"] == 255
    assert set(padding["required"]) == {"mode", "length"}


def test_execute_requires_a_server_generated_preview(api_client: TestClient) -> None:
    response = api_client.post(
        "/rename/execute",
        json={"preview_id": "not-created-by-preview"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PREVIEW_NOT_FOUND"


def test_preview_replacement_and_release(tmp_path: Path, api_client: TestClient) -> None:
    (tmp_path / "demo.txt").write_text("demo", encoding="utf-8")
    url = "/storages/local/rename/preview"
    first = api_client.post(url, json={"file_ids": ["demo.txt"]}).json()["preview_id"]
    unrelated = api_client.post(url, json={"file_ids": ["demo.txt"]}).json()["preview_id"]
    second_response = api_client.post(url, json={"file_ids": ["demo.txt"], "previous_preview_id": first})
    assert second_response.status_code == 200
    second = second_response.json()["preview_id"]
    assert api_client.get(f"/rename/progress/{first}").status_code == 404
    assert api_client.get(f"/rename/progress/{unrelated}").status_code == 200
    # 不能因另一连接的清理请求删除当前连接的快照。
    assert api_client.delete(f"/storages/other/rename/previews/{second}").status_code == 204
    assert api_client.get(f"/rename/progress/{second}").status_code == 200
    for _ in range(2):
        assert api_client.delete(f"/storages/local/rename/previews/{second}").status_code == 204
    assert api_client.get(f"/rename/progress/{second}").status_code == 404
    assert api_client.get(f"/rename/progress/{unrelated}").status_code == 200


def test_failed_preview_replacement_preserves_previous(tmp_path: Path, api_client: TestClient) -> None:
    (tmp_path / "demo.txt").write_text("demo", encoding="utf-8")
    url = "/storages/local/rename/preview"
    first = api_client.post(url, json={"file_ids": ["demo.txt"]}).json()["preview_id"]
    response = api_client.post(url, json={"file_ids": ["missing.txt"], "previous_preview_id": first})
    assert response.status_code == 422
    assert api_client.get(f"/rename/progress/{first}").status_code == 200


def test_execution_progress_api(tmp_path: Path, api_client: TestClient) -> None:
    (tmp_path / "demo.txt").write_text("demo", encoding="utf-8")
    response = api_client.post("/storages/local/rename/preview", json={"file_ids": ["demo.txt"]})
    preview_id = response.json()["preview_id"]
    progress = api_client.get(f"/rename/progress/{preview_id}")
    assert progress.status_code == 200
    assert progress.json()["phase"] == "waiting"
    assert progress.json()["processed"] == progress.json()["total"] == 0
    result = api_client.post("/rename/execute", json={"preview_id": preview_id})
    assert result.status_code == 200
    assert api_client.delete(f"/storages/local/rename/previews/{preview_id}").status_code == 204
    assert api_client.get(f"/rename/progress/{preview_id}").json()["phase"] == "finished"
    assert api_client.get("/rename/progress/unknown").status_code == 404


@pytest.mark.parametrize(("file_count", "rule_count"), [(1001, 0), (1, 21)])
def test_preview_batch_limits_are_http_validation_errors(api_client: TestClient, file_count: int, rule_count: int) -> None:
    response = api_client.post("/storages/local/rename/preview", json={
        "file_ids": [f"file-{index}" for index in range(file_count)],
        "rules": [{"type": "padding", "config": {}} for _ in range(rule_count)],
    })
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REQUEST_VALIDATION_ERROR"
