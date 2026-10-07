import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
from uuid import uuid4
from datetime import datetime

from app.core.errors import NotFoundError, StorageBusyError, StorageConnectionChangedError, ValidationError
from app.providers.base import StorageProvider
from app.providers.registry import ProviderRegistry
from app.repositories.storage_repository import JsonStorageRepository
from app.schemas.storage import StorageCreate, StorageInfo, StorageRecord, StorageState, StorageUpdate
from app.services.connection_auth import ConnectionAuth


class StorageManager:
    def __init__(self, registry: ProviderRegistry, repository: JsonStorageRepository, state: StorageState) -> None:
        self.registry = registry
        self.repository = repository
        self.state = state
        self._clients: dict[str, tuple[int, StorageProvider]] = {}
        self._auth: dict[str, ConnectionAuth] = {}
        self._busy: set[str] = set()
        self._closing: set[asyncio.Task[None]] = set()
        self.authorization_sessions: dict[str, tuple[str, int, str, datetime]] = {}
        registry.manager = self

    def record(self, storage_id: str) -> StorageRecord:
        storage_id = {"local": "default-local", "onedrive": "default-onedrive"}.get(storage_id, storage_id)
        if storage_id not in self.state.connections:
            raise NotFoundError("Storage connection was not found")
        return self.state.connections[storage_id]

    def info(self, storage_id: str) -> StorageInfo:
        record = self.record(storage_id)
        return StorageInfo(**record.model_dump(exclude={"credentials"}), busy=record.storage_id in self._busy,
                           account_id=record.credentials.get("account_id"),
                           account_display_name=record.credentials.get("account_display_name"),
                           account_email=record.credentials.get("account_email"))

    def validate_config(self, provider_type: str, config: dict[str, object]) -> dict[str, object]:
        return self.registry.validate_config(provider_type, config)

    def ensure_mutable(self, storage_id: str) -> None:
        if self.record(storage_id).storage_id in self._busy:
            raise StorageBusyError("This storage is executing a rename; try again after it finishes")

    def _commit(self, record: StorageRecord | None, storage_id: str) -> None:
        state = self.state.model_copy(deep=True)
        if record is None:
            del state.connections[storage_id]
        else:
            state.connections[storage_id] = record
        self.repository.save(state)
        self.state = state

    def create(self, request: StorageCreate) -> StorageInfo:
        config = self.validate_config(request.provider_type, request.config)
        record = StorageRecord(storage_id=uuid4().hex, provider_type=request.provider_type,
                               name=request.name, enabled=request.enabled, config=config)
        self._commit(record, record.storage_id)
        return self.info(record.storage_id)

    async def update(self, storage_id: str, request: StorageUpdate) -> StorageInfo:
        self.ensure_mutable(storage_id)
        before = self.record(storage_id)
        config = before.config if request.config is None else self.validate_config(before.provider_type, request.config)
        changed = config != before.config or (request.enabled is not None and request.enabled != before.enabled)
        record = before.model_copy(deep=True)
        if request.name is not None:
            record.name = request.name
        if request.enabled is not None:
            record.enabled = request.enabled
        record.config = config
        if changed:
            record.revision += 1
            if config != before.config:
                record.credentials = {}
        self._commit(record, record.storage_id)
        if changed:
            await self._invalidate(record.storage_id)
        return self.info(record.storage_id)

    async def delete(self, storage_id: str) -> None:
        self.ensure_mutable(storage_id)
        record = self.record(storage_id)
        if record.storage_id in {"default-local", "default-onedrive"}:
            raise ValidationError("Default storage connections cannot be deleted")
        self._commit(None, record.storage_id)
        await self._invalidate(record.storage_id)

    def provider(self, storage_id: str) -> StorageProvider:
        record = self.record(storage_id)
        if not record.enabled:
            raise ValidationError("Storage connection is disabled")
        cached = self._clients.get(record.storage_id)
        if cached is not None and cached[0] == record.revision:
            return cached[1]
        provider = self.registry.definition(record.provider_type).factory(record, self.auth(record.storage_id, required=False))
        self._clients[record.storage_id] = (record.revision, provider)
        return provider

    def auth(self, storage_id: str, *, required: bool = True) -> ConnectionAuth | None:
        record = self.record(storage_id)
        factory = self.registry.definition(record.provider_type).auth_factory
        if factory is None:
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

            auth = factory(record, persist, guard)
            self._auth[record.storage_id] = auth
        return self._auth[record.storage_id]

    def _persist_auth(self, storage_id: str, config: dict[str, object], credentials: dict[str, str]) -> None:
        before = self.record(storage_id)
        record = before.model_copy(deep=True)
        record.config = self.validate_config(record.provider_type, config)
        record.credentials = credentials
        # Refresh-token rotation does not change the connection's account identity.
        changed = record.config != before.config or any(
            record.credentials.get(key) != before.credentials.get(key)
            for key in ("account_id",)
        ) or bool(record.credentials.get("refresh_token")) != bool(before.credentials.get("refresh_token"))
        if changed:
            record.revision += 1
        self._commit(record, storage_id)
        if changed:
            cached = self._clients.pop(storage_id, None)
            if cached is not None:
                task = asyncio.create_task(cached[1].aclose())
                self._closing.add(task)
                task.add_done_callback(self._closing.discard)

    async def _invalidate(self, storage_id: str) -> None:
        self._auth.pop(storage_id, None)
        cached = self._clients.pop(storage_id, None)
        if cached is not None:
            await cached[1].aclose()

    @contextmanager
    def execution(self, storage_id: str, revision: int) -> Iterator[None]:
        try:
            record = self.record(storage_id)
        except NotFoundError as exc:
            raise StorageConnectionChangedError("Storage connection was deleted; create a new preview") from exc
        if record.revision != revision or not record.enabled:
            raise StorageConnectionChangedError("Storage connection changed; create a new preview")
        self.ensure_mutable(record.storage_id)
        self._busy.add(record.storage_id)
        try:
            yield
        finally:
            self._busy.remove(record.storage_id)

    async def aclose(self) -> None:
        await asyncio.gather(*(entry[1].aclose() for entry in self._clients.values()), *self._closing)
