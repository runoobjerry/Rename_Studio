import pytest

from app.core.errors import ProviderError, ValidationError
from app.providers.onedrive import GRAPH_ROOT, OneDriveProvider
from app.schemas.storage import IdLocation, PathLocation, RootLocation
from app.services.onedrive_auth import OneDriveAuthService


def folder(key: str, name: str, parent: str = "root-id"):
    return {"id": key, "name": name, "folder": {}, "parentReference": {"id": parent, "path": "/drive/root:"}}


class DirectoryProvider(OneDriveProvider):
    def __init__(self, responses):
        super().__init__(OneDriveAuthService("http://localhost/callback"))
        self.responses = responses
        self.urls: list[str] = []

    async def _request_json(self, method, url, *, json=None):
        self.urls.append(url)
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_id_directory_and_parent_do_not_depend_on_names() -> None:
    root = {**folder("root-id", "root"), "root": {}}
    provider = DirectoryProvider([root, folder("opaque-id", "same"), {"value": [folder("child-id", "same", "opaque-id")]}])
    listing = await provider.list_directory(IdLocation(value="opaque-id"))
    assert listing.location == IdLocation(value="opaque-id")
    assert listing.parent_location == RootLocation()
    assert listing.items[0].parent_location == IdLocation(value="opaque-id")
    assert any("/items/opaque-id/children" in url for url in provider.urls)


@pytest.mark.asyncio
async def test_ambiguous_name_path_is_rejected() -> None:
    root = {**folder("root-id", "root"), "root": {}}
    provider = DirectoryProvider([root, {"value": [folder("one", "same"), folder("two", "same")]}])
    with pytest.raises(ValidationError, match="ambiguous"):
        await provider.list_directory(PathLocation(value="same"))


@pytest.mark.asyncio
@pytest.mark.parametrize("next_link", [123, "https://untrusted.example/page", f"{GRAPH_ROOT}/me/drive/root/children?$select=id,name,parentReference,folder,root,size,lastModifiedDateTime&$top=200"])
async def test_invalid_or_repeated_pagination_never_returns_partial_items(next_link) -> None:
    provider = DirectoryProvider([{"value": [folder("one", "same")], "@odata.nextLink": next_link}])
    with pytest.raises(ProviderError):
        await provider.list_files("")


@pytest.mark.asyncio
async def test_invalid_directory_item_is_not_silently_skipped() -> None:
    provider = DirectoryProvider([{"value": [folder("one", "same"), None]}])
    with pytest.raises(ProviderError):
        await provider.list_files("")
