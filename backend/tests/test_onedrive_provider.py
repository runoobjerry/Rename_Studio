from typing import Any

import pytest

from app.providers.base import RenameRequest
from app.providers.onedrive import GRAPH_ROOT, OneDriveProvider
from app.services.onedrive_auth import OneDriveAuthService


def drive_item(item_id: str, name: str, *, folder: bool = False) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": item_id,
        "name": name,
        "size": 12,
        "lastModifiedDateTime": "2026-09-28T08:00:00Z",
        "parentReference": {"path": "/drive/root:/Photos"},
    }
    if folder:
        item["folder"] = {"childCount": 1}
    return item


class StubOneDriveProvider(OneDriveProvider):
    def __init__(self, responses: list[dict[str, object]]) -> None:
        super().__init__(OneDriveAuthService("http://localhost/callback"))
        self.responses = responses
        self.calls: list[tuple[str, str, dict[str, object] | None]] = []

    async def _request_json(
        self,
        method: str,
        url: str,
        *,
        json: dict[str, object] | None = None,
    ) -> dict[str, object]:
        self.calls.append((method, url, json))
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_lists_path_with_pagination_and_maps_folders() -> None:
    next_link = f"{GRAPH_ROOT}/next-page"
    provider = StubOneDriveProvider(
        [
            {"value": [drive_item("1", "Trip", folder=True)], "@odata.nextLink": next_link},
            {"value": [drive_item("2", "photo.jpg")]},
        ]
    )

    items = await provider.list_files("Photos/2026")

    assert "/root:/Photos/2026:/children?" in provider.calls[0][1]
    assert "$select=" in provider.calls[0][1]
    assert provider.calls[1][1] == next_link
    assert [item.name for item in items] == ["Trip", "photo.jpg"]
    assert items[0].is_directory is True
    assert items[0].parent_path == "Photos"


@pytest.mark.asyncio
async def test_rename_many_uses_graph_batch_response() -> None:
    provider = StubOneDriveProvider(
        [
            {
                "responses": [
                    {"id": "0", "status": 200, "body": drive_item("a", "new-a.txt")},
                    {"id": "1", "status": 200, "body": drive_item("b", "new-b.txt")},
                ]
            }
        ]
    )

    results = await provider.rename_many(
        [RenameRequest("a", "new-a.txt"), RenameRequest("b", "new-b.txt")]
    )

    assert provider.calls[0][1] == f"{GRAPH_ROOT}/$batch"
    request_body = provider.calls[0][2]
    assert request_body is not None
    assert len(request_body["requests"]) == 2  # type: ignore[arg-type]
    assert results["a"].name == "new-a.txt"  # type: ignore[union-attr]


def test_rejects_onedrive_reserved_names() -> None:
    provider = StubOneDriveProvider([])

    assert provider.validate_name("desktop.ini") is not None
    assert provider.validate_name("~$draft.docx") is not None
    assert provider.validate_name("valid file.txt") is None
