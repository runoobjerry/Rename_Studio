from typing import Any
import asyncio
import json
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime

import pytest
import httpx

from app.core.errors import PermissionDeniedError, ProviderError, RateLimitError, RenameOutcomeUnknownError, ValidationError
from app.providers.base import RenameRequest
from app.providers.onedrive.driver import GRAPH_ROOT, OneDriveProvider
from app.schemas.files import FileItem
from app.schemas.storage import IdLocation, PathLocation, RootLocation
from app.providers.onedrive.auth import OneDriveAuthService
from app.services.execute_service import ExecuteService
from provider_fixtures import CooldownClock


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
        super().__init__(OneDriveAuthService("http://localhost/callback", initial_state={}, persist=lambda payload: None))
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
@pytest.mark.parametrize("final_status", [403, 429])
@pytest.mark.parametrize(("retry_after", "delay"), [
    ("60", 60), ("date", 60), (None, 1), ("invalid", 1), ("nan", 1), ("0", 0),
])
async def test_single_patch_maps_graph_permission_denied(
    monkeypatch: pytest.MonkeyPatch, retry_after: str | None, delay: float, final_status: int,
) -> None:
    clock = CooldownClock(monkeypatch)
    if retry_after == "date":
        retry_after = format_datetime(datetime.fromtimestamp(1793318400, UTC) + timedelta(seconds=60), usegmt=True)
    class AuthorizedAuth(OneDriveAuthService):
        async def access_token(self, *, force_refresh: bool = False) -> str:
            return "fixture-token"

    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(429, headers={"Retry-After": retry_after} if retry_after is not None else {})
        if final_status == 429 and len(requests) <= 4:
            return httpx.Response(429, headers={"Retry-After": "60" if len(requests) == 4 else "0"})
        if request.method == "GET":
            return httpx.Response(200, json=drive_item("after", "after"))
        return httpx.Response(403, json={"error": {"code": "accessDenied", "message": "Access denied"}})

    auth = AuthorizedAuth("http://localhost/callback", initial_state={}, persist=lambda payload: None)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        provider = OneDriveProvider(auth, client=client)
        task = asyncio.create_task(provider.rename("opaque-id", "new.txt"))
        try:
            if delay:
                assert await clock.next_wait() == delay
                assert len(requests) == 1
                clock.advance(delay)
            with pytest.raises(RateLimitError if final_status == 429 else PermissionDeniedError) as caught:
                await asyncio.wait_for(task, 5)
            if final_status == 429:
                task = asyncio.create_task(provider.get_metadata("after"))
                assert await clock.next_wait() == delay + 60
                assert len(requests) == 4
                clock.advance(delay + 60)
                assert (await asyncio.wait_for(task, 5)).id == "after"
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    assert caught.value.code == ("RATE_LIMIT_ERROR" if final_status == 429 else "PERMISSION_DENIED")
    assert caught.value.details == {"graph_status": final_status}
    assert [request.method for request in requests] == (["PATCH"] * 4 + ["GET"] if final_status == 429 else ["PATCH", "PATCH"])


