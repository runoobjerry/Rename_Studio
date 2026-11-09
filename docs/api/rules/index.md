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
| `type` | string | 否 | 稳定类型。当前为 `padding`、`replace`、`remove`、`insert`、`serialize`。 |
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

#### serialize

按预览请求的 `file_ids` 顺序为每个选中项编号，文件夹也占一个序号。每条启用的 `serialize` 规则独立使用该顺序，将编号作用于规则链计算到当前位置的名称。对于从零开始的项索引 `i`，启用分组时先计算 `i % reset_every`，随后用所得索引计算 `start + (i // repeat) * step`。每组重新从 `start` 开始，并重新计算重复次数。

配置字段均可省略。下表中的 `M` 为配置输入上限 `99999999`。整数字段使用 JSON 整数。

| 字段 | 类型 | 默认值 | 有效值 |
| --- | --- | --- | --- |
| `numbering_system` | string | `decimal` | `decimal`、`alphabetic`、`roman`、`music`、`chinese` |
| `start` | integer | `1` | 取值由编号方式决定，见下表。 |
| `repeat` | integer | `1` | `1` 至 `M`，同一编号连续使用的项数。 |
| `step` | integer | `1` | `-M` 至 `M`，负数倒序，`0` 使编号固定。 |
| `reset_every` | integer 或 null | `null` | `1` 至 `M`，每组的项数。`null` 关闭分组。 |
| `pad_length` | integer 或 null | `null` | 十进制可设为 `1` 至 `255`，达到此长度后不截断。`null` 关闭补齐。其他编号方式须为 `null`。 |
| `position` | string | `prefix` | `prefix`、`suffix`、`index`、`replace`。 |
| `index` | integer | `1` | `1` 至 `255`。仅 `position: "index"` 使用，沿用 `insert` 的字符间隙与越界处理。 |
| `from_right` | boolean | `false` | 仅 `position: "index"` 使用。`true` 从名称末尾数。 |
| `ignore_extension` | boolean | `true` | 为 `true` 时对文件主名称操作，`replace` 也保留扩展名。为 `false` 时处理完整文件名。文件夹始终处理完整名称。 |

| 编号方式 | 起始序号范围 | 转换和补齐 |
| --- | --- | --- |
| `decimal` | `-M` 至 `M` | 左侧补 `0`。负号计入长度，补齐至 3 位时 `-1` 变为 `-01`。 |
| `alphabetic` | `1` 至 `M` | 将编号减一后按 26 进制转换，`a` 表示 0、`z` 表示 25。第 26 项为 `z`，第 27 项为 `ba`。 |
| `roman` | `1` 至 `3999` | 大写罗马数字，例如 `IV`、`IX`。 |
| `music` | `1` 至 `120` | 从 `C0` 开始按半音递进，`12` 为 `B0`，`13` 为 `C1`，最后一项为 `B9`。 |
| `chinese` | `1` 至 `9999` | 使用简体中文的千、百、十位，`10` 为「一十」，`1001` 为「一千零一」。 |

十进制和英文字母的生成结果可以超过配置输入上限，分别支持 `-9007199254740991` 至 `9007199254740991` 和 `1` 至 `9007199254740991`。其他编号方式的生成范围与上表的起始序号范围相同。

上表的数值上限、零与负值约束，以及仅十进制支持补齐的规则由 Rename Studio 定义。编号转换示例见 [ReNamer Serialize rule](https://www.den4b.com/docs/books/renamer/page/serialize-rule)。

配置无效或实际生成的编号超出范围时，预览返回 HTTP 422 `RULE_CONFIGURATION_ERROR` 和 `details.rule_type: "serialize"`。配置校验错误保留错误类型、位置等诊断信息，省略原始输入。生成越界时还返回 `details.reason: "SERIALIZE_NUMBER_OUT_OF_RANGE"`，以及 `details.params` 中的 `item`（从 1 开始的请求项位置）、`min` 和 `max`。编号成功生成后，目标名称继续接受原有名称校验和冲突检测。
