import asyncio
from datetime import UTC, datetime
from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_storage_manager, get_preview_service, get_execute_service, get_preview_store
from app.api import app_settings_router, storage_router
from app.core.errors import ProviderError, StorageBusyError, StorageConnectionChangedError, ValidationError
from app.core import config as app_config
from app.main import create_app
from app.providers.local import LocalProvider
from app.providers.onedrive import OneDriveProvider
from app.providers.registry import ProviderDefinition, ProviderRegistry
from app.repositories.storage_repository import JsonStorageRepository
from app.schemas.rename import RenamePreviewRequest
from app.schemas.rules import RuleSpec
from app.schemas.storage import StorageConfigField, LocalConfig, OneDriveConfig, RootLocation, StorageCreate, StorageUpdate
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


def test_provider_metadata_exposes_form_fields_without_connection_secrets(tmp_path: Path) -> None:
    manager = make_manager(tmp_path)
    definition = manager.registry.definition("onedrive")
    manager.registry.definitions["onedrive"] = replace(
        definition, account_label="测试用户", icon="computer", config_fields=(
            StorageConfigField(key="client_id", label="客户端 ID", nullable=True),
            StorageConfigField(key="client_secret", label="客户端密钥", input_type="password", target="client_secret"),
        ),
    )
    app = FastAPI()
    app.include_router(storage_router.router)
    app.dependency_overrides[get_storage_manager] = lambda: manager
    with TestClient(app) as client:
        response = client.get("/storage-providers")
    assert response.status_code == 200
    provider = next(item for item in response.json() if item["provider_type"] == "onedrive")
    assert provider["account_label"] == "测试用户"
    assert provider["icon"] == "computer"
    assert provider["browser_auth"] is True
    assert provider["config_schema"] == OneDriveConfig.model_json_schema()
    fields = provider["config_fields"]
    assert fields[0]["key"] == "client_id" and fields[0]["nullable"] is True
    assert fields[1]["input_type"] == "password" and fields[1]["target"] == "client_secret"
    assert "value" not in fields[1] and "credentials" not in provider


@pytest.mark.parametrize("provider_type", ["fixture_service", "google_drive"])
@pytest.mark.parametrize("accepts_secret", [False, True])
def test_client_secret_acceptance_follows_provider_fields(tmp_path: Path, provider_type: str, accepts_secret: bool) -> None:
    manager = make_manager(tmp_path)
    manager.registry.register(replace(
        manager.registry.definition("onedrive"), provider_type=provider_type, name="Fixture Service",
        config_fields=(StorageConfigField(
            key="client_secret", label="密钥", target="client_secret", input_type="password",
        ),) if accepts_secret else (),
    ))
    app = create_app()
    app.dependency_overrides[get_storage_manager] = lambda: manager
    with TestClient(app) as client:
        response = client.post("/storages", json={
            "provider_type": provider_type, "name": "Fixture", "config": {}, "client_secret": "fixture-secret",
        })
        assert response.status_code == (201 if accepts_secret else 422)
        assert "fixture-secret" not in response.text
        if accepts_secret:
            storage_id = response.json()["storage_id"]
            assert response.json()["has_client_secret"] is True
            assert "client_secret" not in response.json()["config"]
            assert manager.record(storage_id).credentials["client_secret"] == "fixture-secret"
        else:
            assert len(manager.state.connections) == 1
            storage_id = manager.create(StorageCreate(provider_type=provider_type, name="Fixture", config={})).storage_id
        updated = client.put(f"/storages/{storage_id}", json={"client_secret": "replacement-secret"})
        assert updated.status_code == (200 if accepts_secret else 422)
        assert "replacement-secret" not in updated.text
        if accepts_secret:
            assert manager.record(storage_id).credentials["client_secret"] == "replacement-secret"
        else:
            assert manager.record(storage_id).credentials == {}


def test_new_install_only_creates_local_and_restores_it(tmp_path: Path) -> None:
    manager = make_manager(tmp_path)
    assert list(manager.state.connections) == ["default-local"]
    assert manager.record("default-local").name == "Local Files"
    assert manager.state.schema_version == 3
    assert manager.state.preferences.model_dump() == {
        "theme": "system", "hide_batch_limit_hint": False,
        "cloud_default_locations": {},
    }
    assert manager.record("default-local").config["root_path"] == str((tmp_path / "files").resolve())
    assert make_manager(tmp_path).state == manager.state
    restored = manager.repository.load_or_initialize(tmp_path / "different-default", manager.registry.validate_config)
    assert restored == manager.state


