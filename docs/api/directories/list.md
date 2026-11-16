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
| `refresh` | boolean | 否 | 否 | 默认 `false`，允许返回缓存结果。设为 `true` 时实时读取目录内容；是否复用祖先信息由 `reuse_ancestors` 决定。 |
| `reuse_ancestors` | boolean | 否 | 否 | 默认 `false`。仅在 `refresh: true` 时生效，允许定位目录时复用同连接版本内的有效祖先信息。适用于外部导航；手动刷新及未知写入后的目录核对应省略或设为 `false`。 |
| `parent_location` | StorageLocation | 否 | 是 | 默认 `null`。普通导航可传目标的已知父目录位置，供服务端复用同连接版本的缓存。`refresh: true` 时不作为目录读取依据。 |

请求体必需，读取根目录可提交 `{}`。不提供分页、搜索、排序或筛选参数，也不设应用级目录数量上限。

读取方式：

| `refresh` | `reuse_ancestors` | 行为 |
| --- | --- | --- |
| `false` | `false` 或 `true` | 允许复用目录列表、目标及祖先信息；忽略 `reuse_ancestors`。 |
| `true` | `false` | 实时读取目录元数据、祖先信息和目录内容，适用于手动刷新及未知写入后的目录核对。 |
| `true` | `true` | 实时读取目录内容，定位时允许复用根目录及祖先信息；不直接返回已缓存的目标列表。 |

#### Returns

HTTP 200，返回 [DirectoryListing](index.md#对象directorylisting)。服务端汇总云端分页，读取失败时返回错误。

后续访问应原样传回响应的 `location`。从列表进入子文件夹时，使用子项的 `location`，并可将当前目录的 `location` 作为 `parent_location`。访问祖先目录时，使用对应面包屑条目的 `location`，不从显示路径推导位置。

OneDrive 和 Google Drive 的目录缓存按连接及版本隔离。普通读取可返回有效缓存；即使目录内容为实时读取，复用的目录名称、父级关系和面包屑仍可能暂时陈旧。需要完整刷新时，提交 `refresh: true` 并省略 `reuse_ancestors`。Local 每次读取文件系统。

完整刷新成功后替换目标列表；若发现目录或祖先改名、移动，或旧子目录消失、变为非目录，则使受影响的目录缓存失效。无关目录的缓存可继续复用。缓存有效期及目录数量上限见[缓存配置](../../../backend/cache.toml)。

重命名写入期间，同一连接的普通目录读取绕过缓存且不回填；强制刷新返回 `STORAGE_BUSY`。写入结束后，服务端按已确认结果更新或使相关缓存失效；结果仍未知时清除该连接缓存。写入结果及后续处理见[执行结果](../executions/index.md#execution-outcomes)。

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

手动刷新指定云目录：

```http
POST /storages/cloud-connection/files/list
Content-Type: application/json

{"location":{"kind":"id","value":"folder-id"},"refresh":true}
```

外部导航允许复用祖先信息时，在同一请求体中增加 `"reuse_ancestors": true`；响应结构不变。`cloud-connection` 和 `folder-id` 分别替换为实际连接 ID 和目录 ID。

#### Errors

- 409 `STORAGE_CONNECTION_CHANGED`。读取期间连接变化，重新读取连接状态后再加载目录。
- 409 `STORAGE_BUSY`。强制刷新时，连接正在执行或目录在读取期间失效。等待执行结束或重试刷新。
- 403 `PERMISSION_DENIED`。Provider 拒绝列举目录。Google Drive 未提供列举权限提示本身不会触发此错误。
- 422 `VALIDATION_ERROR`。连接不支持该位置类型，或位置无效、超出范围、指向链接目录。

#### Google Drive 目录约束

仅支持当前账号 My Drive 范围。返回可见的直接子项，无需当前账号拥有项目。列表排除回收站项目。快捷方式作为非目录项返回，`can_rename` 为 `false`。原生文档使用原始标题，不添加扩展名。
