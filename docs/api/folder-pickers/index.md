[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="folder-pickers"></a>
## 本地目录选择

### 接口索引

| 接口名称 | HTTP 方法 | 路径 | 文档 |
| --- | --- | --- | --- |
| 为新连接选择目录 | `POST` | `/local/folder-picker` | [为新连接选择目录](index.md#endpoint-post-local-folder-picker) |
| 为连接选择根目录 | `POST` | `/storages/{storage_id}/local/pick` | [为连接选择根目录](index.md#endpoint-post-storages-storage-id-local-pick) |

### 对象：LocalFolderPickResponse

表示后端电脑上的系统目录选择结果。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `root_path` | string | 否 | 选中目录的绝对路径；取消时为初始路径。 |
| `selected` | boolean | 否 | 是否选中目录。`false` 时客户端保留原输入。 |

<a id="endpoint-post-local-folder-picker"></a>
### 为新连接选择目录

打开目录选择器，返回路径而不保存连接。

`POST /local/folder-picker`

#### Parameters

无。初始目录为后端配置的 `local_storage_root`。

#### Returns

HTTP 200，返回 `LocalFolderPickResponse`。

#### Request / Response 示例

```http
POST /local/folder-picker
```

```json
{"root_path":"I:\\Files","selected":true}
```

#### Errors

- 502 `PROVIDER_ERROR`：系统目录选择器不可用或失败；允许用户手动输入路径。

<a id="endpoint-post-storages-storage-id-local-pick"></a>
### 为连接选择根目录

打开目录选择器，并在选中后更新连接根目录。

`POST /storages/{storage_id}/local/pick`

#### Parameters

路径参数 `storage_id`：string，必填，不可空；连接必须声明 `local_picker: true`。无请求体。

#### Returns

HTTP 200，返回 `LocalFolderPickResponse`。取消时不修改连接；根目录实际变化时更新连接版本，旧预览失效。

#### Request / Response 示例

```http
POST /storages/default-local/local/pick
```

```json
{"root_path":"I:\\Files","selected":false}
```

#### Errors

- 409 `STORAGE_BUSY`：等待重命名结束。
- 409 `STORAGE_CONNECTION_CHANGED`：选择期间连接变化；重新读取连接。
- 422 `VALIDATION_ERROR`：连接不支持选择器或选中配置无效。
- 502 `PROVIDER_ERROR`：目录选择器不可用或失败。