@pytest.mark.asyncio
async def test_single_patch_incomplete_metadata_is_unknown() -> None:
    provider = StubOneDriveProvider([{}])
    with pytest.raises(RenameOutcomeUnknownError):
        await provider.rename("opaque-id", "new.txt")
    assert len(provider.calls) == 1


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
@pytest.mark.parametrize("operation", ["read", "write"])
@pytest.mark.parametrize("throttle", ["outer", "part"])
async def test_rename_many_uses_graph_batch_response(
    monkeypatch: pytest.MonkeyPatch, operation: str, throttle: str,
) -> None:
    class AuthorizedAuth(OneDriveAuthService):
        async def access_token(self, *, force_refresh: bool = False) -> str:
            return "fixture-token"

    clock = CooldownClock(monkeypatch)
    started: asyncio.Queue[str] = asyncio.Queue()
    gates = {key: asyncio.Event() for key in ("extend", "short")}
    batches: list[list[str]] = []
    sent: list[tuple[str, float]] = []
    attempts: dict[str, int] = {}

    async def respond(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            key = request.url.path.rsplit("/", 1)[-1]
            sent.append((key, clock.now))
            attempts[key] = attempts.get(key, 0) + 1
            if key in gates and attempts[key] == 1:
                started.put_nowait(key)
                await gates[key].wait()
                return httpx.Response(429, headers={"Retry-After": "90" if key == "extend" else "1"})
            return httpx.Response(200, json=drive_item(key, key))
        entries = json.loads(request.content)["requests"]
        ids = [entry["url"].split("?")[0].rsplit("/", 1)[-1] for entry in entries]
        sent.append(("batch", clock.now))
        batches.append(ids)
        if len(batches) == 1 and throttle == "outer":
            return httpx.Response(429, headers={"Retry-After": "60"})
        responses = []
        for entry, key in zip(entries, ids, strict=True):
            if len(batches) == 1 and key == "b":
                responses.append({"id": entry["id"], "status": 429, "headers": {"retry-after": "60"}})
            else:
                responses.append({"id": entry["id"], "status": 200, "body": drive_item(key, f"new-{key}.txt")})
        return httpx.Response(200, json={"responses": responses})

    auth = AuthorizedAuth("http://localhost/callback", initial_state={}, persist=lambda payload: None)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        provider = OneDriveProvider(auth, client=client)
        tasks: list[asyncio.Task] = []
        try:
            # These requests are already in flight when the first batch reports throttling.
            for key in gates:
                tasks.append(asyncio.create_task(provider.get_metadata(key)))
                assert await asyncio.wait_for(started.get(), 5) == key
            if operation == "write":
                batch_task = asyncio.create_task(provider.rename_many([RenameRequest("a", "new-a.txt"), RenameRequest("b", "new-b.txt")]))
            else:
                batch_task = asyncio.create_task(provider.get_metadata_many(["a", "b"]))
            tasks.append(batch_task)
            assert await clock.next_wait() == 60
            queued = asyncio.create_task(provider.get_metadata("queued"))
            tasks.append(queued)
            assert await clock.next_wait() == 60
            # A distinct connection shares neither the deadline nor cancellation state.
            independent = OneDriveProvider(auth, client=client)
            assert (await independent.get_metadata("independent")).id == "independent"
            assert batches == [["a", "b"]]
            assert "queued" not in attempts

            clock.advance(5)
            gates["extend"].set()
            assert await clock.next_wait() == 95
            clock.advance(10)
            gates["short"].set()
            assert await clock.next_wait() == 95
            clock.advance(60)
            # Waking at the original deadline must recheck the extended deadline.
            assert [await clock.next_wait(), await clock.next_wait()] == [95, 95]
            assert batches == [["a", "b"]]
            assert "queued" not in attempts
            queued.cancel()
            with pytest.raises(asyncio.CancelledError):
                await queued
            survivor = asyncio.create_task(provider.get_metadata("survivor"))
            tasks.append(survivor)
            assert await clock.next_wait() == 95
            clock.advance(95)
            await asyncio.wait_for(asyncio.gather(*(task for task in tasks if task is not queued)), 5)
            result = batch_task.result()
            items = list(result.values()) if operation == "write" else result
            assert [item.name for item in items] == ["new-a.txt", "new-b.txt"]
            assert batches == [["a", "b"], ["a", "b"] if throttle == "outer" else ["b"]]
            assert all(at in (0, 95) for _, at in sent)
            assert "queued" not in attempts
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


def test_rejects_onedrive_reserved_names() -> None:
    provider = StubOneDriveProvider([])

    assert provider.validate_name("desktop.ini") is not None
    assert provider.validate_name("~$draft.docx") is not None
    assert provider.validate_name("valid file.txt") is None


@pytest.mark.asyncio
async def test_service_two_group_window_does_not_multiply_graph_concurrency() -> None:
    class GatedGraphProvider(StubOneDriveProvider):
        def __init__(self) -> None:
            super().__init__([])
            self.started: asyncio.Queue[int] = asyncio.Queue()
            self.gates: list[asyncio.Event] = []
            self.active = 0
            self.peak = 0
            self.release_all = False

        async def _request_json(
            self, method: str, url: str, *, json: dict[str, Any] | None = None,
        ) -> dict[str, object]:
            assert method == "POST" and url == f"{GRAPH_ROOT}/$batch"
            assert json is not None
            index = len(self.calls)
            self.calls.append((method, url, json))
            gate = asyncio.Event()
            self.gates.append(gate)
            if self.release_all:
                gate.set()
            self.active += 1
            self.peak = max(self.peak, self.active)
            self.started.put_nowait(index)
            try:
                await gate.wait()
                return {"responses": [
                    {"id": entry["id"], "status": 200,
                     "body": drive_item(entry["url"].rsplit("/", 1)[-1], entry["body"]["name"])}
                    for entry in json["requests"]
                ]}
            finally:
                self.active -= 1

    provider = GatedGraphProvider()
    requests = [RenameRequest(f"file-{index}", f"new-{index}.txt") for index in range(41)]
    task = asyncio.create_task(ExecuteService._rename_in_batches(provider, requests, allow_concurrent=True))
    try:
        assert [await asyncio.wait_for(provider.started.get(), 5),
                await asyncio.wait_for(provider.started.get(), 5)] == [0, 1]
        assert provider.active == provider.peak == 2
        provider.gates[1].set()
        assert await asyncio.wait_for(provider.started.get(), 5) == 2
        assert not provider.gates[0].is_set()
        assert provider.active == 2
    finally:
        provider.release_all = True
        for gate in provider.gates:
            gate.set()
        outcomes = await asyncio.wait_for(task, 5)
    assert [len(body["requests"]) for _, _, body in provider.calls] == [20, 20, 1]
    assert provider.peak == 2
    assert provider.active == 0
    assert set(outcomes) == {entry.file_id for entry in requests}
    for entry in requests:
        outcome = outcomes[entry.file_id]
        assert isinstance(outcome, FileItem)
        assert outcome.name == entry.new_name


def folder(key: str, name: str, parent: str = "root-id"):
    return {"id": key, "name": name, "folder": {}, "parentReference": {"id": parent, "path": "/drive/root:"}}


@pytest.mark.asyncio
async def test_id_directory_and_parent_do_not_depend_on_names() -> None:
    root = {**folder("root-id", "root"), "root": {}}
    provider = StubOneDriveProvider([root, folder("opaque-id", "same"), {"value": [folder("child-id", "same", "opaque-id")]}])
    listing = await provider.list_directory(IdLocation(value="opaque-id"))
    assert listing.location == IdLocation(value="opaque-id")
    assert listing.directory_id == "opaque-id"
    assert listing.parent_location == RootLocation()
    assert listing.items[0].parent_location == IdLocation(value="opaque-id")
    assert any("/items/opaque-id/children" in url for _, url, _ in provider.calls)


@pytest.mark.asyncio
async def test_root_listing_exposes_real_identity_without_extra_requests() -> None:
    root = {**folder("root-id", "root"), "root": {}}
    provider = StubOneDriveProvider([root, {"value": [folder("child", "child")]}])
    listing = await provider.list_directory(RootLocation())
    assert listing.location == RootLocation()
    assert listing.directory_id == "root-id"
    assert listing.items[0].parent_location == IdLocation(value=listing.directory_id)
    assert len(provider.calls) == 2


@pytest.mark.asyncio
async def test_ambiguous_name_path_is_rejected() -> None:
    root = {**folder("root-id", "root"), "root": {}}
    provider = StubOneDriveProvider([root, {"value": [folder("one", "same"), folder("two", "same")]}])
    with pytest.raises(ValidationError, match="ambiguous"):
        await provider.list_directory(PathLocation(value="same"))


@pytest.mark.asyncio
@pytest.mark.parametrize("next_link", [123, "https://untrusted.example/page", f"{GRAPH_ROOT}/me/drive/root/children?$select=id,name,parentReference,folder,root,size,lastModifiedDateTime&$top=200"])
async def test_invalid_or_repeated_pagination_never_returns_partial_items(next_link) -> None:
    provider = StubOneDriveProvider([{"value": [folder("one", "same")], "@odata.nextLink": next_link}])
    with pytest.raises(ProviderError):
        await provider.list_files("")


@pytest.mark.asyncio
async def test_invalid_directory_item_is_not_silently_skipped() -> None:
    provider = StubOneDriveProvider([{"value": [folder("one", "same"), None]}])
    with pytest.raises(ProviderError):
        await provider.list_files("")
