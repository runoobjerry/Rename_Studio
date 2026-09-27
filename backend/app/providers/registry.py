from app.core.errors import ValidationError
from app.providers.base import StorageProvider


class ProviderRegistry:
    def __init__(self, providers: list[StorageProvider]) -> None:
        self._providers = {provider.id: provider for provider in providers}

    def get(self, provider_id: str) -> StorageProvider:
        provider = self._providers.get(provider_id)
        if provider is None:
            raise ValidationError(
                "Unknown storage provider", details={"provider": provider_id}
            )
        return provider

    def all(self) -> list[StorageProvider]:
        return list(self._providers.values())
