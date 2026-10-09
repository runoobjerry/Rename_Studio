from contextvars import ContextVar


# 请求上下文随异步调用传播，仅保存日志关联 ID，不保存请求内容或凭据。
request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)