def test_default_documents_root_and_explicit_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    documents = tmp_path / "Documents"
    monkeypatch.delenv("LOCAL_STORAGE_ROOT", raising=False)
    monkeypatch.setattr(app_config, "default_documents_directory", lambda: documents)
    assert app_config.Settings(_env_file=None).local_storage_root == documents.resolve()
    override = tmp_path / "custom"
    monkeypatch.setenv("LOCAL_STORAGE_ROOT", str(override))
    assert app_config.Settings(_env_file=None).local_storage_root == override.resolve()


@pytest.mark.parametrize("selected", [True, False])
def test_draft_folder_picker_does_not_modify_connections(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, selected: bool) -> None:
    manager = make_manager(tmp_path)
    before = manager.repository.path.read_bytes()
    root = tmp_path / "Documents"
    chosen = tmp_path / "chosen"
    settings = app_config.Settings(_env_file=None, local_storage_root=root)
    monkeypatch.setattr(storage_router, "get_settings", lambda: settings)

    def choose(initial: Path) -> Path | None:
        assert initial == root
        return chosen if selected else None

    monkeypatch.setattr(storage_router, "choose_local_directory", choose)
    app = FastAPI()
    app.include_router(storage_router.router)
    with TestClient(app) as client:
        response = client.post("/local/folder-picker")
    assert response.status_code == 200
    assert response.json() == {"root_path": str(chosen if selected else root), "selected": selected}
    assert manager.repository.path.read_bytes() == before
    assert not chosen.exists()


def test_corrupt_state_does_not_reset_connections(tmp_path: Path) -> None:
    make_manager(tmp_path)
    (tmp_path / "storages.json").write_text('{"schema_version":3}', encoding="utf-8")
    with pytest.raises(ProviderError):
        make_manager(tmp_path)


def test_app_settings_keeps_only_current_account_default_and_rotated_token(tmp_path: Path) -> None:
    from app.schemas.storage import AppSettingsPatch

    manager = make_manager(tmp_path)
    cloud = manager.create(StorageCreate(provider_type="onedrive", name="Account", config={"client_id": "app"}))
    manager._persist_auth(cloud.storage_id, {"client_id": "app"}, {
        "account_id": "account-a", "refresh_token": "rotated-token",
    })
    manager.update_app_settings(AppSettingsPatch.model_validate({
        "cloud_default_locations": {cloud.storage_id: {"account_id": "account-a", "location": {"kind": "id", "value": "folder-a"}}},
    }))
    manager._persist_auth(cloud.storage_id, {"client_id": "app"}, {
        "account_id": "account-a", "refresh_token": "new-token",
    })
    manager.update_app_settings(AppSettingsPatch(theme="dark"))
    assert manager.state.preferences.cloud_default_locations[cloud.storage_id].location.value == "folder-a"
    assert manager.record(cloud.storage_id).credentials["refresh_token"] == "new-token"
    manager._persist_auth(cloud.storage_id, {"client_id": "app"}, {
        "account_id": "account-b", "refresh_token": "rotated-token",
    })
    assert cloud.storage_id not in manager.state.preferences.cloud_default_locations
    with pytest.raises(StorageConnectionChangedError):
        manager.update_app_settings(AppSettingsPatch.model_validate({
            "cloud_default_locations": {cloud.storage_id: {"account_id": "account-a", "location": {"kind": "root"}}},
        }))
    manager.update_app_settings(AppSettingsPatch.model_validate({
        "cloud_default_locations": {cloud.storage_id: {"account_id": "account-b", "location": {"kind": "root"}}},
    }))
    restored = make_manager(tmp_path)
    default = restored.state.preferences.cloud_default_locations[cloud.storage_id]
    assert default.account_id == "account-b"
    assert default.location.kind == "root"
    assert restored.state.preferences.theme == "dark"
    assert restored.record(cloud.storage_id).credentials["refresh_token"] == "rotated-token"
    cleared = restored.update_app_settings(AppSettingsPatch(
        cloud_default_locations={cloud.storage_id: None},
    ))
    assert cloud.storage_id not in cleared.preferences.cloud_default_locations
    assert make_manager(tmp_path).state == restored.state


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["disconnect", "configure", "delete"])
async def test_connection_changes_remove_current_account_default(tmp_path: Path, action: str) -> None:
    from app.schemas.storage import AppSettingsPatch

    manager = make_manager(tmp_path)
    cloud = manager.create(StorageCreate(provider_type="onedrive", name="Account", config={"client_id": "app"}))
    manager._persist_auth(cloud.storage_id, {"client_id": "app"}, {
        "account_id": "account-a", "refresh_token": "fixture-token",
    })
    manager.update_app_settings(AppSettingsPatch.model_validate({
        "cloud_default_locations": {cloud.storage_id: {"account_id": "account-a", "location": {"kind": "root"}}},
    }))
    if action == "disconnect":
        cast(ConnectionAuth, manager.auth(cloud.storage_id)).disconnect()
    elif action == "configure":
        await manager.update(cloud.storage_id, StorageUpdate(config={"client_id": "other-app"}))
    else:
        await manager.delete(cloud.storage_id)
    assert cloud.storage_id not in manager.state.preferences.cloud_default_locations
    assert make_manager(tmp_path).state == manager.state
    await manager.aclose()


