[API Reference](../README.md) · [通用约定](conventions.md) · [共享错误](errors.md)

<a id="errors"></a>
## 错误对象：ErrorResponse

应用错误使用统一 JSON 对象。OAuth callback 使用 HTML 和消息载荷，见[授权回调](../authorization/callback.md#auth-callback)。

### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `error` | object | 否 | 错误内容。 |
| ↳ `code` | string | 否 | 稳定错误码，用于选择处理方式。 |
| ↳ `message` | string | 否 | 诊断信息；不作为业务标识或固定语言文案。 |
| ↳ `details` | object | 否 | 附加数据；没有附加数据时为 `{}`。 |

### HTTP 状态与错误码

| HTTP | `error.code` | 含义与客户端处理 |
| --- | --- | --- |
| 401 | `AUTHENTICATION_ERROR` | 未连接账号或授权被拒绝。读取授权状态，按需重新授权。 |
| 403 | `PERMISSION_DENIED` | Provider 拒绝访问。提示检查权限。 |
| 404 | `NOT_FOUND` | 连接、目录或项目不存在。刷新对应资源。 |
| 404 | `PREVIEW_NOT_FOUND` | 预览不存在、已释放、已消费或已回收。重新预览。 |
| 409 | `PREVIEW_EXPIRED` | 预览过期或复核结果变化。重新预览。 |
| 409 | `STORAGE_CONNECTION_CHANGED` | 连接版本或账号变化。重新读取连接、目录；批量重新预览，单项更新请求版本。 |
| 409 | `STORAGE_BUSY` | 连接正在重命名。等待完成后再操作。 |
| 409 | `STORAGE_ACCOUNT_ALREADY_CONNECTED` | 账号已绑定其他同类连接。使用 `details.storage_id` 指向的连接。 |
| 409 | `RENAME_CONFLICT` | 目标名称冲突。修改名称或重新预览。 |
| 422 | `REQUEST_VALIDATION_ERROR` | 请求结构、类型或取值无效。根据 `details.errors` 修正请求。 |
| 422 | `VALIDATION_ERROR` | 配置、位置、选择或名称无效。根据 `details.reason` 提示或修正输入。 |
| 422 | `RULE_CONFIGURATION_ERROR` | 已启用规则的类型或配置无效。根据 `details.rule_type` 修正规则。 |
| 429 | `RATE_LIMIT_ERROR` | Provider 限流。稍后操作；写入不能据此盲目重发。 |
| 502 | `PROVIDER_ERROR` | Provider、文件系统、身份服务或状态保存失败。显示错误；写入失败先核对结果。 |
| 502 | `RENAME_OUTCOME_UNKNOWN` | 无法确认是否已写入。核对真实文件，不自动重放。执行接口通常在结果项中返回此码。 |
| 500 | `INTERNAL_ERROR` | 未预期错误。保留 `details.request_id` 供排查；不自动重放写入。 |

各接口的 Errors 仅列出需要额外处理的情形。HTTP 200 的重命名响应也可能含失败项，见[执行结果](../executions/index.md#execution-items)。

### 错误详情

以下字段按错误场景出现，不保证全部存在。

| `details` 字段 | 类型 | 说明 |
| --- | --- | --- |
| `reason` | string | 稳定原因标识，用于本地化。 |
| `params` | object | 原因对应的展示参数。 |
| `file_ids` | array of string | 预览选择错误涉及的 ID。 |
| `errors` | array of object | 校验错误；每项通常含 `type`、`loc`、`msg`，可能有其他校验数据。 |
| `rule_type` | string | 配置错误涉及的规则类型。 |
| `storage_id`、`storage_name` | string | 账号已连接时指向已有连接。 |
| `execution_started` | boolean | 批量复核失败时为 `false`，表示尚未开始写入；缺失时不能推断写入状态。 |
| `request_id` | string | 未预期错误的请求标识。 |
| `actual_name` | string | 写入核对后确认的名称。 |

创建、更新连接和更新偏好的请求校验错误会移除条目的 `input`、`ctx`，避免回显敏感请求值。

<a id="validation-reasons"></a>
### 校验原因

`reason`、`params` 可出现在 `error.details`、`PreviewItem.details` 或执行结果项的 `details` 中。预览项不含 `error_code`；按校验原因显示提示。未知原因回退为通用提示。

| `reason` | 含义 | `params` |
| --- | --- | --- |
| `CONNECTION_NOT_FOUND` | 连接不存在。 | `{}` |
| `ACCOUNT_NOT_CONNECTED` | 账号未连接。 | `{}` |
| `AUTHORIZATION_EXPIRED` | 已明确确认授权过期；普通授权拒绝不一定带此原因。 | `{}` |
| `LOCATION_OUTSIDE_ROOT` | 超出连接根目录。 | `{}` |
| `SYMBOLIC_LINK_UNSUPPORTED` | 不支持符号链接或目录联接。 | `{}` |
| `DEFAULT_CONNECTION_DELETE_FORBIDDEN` | 默认 Local 连接不可删除。 | `{}` |
| `PREVIEW_DUPLICATE_FILE_IDS` | 选择中有重复 ID。 | 不提供；ID 在 `details.file_ids`。 |
| `PREVIEW_ITEMS_NOT_IN_DIRECTORY` | 所选项目不在请求目录。 | 不提供；缺失 ID 在 `details.file_ids`。 |
| `RENAME_UNSUPPORTED` | 连接不支持重命名。 | `{}` |
| `ITEM_RENAME_UNAVAILABLE` | 项目当前不能重命名，也可能是不支持的类型。 | `{}` |
| `ROOT_RENAME_UNSUPPORTED` | 不支持重命名根目录。 | `{}` |
| `GOOGLE_DRIVE_SHORTCUT_RENAME_UNSUPPORTED` | 不支持重命名 Google Drive shortcut。 | `{}` |
| `NAME_EMPTY` | 名称为空或全为空白。 | `{}` |
| `NAME_DOT_SEGMENT` | 名称为 `.` 或 `..`。 | `{}` |
| `NAME_INVALID_CHARACTERS` | 包含禁止字符。 | `characters: string[]`、`control_characters: string`。 |
| `NAME_NULL_CHARACTER` | 包含 NUL。 | `{}` |
| `NAME_INVALID_ENDING` | 以空格或句点结尾。 | `{}` |
| `NAME_RESERVED_WINDOWS` | Windows 保留名称。 | `{}` |
| `NAME_TOO_LONG` | 名称过长。 | `max_length: integer`，当前 `255`。 |
| `ONEDRIVE_NAME_INVALID_PREFIX` | OneDrive 名称前缀无效。 | `prefixes: string[]`。 |
| `NAME_RESERVED_ONEDRIVE` | OneDrive 保留名称。 | `{}` |
| `NAME_RESERVED_IN_ROOT` | OneDrive 根目录保留名称。 | `name: string`，当前 `forms`。 |
| `ONEDRIVE_FOLDER_INVALID_PREFIX` | OneDrive 文件夹前缀无效。 | `prefixes: string[]`。 |
| `ONEDRIVE_PATH_TOO_LONG` | OneDrive 目标路径过长。 | `max_length: integer`，当前 `400`。 |

### 示例

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Duplicate file IDs are not allowed",
    "details": {"reason":"PREVIEW_DUPLICATE_FILE_IDS","file_ids":["IMG_1.jpg"]}
  }
}
```

前端将非成功 HTTP 响应转为 `ApiError`，保留 `status`、`code`、`message`、`details`。非标准响应使用 `code: null`、`details: {}`；网络或响应解析失败保留浏览器异常并标记 `status: 0`。`status: 0` 不表示服务端未执行写入。
