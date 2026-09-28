import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import router
from app.api.dependencies import get_provider_registry
from app.core.config import get_settings
from app.core.errors import AppError


logger = logging.getLogger("onedriver_renamer.api")


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        await get_provider_registry().aclose()

    app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def add_request_context(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid4())
        request.state.request_id = request_id
        started_at = perf_counter()
        response = await call_next(request)
        duration_ms = round((perf_counter() - started_at) * 1000, 2)
        response.headers["x-request-id"] = request_id
        logger.info(
            "request completed method=%s path=%s status=%s request_id=%s duration_ms=%s",
            request.method,
            request.url.path,
            response.status_code,
            request_id,
            duration_ms,
        )
        return response

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
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
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "REQUEST_VALIDATION_ERROR",
                    "message": "Request validation failed",
                    "details": {"errors": jsonable_encoder(exc.errors())},
                }
            },
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(
        request: Request, exc: Exception
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        logger.error(
            "unhandled error request_id=%s",
            request_id,
            exc_info=(type(exc), exc, exc.__traceback__),
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "An unexpected error occurred",
                    "details": {"request_id": request_id},
                }
            },
        )

    app.include_router(router)
    return app


app = create_app()
