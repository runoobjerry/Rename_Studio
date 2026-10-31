[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="rules"></a>
## 规则

### 接口索引

| 接口名称 | HTTP 方法 | 路径 | 文档 |
| --- | --- | --- | --- |
| 列出规则定义 | `GET` | `/rules` | [列出规则定义](list.md#endpoint-get-rules) |

### 对象：RuleDefinition

描述可用于预览的规则类型及其配置。

#### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `type` | string | 否 | 稳定类型。当前为 `padding`、`replace`、`remove`、`insert`。 |
| `config_schema` | object | 否 | 配置的 JSON Schema。 |

不返回规则名称或说明，前端按 `type` 查找翻译。

<a id="rule-spec"></a>
### 对象：RuleSpec

用于预览请求。按数组顺序执行；禁用的规则不解析配置、不执行，但仍计入 20 条上限。

#### Attributes

| 字段 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `type` | string | 是 | 否 | 至少 1 个字符；启用时须为已注册类型。 |
| `enabled` | boolean | 否 | 否 | 默认 `true`。 |
| `config` | object | 否 | 否 | 默认 `{}`；启用时须符合对应配置。 |

<a id="rule-configs"></a>
### 规则配置对象

空文本指 `""`，不包括纯空白字符串。跳过规则时保留当前名称，继续后续规则。文件扩展名指最后一个句点起的后缀；以句点开头且无其他句点的名称视为无扩展名。文件夹始终处理完整名称。

#### padding

补齐文件主名称或其中的数字，不修改文件扩展名。

| 字段 | 类型 | 必填 | 可空 | 默认值与约束 |
| --- | --- | --- | --- | --- |
| `mode` | string | 是 | 否 | `number` 或 `text`。数字模式对每段 ASCII 数字独立补零。 |
| `length` | integer | 是 | 否 | 1–255；达到此长度后不截断。 |
| `fill_character` | string | 否 | 否 | 默认 `_`，最多 1 个字符；文本模式为空时跳过。数字模式不使用此值。 |
| `side` | string | 否 | 否 | 默认 `left`；`left` 或 `right`，仅用于文本模式。 |

#### replace / remove 的匹配字段

使用字面文本匹配，不将 `search` 当作正则表达式。`remove` 删除匹配，`replace` 使用 `replacement` 替换。

| 字段 | 类型 | 必填 | 可空 | 默认值与约束 |
| --- | --- | --- | --- | --- |
| `search` | string | 是 | 否 | 最长 255 字符；为空时跳过。 |
| `occurrence` | string | 否 | 否 | 默认 `all`；`all`、`first` 或 `last`。 |
| `case_sensitive` | boolean | 否 | 否 | 默认 `true`。 |
| `whole_word` | boolean | 否 | 否 | 默认 `false`；为 `true` 时匹配前后不能紧邻 Unicode 字母、数字或下划线。 |
| `ignore_extension` | boolean | 否 | 否 | 默认 `true`；文件不处理扩展名，文件夹仍处理完整名称。 |

`replace` 额外接受：

| 字段 | 类型 | 必填 | 可空 | 默认值与约束 |
| --- | --- | --- | --- | --- |
| `replacement` | string | 否 | 否 | 默认 `""`，最长 255 字符；空串表示删除匹配，反斜杠按原文处理。 |

#### insert

在文件主名称或文件夹完整名称中插入文本。

| 字段 | 类型 | 必填 | 可空 | 默认值与约束 |
| --- | --- | --- | --- | --- |
| `text` | string | 是 | 否 | 最长 255 字符；为空时跳过。 |
| `position` | string | 否 | 否 | 默认 `prefix`；`prefix`、`suffix`、`index`、`before_text` 或 `after_text`。 |
| `index` | integer | 否 | 否 | 默认 `1`，1–255；仅 `index` 位置使用。从左数的字符间隙索引，越界时插在末尾。 |
| `from_right` | boolean | 否 | 否 | 默认 `false`；仅 `index` 位置使用。为 `true` 时距末尾 `index` 个字符，越界时插在开头。 |
| `anchor` | string | 否 | 否 | 默认 `""`，最长 255 字符；相对文本位置使用首个区分大小写的字面匹配，为空或未找到时跳过。 |
