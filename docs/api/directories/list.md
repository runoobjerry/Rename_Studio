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
| `location` | StorageLocation | 否 | 否 | 默认 `{"kind":"root"}`。支持的位置类型见 [StorageLocation](../common/locations.md#locations)。 |
| `refresh` | boolean | 否 | 否 | 默认 `false`，允许返回缓存结果。设为 `true` 时绕过目录缓存并直接读取存储。 |
| `parent_location` | StorageLocation | 否 | 是 | 普通导航可传目标的已知父目录位置。提示用于同连接版本的缓存复用或失效。强制刷新始终以云端结果为准。 |

请求体必需，读取根目录可提交 `{}`。不提供分页、搜索、排序或筛选参数，也不设应用级目录数量上限。

#### Returns

HTTP 200，返回 `DirectoryListing`。服务端汇总云端分页，读取失败时返回错误。

再次访问当前目录时，传回响应的 `location`。从列表进入子文件夹时，可将当前列表的 `location` 作为 `parent_location`。访问面包屑中的祖先时，目标及其父位置取自对应面包屑条目。

OneDrive 和 Google Drive 在命中目标列表时直接返回目录内容和面包屑。目标未命中时，服务端可从已知父列表复用子项与祖先链。提示缺失或不足时，Provider 按 ID 获取必要的目录元数据和内容。外部变更可能延迟到缓存过期才可见。

强制刷新成功后替换目标列表。批量重命名执行前直接读取云端数据，复核结果不回填目录缓存。重命名写入期间，同一连接的普通目录请求直接读取存储，结果不回填缓存。写入结束后，已确认的变更合并到仍有效且一致的父目录列表，保留原到期时间。改名项为文件夹时，清除该文件夹及其已缓存的后代。无法安全合并时使受影响的列表失效，有任何写入结果仍未知时清除该连接的目录缓存。缓存有效期和容量见[部署配置](../../../backend/cache.toml)。Local 每次读取文件系统。

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
      "can_list_children":null,
      "mime_type":null
    }
  ],
  "storage_id":"default-local",
  "revision":1,
  "location":{"kind":"root"},
  "parent_location":null,
  "breadcrumbs":null,
  "directory_id":null,
  "drive_id":null
}
```

#### Errors

- 409 `STORAGE_CONNECTION_CHANGED`。读取期间连接变化，重新读取连接状态后再加载目录。
- 409 `STORAGE_BUSY`。强制刷新时，连接正在执行或目录在读取期间失效。等待执行结束或重试刷新。
- 403 `PERMISSION_DENIED`。Provider 拒绝列举目录。Google Drive 返回空列表且实时权限仍未知时，也返回此错误。
- 422 `VALIDATION_ERROR`。连接不支持该位置类型，或位置无效、超出范围、指向链接目录。

#### Google Drive 目录约束

仅支持当前账号 My Drive 范围。返回可见的直接子项，无需当前账号拥有项目。列表排除回收站项目。快捷方式作为非目录项返回，`can_rename` 为 `false`。原生文档使用原始标题，不添加扩展名。
