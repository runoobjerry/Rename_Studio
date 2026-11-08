import asyncio
import logging
from collections import OrderedDict
from time import monotonic

from app.core.config import DirectoryMetadataCacheSettings
from app.core.log_context import request_id_context
from app.providers.directory_metadata import DirectoryMetadata, DirectoryMetadataRead, MetadataLoader


logger = logging.getLogger("rename_studio.directory")
type _Scope = tuple[str, int]
type _Key = tuple[_Scope, str | None]


class DirectoryMetadataIndex:
    def __init__(self, settings: DirectoryMetadataCacheSettings | None = None) -> None:
        settings = settings if settings is not None else DirectoryMetadataCacheSettings()
        self._ttl = settings.ttl
        self._max_entries = settings.max_entries
        self._entries: OrderedDict[_Key, tuple[float, DirectoryMetadata]] = OrderedDict()
        self._pending: dict[_Key, asyncio.Task[DirectoryMetadata]] = {}

    def reader(self, scope: _Scope, *, use_cache: bool) -> DirectoryMetadataRead:
        return DirectoryMetadataRead(
            lambda directory_id: self._get((scope, directory_id)),
            lambda directory_id, fetch: self._share((scope, directory_id), fetch),
            use_cache=use_cache,
        )

    def _get(self, key: _Key) -> DirectoryMetadata | None:
        entry = self._entries.get(key)
        hit = entry is not None and entry[0] > monotonic()
        logger.debug("directory metadata index %s storage_id=%s request_id=%s",
                     "hit" if hit else "miss", key[0][0], request_id_context.get())
        if entry is None or not hit:
            return None
        self._entries.move_to_end(key)
        return entry[1]

    async def _share(self, key: _Key, fetch: MetadataLoader) -> DirectoryMetadata:
        task = self._pending.get(key)
        if task is None:
            async def load() -> DirectoryMetadata:
                return await fetch()

            task = asyncio.create_task(load())
            self._pending[key] = task
            task.add_done_callback(lambda finished: self._finish(key, finished))
        else:
            logger.debug("directory metadata read joined storage_id=%s request_id=%s",
                         key[0][0], request_id_context.get())
        return await asyncio.shield(task)

    def _finish(self, key: _Key, task: asyncio.Task[DirectoryMetadata]) -> None:
        # A fenced task may finish after a new task has taken over the same key.
        if self._pending.get(key) is task:
            del self._pending[key]
        if not task.cancelled():
            task.exception()

    def fence(self, storage_id: str | None) -> None:
        # Existing waiters can finish, while new readers start their own live reads.
        for key in list(self._pending):
            if storage_id is None or key[0][0] == storage_id:
                del self._pending[key]

    def invalidate(self, storage_id: str | None) -> None:
        self.fence(storage_id)
        for key in list(self._entries):
            if storage_id is None or key[0][0] == storage_id:
                del self._entries[key]

    def invalidate_subtree(self, scope: _Scope, directory_id: str) -> str | None:
        # Even an expired parent is useful for eviction, never for validating a read.
        entry = self._entries.get((scope, directory_id))
        self.fence(scope[0])
        children: dict[str, list[str]] = {}
        for (entry_scope, _), (_, item) in self._entries.items():
            if entry_scope == scope and item.parent_id is not None:
                children.setdefault(item.parent_id, []).append(item.id)

        pending = [directory_id]
        while pending:
            folder_id = pending.pop()
            self._entries.pop((scope, folder_id), None)
            pending.extend(children.pop(folder_id, ()))
        return entry[1].parent_id if entry is not None else None

    def store(
        self, scope: _Scope, read: DirectoryMetadataRead,
    ) -> tuple[set[str], set[str], bool]:
        now = monotonic()
        changed: set[str] = set()
        parents: set[str] = set()
        root_changed = False
        root = next((item for item in read.observed.values() if item.parent_id is None), None)
        for key, (_, old) in self._entries.items():
            if key[0] != scope:
                continue
            new = root if key[1] is None else read.observed.get(old.id)
            # A missing child is evidence only when its old parent was fully listed.
            missing = (old.parent_id is not None and old.parent_id in read.listed
                       and old.id not in read.listed[old.parent_id])
            if missing or (new is not None and new != old):
                root_changed |= key[1] is None
                changed.add(old.id)
                if old.parent_id is not None:
                    parents.add(old.parent_id)
                if new is not None and new.parent_id is not None:
                    parents.add(new.parent_id)

        if changed:
            # Paths from Graph may include an ancestor's old name. Discard hints for
            # this connection and retain only the folders observed live in this read.
            self.invalidate(scope[0])
        for item in read.observed.values():
            key = (scope, None if item.parent_id is None else item.id)
            self._entries[key] = (now + self._ttl, item)
            self._entries.move_to_end(key)
            if len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)
        return changed, parents, root_changed
