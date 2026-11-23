[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md) · [文件元数据](../common/files.md)。

<a id="endpoint-post-storages-storage-id-rename-single-execute"></a>
### 单项直接执行

按文件 ID 重命名一个文件或文件夹，无需预览。

`POST /storages/{storage_id}/rename/single/execute`

#### Parameters

路径参数 `storage_id`：string，必填，不可空，连接标识。

请求体：

| 字段 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `operation_id` | string | 是 | 否 | 客户端生成的操作 UUID。 |
| `revision` | integer | 是 | 否 | 当前连接版本，≥ 1。 |
| `location` | StorageLocation | 否 | 否 | 默认根目录，作为请求上下文。 |
| `file_id` | string | 是 | 否 | 至少 1 个字符，目标项目 ID。 |
| `original_name` | string | 是 | 否 | 原名上下文，不用于比对当前名称。 |
| `target_name` | string | 是 | 否 | 完整目标名，文件须含扩展名；名称是否可用由 Provider 判断。 |

请求仅接受上表字段；规则链重命名使用[创建预览](../previews/create.md#endpoint-post-storages-storage-id-rename-preview)。

服务端核对连接版本后按 ID 独立执行每次提交，同名请求同样交由 Provider 执行并确认结果，名称、权限与冲突以 Provider 返回的结果为准。

#### Returns

HTTP 200，返回 [SingleRenameExecuteResponse](index.md#对象singlerenameexecuteresponse)。整体成功为 `completed`，失败或未知为 `incomplete`；唯一结果项的 `status` 分别为 `renamed`、`failed` 或 `unknown`，定义见[逐项状态](index.md#execution-outcomes)。`counts` 返回各状态的数量。

成功后用 `current_file` 更新 ID 和名称。写入未知时先按 ID 核对，无法确认则返回 `RENAME_OUTCOME_UNKNOWN`，无自动重放机制。

#### Request / Response 示例

```http
POST /storages/default-local/rename/single/execute
Content-Type: application/json

{"operation_id":"72ec54b8-8818-42ec-9ca1-7ae217976c53","revision":1,"file_id":"IMG_1.jpg","original_name":"IMG_1.jpg","target_name":"旅行.jpg"}
```

```json
{
  "operation_id":"72ec54b8-8818-42ec-9ca1-7ae217976c53",
  "status":"completed",
  "counts":{"renamed":1,"skipped":0,"failed":0,"unknown":0},
  "items":[
    {
      "file_id":"IMG_1.jpg",
      "original_name":"IMG_1.jpg",
      "new_name":"旅行.jpg",
      "status":"renamed",
      "error":null,
      "error_code":null,
      "details":null,
      "actual_name":"旅行.jpg",
      "current_file":{
        "id":"旅行.jpg",
        "name":"旅行.jpg",
        "path":"旅行.jpg",
        "parent_path":"",
        "is_directory":false,
        "size":2048,
        "modified_at":"2026-10-31T02:00:00Z",
        "location":{"kind":"path","value":"旅行.jpg"},
        "parent_location":{"kind":"root"},
        "can_rename":true,
        "mime_type":null
      }
    }
  ]
}
```

目标改为 `""` 时，Local 返回 HTTP 200 的失败结果：

```json
{
  "operation_id":"72ec54b8-8818-42ec-9ca1-7ae217976c53",
  "status":"incomplete",
  "counts":{"renamed":0,"skipped":0,"failed":1,"unknown":0},
  "items":[
    {
      "file_id":"IMG_1.jpg",
      "original_name":"IMG_1.jpg",
      "new_name":"",
      "status":"failed",
      "error":"Filename cannot be empty",
      "error_code":"VALIDATION_ERROR",
      "details":{"new_name":"","reason":"NAME_EMPTY","params":{}},
      "actual_name":null,
      "current_file":null
    }
  ]
}
```

无法确认最终结果时，整体为 `incomplete`，结果项为 `unknown`：

```json
{
  "operation_id":"72ec54b8-8818-42ec-9ca1-7ae217976c53",
  "status":"incomplete",
  "counts":{"renamed":0,"skipped":0,"failed":0,"unknown":1},
  "items":[
    {
      "file_id":"IMG_1.jpg",
      "original_name":"IMG_1.jpg",
      "new_name":"旅行.jpg",
      "status":"unknown",
      "error":"Local rename completed but confirmation metadata could not be read",
      "error_code":"RENAME_OUTCOME_UNKNOWN",
      "details":{"provider_type":"local","errno":13},
      "actual_name":null,
      "current_file":null
    }
  ]
}
```

#### Errors

- 422 `REQUEST_VALIDATION_ERROR`：UUID、连接版本、ID 或请求结构无效。
- 409 `STORAGE_CONNECTION_CHANGED`：连接删除或版本变化。读取连接、目录，用户确认后提交新操作。
- 409 `STORAGE_BUSY`：等待已有重命名结束。
- 422 `VALIDATION_ERROR`：连接不支持重命名。
- 写入阶段的 `NOT_FOUND`、`PERMISSION_DENIED`、`VALIDATION_ERROR`、`RENAME_CONFLICT` 等 Provider 错误位于 HTTP 200 的失败项中。客户端按结果项的 `status` 和 `error_code` 显示错误，可放在名称输入框下。
