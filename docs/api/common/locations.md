[API Reference](../README.md) · [通用约定](conventions.md) · [共享错误](errors.md)

<a id="locations"></a>
## 位置对象：StorageLocation

表示连接根目录、Provider ID 或根目录内的相对路径。

### Attributes

| 字段 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `kind` | string | 是 | 否 | `root`、`id` 或 `path`。 |
| `value` | string | 条件 | 否 | `id`、`path` 时必填；`root` 时禁止提供。`id` 至少 1 个字符。 |

位置对象拒绝未知字段。`path` 将反斜杠转为 `/`，移除重复、开头和结尾的分隔符；拒绝 `.`、`..` 路径分量。是否接受某种位置由 Provider 的 `locations` 决定。Google Drive 不接受任何 `path`，空路径也不例外。

```json
{"kind":"root"}
```

```json
{"kind":"id","value":"01ABCDEF12345678"}
```

```json
{"kind":"path","value":"照片/旅行"}
```
