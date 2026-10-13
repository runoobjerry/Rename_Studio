from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.core.errors import PreviewExpiredError, PreviewNotFoundError
from app.schemas.files import FileItem
from app.schemas.rename import PreviewItem, RenamePreviewRequest, RenamePreviewResponse


@dataclass(frozen=True, slots=True)
class PreviewSnapshot:
    preview_id: str
    expires_at: datetime
    request: RenamePreviewRequest
    response: RenamePreviewResponse
    sources: tuple[FileItem, ...]
    connection_revision: int = 0


class PreviewStore:
    def __init__(self, ttl_seconds: int = 600) -> None:
        self.ttl = timedelta(seconds=ttl_seconds)
        self._snapshots: dict[str, PreviewSnapshot] = {}

    def save(
        self,
        request: RenamePreviewRequest,
        items: list[PreviewItem],
        valid: bool,
        sources: list[FileItem],
        connection_revision: int = 0,
    ) -> RenamePreviewResponse:
        now = datetime.now(timezone.utc)
        preview_id = str(uuid4())
        self.purge_expired()
        response = RenamePreviewResponse(
            preview_id=preview_id,
            expires_at=now + self.ttl,
            items=items,
            valid=valid,
        )
        self._snapshots[preview_id] = PreviewSnapshot(
            preview_id=preview_id,
            expires_at=response.expires_at,
            request=request.model_copy(deep=True),
            response=response.model_copy(deep=True),
            sources=tuple(item.model_copy(deep=True) for item in sources),
            connection_revision=connection_revision,
        )
        return response

    def get(self, preview_id: str) -> PreviewSnapshot:
        snapshot = self._snapshots.get(preview_id)
        if snapshot is None:
            raise PreviewNotFoundError("Rename preview was not found")
        if snapshot.expires_at <= datetime.now(timezone.utc):
            self._snapshots.pop(preview_id, None)
            raise PreviewExpiredError("Rename preview has expired")
        return snapshot

    def consume(self, preview_id: str) -> None:
        self._snapshots.pop(preview_id, None)

    def clear(self) -> None:
        self._snapshots.clear()

    def release(self, preview_id: str, storage_id: str) -> None:
        # 仅释放调用方指定连接的快照；已消费、过期或重复释放均无需报错。
        snapshot = self._snapshots.get(preview_id)
        if snapshot is not None and snapshot.request.storage_id == storage_id:
            self._snapshots.pop(preview_id)

    def purge_expired(self) -> None:
        now = datetime.now(timezone.utc)
        expired = [
            preview_id
            for preview_id, snapshot in self._snapshots.items()
            if snapshot.expires_at <= now
        ]
        for preview_id in expired:
            self._snapshots.pop(preview_id, None)
