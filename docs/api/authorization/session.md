[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="endpoint-get-storages-storage-id-auth-status"></a>
### 获取授权状态

返回连接当前保存的授权状态。

`GET /storages/{storage_id}/auth/status`

#### Parameters

路径参数 `storage_id`：string，必填，不可空；连接必须声明 `browser_auth: true`。

#### Returns

HTTP 200，返回 `AuthorizationStatus`。

#### Request / Response 示例

```http
GET /storages/f5b9d4cc28d24b44a531724776d32c21/auth/status
```

```json
{
  "configured":true,
  "connected":false,
  "account_id":null,
  "account_display_name":null,
  "account_email":null
}
```

#### Errors

- 422 `VALIDATION_ERROR`：连接不使用浏览器授权。

<a id="endpoint-delete-storages-storage-id-auth-session"></a>
### 断开账号

移除账号授权，保留连接与客户端配置。

`DELETE /storages/{storage_id}/auth/session`

#### Parameters

路径参数 `storage_id`：string，必填，不可空；连接必须声明 `browser_auth: true`。无请求体。

#### Returns

HTTP 204，无响应体。保留 Client ID 和 Secret；账号变化使旧预览失效，并清除对应云默认目录记录。

#### Request / Response 示例

```http
DELETE /storages/f5b9d4cc28d24b44a531724776d32c21/auth/session
```

```http
HTTP/1.1 204 No Content
```

#### Errors

- 409 `STORAGE_BUSY`：等待重命名结束。
- 422 `VALIDATION_ERROR`：连接不使用浏览器授权。
