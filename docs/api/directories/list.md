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

OneDrive 普通导航命中目标自身的有效祖先索引时，直接按目标 ID 读取子项，沿用缓存的目标名称和父级关系，不额外读取目标元数据。目标内容实时，面包屑可能暂时陈旧；手动刷新会实时校正。外部导航仍实时核验目标元数据。没有可用的目标前缀或直接父列表上下文时，普通导航和 `refresh: true, reuse_ancestors: true` 都可按实时元数据的 `parent_id` 查找祖先反向索引，命中后停止向上读取。索引只引用现有有效目录列表，不保存独立元数据树；不同连接及 revision 相互隔离。候选祖先身份链冲突时回退云端读取，不拼接矛盾路径。OneDrive 可从有效列表的根前缀复用根 ID 和 drive_id，不再固定查询根元数据；缓存提示不能证明目标当前存在或具有访问权限。Google Drive 保留实时 My Drive 根核验。普通 `refresh: true` 及执行前的内部 `verify` 复核不借用祖先链。

索引结构为 `(storage_id, revision, ancestor_id) -> set[DirectoryKey]`。每个列表条目保存不可变的轻量 ID/名称链，根前缀另以 RootLocation 作为同一索引内的查询键，索引本身仅保存条目键；查询不解析完整文件列表。列表覆盖、cachetools TTL 过期/LRU 淘汰、连接及重命名失效同步移除引用。父列表修补沿用原始到期时间。复用祖先链或直接父列表的新缓存，其到期时间不超过来源列表的到期时间，避免旧信息被反复续期。多个有效引用仅名称不同时选用较新的列表，父子身份链不同时返回未命中。

单页、无重试、权限已知时，已有 HTTP 模拟用例验证下列请求数（不含授权和连接列表请求）：

内部执行复核模式统一为 `verify`（替代旧称），通过 Driver 的显式 `verify=True` 参数只读取指定目录的完整实时子项列表。它不读根、目标或祖先元数据，不使用目录缓存或提示，不回填列表或延长 TTL；普通浏览、刷新和外部导航策略不变。OneDrive 使用 ID 对应的 `/children`，根标记使用 `/me/drive/root/children`；Google 使用 `files.list`，根标记使用 `root` 查询别名，子项的真实父 ID 从响应校验并保留。根目录返回空列表时无法得到实际根 ID，但执行复核会因待处理文件缺失而拒绝。

复核结果的云盘显示路径留空，保留文件真实 ID、原名和父目录 ID；旧快照路径只作为历史显示及失效上下文，不是最新验证结果。目录本身改名或移动不单独导致失败；文件移出、原名变化、非法目标名称、名称冲突或明确不可重命名仍沿用原复核逻辑拒绝。单页目录两个云 Provider 均为 1 次请求，两页均为 2 次，N 页为 N 次（不含重试和令牌刷新）。Google 若以成功空列表隐藏不存在或无权访问的目录，此读取无法区分具体原因，执行以待处理文件缺失返回预览过期；明确 HTTP 授权/权限错误仍由现有错误映射处理。

| 导航场景 | OneDrive | Google Drive |
| --- | --- | --- |
| 已缓存目标列表的普通访问 | 0 | 0 |
| 从已缓存直接父列表进入子目录 | 1 | 1，空目录时额外核验一次元数据 |
| 仅缓存 `/A/B/C/D`，普通导航访问祖先 A/B/C | 1 | 3 |
| 仅缓存 `/A/B/C/D`，外部导航访问祖先 C 或直达兄弟 F（父为 C） | 2 | 3 |
| 仅缓存 `/A/B/C/D`，按 ID 直达 `/A/B/C/F/G` | 3 | 4 |
| 仅缓存 `/A/B/C/D`，按 ID 直达 `/A/Branch` | 2 | 3 |

外部导航实时读取目标元数据及内容；普通导航仅在目标前缀命中时跳过元数据，否则仍按实时 parent_id 查询祖先。OneDrive 命中有效根前缀时达到 2/3 次目标；首次返回根目录只需读取内容，共 1 次。根前缀缺失、过期或矛盾时实时查询根元数据。Google Drive 核对 My Drive 根范围，仍额外读取一次根元数据。分页、限流重试或权限复核会增加请求数。手动刷新 G 不复用祖先，两个 Provider 在此场景均为 7 次。

强制刷新成功后替换目标列表。批量重命名执行前直接读取云端数据，复核结果不回填目录缓存。重命名写入期间，同一连接的普通目录请求直接读取存储，结果不回填缓存。写入结束后，已确认的变更合并到仍有效且一致的父目录列表，保留原到期时间。改名项为文件夹时，清除该文件夹及其已缓存的后代。无法安全合并时使受影响的列表失效，有任何写入结果仍未知时清除该连接的目录缓存。缓存有效期和容量见[部署配置](../../../backend/cache.toml)。Local 每次读取文件系统。

手动刷新返回的完整实时祖先链若与有效缓存中的同 ID 名称或父子关系不同，先使变化目录及其后代、旧父目录和新父目录的列表失效，再保存本次刷新结果；同时阻止同连接正在进行的旧读取回填。根身份或 drive_id 不一致时清除该连接的缓存。不发现变化时仍只替换目标列表。前端检测到实时刷新与已有面包屑不一致时，移除同连接版本的其他目录查询（含待完成请求），保留本次刷新及其他连接；服务端无关列表仍可复用。

刷新目标仍有有效旧列表时，还会按 ID 比较其中的子目录。旧子目录改名、从新列表消失（移出或删除）或变为非目录时，使该子目录及其后代缓存失效；不清除无关兄弟目录或祖先列表。前端对同一目录的新旧子项进行相同的变化判断，沿用上述查询清理机制。比较只在完整实时刷新成功后执行，不增加云端请求。

例如 C 的子目录 D 在外部改为 DD，在 C 手动刷新后，C 列表显示 DD，旧 D 及其后代缓存失效。再从 C 进入 DD 时，OneDrive 可复用 C 的新子项提示，仅实时读取 DD 的内容，显示 `/A/B/C/DD`。

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
