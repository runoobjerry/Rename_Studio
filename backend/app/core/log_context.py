from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar


# 请求上下文随异步调用传播，仅保存日志关联 ID，不保存请求内容或凭据。
request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)
operation_id_context: ContextVar[str | None] = ContextVar("operation_id", default=None)
storage_id_context: ContextVar[str | None] = ContextVar("storage_id", default=None)


@contextmanager
def log_operation(operation_id: str, storage_id: str) -> Iterator[None]:
    operation_token = operation_id_context.set(operation_id)
    storage_token = storage_id_context.set(storage_id)
    try:
        yield
    finally:
        storage_id_context.reset(storage_token)
        operation_id_context.reset(operation_token)
