from datetime import datetime, timezone

import pytest

from app.core.errors import PreviewExpiredError
from app.schemas.files import FileItem
from app.schemas.rename import RenamePreviewRequest
from app.services.preview_store import PreviewStore


def test_expired_preview_cannot_be_loaded() -> None:
    store = PreviewStore(ttl_seconds=0)
    source = FileItem(
        id="one.txt",
        name="one.txt",
        path="one.txt",
        parent_path="",
        is_directory=False,
        size=1,
        modified_at=datetime.now(timezone.utc),
    )
    response = store.save(
        RenamePreviewRequest(file_ids=["one.txt"]),
        items=[],
        valid=True,
        sources=[source],
    )

    with pytest.raises(PreviewExpiredError):
        store.get(response.preview_id)
