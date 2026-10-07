import asyncio
from pathlib import Path

from app.core.errors import ValidationError
from app.providers.local import LocalProvider
from app.providers.registry import ProviderRegistry
from app.schemas.files import DirectoryListing, ProviderInfo
from app.schemas.local import LocalFolderPickResponse, LocalSettingsResponse
from app.services.local_folder_picker import choose_local_directory
from app.schemas.storage import PathLocation, StorageUpdate


class FileService:
    def __init__(self, providers: ProviderRegistry) -> None:
        self.providers = providers

    def list_providers(self) -> list[ProviderInfo]:
        if self.providers.manager is not None:
            manager = self.providers.manager
            return [ProviderInfo(id=key, name=manager.registry.definition(key).name,
                                 writable=manager.record(key).enabled and manager.registry.definition(key).can_rename)
                    for key in ("local", "onedrive")]
        return [
            ProviderInfo(id=provider.id, name=provider.display_name, writable=True)
            for provider in self.providers.all()
        ]

    def local_settings(self) -> LocalSettingsResponse:
        if self.providers.manager is not None:
            return LocalSettingsResponse(root_path=str(self.providers.manager.record("local").config["root_path"]))
        provider = self.providers.get("local")
        if not isinstance(provider, LocalProvider):
            raise RuntimeError("Local provider is not registered")
        return LocalSettingsResponse(root_path=str(provider.root))

    async def configure_local_root(self, root_path: str) -> LocalSettingsResponse:
        if self.providers.manager is not None:
            self.providers.manager.ensure_mutable("local")
            root = self._validated_root(root_path)
            await self.providers.manager.update("local", StorageUpdate(config={"root_path": str(root)}))
            return LocalSettingsResponse(root_path=str(root))
        provider = self.providers.get("local")
        if not isinstance(provider, LocalProvider):
            raise RuntimeError("Local provider is not registered")
        return LocalSettingsResponse(
            root_path=str(provider.configure_root(root_path))
        )

    @staticmethod
    def _validated_root(root_path: str) -> Path:
        root = Path(root_path).expanduser().resolve()
        if not root.is_dir():
            raise ValidationError("Local root must be an existing directory")
        return root

    async def pick_local_root(self) -> LocalFolderPickResponse:
        if self.providers.manager is not None:
            self.providers.manager.ensure_mutable("local")
            revision = self.providers.manager.record("local").revision
        provider = self.providers.get("local")
        if not isinstance(provider, LocalProvider):
            raise RuntimeError("Local provider is not registered")
        # 系统对话框会阻塞调用线程，因此不能直接占用 FastAPI 事件循环。
        selected = await asyncio.to_thread(choose_local_directory, provider.root)
        if self.providers.manager is not None and self.providers.manager.record("local").revision != revision:
            from app.core.errors import StorageConnectionChangedError
            raise StorageConnectionChangedError("Storage changed while choosing a directory")
        if selected is None:
            return LocalFolderPickResponse(
                root_path=str(provider.root),
                selected=False,
            )
        configured = await self.configure_local_root(str(selected))
        return LocalFolderPickResponse(root_path=configured.root_path, selected=True)

    async def list_files(self, provider_id: str, path: str) -> DirectoryListing:
        if self.providers.manager is not None and provider_id not in {"local", "onedrive"}:
            raise ValidationError("Unknown storage provider", details={"provider": provider_id})
        provider = self.providers.get(provider_id)
        listing = await provider.list_directory(PathLocation(value=path))
        listing.provider = provider_id
        return listing
