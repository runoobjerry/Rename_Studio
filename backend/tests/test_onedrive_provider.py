from typing import Any
import asyncio
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

import pytest
import pytest_asyncio
import httpx

from app.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    PreviewExpiredError,
    ProviderError,
    RateLimitError,
    RenameConflictError,
    RenameOutcomeUnknownError,
    ValidationError,
)
from app.providers.retry import RetryBudget
from app.providers.base import RenameRequest
from app.providers.registry import ProviderDefinition, ProviderRegistry
from app.providers.onedrive.definition import OneDriveConfig
from app.providers.onedrive.driver import GRAPH_ROOT, OneDriveProvider
from app.repositories.storage_repository import JsonStorageRepository
from app.schemas.files import DirectoryListing, FileItem
from app.rules.registry import RuleRegistry
from app.schemas.rename import RenamePreviewRequest, SingleRenameExecuteRequest
from app.schemas.storage import IdLocation, RootLocation, StorageRecord, StorageState, StorageUpdate
from app.providers.onedrive.auth import OneDriveAuthService
from app.services import directory_cache
from app.services.execute_service import ExecuteService
from app.services.preview_service import PreviewService
from app.services.rename_engine import RenameEngine
from app.services.single_rename_service import SingleRenameService
from app.services.storage_manager import StorageManager
from provider_fixtures import CooldownClock


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [408, 503])
async def test_uncertain_part_preserves_success_and_refusal_without_resubmission(status: int) -> None:
    provider = StubOneDriveProvider([{"responses": [
        {"id": "0", "status": 200, "body": drive_item("a", "AA")},
        {"id": "1", "status": status},
        {"id": "2", "status": 429, "headers": {"Retry-After": "0"}},
    ]}])
    result = await provider.rename_many([RenameRequest("a", "AA"), RenameRequest("b", "BB"), RenameRequest("c", "CC")])
    assert result["a"].name == "AA"
    assert isinstance(result["b"], RenameOutcomeUnknownError)
    assert isinstance(result["c"], RateLimitError)
    assert len(provider.calls) == 1


@pytest.mark.asyncio
async def test_verified_different_batch_name_is_failed_without_replay() -> None:
    provider = StubOneDriveProvider([{"responses": [
        {"id": "0", "status": 200, "body": drive_item("a", "external.txt")},
    ]}])
    result = await provider.rename_many([RenameRequest("a", "new.txt")])
    assert isinstance(result["a"], ProviderError)
    assert result["a"].details["actual_name"] == "external.txt"
    assert len(provider.calls) == 1


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
        budget: RetryBudget | None = None,
    ) -> dict[str, object]:
        if budget is not None:
            budget.used += 1
        self.calls.append((method, url, json))
        return self.responses.pop(0)


@pytest.mark.asyncio
@pytest.mark.parametrize(("status", "inner_code", "expected_code", "expected_reason"), [
    (400, "nameAlreadyExists", "RENAME_CONFLICT", None),
    (409, "resourceModified", "RENAME_CONFLICT", "SOURCE_CHANGED"),
    (400, "unrecognizedCode", "VALIDATION_ERROR", None),
    (412, "unrecognizedCode", "RENAME_CONFLICT", "SOURCE_CHANGED"),
])
async def test_batch_rename_classifies_graph_codes_without_exposing_message(
    status: int, inner_code: str, expected_code: str, expected_reason: str | None,
) -> None:
    upstream_message = "Upstream diagnostic with a private file path"
    provider = StubOneDriveProvider([{"responses": [{
        "id": "0",
        "status": status,
        "body": {"error": {
            "code": "generalException",
            "message": upstream_message,
            "innerError": {"code": inner_code, "message": upstream_message},
        }},
    }]}])

    result = (await provider.rename_many([RenameRequest("a", "new.txt")]))["a"]

    assert isinstance(result, (RenameConflictError, ValidationError))
    assert result.code == expected_code
    assert result.details.get("reason") == expected_reason
    assert result.details["provider_codes"] == ["generalException", inner_code]
    assert result.details["provider_status"] == status
    assert upstream_message not in result.message
    assert upstream_message not in str(result.details)


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
    assert caught.value.details == {"provider_type": "onedrive", "provider_status": final_status, "graph_status": final_status,
                                         **({"provider_codes": ["accessDenied"]} if final_status == 403 else {})}
    assert [request.method for request in requests] == (["PATCH"] * 4 + ["GET"] if final_status == 429 else ["PATCH", "PATCH"])


@pytest.mark.asyncio
async def test_single_patch_incomplete_metadata_is_unknown() -> None:
    provider = StubOneDriveProvider([{}])
    with pytest.raises(RenameOutcomeUnknownError):
        await provider.rename("opaque-id", "new.txt")
    assert len(provider.calls) == 1


