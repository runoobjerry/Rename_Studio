[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="storages"></a>
## 存储连接

### 接口索引

| 接口名称 | HTTP 方法 | 路径 | 文档 |
| --- | --- | --- | --- |
| 列出连接 | `GET` | `/storages` | [列出连接](index.md#endpoint-get-storages) |
| 创建连接 | `POST` | `/storages` | [创建连接](index.md#endpoint-post-storages) |
| 获取连接 | `GET` | `/storages/{storage_id}` | [获取连接](index.md#endpoint-get-storages-storage-id) |
| 更新连接 | `PUT` | `/storages/{storage_id}` | [更新连接](index.md#endpoint-put-storages-storage-id) |
| 删除连接 | `DELETE` | `/storages/{storage_id}` | [删除连接](index.md#endpoint-delete-storages-storage-id) |

### 对象：StorageInfo

表示独立配置与账号连接。默认创建 `default-local`；其他连接由创建接口添加。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `storage_id` | string | 否 | 连接标识，用于路径参数。 |
| `provider_type` | string | 否 | [Provider 类型](../providers/index.md#providers)。 |
| `name` | string | 否 | 用户设置的连接名称，1–200 字符。 |
| `config` | object | 否 | [公开配置](../providers/index.md#provider-config)，不含 Token 或 Secret。 |
| `revision` | integer | 否 | 连接版本，初始 `1`；配置或账号授权状态变化时递增。 |
| `busy` | boolean | 否 | 是否正在执行重命名。 |
| `has_client_secret` | boolean | 否 | 是否已保存密钥，不返回密钥值。 |
| `account_id` | string | 是 | 已保存账号的稳定标识。 |
| `account_display_name` | string | 是 | 账号显示名。 |
| `account_email` | string | 是 | 账号邮箱。 |

仅改 `name` 不改变 `revision`。配置或密钥实际变化会清除账号授权；正常 Token 刷新不改变连接版本。

<a id="endpoint-get-storages"></a>
### 列出连接

返回所有存储连接。

`GET /storages`

#### Parameters

无。

#### Returns

HTTP 200，返回 `StorageInfo[]`。

#### Request / Response 示例

```http
GET /storages
```

```json
[
  {
    "storage_id":"default-local",
    "provider_type":"local",
    "name":"Local Files",
    "config":{"root_path":"I:\\Files"},
    "revision":1,
    "busy":false,
    "has_client_secret":false,
    "account_id":null,
    "account_display_name":null,
    "account_email":null
  }
]
```

<a id="endpoint-post-storages"></a>
### 创建连接

创建指定 Provider 的独立连接。

`POST /storages`

#### Parameters

请求体：

| 字段 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `provider_type` | string | 是 | 否 | 已注册的 Provider 类型。 |
| `name` | string | 是 | 否 | 1–200 字符。 |
| `config` | object | 是 | 否 | 对应 Provider 的[配置对象](../providers/index.md#provider-config)。 |
| `client_secret` | string | 否 | 是 | 只写，默认 `null`；1–4096 字符，去除两端空白后不能为空。 |

拒绝未定义的顶层字段。

#### Returns

HTTP 201，返回新建的 `StorageInfo`；云连接尚未授权。

#### Request / Response 示例

```http
POST /storages
Content-Type: application/json

{"provider_type":"google_drive","name":"工作云盘","config":{}}
```

```json
{
  "storage_id":"f5b9d4cc28d24b44a531724776d32c21",
  "provider_type":"google_drive",
  "name":"工作云盘",
  "config":{"client_id":null},
  "revision":1,
  "busy":false,
  "has_client_secret":false,
  "account_id":null,
  "account_display_name":null,
  "account_email":null
}
```

#### Errors

- 422 `VALIDATION_ERROR`：Provider 未注册、配置无效或该类型不接受密钥。修正配置。
- 422 `REQUEST_VALIDATION_ERROR`：顶层字段或密钥格式无效。

<a id="endpoint-get-storages-storage-id"></a>
### 获取连接

返回指定连接的公开状态。

`GET /storages/{storage_id}`

#### Parameters

路径参数 `storage_id`：string，必填，不可空，连接标识。

#### Returns

HTTP 200，返回 `StorageInfo`。

#### Request / Response 示例

```http
GET /storages/default-local
```

```json
{
  "storage_id":"default-local",
  "provider_type":"local",
  "name":"Local Files",
  "config":{"root_path":"I:\\Files"},
  "revision":1,
  "busy":false,
  "has_client_secret":false,
  "account_id":null,
  "account_display_name":null,
  "account_email":null
}
```

<a id="endpoint-put-storages-storage-id"></a>
### 更新连接

更新名称、完整配置或客户端密钥。

`PUT /storages/{storage_id}`

#### Parameters

路径参数 `storage_id`：string，必填，不可空，连接标识。

请求体：

| 字段 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string | 否 | 是 | 1–200 字符；省略或 `null` 保留原名。 |
| `config` | object | 否 | 是 | 省略或 `null` 保留原配置；提供对象时[整体替换](../providers/index.md#provider-config)。 |
| `client_secret` | string | 否 | 是 | 1–4096 字符，去除两端空白后不能为空；省略或 `null` 保留原密钥，不能用于清空密钥。 |

拒绝未定义的顶层字段。提交相同配置和密钥不清除授权；仅修改名称不使旧预览失效。

#### Returns

HTTP 200，返回更新后的 `StorageInfo`。配置或密钥变化后重新读取授权状态和目录，丢弃旧预览。

#### Request / Response 示例

```http
PUT /storages/default-local
Content-Type: application/json

{"name":"本地文件"}
```

```json
{
  "storage_id":"default-local",
  "provider_type":"local",
  "name":"本地文件",
  "config":{"root_path":"I:\\Files"},
  "revision":1,
  "busy":false,
  "has_client_secret":false,
  "account_id":null,
  "account_display_name":null,
  "account_email":null
}
```

#### Errors

- 409 `STORAGE_BUSY`：等待重命名完成后修改。
- 422 `VALIDATION_ERROR`：配置或密钥能力不符合 Provider 定义。

<a id="endpoint-delete-storages-storage-id"></a>
### 删除连接

删除连接及保存的账号凭据。

`DELETE /storages/{storage_id}`

#### Parameters

路径参数 `storage_id`：string，必填，不可空，连接标识。

#### Returns

HTTP 204，无响应体。对应云默认目录记录一并删除。

#### Request / Response 示例

```http
DELETE /storages/f5b9d4cc28d24b44a531724776d32c21
```

```http
HTTP/1.1 204 No Content
```

#### Errors

- 409 `STORAGE_BUSY`：等待重命名完成后删除。
- 422 `VALIDATION_ERROR`，`reason: DEFAULT_CONNECTION_DELETE_FORBIDDEN`：`default-local` 不可删除。
