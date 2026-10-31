[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md) · [文件元数据](../common/files.md)。

<a id="directories"></a>
## 目录

### 接口索引

| 接口名称 | HTTP 方法 | 路径 | 文档 |
| --- | --- | --- | --- |
| 列出目录 | `POST` | `/storages/{storage_id}/files/list` | [列出目录](list.md#endpoint-post-storages-storage-id-files-list) |

### 对象：DirectoryListing

表示一个目录及全部可见直接子项。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `provider` | string | 否 | Provider 类型，不替代 `storage_id`。 |
| `storage_id` | string | 是 | 当前目录接口返回实际连接 ID。 |
| `revision` | integer | 是 | 当前目录接口返回读取时的连接版本。 |
| `location` | StorageLocation | 是 | 规范化后的目录位置，后续导航和位置记忆使用此值。 |
| `parent_location` | StorageLocation | 是 | 父目录位置；根目录为 `null`。 |
| `path` | string | 否 | 当前目录显示路径。 |
| `parent_path` | string | 是 | 父目录显示路径；根目录为 `null`。 |
| `items` | array of FileItem | 否 | 直接子项；空目录为 `[]`。 |
| `breadcrumbs` | array of DirectoryBreadcrumb | 是 | Google Drive 返回从 My Drive 根目录到当前目录的导航项；其他内置 Provider 为 `null`。 |
| `directory_id` | string | 是 | 云目录真实 ID；Local 为 `null`。 |

#### 嵌套对象：DirectoryBreadcrumb

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 否 | 导航项显示名。 |
| `location` | StorageLocation | 否 | 导航目标，不从显示路径推导。 |
