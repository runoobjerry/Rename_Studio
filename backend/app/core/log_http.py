import logging
from time import perf_counter
from uuid import UUID, uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.log_context import request_id_context


logger = logging.getLogger("rename_studio.api")
_QUIET_ROUTES = {"/health", "/rename/progress/{preview_id}", "/storages/{storage_id}/auth/status"}
_SLOW_REQUEST_MS = 1000
_HTTP_METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}


class LoggingMiddleware:
    def __init__(self, app: ASGIApp, instance_id: str | None, app_version: str) -> None:
        self.app = app
        self.instance_id = instance_id
        self.app_version = app_version

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            async def send_lifespan(message: Message) -> None:
                if message["type"] == "lifespan.shutdown.failed":
                    # Lifespan already logged the exception. Preserve the failure
                    # signal without forwarding Starlette's raw traceback.
                    message = {"type": "lifespan.shutdown.failed"}
                await send(message)

            await self.app(scope, receive, send_lifespan)
            return
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        state = scope.setdefault("state", {})
        if "request_id" in state:
            # The mounted Release API shares the outer scope and response sender.
            await self._dispatch(scope, receive, send)
            return

        supplied_id = Headers(scope=scope).get("x-request-id")
        try:
            request_id = str(UUID(supplied_id)) if supplied_id else str(uuid4())
        except ValueError:
            request_id = str(uuid4())
        state["request_id"] = request_id
        started = perf_counter()
        token = request_id_context.set(request_id)

        async def send_response(message: Message) -> None:
            if message["type"] == "http.response.start":
                state["response_status"] = message["status"]
                headers = MutableHeaders(scope=message)
                headers["x-request-id"] = request_id
                if self.instance_id is not None:
                    headers["x-rename-studio-instance"] = self.instance_id
                    if scope["path"] in ("/health", "/api/health"):
                        headers["x-rename-studio-version"] = self.app_version
                    if scope["path"] in ("/", "/index.html"):
                        headers["cache-control"] = "no-cache"
            await send(message)

        try:
            await self._dispatch(scope, receive, send_response)
        finally:
            try:
                self._log_request(scope, started)
            finally:
                request_id_context.reset(token)

    async def _dispatch(self, scope: Scope, receive: Receive, send: Send) -> None:
        state = scope["state"]
        try:
            await self.app(scope, receive, send)
        except Exception as exc:
            state["request_exception"] = exc
            state["error_code"] = "INTERNAL_ERROR"
            if "response_status" in state:
                raise  # A response already started; let the server close the connection.
            response = JSONResponse(
                status_code=500,
                content={
                    "error": {
                        "code": "INTERNAL_ERROR",
                        "message": "An unexpected error occurred",
                        "details": {"request_id": state["request_id"]},
                    },
                },
            )
            await response(scope, receive, send)

    @staticmethod
    def _log_request(scope: Scope, started: float) -> None:
        state = scope["state"]
        status = state.get("response_status")
        exc = state.pop("request_exception", None)
        if status is None and exc is None:
            return
        route = getattr(scope.get("route"), "path", None)
        method = scope["method"] if scope["method"] in _HTTP_METHODS else "OTHER"
        if exc is None and status < 400 and (
            route is None or route in _QUIET_ROUTES or (method, route) == ("GET", "/storages")
        ):
            return
        duration_ms = (perf_counter() - started) * 1000
        if exc is not None:
            level, message = logging.ERROR, "Unhandled HTTP request error "
        elif status >= 400:
            level, message = logging.WARNING, "HTTP request failed "
        else:
            level = logging.INFO if duration_ms >= _SLOW_REQUEST_MS else logging.DEBUG
            message = "HTTP request completed "
        if not logger.isEnabledFor(level):
            return

        error_code = state.get("error_code")
        fields = "method=%s route=%s status=%s duration_ms=%.2f"
        args = (method, route or "unmatched", status or 500, duration_ms)
        if error_code:
            fields += " error_code=%s"
            args += (error_code,)
        if state.get("execution_started") is False:
            fields += " execution_started=false"
        context = {
            "operation_id": state.get("operation_id"),
            "storage_id": state.get("storage_id") or scope.get("path_params", {}).get("storage_id"),
        }
        logger.log(level, message + fields, *args, extra=context, exc_info=exc)
