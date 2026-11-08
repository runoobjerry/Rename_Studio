from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from app.core.errors import ProviderError


class DirectoryMetadataConflict(ProviderError):
    """A live directory response conflicts with the ancestry used for the read."""


@dataclass(frozen=True, slots=True)
class DirectoryMetadata:
    id: str
    name: str
    parent_id: str | None
    can_list_children: bool | None = None
    parent_path: str = ""
    drive_id: str | None = None


# None is the lookup alias for the connection's root. The value always carries its real ID.
type MetadataLoader = Callable[[], Awaitable[DirectoryMetadata]]


class DirectoryMetadataRead:
    def __init__(
        self, lookup: Callable[[str | None], DirectoryMetadata | None],
        share: Callable[[str | None, MetadataLoader], Awaitable[DirectoryMetadata]],
        *, use_cache: bool,
    ) -> None:
        self._lookup = lookup
        self._share = share
        self.use_cache = use_cache
        self.cached_ids: set[str] = set()
        self.failure_id: str | None = None
        self.observed: dict[str, DirectoryMetadata] = {}
        self.listed: dict[str, set[str]] = {}

    @property
    def used_cache(self) -> bool:
        return bool(self.cached_ids)

    @contextmanager
    def reading_target(self, directory_id: str | None) -> Iterator[None]:
        # Keep the ID on failure so the service can evict only the affected subtree.
        self.failure_id = directory_id
        yield
        self.failure_id = None

    async def load(self, directory_id: str | None, fetch: MetadataLoader) -> DirectoryMetadata:
        if self.use_cache:
            known = self._lookup(directory_id)
            if known is not None:
                # Only live observations are published, so a cache hit cannot renew its TTL.
                self.cached_ids.add(known.id)
                return known
            item = await self._share(directory_id, fetch)
        else:
            item = await fetch()
        self.observe(item)
        return item

    def observe(self, item: DirectoryMetadata) -> None:
        previous = self.observed.get(item.id)
        if previous is not None and previous != item:
            raise DirectoryMetadataConflict("Folder metadata changed during the directory read")
        self.observed[item.id] = item

    def retry_live(self) -> None:
        self.use_cache = False
        self.cached_ids.clear()
        self.failure_id = None
        self.observed.clear()
        self.listed.clear()
