[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md) · [文件元数据](../common/files.md)。

<a id="endpoint-post-storages-storage-id-files-list"></a>
### 列出目录

返回指定位置的完整目录列表。

`POST /storages/{storage_id}/files/list`

#### Parameters

路径参数 `storage_id`：string，必填，不可空，连接标识。

请求体：

| 字段 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `location` | StorageLocation | 否 | 否 | 默认 `{"kind":"root"}`。 |

请求体必需，读取根目录可提交 `{}`。不提供分页、搜索、排序或筛选参数，也不设应用级目录数量上限。

#### Returns

HTTP 200，返回 `DirectoryListing`。云端分页由后端汇总；读取失败不返回部分列表。

#### Request / Response 示例

```http
POST /storages/default-local/files/list
Content-Type: application/json

{}
```

```json
{
  "provider":"local",
  "path":"",
  "parent_path":null,
  "items":[
    {
      "id":"IMG_1.jpg",
      "name":"IMG_1.jpg",
      "path":"IMG_1.jpg",
      "parent_path":"",
      "is_directory":false,
      "size":2048,
      "modified_at":"2026-10-31T02:00:00Z",
      "location":{"kind":"path","value":"IMG_1.jpg"},
      "parent_location":{"kind":"root"},
      "can_rename":true,
      "mime_type":null
    }
  ],
  "storage_id":"default-local",
  "revision":1,
  "location":{"kind":"root"},
  "parent_location":null,
  "breadcrumbs":null,
  "directory_id":null
}
```

#### Errors

- 409 `STORAGE_CONNECTION_CHANGED`：读取期间连接变化；重新读取连接状态再加载。
- 422 `VALIDATION_ERROR`：位置类型不支持、路径无效、超出范围或进入链接目录。
- 401、403、404、429、502：按[共享错误](../common/errors.md#errors)处理，不把失败视为空目录。

#### Google Drive 目录约束

浏览和批量重命名仅支持当前账号 My Drive 范围，不支持 shared drive、trashed 项目或跟随 shortcut。目录包含所有可见直接子项，不要求当前账号拥有项目。

shortcut 保留为非目录行，`can_rename: false`。原生文档保留真实标题，不添加合成扩展名。文件夹重名或名称含 `/` 时仍使用位置 ID 和 breadcrumbs 导航。
