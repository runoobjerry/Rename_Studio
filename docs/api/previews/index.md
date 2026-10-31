[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md) · [规则定义](../rules/index.md)。

<a id="previews"></a>
## 重命名预览

### 接口索引

| 接口名称 | HTTP 方法 | 路径 | 文档 |
| --- | --- | --- | --- |
| 释放预览 | `DELETE` | `/storages/{storage_id}/rename/previews/{preview_id}` | [释放预览](index.md#endpoint-delete-storages-storage-id-rename-previews-preview-id) |
| 创建预览 | `POST` | `/storages/{storage_id}/rename/preview` | [创建预览](create.md#endpoint-post-storages-storage-id-rename-preview) |

### 对象：RenamePreviewResponse

保存本次选择与规则的快照，不修改文件。快照在当前后端进程中有效 10 分钟，重启后失效。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `preview_id` | string | 否 | 服务端签发的标识，用于执行、进度查询和释放。 |
| `expires_at` | string | 否 | ISO 8601 到期时间。 |
| `items` | array of PreviewItem | 否 | 与请求 `file_ids` 顺序相同，包含未变化项。 |
| `valid` | boolean | 否 | 全部项目有效时为 `true`，不表示所有名称都会变化。 |

### 对象：PreviewItem

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `file_id` | string | 否 | 请求中的文件 ID。 |
| `original_name` | string | 否 | 预览时的完整名称。 |
| `new_name` | string | 否 | 规则或指定目标产生的完整名称。 |
| `changed` | boolean | 否 | 原名与目标名是否不同。 |
| `valid` | boolean | 否 | 名称及该项操作是否有效。 |
| `conflict` | boolean | 否 | 是否与其他目标或未选中兄弟项名称冲突。 |
| `error` | string | 是 | 无效原因的诊断信息，正常为 `null`。 |
| `details` | object | 是 | [校验原因与参数](../common/errors.md#validation-reasons)，无结构化原因时为 `null`。 |

`conflict` 只是无效的一种原因；名称非法、不可重命名等也使 `valid: false`。

<a id="endpoint-delete-storages-storage-id-rename-previews-preview-id"></a>
### 释放预览

释放指定连接的预览快照。

`DELETE /storages/{storage_id}/rename/previews/{preview_id}`

#### Parameters

| 字段 | 位置 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `storage_id` | 路径 | string | 是 | 否 | 所属连接，连接删除后仍可清理。 |
| `preview_id` | 路径 | string | 是 | 否 | 要释放的预览。 |

#### Returns

HTTP 204，无响应体。不存在、过期、已消费、重复释放或属于其他连接均不报错。不会取消已开始的执行，也不会清除执行进度。

#### Request / Response 示例

```http
DELETE /storages/default-local/rename/previews/4db956a6-c583-47af-bcde-9ea71312fc36
```

```http
HTTP/1.1 204 No Content
```
