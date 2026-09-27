from pathlib import Path

from fastapi.testclient import TestClient

from app.api.dependencies import get_file_service, get_preview_service
from app.main import create_app
from app.providers.local import LocalProvider
from app.providers.registry import ProviderRegistry
from app.rules.registry import RuleRegistry
from app.services.file_service import FileService
from app.services.preview_service import PreviewService
from app.services.rename_engine import RenameEngine


def test_local_browse_and_preview_api(tmp_path: Path) -> None:
    (tmp_path / "demo.txt").write_text("demo", encoding="utf-8")
    providers = ProviderRegistry([LocalProvider(tmp_path)])
    app = create_app()
    app.dependency_overrides[get_file_service] = lambda: FileService(providers)
    app.dependency_overrides[get_preview_service] = lambda: PreviewService(
        providers, RenameEngine(RuleRegistry())
    )

    with TestClient(app) as client:
        listing = client.get("/files", params={"provider": "local", "path": ""})
        preview = client.post(
            "/rename/preview",
            json={"provider": "local", "file_ids": ["demo.txt"], "rules": []},
        )

    assert listing.status_code == 200
    assert listing.json()["items"][0]["name"] == "demo.txt"
    assert preview.status_code == 200
    assert preview.json()["items"][0]["new_name"] == "demo.txt"


def test_validation_errors_use_standard_shape() -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.post(
            "/rename/preview",
            json={"provider": "local", "file_ids": [], "rules": []},
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REQUEST_VALIDATION_ERROR"
