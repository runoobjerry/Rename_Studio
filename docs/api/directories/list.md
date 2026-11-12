[API Reference](../README.md) · [通用约定](../common/conventions.md) · [共享错误](../common/errors.md)

相关定义：[资源对象与接口索引](index.md) · [StorageLocation](../common/locations.md) · [文件元数据](../common/files.md)。

<a id="endpoint-post-storages-storage-id-files-list"></a>
### 列出目录

返回指定位置的完整目录列表。

`POST /storages/{storage_id}/files/list`

#### Parameters

路径参数 `storage_id`：string，必填，不可空，连接标识。

请求体：

| 字段 | 类型 | 必填 | 可空 | 说明 |
| --- | --- | --- | --- | --- |
| `location` | StorageLocation | 否 | 否 | 默认 `{"kind":"root"}`。支持的位置类型见 [StorageLocation](../common/locations.md#locations)。 |
| `refresh` | boolean | 否 | 否 | 默认 `false`，允许返回缓存结果。设为 `true` 时绕过目录缓存并直接读取存储。 |
| `reuse_ancestors` | boolean | 否 | 否 | 默认 `false`。与 `refresh: true` 一起用于外部导航：实时读取目标元数据和目录内容，允许复用同连接版本内的有效祖先链。普通手动刷新不设置此项。 |
| `parent_location` | StorageLocation | 否 | 是 | 普通导航可传目标的已知父目录位置。提示用于同连接版本的缓存复用或失效。强制刷新始终以云端结果为准。 |

请求体必需，读取根目录可提交 `{}`。不提供分页、搜索、排序或筛选参数，也不设应用级目录数量上限。

#### Returns

HTTP 200，返回 `DirectoryListing`。服务端汇总云端分页，读取失败时返回错误。

再次访问当前目录时，传回响应的 `location`。从列表进入子文件夹时，可将当前列表的 `location` 作为 `parent_location`。访问面包屑中的祖先时，目标及其父位置取自对应面包屑条目。

OneDrive 和 Google Drive 在命中目标列表时直接返回目录内容和面包屑。目标未命中时，服务端可从已知父列表复用子项与祖先链。提示缺失或不足时，Provider 按 ID 获取必要的目录元数据和内容。外部变更可能延迟到缓存过期才可见。

没有直接父列表上下文时，普通导航和 `refresh: true, reuse_ancestors: true` 都可按实时元数据的 `parent_id` 查找祖先反向索引，命中后停止向上读取。索引只引用现有有效目录列表，不保存独立元数据树；不同连接及 revision 相互隔离。候选祖先身份链冲突时回退云端读取，不拼接矛盾路径。OneDrive 可从有效列表的根前缀复用根 ID 和 drive_id，不再固定查询根元数据；缓存提示不能证明目标当前存在或具有访问权限。Google Drive 保留实时 My Drive 根核验。普通 `refresh: true` 及执行前的内部 `fresh` 复核不借用祖先链。

索引结构为 `(storage_id, revision, ancestor_id) -> set[DirectoryKey]`。每个列表条目保存不可变的轻量 ID/名称链，根前缀另以 RootLocation 作为同一索引内的查询键，索引本身仅保存条目键；查询不解析完整文件列表。列表覆盖、cachetools TTL 过期/LRU 淘汰、连接及重命名失效同步移除引用。父列表修补沿用原始到期时间，不延长祖先提示寿命。多个有效引用仅名称不同时选用较新的列表，父子身份链不同时返回未命中。

单页、无重试、权限已知时，已有 HTTP 模拟用例验证下列请求数（不含授权和连接列表请求）：

| 导航场景 | OneDrive | Google Drive |
| --- | --- | --- |
| 已缓存目标列表的普通访问 | 0 | 0 |
| 从已缓存直接父列表进入子目录 | 1 | 1，空目录或权限未知时需额外核验 |
| 仅缓存 `/A/B/C/D`，按 ID 直达祖先 C 或兄弟 F（父为 C） | 2 | 3 |
| 仅缓存 `/A/B/C/D`，按 ID 直达 `/A/B/C/F/G` | 3 | 4 |
| 仅缓存 `/A/B/C/D`，按 ID 直达 `/A/Branch` | 2 | 3 |

后三行的外部导航实时读取目标内容，且与未命中列表的普通 ID 导航使用相同祖先查询。OneDrive 命中有效根前缀时达到 2/3 次目标；首次返回根目录只需读取内容，共 1 次。根前缀缺失、过期或矛盾时实时查询根元数据。Google Drive 核对 My Drive 根范围，仍额外读取一次根元数据。分页、限流重试或权限复核会增加请求数。手动刷新 G 不复用祖先，两个 Provider 在此场景均为 7 次。

强制刷新成功后替换目标列表。批量重命名执行前直接读取云端数据，复核结果不回填目录缓存。重命名写入期间，同一连接的普通目录请求直接读取存储，结果不回填缓存。写入结束后，已确认的变更合并到仍有效且一致的父目录列表，保留原到期时间。改名项为文件夹时，清除该文件夹及其已缓存的后代。无法安全合并时使受影响的列表失效，有任何写入结果仍未知时清除该连接的目录缓存。缓存有效期和容量见[部署配置](../../../backend/cache.toml)。Local 每次读取文件系统。

手动刷新返回的完整实时祖先链若与有效缓存中的同 ID 名称或父子关系不同，先使变化目录及其后代、旧父目录和新父目录的列表失效，再保存本次刷新结果；同时阻止同连接正在进行的旧读取回填。根身份或 drive_id 不一致时清除该连接的缓存。不发现变化时仍只替换目标列表。前端检测到实时刷新与已有面包屑不一致时，移除同连接版本的其他目录查询（含待完成请求），保留本次刷新及其他连接；服务端无关列表仍可复用。

例如已缓存 `/A`、`/A/B`、`/A/B/C`、`/A/B/C/D`、`/A/B/E`，外部将 B 改为 BB 后在 C 手动刷新，OneDrive 仍请求根、C、B、A 元数据及 C 内容，共 5 次。A 的子项名称已过时，因此 A 列表也失效；B、D、E 的旧列表失效，C 被保存为 `/A/BB/C`。若根列表已缓存则保留。随后从 C 进入 D 只需读取 D 内容，共 1 次，面包屑为 `/A/BB/C/D`。

#### Request / Response 示例

```http
POST /storages/default-local/files/list
Content-Type: application/json

{}
```

```json
{
  "provider":"local",
  "path":"",
  "parent_path":null,
  "items":[
    {
      "id":"IMG_1.jpg",
      "name":"IMG_1.jpg",
      "path":"IMG_1.jpg",
      "parent_path":"",
      "is_directory":false,
      "size":2048,
      "modified_at":"2026-10-31T02:00:00Z",
      "location":{"kind":"path","value":"IMG_1.jpg"},
      "parent_location":{"kind":"root"},
      "can_rename":true,
      "can_list_children":null,
      "mime_type":null
    }
  ],
  "storage_id":"default-local",
  "revision":1,
  "location":{"kind":"root"},
  "parent_location":null,
  "breadcrumbs":null,
  "directory_id":null,
  "drive_id":null
}
```

#### Errors

- 409 `STORAGE_CONNECTION_CHANGED`。读取期间连接变化，重新读取连接状态后再加载目录。
- 409 `STORAGE_BUSY`。强制刷新时，连接正在执行或目录在读取期间失效。等待执行结束或重试刷新。
- 403 `PERMISSION_DENIED`。Provider 拒绝列举目录。Google Drive 返回空列表且实时权限仍未知时，也返回此错误。
- 422 `VALIDATION_ERROR`。连接不支持该位置类型，或位置无效、超出范围、指向链接目录。

#### Google Drive 目录约束

仅支持当前账号 My Drive 范围。返回可见的直接子项，无需当前账号拥有项目。列表排除回收站项目。快捷方式作为非目录项返回，`can_rename` 为 `false`。原生文档使用原始标题，不添加扩展名。
