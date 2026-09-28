import asyncio
from pathlib import PurePosixPath

from app.core.paths import normalize_storage_path
from app.providers.local import LocalProvider
from app.providers.registry import ProviderRegistry
from app.schemas.files import DirectoryListing, ProviderInfo
from app.schemas.local import LocalFolderPickResponse, LocalSettingsResponse
from app.services.local_folder_picker import choose_local_directory


class FileService:
    def __init__(self, providers: ProviderRegistry) -> None:
        self.providers = providers

    def list_providers(self) -> list[ProviderInfo]:
        return [
            ProviderInfo(id=provider.id, name=provider.display_name, writable=True)
            for provider in self.providers.all()
        ]

    def local_settings(self) -> LocalSettingsResponse:
        provider = self.providers.get("local")
        if not isinstance(provider, LocalProvider):
            raise RuntimeError("Local provider is not registered")
        return LocalSettingsResponse(root_path=str(provider.root))

    def configure_local_root(self, root_path: str) -> LocalSettingsResponse:
        provider = self.providers.get("local")
        if not isinstance(provider, LocalProvider):
            raise RuntimeError("Local provider is not registered")
        return LocalSettingsResponse(
            root_path=str(provider.configure_root(root_path))
        )

    async def pick_local_root(self) -> LocalFolderPickResponse:
        provider = self.providers.get("local")
        if not isinstance(provider, LocalProvider):
            raise RuntimeError("Local provider is not registered")
        # 系统对话框会阻塞调用线程，因此不能直接占用 FastAPI 事件循环。
        selected = await asyncio.to_thread(choose_local_directory, provider.root)
        if selected is None:
            return LocalFolderPickResponse(
                root_path=str(provider.root),
                selected=False,
            )
        configured = provider.configure_root(str(selected))
        return LocalFolderPickResponse(root_path=str(configured), selected=True)

    async def list_files(self, provider_id: str, path: str) -> DirectoryListing:
        provider = self.providers.get(provider_id)
        normalized = normalize_storage_path(path)
        parent: str | None = None
        if normalized:
            value = PurePosixPath(normalized).parent.as_posix()
            parent = "" if value == "." else value
        return DirectoryListing(
            provider=provider_id,
            path=normalized,
            parent_path=parent,
            items=await provider.list_files(normalized),
        )
