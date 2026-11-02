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
| `completed` | 每项均为已确认重命名或无需修改，包括全部跳过的情况。 |
| `partial` | 至少一项已确认重命名，且存在失败、未知或未尝试项。 |
| `failed` | 存在失败、未知或未尝试项且无已确认重命名项，可能同时包含跳过项；不能据此认为所有项目均为已确认失败。 |

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
| `current_file` | FileItem / RenameFile | 是 | 成功写入后确认的元数据；`null` 本身不能证明是否已写入。 |

<a id="execution-outcomes"></a>
### 操作结果与兼容映射

阶段一保留公开三值 `status`，由下表中的稳定字段解释五种结果。按表顺序分类，后端与前端分别集中在 `RenameItemResult.outcome` 和 `renameItemOutcome`，不读取 `error` 文案。

| 统一结果 | 当前 wire 字段 | 含义 |
| --- | --- | --- |
| `renamed` | `status: renamed` | 已确认达到目标名。 |
| `skipped` | `status: skipped` | 无需修改而跳过；不能用于错误或停止提交。 |
| `unknown` | `status: failed`、`error_code: RENAME_OUTCOME_UNKNOWN` | 按 ID 核实后，最终名称或目标结果仍不能确认；不能直接判定失败。 |
| `not_attempted` | `status: failed`、`details.reason: RENAME_NOT_ATTEMPTED` | 有尚未发出本项写请求的依据；不是请求发出后丢失响应，也不是已拒绝项的下一次重试未发生。 |
| `failed` | 其他 `status: failed` | 已确认未达到目标，不保证仍为原名，也不证明请求从未执行；依赖 Provider 对明确错误与未知写入的正确分类。 |

总体状态按上述统一结果计算，不增加组合枚举。单项流程沿用同一语义；未知项的总体状态仍为 `failed`，客户端必须检查逐项稳定字段。Provider 错误分类的完整整理属于后续阶段，本阶段不通过猜测名称或元数据弥补分类。

`actual_name` 和 `current_file` 独立表达确认名称与确认元数据。已核实名称为第三个名称且未达到目标时是 `failed`，不会因为缺少完整元数据而变成 `unknown`。`null` 既不能证明未知，也不能证明未执行；缺失整个结果项或整次响应时，客户端仍保持待核对保护。单项声称成功但缺少所需确认元数据时，继续保留客户端的待核对保护，不改写服务端结果状态。

写入确定性是判断下一步能否再次提交的事实，不新增一套公开状态字段：

| 确定性 | 证据及边界 |
| --- | --- |
| 已确认 | 远端返回或按 ID 核实了目标是否达到；可以是成功，也可以是失败。不能由是否有完整显示路径判断。 |
| 结果未知 | 已发出请求但无可靠确认，核实仍失败。先核对，不盲目重放。 |
| 未执行 | 尚未发出本项写请求；当前由调度器未提交的剩余组证明。复核失败的 `execution_started: false` 则是整个执行请求的未写入证据。 |

已确认失败和未执行不同：例如写请求已返回明确拒绝，虽可按具体条件处理，不能因此把操作历史标成“从未尝试”。未知经核实可变成成功或失败；无法核实就保持未知，不定义恢复状态。

交换、循环或名称占用链在预览时判为冲突，不使用临时名称。执行保留成功项，不自动回滚；失败时返回明确错误或未知结果。

`error_code: RENAME_OUTCOME_UNKNOWN` 表示写入可能发生，但按 ID 核对仍无法确认，此时 `actual_name: null`。核对真实文件后再决定下一步，不自动重放。

例如下项保持旧 `status` 和 `PROVIDER_ERROR`，结构化字段明确表示它尚未提交，而不是本项写入未知：

```json
{
  "file_id": "file-3",
  "original_name": "C.txt",
  "new_name": "Z.txt",
  "status": "failed",
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
| `renaming` | 写入目标名称。 |
| `finished` | 执行响应已就绪，可能为 `completed`、`partial` 或 `failed`。 |
| `failed` | 执行请求复核失败、异常或中断，不代表已有完整执行响应。 |

`phase` 仅描述执行阶段，不能代替逐项结果或写入确定性。`renaming` 时同批项目可能同时处于未提交、在途和已确认状态；`finished` 不保证全部成功，`failed` 不保证从未写入。先读取最终逐项结果；没有完整响应时保留待核对保护，不根据进度或诊断猜测结果。

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
