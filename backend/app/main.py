import argparse
import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import router
from app.api.storage_router import router as storage_router
from app.api.app_settings_router import router as app_settings_router
from app.api.dependencies import get_preview_store, get_storage_services
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.log_dev import DEV_LOG_LEVEL_ENV, development_log_session
from app.core.log_http import LoggingMiddleware


app_logger = logging.getLogger("rename_studio.app")


def create_app(*, instance_id: str | None = None, development_logs: bool = False) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        async def clean_previews() -> None:
            while True:
                await asyncio.sleep(60)
                if get_preview_store.cache_info().currsize:
                    get_preview_store().purge_expired()

        # 无后续请求时也回收过期快照；退出时先停止清理任务。
        cleanup_task = asyncio.create_task(clean_previews())
        app_logger.debug("Application lifecycle initialized")
        try:
            yield
        finally:
            try:
                cleanup_task.cancel()
                with suppress(asyncio.CancelledError):
                    await cleanup_task
                if get_storage_services.cache_info().currsize:
                    manager, _ = get_storage_services()
                    await manager.aclose()
            except Exception:
                app_logger.exception("Application shutdown failed")
                raise

    @asynccontextmanager
    async def development_lifespan(app: FastAPI) -> AsyncIterator[None]:
        with development_log_session(app.version):
            async with lifespan(app):
                yield

    app = FastAPI(title=settings.app_name, version="1.0.0-alpha4",
                  lifespan=development_lifespan if development_logs else lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    app.add_middleware(LoggingMiddleware, instance_id=instance_id, app_version=app.version)

    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        request.state.error_code = exc.code
        request.state.operation_id = exc.log_operation_id
        request.state.storage_id = exc.log_storage_id
        request.state.execution_started = exc.details.get("execution_started")
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        request.state.error_code = "REQUEST_VALIDATION_ERROR"
        errors = exc.errors()
        if request.scope["route"].path in ("/app-settings", "/storages", "/storages/{storage_id}"):
            # Storage bodies may contain a secret even when another field fails validation.
            errors = [{key: value for key, value in error.items() if key not in ("input", "ctx")}
                      for error in errors]
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "REQUEST_VALIDATION_ERROR",
                    "message": "Request validation failed",
                    "details": {"errors": jsonable_encoder(errors)},
                }
            },
        )

    app.include_router(router)
    app.include_router(storage_router)
    app.include_router(app_settings_router)
    return app


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser(description="Start the Rename Studio development API.")
    parser.add_argument("--reload", action="store_true", help="Restart the server after source changes.")
    logging_options = parser.add_mutually_exclusive_group()
    logging_options.add_argument("--debug", action="store_true", help="Include debug messages in the log file.")
    logging_options.add_argument("--no-log", action="store_true", help="Disable development log output.")
    args = parser.parse_args()

    if args.no_log:
        os.environ[DEV_LOG_LEVEL_ENV] = "OFF"
    elif args.debug:
        os.environ[DEV_LOG_LEVEL_ENV] = "DEBUG"
    uvicorn.run(
        "app.main:app", reload=args.reload, access_log=False,
        log_level=logging.CRITICAL + 1 if args.no_log else "info",
    )


if __name__ == "__main__":
    main()
else:
    app = create_app(development_logs=True)
