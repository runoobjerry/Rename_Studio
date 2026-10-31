[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="providers"></a>
## Provider 定义

### 接口索引

| 接口名称 | HTTP 方法 | 路径 | 文档 |
| --- | --- | --- | --- |
| 列出 Provider 定义 | `GET` | `/storage-providers` | [列出 Provider 定义](index.md#endpoint-get-storage-providers) |

### 对象：StorageProviderInfo

描述存储实现的配置与能力。前端应按能力启用操作，不从类型名称推断。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `provider_type` | string | 否 | 稳定标识。内置 `local`、`onedrive`、`google_drive`。 |
| `config_schema` | object | 否 | `config` 的 JSON Schema，不包含凭据。 |
| `config_fields` | array of StorageConfigField | 否 | 按显示顺序排列的配置字段。 |
| `icon` | string | 否 | `computer` 或 `cloud`。 |
| `locations` | array of string | 否 | 接受的位置类型，当前取值为 `root`、`id`、`path`。 |
| `can_rename` | boolean | 否 | 是否支持重命名。 |
| `browser_auth` | boolean | 否 | 是否使用浏览器授权。 |
| `local_picker` | boolean | 否 | 是否支持连接级本地目录选择器。 |

#### 嵌套对象：StorageConfigField

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `key` | string | 否 | 稳定字段标识。 |
| `input_type` | string | 否 | `text`、`password` 或 `directory`。 |
| `target` | string | 否 | `config` 写入请求的 `config[key]`；`client_secret` 写入请求顶层密钥。 |
| `required` | boolean | 否 | 配置字段是否必填。 |
| `nullable` | boolean | 否 | 配置字段是否可空。 |

定义不返回展示名称或字段文案。前端使用稳定 `provider_type`、`key` 查找翻译。

<a id="provider-config"></a>
### 配置对象：config

创建时必填，更新时可省略。更新配置时整体替换原 `config`，不逐字段合并。内置配置拒绝未知字段。

| Provider | 字段 | 类型 | 必填 | 可空 | 默认值与约束 |
| --- | --- | --- | --- | --- | --- |
| `local` | `root_path` | string | 是 | 否 | 1–4096 字符；后端电脑上已存在的目录；保存为解析后的绝对路径。 |
| `onedrive` | `client_id` | string | 否 | 是 | 默认 `null`；最长 200 字符；去除两端空白后不能为空。 |
| `google_drive` | `client_id` | string | 否 | 是 | 默认 `null`；最长 200 字符；去除两端空白后不能为空。 |

`client_secret` 是创建、更新请求的顶层字段，不属于 `config`。仅声明对应 `target` 的 Provider 接受非空密钥，内置实现中仅 Google Drive 支持。Google Drive 的 Client ID、Secret 均就绪后才能授权；可以先保存不完整配置。

<a id="endpoint-get-storage-providers"></a>
### 列出 Provider 定义

返回已注册的存储类型及能力。

`GET /storage-providers`

#### Parameters

无。

#### Returns

HTTP 200，返回 `StorageProviderInfo[]`。

#### Request / Response 示例

```http
GET /storage-providers
```

<details>
<summary>响应 JSON（展开查看完整配置 Schema）</summary>

```json
[
  {
    "provider_type": "local",
    "config_schema": {
      "additionalProperties": false,
      "properties": {"root_path":{"maxLength":4096,"minLength":1,"title":"Root Path","type":"string"}},
      "required": ["root_path"],
      "title": "LocalConfig",
      "type": "object"
    },
    "config_fields": [{"key":"root_path","input_type":"directory","target":"config","required":true,"nullable":false}],
    "icon": "computer",
    "locations": ["root","path","id"],
    "can_rename": true,
    "browser_auth": false,
    "local_picker": true
  },
  {
    "provider_type": "onedrive",
    "config_schema": {
      "additionalProperties": false,
      "properties": {"client_id":{"anyOf":[{"maxLength":200,"type":"string"},{"type":"null"}],"default":null,"title":"Client Id"}},
      "title": "OneDriveConfig",
      "type": "object"
    },
    "config_fields": [{"key":"client_id","input_type":"text","target":"config","required":false,"nullable":true}],
    "icon": "cloud",
    "locations": ["root","id","path"],
    "can_rename": true,
    "browser_auth": true,
    "local_picker": false
  },
  {
    "provider_type": "google_drive",
    "config_schema": {
      "additionalProperties": false,
      "properties": {"client_id":{"anyOf":[{"maxLength":200,"type":"string"},{"type":"null"}],"default":null,"title":"Client Id"}},
      "title": "GoogleDriveConfig",
      "type": "object"
    },
    "config_fields": [
      {"key":"client_id","input_type":"text","target":"config","required":false,"nullable":true},
      {"key":"client_secret","input_type":"text","target":"client_secret","required":false,"nullable":false}
    ],
    "icon": "cloud",
    "locations": ["root","id"],
    "can_rename": true,
    "browser_auth": true,
    "local_picker": false
  }
]
```

</details>
