[API Reference](../README.md) · [通用约定](conventions.md) · [共享错误](errors.md)

<a id="files"></a>
### 对象：RenameFile 与 FileItem

`RenameFile` 是重命名结果中确认的元数据；`FileItem` 用于目录列表和批量结果，要求显示路径非 `null`。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 否 | 当前项目 ID。Local 重命名后会变化。 |
| `name` | string | 否 | 当前完整名称。 |
| `is_directory` | boolean | 否 | 是否为文件夹。 |
| `path` | string | `RenameFile` 可空 | 显示路径；`FileItem` 必为 string。 |
| `parent_path` | string | `RenameFile` 可空 | 父目录显示路径；`FileItem` 必为 string，根目录内项目为 `""`。 |
| `size` | integer | 是 | 字节数；文件夹为 `null`，Google 原生文档等也可能为 `null`。 |
| `modified_at` | string | 是 | ISO 8601 修改时间。 |
| `location` | StorageLocation | 是 | 当前位置，进入文件夹时使用。 |
| `parent_location` | StorageLocation | 是 | 父目录位置。 |
| `can_rename` | boolean | 是 | `false` 表示不能重命名；`null` 表示未知，不能保证写入成功。 |
| `mime_type` | string | 是 | Google MIME type；其他内置 Provider 为 `null`。 |

单项结果可能不含可用显示路径。前端可结合浏览上下文生成路径；身份和成功判断以确认元数据及执行状态为准。
