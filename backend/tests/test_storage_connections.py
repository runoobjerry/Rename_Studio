import json
import asyncio
from pathlib import Path
from typing import cast

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_storage_manager, get_preview_service, get_execute_service
from app.core.errors import ProviderError, StorageBusyError, StorageConnectionChangedError, ValidationError
from app.main import create_app
from app.providers.local import LocalProvider
from app.providers.onedrive import OneDriveProvider
from app.providers.registry import ProviderDefinition, ProviderRegistry
from app.repositories.storage_repository import JsonStorageRepository
from app.schemas.rename import RenamePreviewRequest
from app.schemas.rules import RuleSpec
from app.schemas.storage import LocalConfig, OneDriveConfig, RootLocation, StorageCreate, StorageUpdate
from app.services.connection_auth import ConnectionAuth
from app.services.execute_service import ExecuteService
from app.services.onedrive_auth import OneDriveAuthService
from app.services.preview_service import PreviewService
from app.services.preview_store import PreviewStore
from app.services.rename_engine import RenameEngine
from app.services.storage_manager import StorageManager
from app.rules.registry import RuleRegistry
from app.rules.text_operations import ReplaceRule


def make_manager(tmp_path: Path) -> StorageManager:
    root = tmp_path / "files"
    root.mkdir(exist_ok=True)
    repository = JsonStorageRepository(tmp_path / "storages.json")
    registry = ProviderRegistry()
    registry.register(ProviderDefinition("local", "Local", LocalConfig, ("root", "path", "id"), lambda record, auth: LocalProvider(Path(str(record.config["root_path"]))), local_picker=True))
    registry.register(ProviderDefinition("onedrive", "OneDrive", OneDriveConfig, ("root", "id", "path"), lambda record, auth: OneDriveProvider(cast(ConnectionAuth, auth)),
        auth_factory=lambda record, persist, guard: OneDriveAuthService("http://localhost/auth/storage/callback",
            initial_state={**record.credentials, **({"client_id": str(record.config["client_id"])} if record.config["client_id"] else {})},
            persist=lambda payload: persist({"client_id": payload.get("client_id")}, {key: value for key, value in payload.items() if key != "client_id"}), before_change=guard)))
    state = repository.load_or_initialize(root, registry.validate_config)
    return StorageManager(registry, repository, state)


def services(manager: StorageManager) -> tuple[PreviewService, ExecuteService]:
    rules = RuleRegistry()
    rules.register(ReplaceRule())
    store = PreviewStore()
    preview = PreviewService(manager.registry, RenameEngine(rules), store)
    return preview, ExecuteService(manager.registry, store, preview)


def test_new_install_only_creates_local_and_restores_it(tmp_path: Path) -> None:
    manager = make_manager(tmp_path)
    assert list(manager.state.connections) == ["default-local"]
    assert manager.record("default-local").name == "Local Files"
    assert manager.state.schema_version == 2
    assert make_manager(tmp_path).state == manager.state


def test_v1_upgrade_preserves_accounts_and_removes_empty_default_cloud(tmp_path: Path) -> None:
    manager = make_manager(tmp_path)
    cloud = manager.create(StorageCreate(provider_type="onedrive", name="Account", config={"client_id": "app"}))
    payload = manager.state.model_dump()
    payload["schema_version"] = 1
    for record in payload["connections"].values():
        record["enabled"] = False
    payload["connections"][cloud.storage_id]["credentials"] = {
        "refresh_token": "fixture-token", "account_id": "account-a",
    }
    payload["connections"]["default-onedrive"] = {
        "storage_id": "default-onedrive", "provider_type": "onedrive", "name": "OneDrive",
        "enabled": True, "config": {"client_id": None}, "revision": 1, "credentials": {},
    }
    path = tmp_path / "storages.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    restored = make_manager(tmp_path)
    assert "default-onedrive" not in restored.state.connections
    assert restored.record(cloud.storage_id).credentials["account_id"] == "account-a"
    assert "enabled" not in restored.info(cloud.storage_id).model_dump()
    assert "credentials" not in restored.info(cloud.storage_id).model_dump()
    assert path.with_name("storages.json.pre-storage-v2.bak").exists()
    assert make_manager(tmp_path).state == restored.state


