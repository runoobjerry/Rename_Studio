from collections.abc import Iterator
import errno
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from provider_fixtures import registry_for
from app.api.dependencies import get_execute_service, get_rule_registry, get_single_rename_service, get_storage_manager, get_preview_service, get_preview_store
from app.main import create_app
from app.providers.local.driver import LocalDriver
from app.services.execute_service import ExecuteService
from app.services.single_rename_service import SingleRenameService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine


@pytest.mark.parametrize("single", [False, True])
def test_execution_api_preserves_unknown_status_after_committed_write(
    tmp_path: Path, api_client: TestClient, monkeypatch: pytest.MonkeyPatch, single: bool,
) -> None:
    source = tmp_path / "old.txt"
    source.write_text("data")
    read = Path.lstat

    def fail_confirmation(path: Path, *args, **kwargs):
        if path == tmp_path / "new.txt" and not source.exists():
            raise PermissionError(errno.EACCES, "Confirmation unavailable")
        return read(path, *args, **kwargs)

    monkeypatch.setattr(Path, "lstat", fail_confirmation)
    if single:
        response = api_client.post("/storages/local/rename/single/execute", json={
            "operation_id": str(uuid4()), "revision": 1, "file_id": "old.txt",
            "original_name": "old.txt", "target_name": "new.txt",
        })
    else:
        preview = api_client.post("/storages/local/rename/preview", json={
            "file_ids": ["old.txt"], "target_name": "new.txt",
        }).json()
        response = api_client.post("/rename/execute", json={"preview_id": preview["preview_id"]})
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "incomplete"
    assert result["counts"] == {"renamed": 0, "skipped": 0, "failed": 0, "unknown": 1, "not_attempted": 0}
    assert result["items"][0]["status"] == "unknown"
    assert result["items"][0]["error_code"] == "RENAME_OUTCOME_UNKNOWN"
    assert result["items"][0]["actual_name"] is None
    assert (tmp_path / "new.txt").exists()
    assert not source.exists()


@pytest.fixture
def api_client(tmp_path: Path) -> Iterator[TestClient]:
    providers = registry_for({"local": LocalDriver(tmp_path)})
    store = PreviewStore()
    preview = PreviewService(providers, RenameEngine(get_rule_registry()), store)
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
    assert {item["type"] for item in definitions} == {"padding", "replace", "remove", "insert", "serialize"}
    assert all(set(item) == {"type", "config_schema"} for item in definitions)
    padding = next(item["config_schema"] for item in definitions if item["type"] == "padding")
    assert padding["type"] == "object"
    assert padding["properties"]["length"]["minimum"] == 1
    assert padding["properties"]["length"]["maximum"] == 255
    assert set(padding["required"]) == {"mode", "length"}
    serialize = next(item["config_schema"] for item in definitions if item["type"] == "serialize")
    assert set(serialize["properties"]["numbering_system"]["enum"]) == {
        "decimal", "alphabetic", "roman", "music", "chinese",
    }
    assert serialize["properties"]["reset_every"]["default"] is None
    assert serialize["properties"]["ignore_extension"]["default"] is True


