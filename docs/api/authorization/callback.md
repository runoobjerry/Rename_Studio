[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="auth-callback"></a>
<a id="endpoint-get-auth-storage-callback"></a>
### 接收授权回调

接收第三方授权结果并通知发起窗口。

`GET /auth/storage/callback`

#### Parameters

查询参数：

| 字段 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `code` | string | 条件 | 否 | 授权成功时提供；完成连接需要非空值。 |
| `state` | string | 条件 | 否 | 必须匹配有效会话；成功或失败都会消费。 |
| `error` | string | 否 | 否 | 第三方授权失败标识；非空时拒绝完成授权。 |

#### Returns

成功返回 HTTP 200 `text/html`，发送 `status: connected` 消息；失败返回 HTTP 400 `text/html`，发送 `status: failed` 消息。HTTP 状态不采用载荷错误码对应的常规状态。

前端必须校验 `redirect_uri` 对应的 origin、弹窗 source、消息结构和 `storage_id`。成功后重新读取连接、授权状态与目录。

#### Request / Response 示例

```http
GET /auth/storage/callback?code=example-code&state=example-state
```

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
```

成功页面发送的消息载荷：

```json
{
  "type":"storage-auth",
  "storage_id":"f5b9d4cc28d24b44a531724776d32c21",
  "status":"connected",
  "message":"Storage connected. You can close this window.",
  "error_code":null,
  "details":{}
}
```

#### Errors

以下为失败消息的 `error_code`，HTTP 均为 400：

| `error_code` | 含义与客户端处理 |
| --- | --- |
| `AUTHENTICATION_ERROR` | 会话无效、过期、取消或身份核验被拒绝。重新开始授权。 |
| `STORAGE_CONNECTION_CHANGED` | 授权期间版本变化。读取连接后重新授权。 |
| `STORAGE_ACCOUNT_ALREADY_CONNECTED` | 账号已绑定其他同类连接；`details` 含已有连接的 `storage_id`、`storage_name`。 |
| `STORAGE_BUSY` | 连接正在重命名。完成后重新授权。 |
| `RATE_LIMIT_ERROR` | 身份服务限流。稍后重新开始。 |
| `PROVIDER_ERROR` | Token 交换、账号信息读取或保存失败。提示失败。 |

Token 交换、刷新及账号信息读取不自动重试。临时网络、限流或服务端错误保留已保存授权；刷新被明确拒绝时清除失效授权。业务响应不返回 Token 或 Secret。