@pytest.mark.asyncio
async def test_lists_root_with_pagination_and_maps_folders() -> None:
    next_link = f"{GRAPH_ROOT}/next-page"
    provider = StubOneDriveProvider(
        [
            {"value": [drive_item("1", "Trip", folder=True)], "@odata.nextLink": next_link},
            {"value": [drive_item("2", "photo.jpg")]},
        ]
    )

    items = await provider.list_files("")

    assert "/root/children?" in provider.calls[0][1]
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
            budget: RetryBudget | None = None,
        ) -> dict[str, object]:
            if budget is not None:
                budget.used += 1
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
    task = asyncio.create_task(ExecuteService._rename_in_batches(provider, requests))
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
@pytest.mark.parametrize("drive_id", [None, "opaque-default-drive"])
async def test_root_listing_exposes_real_identity_without_extra_requests(drive_id: str | None) -> None:
    root = {**folder("root-id", "root"), "root": {}}
    if drive_id is not None:
        root["parentReference"]["driveId"] = drive_id
    provider = StubOneDriveProvider([root, {"value": [folder("child", "child")]}])
    listing = await provider.list_directory(RootLocation())
    assert listing.location == RootLocation()
    assert listing.directory_id == "root-id"
    assert listing.drive_id == drive_id
    assert listing.items[0].parent_location == IdLocation(value=listing.directory_id)
    assert len(provider.calls) == 2
    provider.responses.extend([root, folder("nested", "nested"), {"value": []}])
    nested = await provider.list_directory(IdLocation(value="nested"))
    assert nested.drive_id == drive_id
    assert len(provider.calls) == 5


class DirectoryGraph:
    def __init__(self) -> None:
        self.folders = {
            "root-id": {**folder("root-id", "root"), "root": {}},
            "a": folder("a", "A"),
            "b": folder("b", "B", "a"),
            "c": folder("c", "C", "b"),
            "d": folder("d", "D", "c"),
            "other": folder("other", "Other"),
        }
        self.requests: list[tuple[str, str]] = []

    def payload(self, key: str) -> dict:
        item = self.folders[key]
        if key == "root-id":
            return item
        parent = item["parentReference"]["id"]
        names = []
        while parent != "root-id":
            names.append(quote(self.folders[parent]["name"], safe=""))
            parent = self.folders[parent]["parentReference"]["id"]
        return {**item, "parentReference": {
            **item["parentReference"], "path": "/drive/root:/" + "/".join(reversed(names)),
        }}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        route = request.url.path.removeprefix("/v1.0/me/drive/")
        self.requests.append((request.method, route))
        if route == "root":
            return httpx.Response(200, json=self.folders["root-id"])
        _, key, *suffix = route.split("/")
        if key not in self.folders:
            return httpx.Response(404, json={"error": {"code": "itemNotFound"}})
        if suffix == ["children"]:
            return httpx.Response(200, json={"value": [
                self.payload(item["id"]) for item in self.folders.values()
                if item["id"] != "root-id" and item["parentReference"]["id"] == key
            ]})
        item = self.folders[key]
        if request.method == "PATCH":
            item["name"] = json.loads(request.content)["name"]
        return httpx.Response(200, json=self.payload(key))


@pytest_asyncio.fixture
async def directory_graph(tmp_path: Path) -> AsyncIterator[tuple[StorageManager, DirectoryGraph]]:
    class AuthorizedAuth(OneDriveAuthService):
        async def access_token(self, *, force_refresh: bool = False) -> str:
            return "fixture-token"

    graph = DirectoryGraph()
    auth = AuthorizedAuth("http://localhost/callback", initial_state={}, persist=lambda payload: None)
    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        registry = ProviderRegistry()
        registry.register(ProviderDefinition(
            "onedrive", OneDriveConfig, ("root", "id"),
            lambda record, _: OneDriveProvider(auth, client=client), cache_directories=True,
        ))
        record = StorageRecord(storage_id="drive", provider_type="onedrive", name="Drive", config={"client_id": "original"})
        manager = StorageManager(registry, JsonStorageRepository(tmp_path / "state.json"), StorageState(connections={"drive": record}))
        yield manager, graph


