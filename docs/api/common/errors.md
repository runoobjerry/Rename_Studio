[API Reference](../README.md) · [通用约定](conventions.md) · [共享错误](errors.md)

<a id="errors"></a>
## 错误对象：ErrorResponse

应用错误使用统一 JSON 对象。OAuth callback 使用 HTML 和消息载荷，见[授权回调](../authorization/callback.md#auth-callback)。

### Attributes

| 字段 | 类型 | 必含 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `error` | object | 是 | 否 | 错误内容。 |
| ↳ `code` | string | 是 | 否 | 稳定错误类别；与操作性质、结果确定性共同决定处理方式。 |
| ↳ `message` | string | 是 | 否 | 诊断信息；不作为业务标识或固定语言文案。 |
| ↳ `details` | object | 是 | 否 | 附加数据；没有附加数据时为 `{}`。 |

### HTTP 状态与错误码

| HTTP | `error.code` | 含义与客户端处理 |
| --- | --- | --- |
| 400 | `APPLICATION_ERROR` | 通用应用错误。根据当前操作检查输入或应用状态。 |
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
| 422 | `RULE_CONFIGURATION_ERROR` | 已启用规则的类型或配置无效，或序列编号超出范围。根据 `details.rule_type` 修正规则。 |
| 429 | `RATE_LIMIT_ERROR` | Provider 限流。稍后操作；写入不能据此盲目重发。 |
| 502 | `PROVIDER_ERROR` | Provider、文件系统、身份服务或状态保存失败。显示错误；写入失败先核对结果。 |
| 502 | `RENAME_OUTCOME_UNKNOWN` | 无法确认是否已写入。核对真实文件，不自动重放。执行接口通常在结果项中返回此码。 |
| 500 | `INTERNAL_ERROR` | 未预期错误。保留 `details.request_id` 供排查；不自动重放写入。 |

各接口的 Errors 仅列出需要额外处理的情形。HTTP 200 的重命名响应也可能含失败项，见[执行结果](../executions/index.md#execution-items)。

### 错误详情

以下字段按错误场景出现，不保证全部存在。预览项及执行项的 `details` 复用适用字段；无详情时可为 `null`。

| `details` 字段 | 类型 | 必含 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `reason` | string | 否 | 否 | 应用定义的稳定细分原因，用于分类和本地化；不能直接填供应商错误码。 |
| `params` | object | 否 | 否 | `reason` 对应的展示参数，不能用作业务标识或重试指令。 |
| `stop_reason` | string | 否 | 否 | 停止继续提交的应用错误码；当前为 `RENAME_OUTCOME_UNKNOWN`，不表示本项写入未知。 |
| `file_ids` | array of string | 否 | 否 | 预览选择错误涉及的 ID。 |
| `errors` | array of object | 否 | 否 | 校验错误；每项通常含 `type`、`loc`、`msg`，可能有其他校验数据。 |
| `rule_type` | string | 否 | 否 | 配置错误涉及的规则类型。 |
| `storage_id` | string | 否 | 否 | 已绑定该账号的连接 ID。 |
| `storage_name` | string | 否 | 否 | 已绑定该账号的连接名称。 |
| `execution_started` | boolean | 否 | 否 | 批量复核失败时为 `false`，表示尚未开始写入；缺失时不能推断写入状态。 |
| `request_id` | string | 否 | 否 | 未预期错误的请求标识。 |
| `actual_name` | string | 否 | 否 | 写入核对后确认的名称。 |
| `file_id` | string | 否 | 否 | 请求涉及的项目 ID，不作为写入结果证据。 |
| `path` | string | 否 | 否 | 请求涉及的相对目录路径。 |
| `new_name` | string | 否 | 否 | 请求目标名，不表示该名称已生效。 |
| `provider` | string | 否 | 否 | 配置校验涉及的 Provider 类型；不是 `storage_id`。 |
| `graph_status` | integer | 否 | 否 | 保留的底层 HTTP 状态诊断字段；前端不据此分类或决定重试。 |
| `google_status` | integer | 否 | 否 | 保留的底层 HTTP 状态诊断字段；前端不据此分类或决定重试。 |
| `provider_type` | string | 否 | 否 | 错误来源的 Provider 类型，不是连接 ID。用于 HTTP 或本地 OS 错误诊断。 |
| `provider_status` | integer | 否 | 否 | 底层 HTTP 状态，与 `graph_status` / `google_status` 对应；不是本 API 的 HTTP 状态。 |
| `provider_codes` | array of string | 否 | 否 | Graph 外层至内层的错误码或 Google `errors[].reason`，仅供诊断和 Provider 内部识别；缺失时不补假定值。 |
| `errno` | integer | 否 | 是 | 本地操作系统错误编号，未提供编号时为 `null`。 |
| `winerror` | integer | 否 | 是 | Windows 错误编号，仅在系统提供时出现。 |

创建、更新连接和更新偏好的请求校验错误会移除条目的 `input`、`ctx`，避免回显敏感请求值。

`details` 只提供经过筛选的 JSON 数据，不包含令牌、密钥、Authorization header 或第三方完整响应。供应商状态和错误码仅用于诊断，不替代应用错误码。

缺少字段表示未提供对应信息，不能据此推断写入发生或未发生。执行结果中的名称与状态定义见[执行结果项](../executions/index.md#execution-items)。

### 执行原因

| `error_code` | `details.reason` | 语义 |
| --- | --- | --- |
| `PROVIDER_ERROR` | `RENAME_NOT_ATTEMPTED` | 配合 `status: not_attempted` 表示本项尚未发出写请求。`stop_reason: RENAME_OUTCOME_UNKNOWN` 表示另一项未知导致停止。 |
| `RENAME_CONFLICT` | `SOURCE_CHANGED` | Provider 报告源状态或前置条件已变化，刷新目录后重新预览或重新输入。Graph `412` 产生此原因。 |

已提交但被明确拒绝的项目属于 `failed`，即使后续重试未发生，也不属于 `not_attempted`。

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

未收到响应，或响应不符合共享错误结构时，客户端不能据此推断写入失败或未执行。按[执行结果](../executions/index.md#execution-outcomes)核对真实状态，不自动重发。
