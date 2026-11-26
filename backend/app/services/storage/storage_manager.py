import asyncio
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

from pydantic import SecretStr

from app.core.errors import AppError, AuthenticationError, NotFoundError, StorageAccountAlreadyConnectedError, StorageBusyError, StorageConnectionChangedError, ValidationError
from app.providers.auth import StorageAuth
from app.providers.base import StorageDriver
from app.providers.registry import ProviderDefinition, ProviderRegistry
from app.repositories.storage_repository import JsonStorageRepository
from app.schemas.storage import AppSettingsPatch, AppSettingsResponse, AuthorizationStart, StorageCreate, StorageInfo, StorageRecord, StorageState, StorageUpdate, validate_preferences_size
from app.services.directory.directory_cache import DirectoryCache


logger = logging.getLogger("rename_studio.storage")
app_logger = logging.getLogger("rename_studio.app")
auth_logger = logging.getLogger("rename_studio.auth")


class StorageManager:
    def __init__(
        self, registry: ProviderRegistry, repository: JsonStorageRepository, state: StorageState, *,
        default_connection: StorageRecord,
        directory_cache: DirectoryCache,
    ) -> None:
        self.registry = registry
        self.repository = repository
        self.state = state
        self._default_connection = default_connection
        self._directory_cache = directory_cache
        self._drivers: dict[str, tuple[int, StorageDriver]] = {}
        self._auth: dict[str, StorageAuth] = {}
        self._busy: set[str] = set()
        self._closing: set[asyncio.Task[None]] = set()
        self._authorization_sessions: dict[str, tuple[str, int, datetime]] = {}

    def record(self, storage_id: str) -> StorageRecord:
        if storage_id not in self.state.connections:
            raise NotFoundError("Storage connection was not found", details={"reason": "CONNECTION_NOT_FOUND", "params": {}})
        return self.state.connections[storage_id]

    def info(self, storage_id: str) -> StorageInfo:
        record = self.record(storage_id)
        return StorageInfo(**record.model_dump(exclude={"credentials"}), busy=record.storage_id in self._busy,
                           has_client_secret=bool(record.credentials.get("client_secret")),
                           account_id=record.credentials.get("account_id"),
                           account_display_name=record.credentials.get("account_display_name"),
                           account_email=record.credentials.get("account_email"))

    def list_connections(self) -> list[StorageInfo]:
        return [self.info(storage_id) for storage_id in self.state.connections]

    def provider_definitions(self) -> tuple[ProviderDefinition, ...]:
        return tuple(self.registry.definitions.values())

    def validate_config(self, provider_type: str, config: dict[str, object]) -> dict[str, object]:
        return self.registry.validate_config(provider_type, config)

    def provider_definition(self, storage_id: str) -> ProviderDefinition:
        return self.registry.definition(self.record(storage_id).provider_type)

    def revision(self, storage_id: str) -> int:
        return self.record(storage_id).revision

    def directory_cache_enabled(self, storage_id: str) -> bool:
        if not self.provider_definition(storage_id).cache_directories:
            return False
        auth = self.auth(storage_id, required=False)
        return auth is None or auth.status().connected

    def ensure_mutable(self, storage_id: str) -> None:
        if self.record(storage_id).storage_id in self._busy:
            raise StorageBusyError("This storage is executing a rename; try again after it finishes")

    def _commit(self, record: StorageRecord | None, storage_id: str) -> None:
        previous = self.state.connections.get(storage_id)
        state = self.state.model_copy(deep=True)
        if record is None:
            del state.connections[storage_id]
        else:
            state.connections[storage_id] = record
        default = state.preferences.cloud_default_locations.get(storage_id)
        if default is not None and (record is None or default.account_id != record.credentials.get("account_id")):
            del state.preferences.cloud_default_locations[storage_id]
        self.repository.save(state)
        self.state = state
        if previous is not None and (record is None or record.revision != previous.revision):
            self._directory_cache.invalidate_connection(storage_id)

    def app_settings(self) -> AppSettingsResponse:
        return AppSettingsResponse(preferences=self.state.preferences)

    def update_app_settings(self, request: AppSettingsPatch) -> AppSettingsResponse:
        preferences = self.state.preferences.model_copy(deep=True)
        fields = request.model_fields_set
        if "language" in fields:
            preferences.language = request.language
        if "theme" in fields:
            preferences.theme = request.theme
        if "compact_rule_editor" in fields:
            preferences.compact_rule_editor = request.compact_rule_editor
        if "cloud_default_locations" in fields:
            for storage_id, default in request.cloud_default_locations.items():
                if default is None:
                    preferences.cloud_default_locations.pop(storage_id, None)
                else:
                    record = self.record(storage_id)
                    if default.account_id != record.credentials.get("account_id"):
                        raise StorageConnectionChangedError("Default location belongs to a different account")
                    if default.location.kind not in self.registry.definition(record.provider_type).locations:
                        raise ValidationError("Default location type is not supported by this storage")
                    preferences.cloud_default_locations[storage_id] = default
        try:
            # A valid patch may exceed the aggregate limits after merging with saved connections.
            validate_preferences_size(preferences)
        except ValueError as exc:
            raise ValidationError("Preferences exceed the allowed limits") from exc
        if preferences == self.state.preferences:
            return self.app_settings()
        state = self.state.model_copy(deep=True)
        state.preferences = preferences
        self.repository.save(state)
        self.state = state
        app_logger.info("Application preferences updated")
        return self.app_settings()

    def reset(self) -> AppSettingsResponse:
        if self._busy:
            raise StorageBusyError("A storage is executing a rename; finish it before resetting")
        default = self._default_connection
        config = self.validate_config(default.provider_type, default.config)
        revision = self.record(default.storage_id).revision + 1
        restored = default.model_copy(update={"config": config, "revision": revision})
        state = StorageState(connections={restored.storage_id: restored})
        # No await separates the busy check, atomic save, and in-memory invalidation.
        self.repository.save(state)
        self.state = state
        self._authorization_sessions.clear()
        self._auth.clear()
        self._directory_cache.invalidate_connection()
        drivers = self._drivers
        self._drivers = {}
        for _, driver in drivers.values():
            task = asyncio.create_task(driver.aclose())
            self._closing.add(task)
            task.add_done_callback(self._closing.discard)
        logger.info("Application settings reset")
        return self.app_settings()

    def create(self, request: StorageCreate) -> StorageInfo:
        config = self.validate_config(request.provider_type, request.config)
        secret = self._client_secret(request.provider_type, request.client_secret)
        record = StorageRecord(storage_id=uuid4().hex, provider_type=request.provider_type,
                               name=request.name, config=config,
                               credentials={"client_secret": secret} if secret is not None else {})
        self._commit(record, record.storage_id)
        logger.info("Storage connection created provider=%s", record.provider_type,
                    extra={"storage_id": record.storage_id})
        return self.info(record.storage_id)

    async def update(self, storage_id: str, request: StorageUpdate) -> StorageInfo:
        self.ensure_mutable(storage_id)
        before = self.record(storage_id)
        config = before.config if request.config is None else self.validate_config(before.provider_type, request.config)
        secret = self._client_secret(before.provider_type, request.client_secret)
        if secret is None:
            secret = before.credentials.get("client_secret")
        changed = config != before.config or secret != before.credentials.get("client_secret")
        name = before.name if request.name is None else request.name
        if not changed and name == before.name:
            return self.info(storage_id)
        record = before.model_copy(deep=True)
        record.name = name
        record.config = config
        if changed:
            record.revision += 1
            # Client credentials survive account disconnect/configuration changes; tokens do not.
            record.credentials = {"client_secret": secret} if secret is not None else {}
        self._commit(record, record.storage_id)
        if changed:
            await self._invalidate(record.storage_id)
        logger.info("Storage connection updated provider=%s revision=%s", record.provider_type, record.revision,
                    extra={"storage_id": record.storage_id})
        return self.info(record.storage_id)

    def _client_secret(self, provider_type: str, secret: SecretStr | None) -> str | None:
        if secret is None:
            return None
        if not self.registry.definition(provider_type).accepts_client_secret:
            raise ValidationError("This storage does not accept an OAuth client secret")
        return secret.get_secret_value()

    async def delete(self, storage_id: str) -> None:
        self.ensure_mutable(storage_id)
        record = self.record(storage_id)
        if record.storage_id == self._default_connection.storage_id:
            raise ValidationError("The default storage connection cannot be deleted", details={"reason": "DEFAULT_CONNECTION_DELETE_FORBIDDEN", "params": {}})
        self._commit(None, record.storage_id)
        await self._invalidate(record.storage_id)
        logger.info("Storage connection deleted provider=%s", record.provider_type,
                    extra={"storage_id": record.storage_id})

    def start_authorization(self, storage_id: str, redirect_uri: str) -> AuthorizationStart:
        self.ensure_mutable(storage_id)
        result = cast(StorageAuth, self.auth(storage_id)).start_authorization(redirect_uri)
        revision = self.record(storage_id).revision
        now = datetime.now(UTC)
        self._authorization_sessions = {
            state: session for state, session in self._authorization_sessions.items()
            if session[0] != storage_id and session[2] > now
        }
        self._authorization_sessions[result.state] = (storage_id, revision, now + timedelta(minutes=10))
        auth_logger.info("Storage authorization started", extra={"storage_id": storage_id})
        return result

    async def finish_authorization(
        self, code: str | None, state: str | None, error: str | None,
    ) -> tuple[str | None, AppError | None]:
        provider_state = state or ""
        session = self._authorization_sessions.pop(provider_state, None)
        if session is None or session[2] <= datetime.now(UTC) or error or not code:
            return None, AuthenticationError("Authorization is invalid, expired or cancelled")
        storage_id, revision, _ = session
        try:
            if self.record(storage_id).revision != revision:
                raise StorageConnectionChangedError("Storage changed during authorization")
            self.ensure_mutable(storage_id)
            await cast(StorageAuth, self.auth(storage_id)).finish_authorization(code, provider_state)
        except AppError as exc:
            return storage_id, exc
        return storage_id, None

    def get_driver(self, storage_id: str) -> StorageDriver:
        record = self.record(storage_id)
        cached = self._drivers.get(record.storage_id)
        if cached is not None and cached[0] == record.revision:
            return cached[1]
        driver_factory = self.registry.definition(record.provider_type).driver_factory
        driver = driver_factory(record, self.auth(record.storage_id, required=False))
        self._drivers[record.storage_id] = (record.revision, driver)
        return driver

    def auth(self, storage_id: str, *, required: bool = True) -> StorageAuth | None:
        record = self.record(storage_id)
        auth_factory = self.registry.definition(record.provider_type).auth_factory
        if auth_factory is None:
            if required:
                raise ValidationError("This storage does not use browser authentication")
            return None
        if record.storage_id not in self._auth:
            def guard() -> None:
                if self._auth.get(record.storage_id) is not auth:
                    raise StorageConnectionChangedError("Authorization belongs to an old storage configuration")
                self.ensure_mutable(record.storage_id)

            def persist(config: dict[str, object], credentials: dict[str, str]) -> None:
                if self._auth.get(record.storage_id) is not auth:
                    raise StorageConnectionChangedError("Authorization belongs to an old storage configuration")
                self._persist_auth(record.storage_id, config, credentials)

            auth = auth_factory(record, persist, guard)
            self._auth[record.storage_id] = auth
        return self._auth[record.storage_id]

    def _persist_auth(self, storage_id: str, config: dict[str, object], credentials: dict[str, str]) -> None:
        before = self.record(storage_id)
        account_id = credentials.get("account_id")
        # Existing grants may refresh unchanged; only a new account binding needs checking.
        if account_id and account_id != before.credentials.get("account_id"):
            for other in self.state.connections.values():
                if (other.storage_id != storage_id and other.provider_type == before.provider_type
                        and other.credentials.get("account_id") == account_id):
                    raise StorageAccountAlreadyConnectedError(
                        f'This account is already connected to "{other.name}". Use the existing connection.',
                        details={"storage_id": other.storage_id, "storage_name": other.name},
                    )
        record = before.model_copy(deep=True)
        record.config = self.validate_config(record.provider_type, config)
        record.credentials = credentials
        # Refresh-token rotation does not change the connection's account identity.
        changed = record.config != before.config or any(
            record.credentials.get(key) != before.credentials.get(key)
            for key in ("account_id", "client_secret")
        ) or bool(record.credentials.get("refresh_token")) != bool(before.credentials.get("refresh_token"))
        if changed:
            record.revision += 1
        self._commit(record, storage_id)
        if changed:
            cached = self._drivers.pop(storage_id, None)
            if cached is not None:
                task = asyncio.create_task(cached[1].aclose())
                self._closing.add(task)
                task.add_done_callback(self._closing.discard)

    async def _invalidate(self, storage_id: str) -> None:
        self._auth.pop(storage_id, None)
        cached = self._drivers.pop(storage_id, None)
        if cached is not None:
            await cached[1].aclose()

    @contextmanager
    def execution(self, storage_id: str, revision: int) -> Iterator[None]:
        try:
            record = self.record(storage_id)
        except NotFoundError as exc:
            raise StorageConnectionChangedError("Storage connection was deleted; create a new preview") from exc
        if record.revision != revision:
            raise StorageConnectionChangedError("Storage connection changed; create a new preview")
        self.ensure_mutable(record.storage_id)
        self._busy.add(record.storage_id)
        try:
            yield
        finally:
            self._busy.remove(record.storage_id)

    async def aclose(self) -> None:
        await asyncio.gather(*(entry[1].aclose() for entry in self._drivers.values()), *self._closing)
