[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="health"></a>
## 健康状态

### 接口索引

| 接口名称 | HTTP 方法 | 路径 | 文档 |
| --- | --- | --- | --- |
| 获取健康状态 | `GET` | `/health` | [获取健康状态](index.md#endpoint-get-health) |

### 对象：HealthResponse

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `status` | string | 否 | 当前固定返回 `ok`。 |

<a id="endpoint-get-health"></a>
### 获取健康状态

检查 API 进程是否能响应。

`GET /health`

#### Parameters

无。

#### Returns

HTTP 200，返回 `HealthResponse`。不检查云账号、Provider 或目录是否可用。

#### Request / Response 示例

```http
GET /health
```

```json
{"status":"ok"}
```
