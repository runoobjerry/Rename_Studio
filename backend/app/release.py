"""Single-process entry point for the prebuilt WebUI; development uses app.main."""

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from app.main import create_app


def create_release_app(dist: Path, instance_id: str) -> FastAPI:
    app = create_app()
    # Both route sets use the same cached services. The outer app owns their lifespan.
    # Keep the original routes, including the registered OAuth callback, available.
    app.mount("/api", create_app())
    app.mount("/", StaticFiles(directory=dist, html=True), name="webui")

    @app.middleware("http")
    async def identify_instance(request: Request, call_next):
        response = await call_next(request)
        response.headers["x-rename-studio-instance"] = instance_id
        if request.url.path in ("/", "/index.html"):
            response.headers["cache-control"] = "no-cache"
        return response

    return app
