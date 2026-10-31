[API Reference](../README.md) · [通用约定](conventions.md) · [共享错误](errors.md)

## 通用约定

- 本文路径不含 `/api`。前端客户端请求 `/api/*`，开发代理转发到后端 `/*`。
- 请求体和响应体使用 JSON；带 JSON 请求体时发送 `Content-Type: application/json`。日期时间为 ISO 8601 字符串；HTTP 204 无响应体。
- Parameters 注明参数位置、必填性和可空性。必填表示必须提交；可空表示允许 JSON `null`。
- Attributes 中的字段均出现在当前 JSON 响应中，可空字段可能为 `null`。JSON Schema 的内部字段由对应配置模型决定。
- `provider_type` 标识存储实现，`storage_id` 标识独立连接。文件 ID 和位置值由 Provider 定义，客户端应原样保存和传回；显示路径不作为资源身份。
- 业务请求不提交云端 Token。云账号通过[授权接口](../authorization/index.md#authorization)连接。