@pytest.mark.asyncio
async def test_browsing_and_repeated_breadcrumb_jumps_share_existing_listings(directory_graph, caplog) -> None:
    manager, graph = directory_graph
    caplog.set_level("DEBUG", logger="rename_studio.directory")
    directories = manager.directories
    chain = [("root", RootLocation()), ("A", IdLocation(value="a")), ("B", IdLocation(value="b")),
             ("C", IdLocation(value="c")), ("D", IdLocation(value="d"))]
    for index, (_, location) in enumerate(chain):
        listing = await directories.list_directory("drive", location, parent_location=chain[index - 1][1] if index else None)
        assert [(crumb.name, crumb.location) for crumb in listing.breadcrumbs] == chain[:index + 1]
        if index:
            assert listing.parent_location == chain[index - 1][1]
    assert graph.requests == [("GET", "root"), ("GET", "items/root-id/children")] + [
        ("GET", f"items/{key}/children") for key in ("a", "b", "c", "d")
    ]
    count = len(graph.requests)
    caplog.clear()
    a, b = listing.breadcrumbs[1:3]
    d = listing.breadcrumbs[-1]
    for target in (a, d, b, d, a):
        opened = await directories.list_directory("drive", target.location)
        assert opened.location == target.location
    assert sum(record.message == "directory cache hit storage_id=drive" for record in caplog.records) == 5
    assert len(graph.requests) == count


@pytest.mark.asyncio
async def test_graph_missing_target_does_not_retry_or_evict_other_directories(directory_graph) -> None:
    manager, graph = directory_graph
    directories = manager.directories
    root = await directories.list_directory("drive", RootLocation())
    graph.requests.clear()
    with pytest.raises(NotFoundError):
        await directories.list_directory("drive", IdLocation(value="missing"))
    assert await directories.list_directory("drive", RootLocation()) == root
    await directories.list_directory("drive", IdLocation(value="a"), parent_location=RootLocation())
    assert graph.requests == [("GET", "root"), ("GET", "items/missing"), ("GET", "items/a/children")]


@pytest.mark.asyncio
async def test_graph_deleted_folder_evicts_descendants_but_keeps_unrelated_listings(directory_graph) -> None:
    manager, graph = directory_graph
    directories = manager.directories
    parent, child, other = (IdLocation(value=value) for value in ("a", "b", "other"))
    await directories.list_directory("drive", parent)
    await directories.list_directory("drive", child)
    unrelated = await directories.list_directory("drive", other)
    for folder_id in ("a", "b", "c", "d"):
        del graph.folders[folder_id]
    with pytest.raises(NotFoundError):
        await directories.list_directory("drive", parent, mode="refresh")

    graph.requests.clear()
    assert await directories.list_directory("drive", other) == unrelated
    with pytest.raises(NotFoundError):
        await directories.list_directory("drive", child)
    assert graph.requests == [("GET", "root"), ("GET", "items/b")]


@pytest.mark.asyncio
async def test_cold_deep_listing_resolves_ancestor_ids_with_duplicate_and_separator_names(directory_graph) -> None:
    manager, graph = directory_graph
    graph.folders["a"]["name"] = graph.folders["other"]["name"] = "Same"
    graph.folders["b"]["name"] = "with/slash"
    graph.folders["nested"] = folder("nested", "D", "d")
    location = IdLocation(value="d")
    listing = await manager.directories.list_directory("drive", location)
    assert [(crumb.name, crumb.location) for crumb in listing.breadcrumbs] == [
        ("root", RootLocation()), ("Same", IdLocation(value="a")), ("with/slash", IdLocation(value="b")),
        ("C", IdLocation(value="c")), ("D", IdLocation(value="d")),
    ]
    assert listing.location == location and listing.directory_id == "d"
    assert listing.items[0].parent_location == location
    assert listing.path == "Same/with%2Fslash/C/D"
    assert graph.requests == [("GET", route) for route in (
        "root", "items/d", "items/d/children", "items/c", "items/b", "items/a",
    )]


@pytest.mark.asyncio
async def test_missing_parent_hint_reads_the_directory_live_even_with_a_cached_parent(directory_graph) -> None:
    manager, graph = directory_graph
    await manager.directories.list_directory("drive", RootLocation())
    graph.requests.clear()
    listing = await manager.directories.list_directory("drive", IdLocation(value="a"))
    assert [crumb.name for crumb in listing.breadcrumbs] == ["root", "A"]
    assert graph.requests == [("GET", route) for route in ("root", "items/a", "items/a/children")]


@pytest.mark.asyncio
async def test_child_lookup_parses_only_the_named_parent_listing(directory_graph, monkeypatch) -> None:
    manager, graph = directory_graph
    directories = manager.directories
    root = RootLocation()
    other, a = (IdLocation(value=key) for key in ("other", "a"))
    await directories.list_directory("drive", root)
    await directories.list_directory("drive", other, parent_location=root)
    parsed: list[str | None] = []
    parse = DirectoryListing.model_validate_json

    def track(payload: bytes) -> DirectoryListing:
        listing = parse(payload)
        parsed.append(listing.directory_id)
        return listing

    monkeypatch.setattr(DirectoryListing, "model_validate_json", staticmethod(track))
    graph.requests.clear()
    opened = await directories.list_directory("drive", a, parent_location=IdLocation(value="root-id"))
    assert opened.parent_location == root
    assert parsed == ["root-id"]
    assert graph.requests == [("GET", "items/a/children")]


