[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md) · [规则定义](../rules/index.md)。

<a id="endpoint-post-storages-storage-id-rename-preview"></a>
### 创建预览

对所选文件或文件夹应用规则并检查名称与冲突。

`POST /storages/{storage_id}/rename/preview`

#### Parameters

路径参数 `storage_id`：string，必填，不可空，连接标识。

请求体：

| 字段 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `location` | StorageLocation | 否 | 否 | 默认根目录；选中项必须在此目录中。 |
| `file_ids` | array of string | 是 | 否 | 至少 1 项，不得重复，没有应用级数量上限。顺序决定规则处理及响应顺序。 |
| `rules` | array of RuleSpec | 否 | 否 | 默认 `[]`，最多 20 条，包括禁用项；见[规则对象](../rules/index.md#rule-spec)。 |
| `target_name` | string | 否 | 是 | 默认 `null`，使用规则链；其他字符串包括 `""` 表示指定完整目标名，不裁剪空白。 |
| `previous_preview_id` | string | 否 | 是 | 默认 `null`；字符串至少 1 个字符。新快照保存后释放同连接的此预览。 |

`target_name` 非 `null` 时必须恰好选择 1 项，且 `rules` 必须为空或省略，不能同时提交禁用规则。指定名称的文件需自行包含扩展名。

新快照保存成功即替换指定旧快照，即使新响应 `valid: false`；请求失败保留旧快照。其他连接的预览不受影响。

冲突比较遵循 Provider 名称语义。Local、OneDrive 忽略大小写；Google Drive 精确比较，区分大小写及 Unicode 形式。发生变化的目标不得重复其他目标或未选中兄弟项名称；已有重名可保持不变。

#### Returns

HTTP 200，返回 `RenamePreviewResponse`。逐项名称、可用性或冲突校验不通过时返回 `valid: false`，不是 HTTP 错误。执行时只提交 `preview_id`。

#### Request / Response 示例

```http
POST /storages/default-local/rename/preview
Content-Type: application/json

{"file_ids":["IMG_1.jpg"],"rules":[{"type":"padding","config":{"mode":"number","length":3}}]}
```

```json
{
  "preview_id":"4db956a6-c583-47af-bcde-9ea71312fc36",
  "expires_at":"2026-10-31T02:10:00Z",
  "items":[
    {
      "file_id":"IMG_1.jpg",
      "original_name":"IMG_1.jpg",
      "new_name":"IMG_001.jpg",
      "changed":true,
      "valid":true,
      "conflict":false,
      "error":null,
      "details":null
    }
  ],
  "valid":true
}
```

提交 `{"file_ids":["IMG_1.jpg"],"target_name":""}` 时仍返回 HTTP 200：

```json
{
  "preview_id":"c08fe423-26e0-4499-b1ee-a24bcfd0a6f3",
  "expires_at":"2026-10-31T02:10:00Z",
  "items":[
    {
      "file_id":"IMG_1.jpg",
      "original_name":"IMG_1.jpg",
      "new_name":"",
      "changed":true,
      "valid":false,
      "conflict":false,
      "error":"Filename cannot be empty",
      "details":{"reason":"NAME_EMPTY","params":{}}
    }
  ],
  "valid":false
}
```

#### Errors

- 422 `REQUEST_VALIDATION_ERROR`：空选择、规则超过 20 条，或 `target_name` 与选择、规则不兼容。
- 422 `RULE_CONFIGURATION_ERROR`：已启用规则类型或配置无效。
- 422 `VALIDATION_ERROR`：位置不支持、连接不支持预览或选择无效。重复 ID 的原因为 `PREVIEW_DUPLICATE_FILE_IDS`，目录缺失项为 `PREVIEW_ITEMS_NOT_IN_DIRECTORY`，均附 `details.file_ids`。
- 409 `STORAGE_CONNECTION_CHANGED`：创建期间连接变化。读取连接和目录后重新预览。
