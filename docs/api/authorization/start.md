[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="endpoint-post-storages-storage-id-auth-start"></a>
### 开始授权

创建授权会话并返回浏览器登录地址。

`POST /storages/{storage_id}/auth/start`

#### Parameters

路径参数 `storage_id`：string，必填，不可空；连接必须声明 `browser_auth: true`。无请求体。

同一连接仅保留最新授权流程。会话有效期 10 分钟，绑定连接版本；新登录失败时保留原有已提交授权。

#### Returns

HTTP 200，返回 `StorageAuthStartResponse`。前端打开 `authorization_url` 并等待回调消息。

#### Request / Response 示例

```http
POST /storages/f5b9d4cc28d24b44a531724776d32c21/auth/start
```

Client ID、state 和 PKCE challenge 为示例值；实际调用原样使用返回的 URL。

```json
{
  "authorization_url":"https://accounts.google.com/o/oauth2/v2/auth?client_id=123456789-example.apps.googleusercontent.com&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fauth%2Fstorage%2Fcallback&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.metadata&state=example-state&code_challenge=example-challenge&code_challenge_method=S256&access_type=offline&prompt=consent+select_account",
  "redirect_uri":"http://localhost:8000/auth/storage/callback"
}
```

#### Errors

- 409 `STORAGE_BUSY`：等待重命名结束。
- 422 `VALIDATION_ERROR`：不支持浏览器授权或客户端配置不完整。补齐配置后重新开始。
