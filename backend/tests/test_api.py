from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from provider_fixtures import registry_for
from app.api.dependencies import get_execute_service, get_single_rename_service, get_storage_manager, get_preview_service, get_preview_store
from app.main import create_app
from app.providers.local.driver import LocalProvider
from app.rules.registry import RuleRegistry
from app.services.execute_service import ExecuteService
from app.services.single_rename_service import SingleRenameService
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
    app.dependency_overrides[get_single_rename_service] = lambda: SingleRenameService(providers)
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


@pytest.mark.parametrize(("file_count", "rule_count"), [(1, 21)])
def test_preview_rule_limit_is_an_http_validation_error(api_client: TestClient, file_count: int, rule_count: int) -> None:
    response = api_client.post("/storages/local/rename/preview", json={
        "file_ids": [f"file-{index}" for index in range(file_count)],
        "rules": [{"type": "padding", "config": {}} for _ in range(rule_count)],
    })
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REQUEST_VALIDATION_ERROR"


@pytest.mark.parametrize("is_directory", [False, True], ids=["file", "folder"])
def test_single_target_executes_without_preview(
    tmp_path: Path, api_client: TestClient, is_directory: bool,
) -> None:
    original = "archive.tar.gz" if not is_directory else "folder.v1"
    target = "资料.tar.gz" if not is_directory else "资料.v2"
    source = tmp_path / original
    if is_directory:
        source.mkdir()
        (source / "child.txt").write_text("unchanged", encoding="utf-8")
    else:
        source.write_text("unchanged", encoding="utf-8")

    operation_id = str(uuid4())
    result = api_client.post("/storages/local/rename/single/execute", json={
        "operation_id": operation_id, "revision": 1, "file_id": original,
        "original_name": original, "target_name": target,
    })
    assert result.status_code == 200
    assert result.json()["operation_id"] == operation_id
    assert result.json()["status"] == "completed"
    item = result.json()["items"][0]
    assert item["status"] == "renamed"
    assert item["file_id"] == original
    assert item["current_file"]["id"] == target
    assert not source.exists()
    renamed = tmp_path / target
    assert (renamed / "child.txt" if is_directory else renamed).read_text(encoding="utf-8") == "unchanged"
    assert api_client.post("/rename/execute", json={"preview_id": operation_id}).status_code == 404


@pytest.mark.parametrize("body", [
    {"file_ids": ["one.txt", "two.txt"], "target_name": "new.txt"},
    {"file_ids": ["one.txt"], "target_name": "new.txt", "rules": [{"type": "insert", "config": {"text": "X"}}]},
    {"file_ids": ["one.txt"], "target_name": "new.txt", "rules": [{"type": "insert", "enabled": False}]},
], ids=["multiple-items", "mixed-rules", "mixed-disabled-rule"])
def test_single_target_rejects_ambiguous_requests(api_client: TestClient, body: dict[str, object]) -> None:
    response = api_client.post("/storages/local/rename/preview", json=body)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REQUEST_VALIDATION_ERROR"


@pytest.mark.parametrize("target", ["", "bad/name.txt", "occupied.txt", "x" * 256],
                         ids=["empty", "invalid-character", "occupied", "too-long"])
def test_single_target_provider_rejects_invalid_name_without_writing(
    tmp_path: Path, api_client: TestClient, target: str,
) -> None:
    (tmp_path / "one.txt").write_text("source", encoding="utf-8")
    (tmp_path / "occupied.txt").write_text("occupied", encoding="utf-8")

    result = api_client.post("/storages/local/rename/single/execute", json={
        "operation_id": str(uuid4()), "revision": 1, "file_id": "one.txt",
        "original_name": "one.txt", "target_name": target,
    })
    assert result.status_code == 200
    assert result.json()["status"] == "failed"
    assert result.json()["items"][0]["error"]
    assert result.json()["items"][0]["error_code"] == ("RENAME_CONFLICT" if target == "occupied.txt" else "VALIDATION_ERROR")
    assert (tmp_path / "one.txt").read_text(encoding="utf-8") == "source"
    assert (tmp_path / "occupied.txt").read_text(encoding="utf-8") == "occupied"


@pytest.mark.parametrize("change", ["source", "target"], ids=["source-changed", "new-conflict"])
def test_single_target_returns_provider_missing_source_and_conflict_errors(
    tmp_path: Path, api_client: TestClient, change: str,
) -> None:
    source = tmp_path / "one.txt"
    source.write_text("source", encoding="utf-8")
    changed_path = tmp_path / ("external.txt" if change == "source" else "new.txt")
    if change == "source":
        source.rename(changed_path)
    changed_path.write_text("external change", encoding="utf-8")
    result = api_client.post("/storages/local/rename/single/execute", json={
        "operation_id": str(uuid4()), "revision": 1, "file_id": "one.txt",
        "original_name": "one.txt", "target_name": "new.txt",
    })
    assert result.status_code == 200
    assert result.json()["items"][0]["error_code"] == ("NOT_FOUND" if change == "source" else "RENAME_CONFLICT")
    if change != "source":
        assert source.read_text(encoding="utf-8") == "source"
    assert changed_path.read_text(encoding="utf-8") == "external change"
    if change == "source":
        assert not (tmp_path / "new.txt").exists()


def test_single_target_same_name_returns_provider_confirmed_result(tmp_path: Path, api_client: TestClient) -> None:
    (tmp_path / "one.txt").write_text("source", encoding="utf-8")
    result = api_client.post("/storages/local/rename/single/execute", json={
        "operation_id": str(uuid4()), "revision": 1, "file_id": "one.txt",
        "original_name": "one.txt", "target_name": "one.txt",
    })
    assert result.status_code == 200
    assert result.json()["items"][0]["status"] == "renamed"
    assert (tmp_path / "one.txt").read_text(encoding="utf-8") == "source"
