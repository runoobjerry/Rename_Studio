import pytest

from app.core.errors import AppError, NotFoundError, ProviderError, RenameOutcomeUnknownError
from app.schemas.files import DirectoryBreadcrumb, DirectoryListing, FileItem, RenameFile
from app.schemas.storage import IdLocation, RootLocation, StorageLocation
from app.services.directory import directory_cache
from app.services.directory.directory_cache import DirectoryCache, DirectoryKey, RenameCacheScope


def cache_listing(
    cache: DirectoryCache, *folders: str, items: list[FileItem] | None = None,
    storage_id: str = "cloud", revision: int = 1,
) -> DirectoryKey:
    locations = [RootLocation(), *(IdLocation(value=folder) for folder in folders)]
    listing = DirectoryListing(
        provider="fixture", path="/".join(folders), parent_path="/".join(folders[:-1]) if folders else None,
        directory_id=folders[-1] if folders else "root-id", root_id="root-id", location=locations[-1],
        parent_location=locations[-2] if folders else None, items=items or [],
        breadcrumbs=[DirectoryBreadcrumb(name=name, location=location)
                     for name, location in zip(("Root", *folders), locations)],
    )
    key = (storage_id, revision, locations[-1])
    cache.put(key, listing, listing.model_dump_json().encode("utf-8"))
    return key


def item(file_id: str, parent: StorageLocation, *, folder: bool = False) -> FileItem:
    return FileItem(id=file_id, name=file_id, path=file_id, parent_path="", parent_location=parent,
                    is_directory=folder)


@pytest.mark.parametrize(("failure", "parent_trusted"), [
    (ProviderError("Rejected"), True), (NotFoundError("Gone"), False),
    (ProviderError("Changed", details={"actual_name": "external"}), False),
    (RenameFile(id="folder", name="external", parent_location=RootLocation(), is_directory=True), False),
    (RenameOutcomeUnknownError("Lost response"), False),
], ids=["rejected", "missing", "stale", "unconfirmed-target", "unknown"])
def test_partial_success_preserves_only_trustworthy_caches(
    failure: RenameFile | AppError, parent_trusted: bool,
) -> None:
    cache = DirectoryCache()
    root = RootLocation()
    source, folder = item("file", root), item("folder", root, folder=True)
    parent = cache_listing(cache, items=[source, folder])
    descendant = cache_listing(cache, "folder", "nested")
    unrelated = cache_listing(cache, "other")
    old_revision = cache_listing(cache, items=[source, folder], revision=2)
    other_storage = cache_listing(cache, items=[source, folder], storage_id="other")
    scope = RenameCacheScope(folder_ids={"folder"})
    scope.observe("file", root, "file", source.model_copy(update={"name": "new"}), target_confirmed=True)
    scope.observe("folder", root, "folder", failure, target_confirmed=False)
    cache.finish_rename("cloud", 1, scope)

    if parent_trusted:
        assert [entry.name for entry in cache.get(parent).items] == ["new", "folder"]
        assert cache.get(descendant) is not None
        assert cache.ancestor("cloud", 1, "folder") is not None
    else:
        assert cache.get(parent) is None
        assert cache.get(descendant) is None
        assert cache.ancestor("cloud", 1, "folder") is None
    assert cache.get(old_revision) is None
    assert (cache.get(unrelated) is None) == isinstance(failure, RenameOutcomeUnknownError)
    assert cache.get(other_storage) is not None


def test_original_folder_identity_invalidates_subtree_when_result_type_disagrees() -> None:
    cache = DirectoryCache()
    source = item("folder", RootLocation(), folder=True)
    parent = cache_listing(cache, items=[source])
    descendant = cache_listing(cache, "folder", "nested")
    scope = RenameCacheScope(folder_ids={"folder"})
    scope.observe("folder", RootLocation(), "folder", source.model_copy(update={
        "name": "new", "is_directory": False,
    }), target_confirmed=True)
    cache.finish_rename("cloud", 1, scope)
    assert cache.get(parent) is None
    assert cache.get(descendant) is None
    assert cache.ancestor("cloud", 1, "folder") is None


@pytest.mark.parametrize("parent_location", [None, IdLocation(value="other")], ids=["missing-parent", "moved-parent"])
def test_unsafe_patch_invalidates_affected_parent(parent_location: StorageLocation | None) -> None:
    cache = DirectoryCache()
    root = RootLocation()
    source = item("file", root)
    parent = cache_listing(cache, items=[source])
    other = cache_listing(cache, "other")
    scope = RenameCacheScope()
    scope.observe("file", root, "file", source.model_copy(update={
        "name": "new", "parent_location": parent_location,
    }), target_confirmed=True)
    cache.finish_rename("cloud", 1, scope)
    assert cache.get(parent) is None
    assert (cache.get(other) is None) == (parent_location == IdLocation(value="other"))


def test_root_alias_patch_preserves_confirmed_identity_and_original_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    now = 10
    monkeypatch.setattr(directory_cache, "monotonic", lambda: now)
    cache = DirectoryCache()
    source = item("old-id", RootLocation())
    parent = cache_listing(cache, items=[source])
    deadline = cache.expires_at(parent)
    now = 20
    scope = RenameCacheScope()
    scope.observe("old-id", IdLocation(value="root-id"), "old-id", RenameFile(
        id="new-id", name="new", parent_location=RootLocation(), is_directory=False,
    ), target_confirmed=True)
    cache.finish_rename("cloud", 1, scope)
    current = cache.get(parent).items[0]
    assert (current.id, current.name, current.path, current.parent_path) == ("new-id", "new", "new", "")
    assert cache.expires_at(parent) == deadline
    now = deadline
    assert cache.get(parent) is None
    assert cache.ancestor("cloud", 1, RootLocation()) is None
