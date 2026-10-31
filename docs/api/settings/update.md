[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="endpoint-patch-app-settings"></a>
### 更新应用设置

合并指定偏好字段，返回更新后的完整设置。

`PATCH /app-settings`

#### Parameters

请求体：

| 字段 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `language` | string | 否 | 否 | 省略保留原值，约束见 AppPreferences。 |
| `theme` | string | 否 | 否 | 省略保留原值；`light`、`dark`、`system`。 |
| `cloud_default_locations` | object | 否 | 否 | 省略保留全部记录；逐连接合并，键约束同 AppPreferences。 |
| ↳ `<storage_id>` | CloudDefaultLocation | 否 | 是 | 对象整体替换此连接记录，`null` 删除；未提交的连接保持不变。 |

字段直接放在请求体，不包裹 `preferences`。`{}` 不修改偏好；保存失败保留既有状态。

#### Returns

HTTP 200，返回完整 `AppSettingsResponse`，包含未修改字段。偏好不提供 `revision`。

#### Request / Response 示例

假设连接 `f5b9d4cc28d24b44a531724776d32c21` 当前账号为 `account-123`：

```http
PATCH /app-settings
Content-Type: application/json

{"language":"zh-CN","cloud_default_locations":{"f5b9d4cc28d24b44a531724776d32c21":{"account_id":"account-123","location":{"kind":"root"}}}}
```

```json
{
  "preferences":{
    "language":"zh-CN",
    "theme":"system",
    "cloud_default_locations":{
      "f5b9d4cc28d24b44a531724776d32c21":{
        "account_id":"account-123",
        "location":{"kind":"root"}
      }
    }
  }
}
```

删除该默认目录时提交：

```json
{"cloud_default_locations":{"f5b9d4cc28d24b44a531724776d32c21":null}}
```

#### Errors

- 404 `NOT_FOUND`：新增或替换默认目录时连接不存在。刷新连接列表；删除不存在的默认记录不报错。
- 409 `STORAGE_CONNECTION_CHANGED`：账号不符。重新读取账号，不保存旧账号位置。
- 422 `REQUEST_VALIDATION_ERROR`：格式、枚举、长度或请求大小无效。
- 422 `VALIDATION_ERROR`：合并后偏好超过数量或大小限制。
