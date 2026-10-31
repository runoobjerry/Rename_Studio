[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="authorization"></a>
## 授权

### 接口索引

| 接口名称 | HTTP 方法 | 路径 | 文档 |
| --- | --- | --- | --- |
| 获取授权状态 | `GET` | `/storages/{storage_id}/auth/status` | [获取授权状态](session.md#endpoint-get-storages-storage-id-auth-status) |
| 断开账号 | `DELETE` | `/storages/{storage_id}/auth/session` | [断开账号](session.md#endpoint-delete-storages-storage-id-auth-session) |
| 开始授权 | `POST` | `/storages/{storage_id}/auth/start` | [开始授权](start.md#endpoint-post-storages-storage-id-auth-start) |
| 接收授权回调 | `GET` | `/auth/storage/callback` | [接收授权回调](callback.md#endpoint-get-auth-storage-callback) |

### 对象：AuthorizationStatus

表示保存的授权状态，不在线探测 Token 是否有效。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `configured` | boolean | 否 | 授权所需配置是否齐全。OneDrive 需要 Client ID，Google Drive 还需要 Secret。 |
| `connected` | boolean | 否 | 是否存在已连接会话。 |
| `account_id` | string | 是 | 稳定账号 ID；已连接会话提供此值。 |
| `account_display_name` | string | 是 | 账号显示名，无资料时为 `null`。 |
| `account_email` | string | 是 | 账号邮箱，无资料时为 `null`。 |

### 对象：StorageAuthStartResponse

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `authorization_url` | string | 否 | 浏览器应打开的完整授权地址，原样使用。 |
| `redirect_uri` | string | 否 | 本次授权的回调地址。 |

### 对象：授权回调消息

通过 `window.opener.postMessage` 发送，不是 JSON HTTP 响应。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `type` | string | 否 | 固定为 `storage-auth`。 |
| `storage_id` | string | 是 | 关联连接；无法识别授权会话时为 `null`。 |
| `status` | string | 否 | `connected` 或 `failed`。 |
| `message` | string | 否 | 诊断信息。 |
| `error_code` | string | 是 | 成功为 `null`，失败为统一错误码。 |
| `details` | object | 否 | 附加信息，没有时为 `{}`。 |
