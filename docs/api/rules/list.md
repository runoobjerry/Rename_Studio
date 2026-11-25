[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md)。

<a id="endpoint-get-rules"></a>
### 列出规则定义

返回当前注册的规则及配置 Schema。

`GET /rules`

#### Parameters

无。

#### Returns

HTTP 200，返回 `RuleDefinition[]`。

#### Request / Response 示例

```http
GET /rules
```

<details>
<summary>响应 JSON（展开查看完整配置 Schema）</summary>

```json
[
  {
    "type":"padding",
    "config_schema":{
      "$defs":{
        "PaddingMode":{"enum":["number","text"],"title":"PaddingMode","type":"string"},
        "PaddingSide":{"enum":["left","right"],"title":"PaddingSide","type":"string"}
      },
      "properties":{
        "mode":{"$ref":"#/$defs/PaddingMode"},
        "length":{"maximum":255,"minimum":1,"title":"Length","type":"integer"},
        "fill_character":{"default":"_","maxLength":1,"title":"Fill Character","type":"string"},
        "side":{"$ref":"#/$defs/PaddingSide","default":"left"}
      },
      "required":["mode","length"],
      "title":"PaddingConfig",
      "type":"object"
    }
  },
  {
    "type":"replace",
    "config_schema":{
      "$defs":{"MatchOccurrence":{"enum":["all","first","last"],"title":"MatchOccurrence","type":"string"}},
      "properties":{
        "search":{"maxLength":255,"title":"Search","type":"string"},
        "occurrence":{"$ref":"#/$defs/MatchOccurrence","default":"all"},
        "case_sensitive":{"default":true,"title":"Case Sensitive","type":"boolean"},
        "whole_word":{"default":false,"title":"Whole Word","type":"boolean"},
        "ignore_extension":{"default":true,"title":"Ignore Extension","type":"boolean"},
        "replacement":{"default":"","maxLength":255,"title":"Replacement","type":"string"}
      },
      "required":["search"],
      "title":"ReplaceConfig",
      "type":"object"
    }
  },
  {
    "type":"remove",
    "config_schema":{
      "$defs":{"MatchOccurrence":{"enum":["all","first","last"],"title":"MatchOccurrence","type":"string"}},
      "properties":{
        "search":{"maxLength":255,"title":"Search","type":"string"},
        "occurrence":{"$ref":"#/$defs/MatchOccurrence","default":"all"},
        "case_sensitive":{"default":true,"title":"Case Sensitive","type":"boolean"},
        "whole_word":{"default":false,"title":"Whole Word","type":"boolean"},
        "ignore_extension":{"default":true,"title":"Ignore Extension","type":"boolean"}
      },
      "required":["search"],
      "title":"RemoveConfig",
      "type":"object"
    }
  },
  {
    "type":"insert",
    "config_schema":{
      "$defs":{"InsertPosition":{"enum":["prefix","suffix","index","before_text","after_text"],"title":"InsertPosition","type":"string"}},
      "properties":{
        "text":{"maxLength":255,"title":"Text","type":"string"},
        "position":{"$ref":"#/$defs/InsertPosition","default":"prefix"},
        "index":{"default":1,"maximum":255,"minimum":1,"title":"Index","type":"integer"},
        "from_right":{"default":false,"title":"From Right","type":"boolean"},
        "anchor":{"default":"","maxLength":255,"title":"Anchor","type":"string"}
      },
      "required":["text"],
      "title":"InsertConfig",
      "type":"object"
    }
  },
  {
    "type":"delete",
    "config_schema":{
      "additionalProperties":false,
      "properties":{
        "from_mode":{"default":"position","enum":["position","delimiter"],"title":"From Mode","type":"string"},
        "from_position":{"default":1,"maximum":255,"minimum":1,"title":"From Position","type":"integer"},
        "from_delimiter":{"default":"","maxLength":255,"title":"From Delimiter","type":"string"},
        "until_mode":{"default":"count","enum":["count","delimiter","end"],"title":"Until Mode","type":"string"},
        "until_count":{"default":1,"maximum":255,"minimum":1,"title":"Until Count","type":"integer"},
        "until_delimiter":{"default":"","maxLength":255,"title":"Until Delimiter","type":"string"},
        "delete_current_name":{"default":false,"title":"Delete Current Name","type":"boolean"},
        "ignore_extension":{"default":true,"title":"Ignore Extension","type":"boolean"},
        "from_right":{"default":false,"title":"From Right","type":"boolean"},
        "keep_delimiters":{"default":false,"title":"Keep Delimiters","type":"boolean"}
      },
      "title":"DeleteConfig",
      "type":"object"
    }
  },
  {
    "type":"serialize",
    "config_schema":{
      "additionalProperties":false,
      "properties":{
        "numbering_system":{"default":"decimal","enum":["decimal","alphabetic","roman","music","chinese"],"title":"Numbering System","type":"string"},
        "start":{"default":1,"maximum":99999999,"minimum":-99999999,"title":"Start","type":"integer"},
        "repeat":{"default":1,"maximum":99999999,"minimum":1,"title":"Repeat","type":"integer"},
        "step":{"default":1,"maximum":99999999,"minimum":-99999999,"title":"Step","type":"integer"},
        "reset_every":{"anyOf":[{"maximum":99999999,"minimum":1,"type":"integer"},{"type":"null"}],"default":null,"title":"Reset Every"},
        "pad_length":{"anyOf":[{"maximum":255,"minimum":1,"type":"integer"},{"type":"null"}],"default":null,"title":"Pad Length"},
        "position":{"default":"prefix","enum":["prefix","suffix","index","replace"],"title":"Position","type":"string"},
        "index":{"default":1,"maximum":255,"minimum":1,"title":"Index","type":"integer"},
        "from_right":{"default":false,"title":"From Right","type":"boolean"},
        "ignore_extension":{"default":true,"title":"Ignore Extension","type":"boolean"}
      },
      "title":"SerializeConfig",
      "type":"object"
    }
  },
  {
    "type":"user_input",
    "config_schema":{
      "additionalProperties":false,
      "properties":{
        "text":{"default":"","title":"Text","type":"string"},
        "position":{"default":"replace","enum":["prefix","suffix","replace"],"title":"Position","type":"string"},
        "ignore_extension":{"default":true,"title":"Ignore Extension","type":"boolean"}
      },
      "title":"UserInputConfig",
      "type":"object"
    }
  }
]
```

</details>

删除范围、方向和分隔符的行为见[删除规则配置](index.md#delete)。各编号方式的取值范围和补齐限制见[序列编号配置](index.md#serialize)。输入列表的顺序和空行行为见[自定义规则配置](index.md#user_input)。
