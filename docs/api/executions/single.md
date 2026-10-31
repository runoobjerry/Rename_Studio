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
| `operation_id` | string | 是 | 否 | 客户端生成的 UUID，仅标识操作，不是预览 ID 或幂等键。 |
| `revision` | integer | 是 | 否 | 当前连接版本，≥ 1。 |
| `location` | StorageLocation | 否 | 否 | 默认根目录，作为请求上下文。 |
| `file_id` | string | 是 | 否 | 至少 1 个字符，目标项目 ID。 |
| `original_name` | string | 是 | 否 | 原名上下文，不用于比对当前名称。 |
| `target_name` | string | 是 | 否 | 完整目标名，文件须含扩展名；名称是否可用由 Provider 判断。 |

拒绝额外字段，不接受规则链；使用规则链时应先创建预览。

核对连接版本后按 ID 直接执行，不读取整个目录、不比对原名。名称、权限与冲突以 Provider 结果为准。Google Drive 单项直接按 ID 修改，不做 My Drive、祖先、类型或权限预检，允许其 API 接受的同目录同名；不因此新增 shared drive 浏览支持。

重复 `operation_id` 不保证只执行一次。同名请求也按 Provider 实际返回确认，不预先标为跳过。没有按 `operation_id` 查询结果或进度的接口。

#### Returns

HTTP 200，返回 `SingleRenameExecuteResponse`。确认目标时为 `completed`，唯一结果项为 `renamed`；Provider 明确拒绝或无法确认时为 `failed`，结果项含错误码。

成功后用 `current_file` 更新 ID 和名称。写入未知时先按 ID 核对，无法确认则返回 `RENAME_OUTCOME_UNKNOWN`，不自动重放。客户端网络失败也不得自动重发。

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
  "items":[
    {
      "file_id":"IMG_1.jpg",
      "original_name":"IMG_1.jpg",
      "new_name":"旅行.jpg",
      "status":"renamed",
      "error":null,
      "error_code":null,
      "details":null,
      "actual_name":null,
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
  "status":"failed",
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

#### Errors

- 422 `REQUEST_VALIDATION_ERROR`：UUID、连接版本、ID 或请求结构无效。
- 409 `STORAGE_CONNECTION_CHANGED`：连接删除或版本变化。读取连接、目录，用户确认后提交新操作。
- 409 `STORAGE_BUSY`：等待已有重命名结束。
- 422 `VALIDATION_ERROR`：连接不支持重命名。
- 写入阶段的 `NOT_FOUND`、`PERMISSION_DENIED`、`VALIDATION_ERROR`、`RENAME_CONFLICT` 等 Provider 错误位于 HTTP 200 的失败项中，可显示在名称输入框下；不要只依赖 HTTP 状态。