@pytest.mark.asyncio
async def test_configured_former_default_cloud_is_deletable(tmp_path: Path) -> None:
    manager = make_manager(tmp_path)
    payload = manager.state.model_dump()
    payload["schema_version"] = 1
    payload["connections"]["default-local"]["enabled"] = True
    payload["connections"]["default-onedrive"] = {
        "storage_id": "default-onedrive", "provider_type": "onedrive", "name": "OneDrive",
        "enabled": True, "config": {"client_id": "app"}, "revision": 1,
        "credentials": {"refresh_token": "fixture-token"},
    }
    (tmp_path / "storages.json").write_text(json.dumps(payload), encoding="utf-8")
    restored = make_manager(tmp_path)
    assert restored.record("default-onedrive").credentials["refresh_token"] == "fixture-token"
    await restored.delete("default-onedrive")
    assert list(restored.state.connections) == ["default-local"]
    await restored.aclose()


def test_corrupt_state_does_not_reset_connections(tmp_path: Path) -> None:
    make_manager(tmp_path)
    (tmp_path / "storages.json").write_text('{"schema_version":2}', encoding="utf-8")
    with pytest.raises(ProviderError):
        make_manager(tmp_path)


@pytest.mark.asyncio
async def test_connections_versions_busy_guard_and_delete(tmp_path: Path) -> None:
    manager = make_manager(tmp_path)
    other = manager.create(StorageCreate(provider_type="local", name="Other", config={"root_path": str(tmp_path)}))
    original = manager.record("default-local").revision
    with manager.execution("default-local", original):
        with pytest.raises(StorageBusyError):
            await manager.update("default-local", StorageUpdate(name="Busy edit"))
        await manager.update(other.storage_id, StorageUpdate(name="Renamed"))
    await manager.update("default-local", StorageUpdate(config={"root_path": str(tmp_path)}))
    with pytest.raises(StorageConnectionChangedError):
        with manager.execution("default-local", original):
            pass
    with pytest.raises(ValidationError):
        await manager.delete("default-local")
    await manager.delete(other.storage_id)
    with pytest.raises(StorageConnectionChangedError):
        with manager.execution(other.storage_id, other.revision):
            pass
    await manager.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("update_request", [
    StorageUpdate(),
    StorageUpdate(name="Account"),
    StorageUpdate(config={"client_id": "app"}),
    StorageUpdate(name="Account", config={"client_id": " app "}),
])
async def test_unchanged_update_does_not_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, update_request: StorageUpdate,
) -> None:
    manager = make_manager(tmp_path)
    info = manager.create(StorageCreate(provider_type="onedrive", name="Account", config={"client_id": "app"}))
    auth = cast(OneDriveAuthService, manager.auth(info.storage_id))
    auth._store_tokens({"access_token": "fixture-access", "refresh_token": "fixture-refresh"})
    before = manager.info(info.storage_id)
    state = manager.state.model_copy(deep=True)

    def fail(state):
        raise ProviderError("Disk unavailable")

    monkeypatch.setattr(manager.repository, "save", fail)
    assert await manager.update(info.storage_id, update_request) == before
    assert manager.state == state
    assert manager.auth(info.storage_id) is auth
    await manager.aclose()


@pytest.mark.asyncio
async def test_name_only_update_persists_without_invalidating_authorization(tmp_path: Path) -> None:
    manager = make_manager(tmp_path)
    info = manager.create(StorageCreate(provider_type="onedrive", name="Account", config={"client_id": "app"}))
    auth = cast(OneDriveAuthService, manager.auth(info.storage_id))
    auth._store_tokens({"access_token": "fixture-access", "refresh_token": "fixture-refresh"})
    before = manager.record(info.storage_id).model_copy(deep=True)

    result = await manager.update(info.storage_id, StorageUpdate(name="Renamed"))

    assert result.name == "Renamed"
    assert result.revision == before.revision
    assert manager.record(info.storage_id).credentials == before.credentials
    assert manager.auth(info.storage_id) is auth
    restored = make_manager(tmp_path)
    assert restored.record(info.storage_id) == manager.record(info.storage_id)
    await restored.aclose()
    await manager.aclose()


