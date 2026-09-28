from pathlib import PurePosixPath

from app.providers.registry import ProviderRegistry
from app.schemas.files import DirectoryListing, ProviderInfo


class FileService:
    def __init__(self, providers: ProviderRegistry) -> None:
        self.providers = providers

    def list_providers(self) -> list[ProviderInfo]:
        return [
            ProviderInfo(id=provider.id, name=provider.display_name, writable=True)
            for provider in self.providers.all()
        ]

    async def list_files(self, provider_id: str, path: str) -> DirectoryListing:
        provider = self.providers.get(provider_id)
        normalized = path.replace("\\", "/").strip("/")
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
