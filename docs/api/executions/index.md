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

| 字段 | 类型 | 必含 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `preview_id` | string | 是 | 否 | 执行的预览标识。 |
| `status` | string | 是 | 否 | `completed` 或 `incomplete`，含义见下表。 |
| `counts` | RenameResultCounts | 是 | 否 | 五种逐项状态的数量，按本次响应的 `items` 计算。 |
| `items` | array of ExecuteItem | 是 | 否 | 按预览顺序返回；实际完成顺序可能不同。 |

| `status` | 含义 |
| --- | --- |
| `completed` | 每项均为已确认重命名或无需修改，包括全部跳过的情况。 |
| `incomplete` | 未全部完成：至少一项为 `failed`、`unknown` 或 `not_attempted`；已确认成功项仍保留。 |

### 对象：SingleRenameExecuteResponse

表示单项直接执行的最终结果。

#### Attributes

| 字段 | 类型 | 必含 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `operation_id` | string | 是 | 否 | 请求 UUID 的标准字符串形式。 |
| `status` | string | 是 | 否 | `completed` 或 `incomplete`；单项成功为 `completed`，失败或未知为 `incomplete`。 |
| `counts` | RenameResultCounts | 是 | 否 | 五种逐项状态的数量，按本次响应的 `items` 计算。 |
| `items` | array of SingleExecuteItem | 是 | 否 | 当前固定为 1 个结果项。 |

### 对象：RenameResultCounts

表示本次响应中五种逐项状态的数量；字段均必定返回、不可空，无默认值，合计等于 `items` 长度。

#### Attributes

| 字段 | 类型 | 必含 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `renamed` | integer | 是 | 否 | 已确认重命名项数，≥ 0。 |
| `skipped` | integer | 是 | 否 | 无需修改项数，≥ 0。 |
| `failed` | integer | 是 | 否 | 已确认未达到目标的项数，≥ 0。 |
| `unknown` | integer | 是 | 否 | 最终结果无法确认的项数，≥ 0。 |
| `not_attempted` | integer | 是 | 否 | 尚未发出写请求的项数，≥ 0。 |

<a id="execution-items"></a>
### 对象：ExecuteItem 与 SingleExecuteItem

两种结果项共用以下字段。`ExecuteItem.current_file` 为 [FileItem](../common/files.md#files)，`SingleExecuteItem.current_file` 为 [RenameFile](../common/files.md#files)。

#### Attributes

| 字段 | 类型 | 必含 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `file_id` | string | 是 | 否 | 原请求 ID，不因重命名后的身份变化而改写。 |
| `original_name` | string | 是 | 否 | 预览原名或单项请求携带的原名。 |
| `new_name` | string | 是 | 否 | 最终目标名。 |
| `status` | string | 是 | 否 | `renamed`、`skipped`、`failed`、`unknown` 或 `not_attempted`；单项当前返回 `renamed`、`failed` 或 `unknown`。 |
| `error` | string | 是 | 是 | 诊断信息，默认 `null`。 |
| `error_code` | string | 是 | 是 | [统一错误码](../common/errors.md#errors)，默认 `null`。 |
| `details` | object | 是 | 是 | 附加详情，包括[校验原因](../common/errors.md#validation-reasons)，默认 `null`。 |
| `actual_name` | string | 是 | 是 | 成功为已确认名称，跳过为预览原名；失败时为已核实名称或 `null`，未知和未执行不猜测名称；默认 `null`。 |
| `current_file` | FileItem / RenameFile | 是 | 是 | 成功写入后确认的元数据；默认 `null`；为空不能证明是否已写入。 |

<a id="execution-outcomes"></a>
### 操作结果

逐项 `status` 表示执行结果；`error_code` 和 `details` 补充原因，不能代替状态。

| `status` | 含义 |
| --- | --- |
| `renamed` | 已确认达到目标名。 |
| `skipped` | 无需修改而跳过，不能用于错误或停止提交。 |
| `failed` | 已确认未达到目标，不保证仍为原名，也不证明请求从未执行。 |
| `unknown` | 最终结果无法确认，不能直接判为失败。 |
| `not_attempted` | 尚未发出本项写请求；不是响应丢失，也不是下一次重试未发生。 |

总体状态只表示是否全部成功修改，`incomplete` 不代表全部失败；客户端使用 `counts` 和逐项状态区分部分完成、确认失败、未知及未执行。存在未知或缺失结果时，优先提示待核对。`error_code` 说明具体原因，`stop_reason` 说明停止原因；缺少当前名称不改变结果状态。

`actual_name` 是已确认的当前名称，`new_name` 始终是请求目标。`current_file` 提供确认元数据；使用其返回 ID 更新文件身份。名称或元数据为空不改变 `status`，也不能证明文件仍为原名。

同组出现未知写入时，先按 ID 核实。确认目标已达到则返回 `renamed`，确认其他名称则返回 `failed`；核实不了则保留 `unknown` 并停止提交后续组。未提交项返回 `not_attempted`，已确认成功项保留，不自动回滚。

客户端收到 `unknown`、缺失结果项或丢失整个执行响应时，不自动重发。发起操作的连接和目录读取成功后解除待核对保护，恢复单项改名和批量预览。旧预览作废。切换目录清理当前选择和预览，最近修改记录与待核对保护继续保留。

例如下项 `status` 明确表示尚未提交，错误诊断字段继续保留：

```json
{
  "file_id": "file-3",
  "original_name": "C.txt",
  "new_name": "Z.txt",
  "status": "not_attempted",
  "error": "Rename was not attempted after an unknown write outcome",
  "error_code": "PROVIDER_ERROR",
  "details": {"reason": "RENAME_NOT_ATTEMPTED", "stop_reason": "RENAME_OUTCOME_UNKNOWN"},
  "actual_name": null,
  "current_file": null
}
```

### 对象：RenameProgress

表示批量执行进度，不包含最终逐项结果。

#### Attributes

| 字段 | 类型 | 必含 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `preview_id` | string | 是 | 否 | 预览标识。 |
| `total` | integer | 是 | 否 | 名称变化的预览项目数，≥ 0。 |
| `processed` | integer | 是 | 否 | 已定案项目数，≥ 0，包括失败和最终未尝试项，不是成功数。初始为 `0`。 |
| `phase` | string | 是 | 否 | 阶段，见下表；初始为 `waiting`。 |
| `error` | string | 是 | 是 | 请求异常终止时的诊断信息，不是逐项失败列表。 |

| `phase` | 含义 |
| --- | --- |
| `waiting` | 预览存在，尚未开始执行。 |
| `validating` | 执行前复核。 |
| `renaming` | 写入目标名称。 |
| `finished` | 执行响应已就绪，可能为 `completed` 或 `incomplete`。 |
| `failed` | 执行请求复核失败、异常或中断，不代表已有完整执行响应。 |

`phase` 和 `processed` 仅表示进度，不替代最终逐项结果。`finished` 不保证全部成功，`failed` 不证明从未写入。

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
