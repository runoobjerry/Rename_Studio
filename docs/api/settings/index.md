[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="settings"></a>
## 应用设置

### 接口索引

| 接口名称 | HTTP 方法 | 路径 | 文档 |
| --- | --- | --- | --- |
| 获取应用设置 | `GET` | `/app-settings` | [获取应用设置](index.md#endpoint-get-app-settings) |
| 恢复默认设置 | `POST` | `/app-settings/factory-reset` | [恢复默认设置](index.md#endpoint-post-app-settings-factory-reset) |
| 更新应用设置 | `PATCH` | `/app-settings` | [更新应用设置](update.md#endpoint-patch-app-settings) |

### 对象：AppSettingsResponse

仅返回偏好，不包含连接配置、凭据或执行任务。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `preferences` | AppPreferences | 否 | 当前完整偏好。 |

### 对象：AppPreferences

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `language` | string | 否 | 默认 `auto`，或语言标识，如 `zh-CN`、`en-US`。 |
| `theme` | string | 否 | 默认 `system`；`light`、`dark` 或 `system`。 |
| `cloud_default_locations` | object | 否 | 默认 `{}`；键为 `storage_id`，值为 CloudDefaultLocation，每个连接保存当前账号的一条默认目录。 |

语言标识长 2–63 字符，匹配 `^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$`。后端不限制为前端已支持的语言集合。

### 对象：CloudDefaultLocation

用于更新偏好时，以下两个字段均必填。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `account_id` | string | 否 | 当前连接账号的稳定 ID，1–200 字符。 |
| `location` | StorageLocation | 否 | 默认打开位置；`id`、`path` 的 `value` 最长 4096 字符。 |

最多 100 条记录，连接键长 1–200 字符。偏好 JSON 按后端序列化后的 UTF-8 大小限制为 131072 字节；更新同时检查请求与合并后偏好。偏好和云默认目录对象拒绝未知字段。

配置变化清除授权、账号变化、断开账号或删除连接时，会移除不匹配账号的默认目录。正常 Token 刷新保留记录。保存时不校验目录存在或 Provider 位置能力；恢复前核对账号与能力，并以成功读取返回的位置为准。

<a id="endpoint-get-app-settings"></a>
### 获取应用设置

返回当前完整偏好。

`GET /app-settings`

#### Parameters

无。

#### Returns

HTTP 200，返回 `AppSettingsResponse`。

#### Request / Response 示例

```http
GET /app-settings
```

```json
{"preferences":{"language":"auto","theme":"system","cloud_default_locations":{}}}
```

<a id="endpoint-post-app-settings-factory-reset"></a>
### 恢复默认设置

恢复默认偏好与默认 Local 连接，删除其他连接、凭据和预览。

`POST /app-settings/factory-reset`

#### Parameters

无。

#### Returns

HTTP 200，返回默认 `AppSettingsResponse`。`default-local` 使用后端 `local_storage_root`，连接版本递增；真实文件不受影响。前端重新读取连接并清理旧工作区状态。

#### Request / Response 示例

```http
POST /app-settings/factory-reset
```

```json
{"preferences":{"language":"auto","theme":"system","cloud_default_locations":{}}}
```

#### Errors

- 409 `STORAGE_BUSY`：任一连接正在重命名。等待完成后再重置。
