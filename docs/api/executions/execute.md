[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md) · [文件元数据](../common/files.md)。

<a id="endpoint-post-rename-execute"></a>
### 执行预览

复核保存的快照，并执行其中的重命名。

`POST /rename/execute`

#### Parameters

请求体：

| 字段 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `preview_id` | string | 是 | 否 | 至少 1 个字符；服务端签发、未过期且未消费的预览标识。 |

不重新提交文件、规则或目标名称。写入前复核源项、同目录名称和预览结果；连接版本或结果变化时拒绝写入。复核不比较文件大小或修改时间。

预览在复核成功后、开始写入前被消费，不能再次执行。请求等待最终结果，进度查询不替代此响应。

#### Returns

HTTP 200，返回 `RenameExecuteResponse`。必须检查整体 `status` 和逐项 `status`、`error_code`；HTTP 200 不保证全部成功。

#### Request / Response 示例

```http
POST /rename/execute
Content-Type: application/json

{"preview_id":"4db956a6-c583-47af-bcde-9ea71312fc36"}
```

```json
{
  "preview_id":"4db956a6-c583-47af-bcde-9ea71312fc36",
  "status":"completed",
  "items":[
    {
      "file_id":"IMG_1.jpg",
      "original_name":"IMG_1.jpg",
      "new_name":"IMG_001.jpg",
      "status":"renamed",
      "error":null,
      "error_code":null,
      "details":null,
      "actual_name":"IMG_001.jpg",
      "current_file":{
        "id":"IMG_001.jpg",
        "name":"IMG_001.jpg",
        "path":"IMG_001.jpg",
        "parent_path":"",
        "is_directory":false,
        "size":2048,
        "modified_at":"2026-10-31T02:00:00Z",
        "location":{"kind":"path","value":"IMG_001.jpg"},
        "parent_location":{"kind":"root"},
        "can_rename":true,
        "mime_type":null
      }
    }
  ]
}
```

#### Errors

- 404 `PREVIEW_NOT_FOUND`：预览不存在或已消费。刷新目录、重新预览，不重复提交旧 ID。
- 409 `PREVIEW_EXPIRED`：预览过期、源项缺失或复核结果变化。重新预览；快照已回收时也可能返回 404。
- 409 `STORAGE_CONNECTION_CHANGED`：连接删除或版本变化。读取连接、目录后重新预览。
- 409 `STORAGE_BUSY`：连接已有重命名，等待完成。
- 422 `VALIDATION_ERROR`：预览含无效项，不能执行。
- 复核期间的应用错误附 `details.execution_started: false`。可明确提示尚未开始写入并要求重新预览；缺少该标记时不能直接推断写入状态。
