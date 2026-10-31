[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md) · [文件元数据](../common/files.md)。

<a id="executions"></a>
## 重命名执行

### 接口索引

| 接口名称 | HTTP 方法 | 路径 | 文档 |
| --- | --- | --- | --- |
| 获取执行进度 | `GET` | `/rename/progress/{preview_id}` | [获取执行进度](index.md#endpoint-get-rename-progress-preview-id) |
| 执行预览 | `POST` | `/rename/execute` | [执行预览](execute.md#endpoint-post-rename-execute) |
| 单项直接执行 | `POST` | `/storages/{storage_id}/rename/single/execute` | [单项直接执行](single.md#endpoint-post-storages-storage-id-rename-single-execute) |

### 对象：RenameExecuteResponse

表示批量执行的最终结果。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `preview_id` | string | 否 | 执行的预览标识。 |
| `status` | string | 否 | `completed`、`partial` 或 `failed`，含义见下表。 |
| `items` | array of ExecuteItem | 否 | 按预览顺序返回；实际完成顺序可能不同。 |

| `status` | 含义 |
| --- | --- |
| `completed` | 没有失败项，包括全部跳过的情况。 |
| `partial` | 存在成功重命名和失败项。 |
| `failed` | 有失败项且无成功重命名项，可能同时包含跳过项。 |

### 对象：SingleRenameExecuteResponse

表示单项直接执行的最终结果。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `operation_id` | string | 否 | 请求 UUID 的标准字符串形式。 |
| `status` | string | 否 | Schema 枚举为 `completed`、`partial`、`failed`；当前单项流程仅返回 `completed` 或 `failed`。 |
| `items` | array of SingleExecuteItem | 否 | 当前固定为 1 个结果项。 |

<a id="execution-items"></a>
### 对象：ExecuteItem 与 SingleExecuteItem

两种结果项共用以下字段。`ExecuteItem.current_file` 为 [FileItem](../common/files.md#files)，`SingleExecuteItem.current_file` 为 [RenameFile](../common/files.md#files)。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `file_id` | string | 否 | 原请求 ID，不因重命名后的身份变化而改写。 |
| `original_name` | string | 否 | 预览原名或单项请求携带的原名。 |
| `new_name` | string | 否 | 最终目标名。 |
| `status` | string | 否 | `renamed`、`skipped` 或 `failed`；单项当前只返回 `renamed` 或 `failed`。 |
| `error` | string | 是 | 失败诊断信息。 |
| `error_code` | string | 是 | [统一错误码](../common/errors.md#errors)。 |
| `details` | object | 是 | 附加详情，包括[校验原因](../common/errors.md#validation-reasons)。 |
| `actual_name` | string | 是 | 批量成功为目标名，跳过为原名；失败时为已确认名称或 `null`。单项成功时也可为 `null`，使用 `current_file.name`。 |
| `current_file` | FileItem / RenameFile | 是 | 成功写入或成功回滚后确认的元数据；`null` 本身不能证明是否已写入。 |

`renamed` 表示目标已确认；`skipped` 表示批量预览名称未变化；`failed` 包括明确拒绝、回滚后失败、未尝试或结果未知，不保证文件仍为原名。

交换、循环或名称占用链可能使用临时名称。阶段失败后尽力回滚；确认的回滚元数据和遗留名称通过 `current_file`、`actual_name` 返回。

`error_code: RENAME_OUTCOME_UNKNOWN` 表示写入可能发生，但按 ID 核对仍无法确认，此时 `actual_name: null`。核对真实文件后再决定下一步，不自动重放。

### 对象：RenameProgress

表示批量执行进度，不包含最终逐项结果。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `preview_id` | string | 否 | 预览标识。 |
| `total` | integer | 否 | 名称变化的预览项目数，≥ 0。 |
| `processed` | integer | 否 | 已定案项目数，≥ 0，包括失败和最终未尝试项，不是成功数。初始为 `0`。 |
| `phase` | string | 否 | 阶段，见下表；初始为 `waiting`。 |
| `error` | string | 是 | 请求异常终止时的诊断信息，不是逐项失败列表。 |

| `phase` | 含义 |
| --- | --- |
| `waiting` | 预览存在，尚未开始执行。 |
| `validating` | 执行前复核。 |
| `staging` | 写入临时名称，此阶段不累计已定案数。 |
| `renaming` | 写入目标名称。 |
| `rollback` | 尝试恢复名称。 |
| `finished` | 执行响应已就绪，可能为 `completed`、`partial` 或 `failed`。 |
| `failed` | 执行请求复核失败、异常或中断，不代表已有完整执行响应。 |

<a id="endpoint-get-rename-progress-preview-id"></a>
### 获取执行进度

读取批量执行进度，不启动、取消或重试执行。

`GET /rename/progress/{preview_id}`

#### Parameters

路径参数 `preview_id`：string，必填，不可空，服务端预览标识。

#### Returns

HTTP 200，返回 `RenameProgress`。有效预览执行前为 `waiting`；执行结束后进度保留 10 分钟。`finished` 或 `processed == total` 不代表全部成功，以执行请求的最终响应为准。

#### Request / Response 示例

```http
GET /rename/progress/4db956a6-c583-47af-bcde-9ea71312fc36
```

```json
{
  "preview_id":"4db956a6-c583-47af-bcde-9ea71312fc36",
  "total":1,
  "processed":1,
  "phase":"finished",
  "error":null
}
```

#### Errors

- 404 `PREVIEW_NOT_FOUND`：进度已清理且无可用预览，或 ID 无效；不能据此判断执行结果。
- 409 `PREVIEW_EXPIRED`：尚未执行的预览过期。重新预览。