def test_app_settings_noop_and_failed_save_do_not_change_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.schemas.storage import AppSettingsPatch

    manager = make_manager(tmp_path)
    original = manager.state.model_copy(deep=True)
    disk = manager.repository.path.read_bytes()

    def fail_save(state: object) -> None:
        raise ProviderError("fixture disk failure")

    monkeypatch.setattr(manager.repository, "save", fail_save)
    assert manager.update_app_settings(AppSettingsPatch(theme="system")).preferences == original.preferences
    with pytest.raises(ProviderError):
        manager.update_app_settings(AppSettingsPatch(theme="dark"))
    assert manager.state == original
    assert manager.repository.path.read_bytes() == disk


def test_app_settings_api_partial_updates_preserve_other_fields_and_credentials(tmp_path: Path) -> None:
    manager = make_manager(tmp_path)
    cloud = manager.create(StorageCreate(provider_type="onedrive", name="Account", config={"client_id": "app"}))
    manager._persist_auth(cloud.storage_id, {"client_id": "app"}, {"refresh_token": "fixture-secret"})
    app = create_app()
    app.dependency_overrides[get_storage_manager] = lambda: manager
    with TestClient(app) as client:
        initial = client.get("/app-settings")
        assert initial.status_code == 200
        assert initial.json() == {"preferences": {
            "theme": "system", "hide_batch_limit_hint": False,
            "cloud_default_locations": {},
        }}
        updated = client.patch("/app-settings", json={"theme": "dark"})
        assert updated.status_code == 200
        assert updated.json()["preferences"]["theme"] == "dark"
        hint = client.patch("/app-settings", json={"hide_batch_limit_hint": True})
        assert hint.status_code == 200
        assert hint.json()["preferences"]["theme"] == "dark"
        last = client.patch("/app-settings", json={"theme": "light"})
        assert last.status_code == 200
        assert last.json() == {"preferences": {
            "theme": "light", "hide_batch_limit_hint": True, "cloud_default_locations": {},
        }}
        rejected = client.patch("/app-settings", json={
            "credentials": {"refresh_token": "fixture-secret"},
        })
        assert rejected.status_code == 422
        assert rejected.json()["error"]["code"] == "REQUEST_VALIDATION_ERROR"
        unsupported_rules = client.patch("/app-settings", json={
            "rules": [{"type": "replace", "config": {}}],
        })
        assert unsupported_rules.status_code == 422
        for response in (initial, updated, hint, last, rejected):
            assert "fixture-secret" not in response.text
            assert "credentials" not in initial.text + updated.text
        assert manager.record(cloud.storage_id).credentials["refresh_token"] == "fixture-secret"
        assert make_manager(tmp_path).state == manager.state