@pytest.mark.asyncio
@pytest.mark.parametrize("hint", ["expired", "wrong"])
async def test_unavailable_parent_hint_falls_back_to_live_identity(directory_graph, monkeypatch, hint: str) -> None:
    manager, graph = directory_graph
    directories = manager.directories
    now = 0.0
    monkeypatch.setattr(directory_cache, "monotonic", lambda: now)
    root, other = RootLocation(), IdLocation(value="other")
    await directories.list_directory("drive", root)
    if hint == "expired":
        now = 600
        parent = root
    else:
        await directories.list_directory("drive", other, parent_location=root)
        parent = other
    graph.requests.clear()
    opened = await directories.list_directory("drive", IdLocation(value="a"), parent_location=parent)
    assert opened.parent_location == root
    assert graph.requests == [("GET", route) for route in ("root", "items/a", "items/a/children")]


@pytest.mark.asyncio
async def test_deleted_hinted_folder_invalidates_parent_and_retries_once_live(directory_graph) -> None:
    manager, graph = directory_graph
    directories = manager.directories
    a, b, other = (IdLocation(value=key) for key in ("a", "b", "other"))
    await directories.list_directory("drive", a)
    unrelated = await directories.list_directory("drive", other)
    del graph.folders["b"]
    graph.requests.clear()
    with pytest.raises(NotFoundError):
        await directories.list_directory("drive", b, parent_location=a)
    assert graph.requests == [("GET", route) for route in ("items/b/children", "root", "items/b")]
    assert await directories.list_directory("drive", other) == unrelated
    assert (await directories.list_directory("drive", a)).items == []


@pytest.mark.asyncio
async def test_old_graph_paths_are_display_hints_and_execute_rechecks_live_membership(directory_graph) -> None:
    manager, graph = directory_graph
    directories = manager.directories
    a, b = (IdLocation(value=key) for key in ("a", "b"))
    await directories.list_directory("drive", a)
    graph.folders["b"]["parentReference"]["id"] = "other"
    graph.requests.clear()
    stale = await directories.list_directory("drive", b, parent_location=a)
    assert stale.path == "A/B" and stale.parent_location == a
    assert graph.requests == [("GET", "items/b/children")]
    preview = PreviewService(manager.registry, RenameEngine(RuleRegistry()))
    execute = ExecuteService(manager.registry, preview.store, preview)
    snapshot = await preview.preview(RenamePreviewRequest(
        storage_id="drive", location=b, file_ids=["c"], target_name="Renamed",
    ))
    assert snapshot.valid
    graph.folders["c"]["parentReference"]["id"] = "other"
    graph.requests.clear()
    with pytest.raises(PreviewExpiredError):
        await execute.execute(snapshot.preview_id)
    assert graph.requests == [("GET", route) for route in ("root", "items/b", "items/b/children")]


@pytest.mark.asyncio
async def test_rename_and_connection_revision_invalidate_cached_directory_ancestors(directory_graph) -> None:
    manager, graph = directory_graph
    directories = manager.directories
    a, d, other = (IdLocation(value=key) for key in ("a", "d", "other"))
    for location in (a, d, other):
        await directories.list_directory("drive", location)
    result = await SingleRenameService(manager.registry).execute("drive", SingleRenameExecuteRequest(
        revision=1, operation_id=uuid4(), location=RootLocation(), file_id="a", original_name="A", target_name="Renamed",
    ))
    assert result.items[0].status == "renamed"
    graph.requests.clear()
    await directories.list_directory("drive", other)
    assert graph.requests == []
    assert (await directories.list_directory("drive", d)).breadcrumbs[1].name == "Renamed"
    assert (await directories.list_directory("drive", a)).breadcrumbs[1].name == "Renamed"
    assert ("GET", "items/d/children") in graph.requests and ("GET", "items/a/children") in graph.requests

    await manager.update("drive", StorageUpdate(config={"client_id": "replacement"}))
    graph.folders["a"]["name"] = "New connection"
    graph.requests.clear()
    reopened = await directories.list_directory("drive", d)
    assert reopened.revision == 2 and reopened.breadcrumbs[1].name == "New connection"
    assert ("GET", "root") in graph.requests and ("GET", "items/a") in graph.requests


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