def test_failed_save_keeps_previous_configuration(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manager = make_manager(tmp_path)
    before = manager.state.model_dump()
    def fail(state):
        raise ProviderError("Disk unavailable")
    monkeypatch.setattr(manager.repository, "save", fail)
    with pytest.raises(ProviderError):
        manager.create(StorageCreate(provider_type="local", name="Other", config={"root_path": str(tmp_path)}))
    assert manager.state.model_dump() == before


@pytest.mark.asyncio
async def test_account_credentials_and_old_auth_objects_are_isolated(tmp_path: Path) -> None:
    manager = make_manager(tmp_path)
    first = manager.create(StorageCreate(provider_type="onedrive", name="First", config={"client_id": "first"}))
    second = manager.create(StorageCreate(provider_type="onedrive", name="Second", config={"client_id": "second"}))
    first_auth = cast(OneDriveAuthService, manager.auth(first.storage_id))
    second_auth = cast(OneDriveAuthService, manager.auth(second.storage_id))
    first_auth._store_tokens({"access_token": "fixture-access", "refresh_token": "fixture-first"})
    second_auth._store_tokens({"access_token": "fixture-access", "refresh_token": "fixture-second"})
    revision = manager.record(first.storage_id).revision
    first_auth._store_tokens({"access_token": "fixture-new", "refresh_token": "fixture-rotated"})
    assert manager.record(first.storage_id).revision == revision
    first_auth.disconnect()
    assert manager.record(second.storage_id).credentials["refresh_token"] == "fixture-second"
    await manager.update(first.storage_id, StorageUpdate(config={"client_id": "replacement"}))
    with pytest.raises(StorageConnectionChangedError):
        first_auth.disconnect()
    await manager.aclose()


@pytest.mark.asyncio
async def test_preview_rejects_changed_connection_even_with_matching_files(tmp_path: Path) -> None:
    manager = make_manager(tmp_path)
    root = Path(str(manager.record("default-local").config["root_path"]))
    (root / "a.txt").write_text("a", encoding="utf-8")
    (tmp_path / "a.txt").write_text("a", encoding="utf-8")
    preview, execute = services(manager)
    response = await preview.preview(RenamePreviewRequest(storage_id="default-local", location=RootLocation(), file_ids=["a.txt"], rules=[RuleSpec(type="replace", config={"search": "a", "replacement": "b"})]))
    await manager.update("default-local", StorageUpdate(config={"root_path": str(tmp_path)}))
    with pytest.raises(StorageConnectionChangedError):
        await execute.execute(response.preview_id)
    assert (root / "a.txt").exists() and (tmp_path / "a.txt").exists()
    await manager.aclose()


def test_storage_api_and_secret_redaction(tmp_path: Path) -> None:
    manager = make_manager(tmp_path)
    preview, execute = services(manager)
    app = create_app()
    app.dependency_overrides[get_storage_manager] = lambda: manager
    app.dependency_overrides[get_preview_service] = lambda: preview
    app.dependency_overrides[get_execute_service] = lambda: execute
    with TestClient(app) as client:
        response = client.post("/storages", json={"provider_type": "local", "name": "Other", "config": {"root_path": str(tmp_path)}})
        assert response.status_code == 201
        storage_id = response.json()["storage_id"]
        assert "credentials" not in response.json()
        assert client.post(f"/storages/{storage_id}/files/list", json={"location": {"kind": "root"}}).status_code == 200
        assert client.put(f"/storages/{storage_id}", json={"provider_type": "onedrive"}).status_code == 422
        assert client.delete("/storages/default-local").status_code == 422
        assert client.get("/storage-providers").json()[0]["provider_type"] == "local"
        assert client.get("/storages/local").status_code == 404
        assert client.put(f"/storages/{storage_id}", json={"enabled": False}).status_code == 422
        assert client.post("/storages", json={"provider_type": "local", "name": "Old field", "config": {"root_path": str(tmp_path)}, "enabled": True}).status_code == 422
        (tmp_path / "source.txt").write_text("unchanged", encoding="utf-8")
        snapshot = client.post(f"/storages/{storage_id}/rename/preview", json={"location": {"kind": "root"}, "file_ids": ["source.txt"], "rules": []}).json()
        response = client.post("/rename/execute", json={"preview_id": snapshot["preview_id"], "file_ids": ["untrusted"], "rules": [{"type": "untrusted"}], "new_name": "tampered.txt"})
        assert response.status_code == 200
        assert response.json()["items"][0]["status"] == "skipped"
        assert (tmp_path / "source.txt").exists()
        assert not (tmp_path / "tampered.txt").exists()


@pytest.mark.asyncio
async def test_old_oauth_response_cannot_overwrite_new_configuration(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from urllib.parse import parse_qs, urlsplit
    manager = make_manager(tmp_path)
    info = manager.create(StorageCreate(provider_type="onedrive", name="Account", config={"client_id": "app"}))
    auth = cast(OneDriveAuthService, manager.auth(info.storage_id))
    start = auth.start_authorization("http://localhost/auth/storage/callback")
    state = parse_qs(urlsplit(start.authorization_url).query)["state"][0]
    waiting, release = asyncio.Event(), asyncio.Event()
    async def token_response(form):
        assert form["redirect_uri"] == "http://localhost/auth/storage/callback"
        waiting.set()
        await release.wait()
        return {"access_token": "fixture-access", "refresh_token": "obsolete-token"}
    monkeypatch.setattr(auth, "_token_request", token_response)
    task = asyncio.create_task(auth.finish_authorization("fixture-code", state))
    await waiting.wait()
    await manager.update(info.storage_id, StorageUpdate(config={"client_id": "replacement"}))
    release.set()
    with pytest.raises(StorageConnectionChangedError):
        await task
    assert manager.record(info.storage_id).config["client_id"] == "replacement"
    assert manager.record(info.storage_id).credentials == {}
    await manager.aclose()


@pytest.mark.asyncio
async def test_failed_auth_save_restores_the_previous_session(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manager = make_manager(tmp_path)
    info = manager.create(StorageCreate(provider_type="onedrive", name="Account", config={"client_id": "app"}))
    auth = cast(OneDriveAuthService, manager.auth(info.storage_id))
    auth._store_tokens({"access_token": "fixture-access", "refresh_token": "committed-token"})
    def fail(state):
        raise ProviderError("Disk unavailable")
    monkeypatch.setattr(manager.repository, "save", fail)
    with pytest.raises(ProviderError):
        auth.disconnect()
    assert auth.status().connected
    assert manager.record(info.storage_id).credentials["refresh_token"] == "committed-token"
    await manager.aclose()


@pytest.mark.asyncio
async def test_callback_rejected_while_busy_discards_uncommitted_tokens(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from urllib.parse import parse_qs, urlsplit

    manager = make_manager(tmp_path)
    info = manager.create(StorageCreate(provider_type="onedrive", name="Account", config={"client_id": "app"}))
    auth = cast(OneDriveAuthService, manager.auth(info.storage_id))
    state = parse_qs(urlsplit(auth.start_authorization().authorization_url).query)["state"][0]
    waiting, release = asyncio.Event(), asyncio.Event()

    async def token_response(form):
        return {"access_token": "fixture-access", "refresh_token": "uncommitted-token"}

    async def profile():
        waiting.set()
        await release.wait()

    monkeypatch.setattr(auth, "_token_request", token_response)
    monkeypatch.setattr(auth, "_load_account_profile", profile)
    task = asyncio.create_task(auth.finish_authorization("fixture-code", state))
    await waiting.wait()
    with manager.execution(info.storage_id, manager.record(info.storage_id).revision):
        release.set()
        with pytest.raises(StorageBusyError):
            await task
    assert not auth.status().connected
    assert manager.record(info.storage_id).credentials == {}
    await manager.aclose()