def test_factory_reset_api_rejects_busy_and_never_returns_credentials(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manager = make_manager(tmp_path)
    cloud = manager.create(StorageCreate(provider_type="onedrive", name="Cloud", config={"client_id": "app"}))
    manager._persist_auth(cloud.storage_id, {"client_id": "app"}, {"refresh_token": "fixture-secret"})
    previews = PreviewStore()
    monkeypatch.setattr(app_settings_router, "get_settings", lambda: app_config.Settings(
        _env_file=None, local_storage_root=tmp_path / "files",
    ))
    app = create_app()
    app.dependency_overrides[get_storage_manager] = lambda: manager
    app.dependency_overrides[get_preview_store] = lambda: previews
    with TestClient(app) as client:
        with manager.execution("default-local", manager.record("default-local").revision):
            busy = client.post("/app-settings/factory-reset")
        assert busy.status_code == 409
        assert busy.json()["error"]["code"] == "STORAGE_BUSY"
        assert manager.record(cloud.storage_id).credentials["refresh_token"] == "fixture-secret"
        done = client.post("/app-settings/factory-reset")
        assert done.status_code == 200
        assert done.json() == {"preferences": {
            "theme": "system", "hide_batch_limit_hint": False, "cloud_default_locations": {},
        }}
        assert "fixture-secret" not in busy.text + done.text


@pytest.mark.asyncio
async def test_factory_reset_clears_connections_preferences_and_old_preview(tmp_path: Path) -> None:
    from app.schemas.storage import AppSettingsPatch
    from app.core.errors import PreviewNotFoundError

    manager = make_manager(tmp_path)
    source = tmp_path / "files" / "keep.txt"
    source.write_text("keep", encoding="utf-8")
    cloud = manager.create(StorageCreate(provider_type="onedrive", name="Cloud", config={"client_id": "app"}))
    extra = manager.create(StorageCreate(provider_type="local", name="Extra", config={"root_path": str(tmp_path)}))
    manager._persist_auth(cloud.storage_id, {"client_id": "app"}, {"refresh_token": "fixture-secret", "account_id": "account-a"})
    auth = manager.auth(cloud.storage_id)
    manager.authorization_sessions["old-session"] = (cloud.storage_id, 1, "old-session", datetime.now(UTC))
    manager.update_app_settings(AppSettingsPatch(theme="dark", hide_batch_limit_hint=True))
    preview, execute = services(manager)
    snapshot = await preview.preview(RenamePreviewRequest(
        storage_id="default-local", location=RootLocation(), file_ids=["keep.txt"], rules=[],
    ))
    previous_revision = manager.record("default-local").revision

    result = await manager.factory_reset(tmp_path / "files", preview.store)

    assert result.preferences.model_dump() == {
        "theme": "system", "hide_batch_limit_hint": False, "cloud_default_locations": {},
    }
    assert list(manager.state.connections) == ["default-local"]
    assert manager.record("default-local").revision == previous_revision + 1
    assert manager.authorization_sessions == {}
    assert source.read_text(encoding="utf-8") == "keep"
    assert cloud.storage_id not in manager.state.connections and extra.storage_id not in manager.state.connections
    assert "fixture-secret" not in manager.repository.path.read_text(encoding="utf-8")
    with pytest.raises(PreviewNotFoundError):
        preview.store.get(snapshot.preview_id)
    with pytest.raises(PreviewNotFoundError):
        await execute.execute(snapshot.preview_id)
    with pytest.raises(StorageConnectionChangedError):
        cast(OneDriveAuthService, auth).disconnect()
    assert make_manager(tmp_path).state == manager.state
    await manager.aclose()


@pytest.mark.asyncio
async def test_factory_reset_busy_and_failed_save_leave_state_untouched(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manager = make_manager(tmp_path)
    cloud = manager.create(StorageCreate(provider_type="onedrive", name="Cloud", config={"client_id": "app"}))
    manager._persist_auth(cloud.storage_id, {"client_id": "app"}, {"refresh_token": "fixture-secret"})
    before = manager.state.model_copy(deep=True)
    disk = manager.repository.path.read_bytes()
    previews = PreviewStore()
    with manager.execution("default-local", manager.record("default-local").revision):
        with pytest.raises(StorageBusyError):
            await manager.factory_reset(tmp_path / "files", previews)
    assert manager.state == before
    assert manager.repository.path.read_bytes() == disk

    def fail_save(state: object) -> None:
        raise ProviderError("fixture disk failure")

    monkeypatch.setattr(manager.repository, "save", fail_save)
    with pytest.raises(ProviderError):
        await manager.factory_reset(tmp_path / "files", previews)
    assert manager.state == before
    assert manager.repository.path.read_bytes() == disk
    assert manager.record(cloud.storage_id).credentials["refresh_token"] == "fixture-secret"


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
