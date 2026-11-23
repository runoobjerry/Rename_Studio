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

服务端从预览快照取得文件、规则和目标名称，写入前实时读取指定目录的全部直接子项，复核源项、同目录名称和预览结果。连接版本变化时拒绝写入；源项缺失、原名变化或重新计算的预览结果变化时，拒绝执行并使该目录缓存失效。

Google Drive 可能以成功的空列表隐藏不存在或无权访问的目录。若因此无法找到快照中的源项，返回 `PREVIEW_EXPIRED`；明确的授权或权限错误仍按[共享错误](../common/errors.md)返回。

预览在复核成功后、开始写入前被消费，只能执行一次。请求等待并返回最终逐项结果，进度查询用于展示执行阶段。

#### Returns

HTTP 200，返回 [RenameExecuteResponse](index.md#对象renameexecuteresponse)。`completed` 表示全部完成，`incomplete` 表示未全部完成。`counts` 汇总成功、跳过、失败和结果未知的数量。跳过原因见[逐项结果](index.md#execution-outcomes)。

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
  "counts":{"renamed":1,"skipped":0,"failed":0,"unknown":0},
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
- 复核期间的应用错误附 `details.execution_started: false`，客户端提示尚未开始写入并要求重新预览。缺少该标记时，按执行结果核对真实文件状态。