def test_serialize_uses_request_order_in_preview_and_execution(tmp_path: Path, api_client: TestClient) -> None:
    for name in ("raw-A2.txt", "raw-B2.txt"):
        (tmp_path / name).write_text(name, encoding="utf-8")
    rules = [
        {"type": "insert", "config": {"text": "img_"}},
        {"type": "remove", "config": {"search": "raw-"}},
        {"type": "serialize"},
        {"type": "serialize", "enabled": False, "config": {"repeat": 0}},
        {"type": "padding", "config": {"mode": "number", "length": 2}},
        {"type": "replace", "config": {"search": "img_", "replacement": "-"}},
        {"type": "serialize", "config": {"numbering_system": "alphabetic", "start": 26, "position": "suffix"}},
    ]
    url = "/storages/local/rename/preview"
    request = {"file_ids": ["raw-B2.txt", "raw-A2.txt"], "rules": rules}

    response = api_client.post(url, json=request)
    assert response.status_code == 200
    first = response.json()
    assert first["valid"] is True
    assert [(item["file_id"], item["new_name"]) for item in first["items"]] == [
        ("raw-B2.txt", "01-B02z.txt"), ("raw-A2.txt", "02-A02ba.txt"),
    ]
    repeated = api_client.post(url, json={**request, "previous_preview_id": first["preview_id"]}).json()
    assert repeated["items"] == first["items"]

    resorted = api_client.post(url, json={
        **request, "file_ids": ["raw-A2.txt", "raw-B2.txt"], "previous_preview_id": repeated["preview_id"],
    }).json()
    assert [(item["file_id"], item["new_name"]) for item in resorted["items"]] == [
        ("raw-A2.txt", "01-A02z.txt"), ("raw-B2.txt", "02-B02ba.txt"),
    ]
    assert sorted(path.name for path in tmp_path.iterdir()) == ["raw-A2.txt", "raw-B2.txt"]

    result = api_client.post("/rename/execute", json={"preview_id": resorted["preview_id"]})
    assert result.status_code == 200
    assert result.json()["status"] == "completed"
    assert (tmp_path / "01-A02z.txt").read_text(encoding="utf-8") == "raw-A2.txt"
    assert (tmp_path / "02-B02ba.txt").read_text(encoding="utf-8") == "raw-B2.txt"


def test_serialize_duplicate_targets_block_execution(tmp_path: Path, api_client: TestClient) -> None:
    names = ["one.txt", "two.txt"]
    for name in names:
        (tmp_path / name).touch()
    response = api_client.post("/storages/local/rename/preview", json={
        "file_ids": names,
        "rules": [{"type": "serialize", "config": {"position": "replace", "repeat": 2}}],
    })
    assert response.status_code == 200
    preview = response.json()
    assert preview["valid"] is False
    assert [(item["new_name"], item["conflict"]) for item in preview["items"]] == [("1.txt", True)] * 2
    execution = api_client.post("/rename/execute", json={"preview_id": preview["preview_id"]})
    assert execution.status_code == 422
    assert execution.json()["error"]["code"] == "VALIDATION_ERROR"
    assert sorted(path.name for path in tmp_path.iterdir()) == names


@pytest.mark.parametrize(("config", "reason"), [
    ({"numbering_system": "alphabetic", "pad_length": 2}, None),
    ({"numbering_system": "roman", "start": 3999}, "SERIALIZE_NUMBER_OUT_OF_RANGE"),
])
def test_serialize_reports_invalid_configuration_or_generated_number(
    tmp_path: Path, api_client: TestClient, config: dict[str, object], reason: str | None,
) -> None:
    names = ["one.txt", "two.txt"]
    for name in names:
        (tmp_path / name).touch()
    response = api_client.post("/storages/local/rename/preview", json={
        "file_ids": names, "rules": [{"type": "serialize", "config": config}],
    })
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "RULE_CONFIGURATION_ERROR"
    assert error["details"]["rule_type"] == "serialize"
    if reason is not None:
        assert error["details"]["reason"] == reason
        assert error["details"]["params"] == {"item": 2, "min": 1, "max": 3999}
    else:
        assert error["details"]["errors"][0]["type"] == "serialize_padding_unsupported"


def test_serialize_reports_oversized_json_number_as_configuration_error(
    tmp_path: Path, api_client: TestClient,
) -> None:
    (tmp_path / "one.txt").touch()
    response = api_client.post(
        "/storages/local/rename/preview",
        content='{"file_ids":["one.txt"],"rules":[{"type":"serialize","config":{"start":1e400}}]}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "RULE_CONFIGURATION_ERROR"
    assert error["details"]["errors"][0]["loc"] == ["start"]


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
    assert result.json()["status"] == "incomplete"
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
