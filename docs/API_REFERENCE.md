# API Reference（API 契约参考）

面向 Python 后端与 React 前端的 API 契约，依据 `backend/app/api/router.py`、`backend/app/api/storage_router.py`、Pydantic schemas 和 `frontend/src/api/client.ts` 核对。路由、字段、枚举值与错误码保留原有英文标识符。

## 通用约定

- 后端路由不带 `/api` 前缀；开发环境由 Vite 将前端 `/api/*` 请求代理到后端 `/*`。
- JSON 使用 `snake_case`；日期时间为 ISO 8601 字符串；HTTP 204 无响应体。
- `provider_type` 标识驱动类型（`local`、`onedrive`、`google_drive`），`storage_id` 标识独立配置与账号连接。`DirectoryListing.provider` 仍为用于展示的驱动类型。
- Storage APIs 以 `storage_id` 和 `location` 为边界。仅自动创建 `default-local`，云连接由用户添加。Google Drive 支持连接、OAuth、My Drive 读取，以及下述预览执行和单项直接执行接口。
- `file_id` 由 Provider 定义，客户端须视为不透明值。Local ID 为相对路径，重命名后会变化；OneDrive ID 为 Graph item ID。显示路径不能作为资源身份。
- 目录 API 不接受分页、搜索、排序或筛选参数；后端聚合 OneDrive / Google Drive 分页后一次返回完整结果。目录加载、UI 选择和单次预览均不设应用级文件数量上限。

## 错误与客户端兼容

除 OAuth HTML callback 外，应用错误统一为：

```ts
{
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}
```

| HTTP | Code | 含义 |
| --- | --- | --- |
| 401 | `AUTHENTICATION_ERROR` | 云连接未授权，或授权被拒绝、已过期。 |
| 403 | `PERMISSION_DENIED` | Google Drive 拒绝元数据或目录读取，与认证失败和限流区分。 |
| 404 | `NOT_FOUND`, `PREVIEW_NOT_FOUND` | 项目、目录或预览不存在，或预览已消费。 |
| 409 | `RENAME_CONFLICT`, `PREVIEW_EXPIRED` | 重命名冲突、预览过期或源状态变化。 |
| 409 | `STORAGE_CONNECTION_CHANGED` | 连接配置或账号变化使旧预览失效，或云默认目录记录属于其他账号。 |
| 409 | `STORAGE_ACCOUNT_ALREADY_CONNECTED` | 同一 Provider 的账号已绑定其他连接。 |
| 409 | `STORAGE_BUSY` | 正在重命名的连接拒绝配置、授权和删除；恢复默认设置也拒绝活动重命名。 |
| 422 | `REQUEST_VALIDATION_ERROR` | Pydantic 请求校验失败。 |
| 422 | `VALIDATION_ERROR`, `RULE_CONFIGURATION_ERROR` | 路径、选择、名称或规则校验失败。 |
| 429 | `RATE_LIMIT_ERROR` | 云 Provider 限流；文件 API 有界重试耗尽，认证接口直接返回且不自动重试。 |
| 502 | `PROVIDER_ERROR` | 本地文件系统、Graph、身份服务或连接状态持久化失败。 |
| 500 | `INTERNAL_ERROR` | 未预期错误；`details.request_id` 可定位服务端日志。 |

原文核对记录未发现 route / schema / client 字段不一致。前端将 HTTP 错误暴露为 `ApiError`，保留 `status`、`code`、`message`、`details`；非标准响应保留 HTTP status，使用 fallback message、`code: null` 和空 `details`。网络失败保留原始错误。现有 UI 可继续读取 `error.message`；按错误码恢复的专用交互仍由 `UI_TODO.md` 跟踪。

预览选择校验保留 `VALIDATION_ERROR`，通过 `details.reason` 提供稳定业务标识供前端本地化；缺失或未知标识继续使用通用错误提示。以下两类错误均通过 `details.file_ids` 返回相关项目 ID，前端使用请求时保存的文件名在预览 Alert 中逐项列出，不按 ID 额外读取文件：

| details.reason | 含义 |
| --- | --- |
| `PREVIEW_DUPLICATE_FILE_IDS` | 所选文件 ID 重复。 |
| `PREVIEW_ITEMS_NOT_IN_DIRECTORY` | 所选项目不在请求目录中；`details.file_ids` 保留缺失项 ID。 |

## 公共类型

```ts
type StorageLocation = { kind: "root" } | { kind: "id" | "path"; value: string };

interface FileItem {
  id: string;
  name: string;
  path: string;
  parent_path: string;
  is_directory: boolean;
  size: number | null;
  modified_at: string | null;
  mime_type?: string | null;
}

interface DirectoryListing {
  provider: string;
  path: string;
  parent_path: string | null;
  items: FileItem[];
  breadcrumbs?: Array<{name: string; location: StorageLocation}> | null;
}

interface RuleSpec {
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

interface PreviewItem {
  file_id: string;
  original_name: string;
  new_name: string;
  changed: boolean;
  valid: boolean;
  conflict: boolean;
  error: string | null;
}
```

- 路径在输入边界规范化；ID 视为不透明值；`{kind:"root"}` 不携带 `value`。
- `parent_path === null` 仅用于 Provider 根目录列表；目录的 `size` 为 `null`。
- 连接级扩展列表增加 `storage_id`、`revision`、`location`、`parent_location`；列表项增加 `location`、`parent_location`、`can_rename`，原有显示路径字段保留。根目录列表的 `parent_location` 为 `null`。
- `can_rename: null` 表示权限未知，不保证远端写入成功。文件夹导航使用 `item.location`，返回上级使用 `listing.parent_location`。
- `conflict` 只是无效状态的一类，UI 应优先展示项目的 `error` 文本。

## 存储连接与 Provider 元数据

### 连接类型与字段

后端注册 Local、OneDrive 和 Google Drive。Google Drive 的 `browser_auth: true`、`locations: ["root", "id"]`、`can_rename: true`；其设置和工作台复用连接与重命名契约，通过服务端返回的 ID-based breadcrumbs 导航。用户配置见 [Google Drive setup and usage](https://github.com/runoobjerry/Rename_Studio/wiki/Configuration)。

```ts
interface StorageInfo {
  storage_id: string;
  provider_type: string;
  name: string;
  config: { root_path?: string; client_id?: string | null };
  revision: number;
  busy: boolean;
  has_client_secret: boolean;
  account_id: string | null;
  account_display_name: string | null;
  account_email: string | null;
}
```

Provider definitions 提供有序 `config_fields`、能力与侧栏 `icon`（`computer` 或 `cloud`），不提供展示名称、账号缺省文案或字段文案。图标显式声明，不从授权或选择器能力推断。每个字段描述包含：

| 字段 | 含义或取值 |
| --- | --- |
| `key` | 稳定配置字段标识 |
| `input_type` | `text`、`password` 或 `directory` |
| `target` | `config` 或既有的请求顶层 `client_secret` |
| `required`, `nullable` | 必填与可空标记 |

可空配置输入为空时提交 `null`，密钥输入为空时省略该字段。描述符不包含凭据值；目录选择按钮同时依赖 `directory` 字段和 `local_picker`，授权操作依赖 `browser_auth`。`config_schema` 保留完整 Pydantic 校验与结构信息；其自动生成的 title/description 不作为最终 UI 翻译源，也不驱动通用表单引擎。

前端按 `providers:<provider_type>.name`、`.accountLabel` 和 `.fields.<key>.{label,createLabel,help,createHelp,savedHelp}` 查词典。新建标签缺失时使用普通标签，帮助变体缺失时使用普通帮助；当前语言缺词回退 `en-US`，仍缺失的名称/标签显示稳定类型或字段 ID，可选帮助不显示原始翻译键。能力仍只取元数据，不从类型名称或翻译推断。

**响应形状迁移（1.0.0-alpha3 开发阶段）**：`/storage-providers` 删除 `name`、`account_label`，`config_fields[]` 删除 `label`、`create_label`、`help_text`、`create_help_text`、`saved_help_text`；`/rules` 删除 `name`、`description`。这是不兼容变更，前后端必须同步升级，外部调用者也需改用稳定 ID，不保留兼容字段。连接记录的 `name`、账号资料、文件名、路径及 settings 状态版本均不变；已保存的 `default-local.name = "Local Files"` 不改写。

### 路由

| Method / route | 请求 | 响应 |
| --- | --- | --- |
| `GET /storage-providers` | 无 | Definitions：`provider_type`、`config_schema`、`config_fields`、`icon`、`locations`、`can_rename`、`browser_auth`、`local_picker` |
| `GET /storages` | 无 | `StorageInfo[]` |
| `POST /storages` | `{provider_type,name,config,client_secret?:string|null}` | 201 `StorageInfo` |
| `GET /storages/{storage_id}` | 无 | `StorageInfo` |
| `PUT /storages/{storage_id}` | `{name?:string,config?:object,client_secret?:string|null}` | `StorageInfo`；提供 `config` 时整体替换旧配置 |
| `DELETE /storages/{storage_id}` | 无 | 204；仅 `default-local` 不可删除 |
| `POST /storages/{storage_id}/files/list` | `{location?:StorageLocation}`，默认 root | 扩展 `DirectoryListing` |
| `POST /storages/{storage_id}/local/pick` | 无 | `{root_path,selected}`；仅用于 Local 连接 |
| `POST /local/folder-picker` | 无 | `{root_path,selected}`；后端电脑上的草稿目录选择器，无需连接且不持久化状态。初始位置为 `local_storage_root`；取消时 `selected=false`，返回初始路径，客户端须保留草稿 |

### 配置、凭据与状态变化

- create / update 拒绝已删除的 `enabled` 字段；UI 展示授权状态，不提供连接启用/禁用控件。`StorageInfo` 不包含凭据。
- Local 配置要求后端电脑上已有的 `root_path`；OneDrive / Google Drive 配置使用可空 `client_id`。不支持的配置字段会被拒绝。
- Google Drive 另接受顶层 write-only `client_secret`，保存到内部 credentials，不放入 `config`。更新时省略或传 `null` 保留旧密钥；空串或纯空白密钥被拒绝。仅声明 `target: "client_secret"` 的 Provider 接受非空密钥，内置 Google 声明该能力，Local / OneDrive 未声明。
- `has_client_secret` 仅表示是否存在密钥。Google 的 Client ID 和 Secret 均就绪后才能授权，但允许保存不完整连接草稿。
- Google Client ID / Secret 变化会清除账号 Token、递增连接 `revision`，使旧授权对象和预览失效；仅改名或提交相同密钥保留授权。disconnect 保留两项客户端凭据，删除连接或 factory reset 才移除。
- 凭据编辑、账号凭据和 `revision` 原子提交；保存失败不发布新状态。create / update 校验错误省略 input / context 值，避免回显含密钥请求体。
- 配置或账号变化使旧预览返回 `STORAGE_CONNECTION_CHANGED`（409）；正常 Token rotation 不改变 `revision`。活动重命名期间拒绝配置、授权和删除，返回 `STORAGE_BUSY`（409）。未知连接返回 404，无效位置或配置返回 422；完整目录读取失败返回 Provider 错误，不返回部分目录。

### Google Drive 目录与名称语义

- 列表 `breadcrumbs: [{name,location}, ...]` 从 My Drive 根目录延伸到当前目录，使用 ID 导航。即使文件夹重名或名称包含 `/`，也不能从显示 `path` 解析身份。其他 Provider 的 `breadcrumbs: null`。
- `mime_type` 为 Google MIME type，其他 Provider 为 `null`。Google native documents 保留真实标题，不添加合成扩展名；文件大小可为 `null`，文件夹大小始终为 `null`。Google `can_rename` 反映逐项能力，根目录和 shortcuts 为 `false`。
- Google 拒绝所有 `path` location，包括空路径形式；根目录应使用 `{kind:"root"}`。ID 读取须确认祖先链可到当前账号的 My Drive 根目录，拒绝 shared-drive、trashed、outside-root 项目，且不跟随 shortcuts。
- 目录结果包括所有可见直接子项，不按所有权过滤；My Drive 下的普通文件夹不必由当前用户拥有。shortcuts 作为 `can_rename:false` 的普通非目录行保留，不从兄弟项集合静默移除。列表和元数据响应中的根目录父位置均使用 `RootLocation`。
- 名称按精确字符串比较，区分大小写及 Unicode form。校验拒绝空白标题和 NUL，不套用 Windows 保留名称/字符，也不假定标题长度上限；其他远端限制仍以远端为准。
- 发生变化的目标名不能重复所选目标名或占用未选兄弟项名称；已有重名可保持不变。普通文件、文件夹和 native document titles 可重命名，根目录与 shortcuts 被拒绝。
- Google 不提供“目录冲突检查 + 重命名”的 transaction；外部编辑、新增重名或权限变化仍可能与写入竞争。

## 认证与 OAuth callback

| Method / route | 请求 | 响应 |
| --- | --- | --- |
| `GET /storages/{storage_id}/auth/status` | 无 | `{configured,connected,account_id,account_display_name,account_email}`；已授权时 account_id 必填；名称、邮箱可空 |
| `POST /storages/{storage_id}/auth/start` | 无 | `{authorization_url,redirect_uri}` |
| `DELETE /storages/{storage_id}/auth/session` | 无 | 204；保留客户端配置 |

`GET /auth/storage/callback` 是接收 `code` / `state` / `error` query parameters 的 HTML callback。Microsoft 应用需配置 `STORAGE_REDIRECT_URI`；OAuth state 单次使用、有有效期，并绑定连接和 `revision`。callback 发送消息：

```ts
{ type: "storage-auth"; storage_id: string | null; status: "connected" | "failed"; message: string; error_code: string | null; details: Record<string, unknown> }
```

前端校验 `redirect_uri` 对应的 callback origin、popup window source、message shape 和 `storage_id`。

同一 `provider_type + account_id` 只能绑定一个连接。重复授权时 callback 返回 HTTP 400、`status: "failed"` 和 `error_code: "STORAGE_ACCOUNT_ALREADY_CONNECTED"`，`details` 包含已有连接的 `storage_id`、`storage_name`。登录成功后才替换原授权；失败保留连接配置及原授权。

Google 复用相同 callback 和授权 endpoints，使用用户提供的 Desktop OAuth client、PKCE S256、offline access 和固定 `https://www.googleapis.com/auth/drive.metadata` scope。Token exchange / refresh 均携带 Client ID 和 Secret；callback 校验授予的 scope，读取 Drive `about.user.permissionId` 作为不透明账号 ID，之后才发布 connected session。账号名称与邮箱可选。

Access Token 仅在内存；Refresh Token、client secret、scope 和账号身份保存在 v3 文档。refresh 响应省略替换 Refresh Token 或 scope 时，保留既有 grant。正常 refresh / rotation 不改变连接 `revision`；授权被拒绝则清除账号凭据并改变 `revision`；临时 transport / 429 / 5xx 失败保留已保存 grant。status 表示本地 session 状态，不是在线 Token 有效性探测。

OneDrive 与 Google 的 Token exchange / refresh、账号信息读取均只请求一次，不自动重试或等待 `Retry-After`。HTTP 429 返回 `RATE_LIMIT_ERROR`；5xx、transport failure、无效成功响应及其他非认证 HTTP 错误返回 `PROVIDER_ERROR`，保留已有凭据、账号身份和连接 `revision`。Token 接口的 400/401/403 属于认证拒绝；账号信息接口的 401/403 表示身份核验被拒绝。刷新被明确拒绝时清除失效授权；新登录失败则保留之前已提交的账号，不发布未完成的新会话。认证错误不回显第三方响应体。

Google 设置 UI 接受 Client ID 和 write-only client secret；工作台共用云账号及默认目录处理，并使用服务端 breadcrumbs。用户配置见 [Google Drive setup and usage](https://github.com/runoobjerry/Rename_Studio/wiki/Configuration)。

## 规则

### `GET /rules`

响应：

```ts
Array<{
  type: string;
  config_schema: Record<string, unknown>;
}>
```

名称与说明由前端 `rules:types.<type>.name` / `.description` 提供；缺词按当前语言、`en-US`、稳定 `type` 回退。规则类型、配置键和值、服务端校验与实际执行语义不变；新增规则的字段编辑 UI 仍须显式适配。

| Type | Config |
| --- | --- |
| `padding` | 必填 `mode: "number" \| "text"`、`length: 1..255`；`fill_character` 默认 `_`，最多一个字符；空文本填充跳过规则；`side` 默认 `left`。 |
| `replace` | 必填 `search: 0..255`；空 search 跳过规则。`replacement` 最长 255，默认空串（删除匹配）；`occurrence: all | first | last`；`case_sensitive=true`；`whole_word=false`；`ignore_extension=true`。 |
| `remove` | 与 replace 使用相同匹配字段，不含 `replacement`。 |
| `insert` | 必填 `text: 0..255`；空 text 跳过规则。`position: prefix | suffix | index | before_text | after_text`；`index: 1..255`；`from_right=false`；相对文本位置的 `anchor` 为空时跳过规则，最长 255。 |

规则按数组顺序执行，跳过 disabled 规则；前端只为以上四种已知类型渲染字段。空值严格指 `""`，空白字符仍是有效文本。跳过规则保留当前文件名，并继续后续规则；缺少必填字段、类型错误、无效枚举或长度越界仍返回 `RULE_CONFIGURATION_ERROR`。

## 重命名预览（Rename Preview）

### `POST /storages/{storage_id}/rename/preview`

请求体：

```ts
{
  location?: StorageLocation; // 默认 root；导航使用后端返回的位置
  file_ids: string[];      // 至少 1 项，不允许重复，无文件数量上限
  rules?: RuleSpec[];      // 默认 []，最多 20 条规则
  target_name?: string | null; // 单项完整目标名称；省略或 null 时使用规则链
  previous_preview_id?: string; // 非空；新预览保存后释放同连接的旧预览
}
```

响应（`RenamePreviewResponse`）：

```ts
{
  preview_id: string;
  expires_at: string;
  items: PreviewItem[];
  valid: boolean;
}
```

- 不修改文件；未变化项目仍保留在 `items` 中，所有项目有效时 `valid` 才为 true。
- `target_name` 为文件或文件夹的完整目标名称（文件含扩展名），不自动裁剪空格。非 null 时，`file_ids` 必须恰好 1 项，`rules` 必须为空或省略（包括 disabled 规则），否则返回 422 `REQUEST_VALIDATION_ERROR`；不执行规则链。
- 名称、长度、权限及冲突按 Provider 校验，无效时返回 `valid: false` 和逐项错误；同名返回 `changed: false`。执行此预览仍须提交 `preview_id`；直接改名单项可使用下述单项执行接口。
- `file_ids` 有序，rule context indices 与响应 `items` 均按该顺序；服务端快照保留顺序，执行前重校验不重新排序。预览不设文件数量上限，规则最多 20 条（包括 disabled 规则）；Provider 内部仍按自身能力分组写入。
- 422：超过规则上限、空选择、重复、跨目录、超出路径、选择根目录、无效路径或规则配置；404：项目或目录不存在；其他 Provider 错误见通用错误。
- 预览在当前后端进程保留 10 分钟，后端重启即失效。
- 新预览保存成功后，仅替换显式提供且属于同连接的 `previous_preview_id`，不影响其他预览。请求失败保留旧快照；保存的响应即使 `valid: false` 也替换旧快照。替换不改变执行重校验或 consume 语义。

### `DELETE /storages/{storage_id}/rename/previews/{preview_id}`

仅释放指定连接的指定预览；不存在、过期、已消费或重复释放均返回 204，不影响其他连接的预览。连接删除后仍可清理。

该操作不访问 Provider，不取消已开始的执行，不清除执行进度或目录元数据缓存。前端在清理工作区或工作区变化时释放持有的预览，并丢弃旧上下文迟到的预览响应；清理失败则由到期机制回收。规则/选择变化导致预览展示重置时，保留 cleanup ID，供下次替换或清理工作区时使用。

## 重命名执行（Rename Execute）

### `POST /rename/execute`

请求体为 `{ preview_id: string }`，`preview_id` 非空；只接受服务端签发的预览 ID。

响应：

```ts
{
  preview_id: string;
  status: "completed" | "partial" | "failed";
  items: Array<{
    file_id: string;
    original_name: string;
    new_name: string;
    status: "renamed" | "skipped" | "failed";
    error: string | null;
    error_code?: string | null;
    actual_name?: string | null;
    current_file?: FileItem | null; // 成功重命名或成功回滚后经 Provider 确认的元数据
  }>;
}
```

- 404：预览不存在或已消费；409：预览过期或源状态变化；422：预览无效；重校验期间也可能返回 Provider 错误。
- 后端在修改前重新校验，真正执行前 consume 预览，不会重复执行同一预览。
- 响应 `items` 按已保存预览顺序返回；实际写入可使用临时名称阶段及并发 Provider batches，不保证完成顺序。
- HTTP 200 也可能包含整体 `partial` / `failed` 及逐项失败，必须检查整体 status 和每项结果；既有 `completed` / `partial` / `failed`、`renamed` / `skipped` / `failed` 含义保持不变。
- `current_file` 保留成功重命名或回滚后经 Provider 确认的身份，包括变化后的 Local path ID；`file_id` 始终为原请求 ID。`null` 本身不能证明写入成功或失败。
- `RENAME_OUTCOME_UNKNOWN` 表示可能已写入但当前状态无法确认，此时 `actual_name: null`。已知成功的写入不会因响应缺失而重放；回滚错误在可确认时报告遗留名称。

### 单项执行：`POST /storages/{storage_id}/rename/single/execute`

请求为 `{ operation_id: string, revision: number, location?: StorageLocation, file_id: string, original_name: string, target_name: string }`。`operation_id` 为客户端生成的 UUID，仅标识操作，不是 `preview_id` 或幂等键；`revision` 为当前连接版本（整数，≥ 1），`location` 默认 root，`file_id` 非空，`target_name` 为完整目标名称（文件含扩展名）。不接受额外字段。

支持单个文件或文件夹，使用独立服务，无需预览，不执行规则链。服务端检查连接版本并持有连接执行锁，直接调用 Provider 单项改名，不读取整个目录或比对原名。`original_name`、`location` 保留为客户端上下文，不作为源状态一致性条件；操作按文件 ID 修改当前项。名称、权限及冲突由 Provider 和第三方 API 判断，Google Drive 允许同目录同名。Google 单项直接按 ID PATCH，不读取 My Drive 根目录、源项或祖先来预检范围、类型及权限，由 API 决定是否允许；仍发送 `supportsAllDrives=false`，不代表新增共享云端硬盘支持。浏览和批量的范围限制保留。

响应为 `{ operation_id: string, status: "completed" | "partial" | "failed", items: SingleExecuteItem[] }`，返回本次 `operation_id`，逐项状态及错误字段同上；单项 `current_file.path`、`parent_path` 可为 `null`，其余确认元数据保持不变。前端使用已知浏览上下文生成显示路径，路径不作为身份或成功依据。HTTP 200 不保证成功：Provider 明确拒绝返回 `failed` 项及统一 `error_code`；确认写入返回 `renamed` 和 `current_file`。前端同名时不提交；直接调用接口提交同名也按 Provider 的实际返回确认，不预先标为 `skipped`。

- 请求格式无效返回 422 `REQUEST_VALIDATION_ERROR`；连接版本变化返回 409 `STORAGE_CONNECTION_CHANGED`；Provider 返回的文件缺失、权限、名称及冲突错误记录在 HTTP 200 的失败项中。原名变化不阻止按 ID 执行。其他错误见通用错误。
- 写入结果未知时先按 ID 核对元数据（Google 使用一次 files.get，不读取祖先）；无法确认时返回 `RENAME_OUTCOME_UNKNOWN`。网络失败或结果未知时不得自动重放请求。此接口不提供按 `operation_id` 查询进度的能力。

## 执行进度（Rename Execution Progress）

### `GET /rename/progress/{preview_id}`

只读查询，不启动、consume、取消或重试执行；`POST /rename/execute` 仍是返回既有最终响应的单次请求。

```ts
{
  preview_id: string;
  total: number;     // 仅变化的预览项目，不含未变化或 skipped 项目
  processed: number; // 已定案项目，包括失败，不是成功数
  phase: "waiting" | "validating" | "staging" | "renaming" | "rollback" | "finished" | "failed";
  error: string | null;
}
```

- 执行前，有效预览返回 `waiting`，`processed` 为零。执行按 Provider 批次发布真实计数（Local / OneDrive 当前每批 20）。staging 不计数；依赖直接重命名须阶段成功后计数，暂存项目须最终重命名/回滚处理后计数。
- `finished` 表示执行响应已就绪，包括整体 `partial` / `failed`。批次中止后定案为失败或未尝试的项目均计入 `processed`；100% 不等于全部成功，应查看 POST 响应和逐项结果。
- 请求级失败或取消报告 `failed`，保留已知计数；校验失败保持零。未知异常使用通用消息，不暴露内部异常详情。
- 进度为 process-local，与 singleton execution service 共用，终止后保留 10 分钟。重启、过期、未知或已消费且无保留进度的预览返回 404；未执行但已过期的预览返回 409。不提供 durable jobs、历史或 reconnect / resume 语义。
- 前端仅在 POST pending 期间每 500ms 轮询，快速批次可能表现为 0% → 100%；轮询失败绝不触发另一次 execute。

## 应用设置（App Settings）

应用偏好与连接配置、凭据共用 v3 `backend/settings.json` 文档。Settings 响应仅暴露 `{preferences}`；偏好更新没有 revision 字段，连接 revision 和 Preview / Execute 校验保持不变。

```ts
interface AppPreferences {
  language: string; // "auto" 或语言代码，例如 "zh-CN"、"en-US"
  theme: "light" | "dark" | "system";
  cloud_default_locations: Record<string, { account_id: string; location: StorageLocation }>;
}
```

| Route | 请求 | 响应 |
| --- | --- | --- |
| `GET /app-settings` | 无 | 当前偏好 |
| `PATCH /app-settings` | 仅变化的偏好字段 | 更新后的偏好；值未变化时不写入 |
| `POST /app-settings/factory-reset` | 无 | 默认偏好；清除云连接、凭据和预览 |

云默认目录 patch 按传入的 storage ID 整体替换记录；`null` 删除该连接默认值，省略的连接保持不变。每个连接仅保留当前账号的默认目录；保存其他账号记录返回 `STORAGE_CONNECTION_CHANGED`（409）。账号变化、disconnect、配置变化或连接删除时，默认目录随连接更新原子移除；正常 Token rotation 保留默认目录。

patch 合并到当前偏好，保留省略的偏好、连接及最新凭据；每个字段最后一次成功处理的修改生效。完整状态原子保存，保存成功后才更新内存和前端 cache；失败返回错误并保留原状态。

`language` 默认 `auto`，恢复出厂设置同样恢复 `auto`；后端只校验语言标识长度（2–63）和连字符分段格式，不维护前端支持语言列表。已保存但当前前端不支持的标识保留原值，界面回退 `en-US`。当前 alpha 阶段不承诺不同版本之间的 settings.json 兼容性。

auto 的浏览器语言解析、Vite 语言发现、词条回退和 MUI/日期显示均属于前端，不改变业务请求参数。新增词典语言只需通过 PR 贡献 JSON/meta，不修改后端枚举或业务 API；说明见 [TRANSLATING](TRANSLATING.md)。Rule/Provider 展示字段的响应迁移见上方对应接口，本轮翻译工作流不新增或改变 API 字段；AppError code/message/details 与真实连接/账号/文件数据继续保留。

偏好限制：最多 100 条云默认目录记录；连接/账号标识长 1–200 字符；目录值最长 4096 字符；JSON 大小最多 128 KiB。factory reset 等待前端排队保存完成，重置期间拒绝新保存；后端存在活动重命名时返回 `STORAGE_BUSY`（409）。默认 Local 保留，真实文件不受影响；规则仍为前端内存状态。

## 实现补充

以下压缩说明原文中的清理、批处理与前端状态同步机制，不增加独立 API。

| 范围 | 现有机制与失败语义 |
| --- | --- |
| 预览回收 | 新快照保存、访问过期 ID 时移除过期快照，并由 lifecycle-managed sweep 每 60 秒清理；不设 global capacity limit。 |
| 偏好保存 | 前端在单个 QueryClient 内串行保存，仅发送变化字段，每次保存前不重新读取设置；失败不阻断后续队列。后端基于当前内存偏好合并并原子保存完整状态；成功后，前端先取消更早的 in-flight settings reads，再更新 cache。 |
| 云盘连接共享冷却 | 每个缓存的 OneDrive / Google Provider 对应独立连接，目录、分页、元数据和改名请求（含新批次及重试）共用一个内存截止时间。HTTP 429、batch 子项 429 和 Google 已支持的 403 限流 reasons 都延长截止时间：`max(当前截止时间, 单调时钟当前值 + 等待秒数)`。即使当前请求已耗尽重试，也记录限流；等待结束后重新检查截止时间，取消某个等待者不会清除共享状态。有效 `Retry-After` 秒数/HTTP 日期优先且不截断（0 表示无需新增等待），缺失或无效时沿用各 Provider 的指数退避。限流不再逐批单独 sleep；其他网络/5xx 读取退避保留。 |
| 冷却范围与恢复 | 已发出的请求正常收尾，其限流响应可以继续延长截止时间；成功响应或较短等待不能提前解除冷却。不同连接互不影响，截止时间不落盘，连接配置/账号版本变化导致 Provider 重建时重新开始。到期后仍按现有并发上限发送，不增加额外串行队列或自动降并发。OAuth Token / 账号核验接口维持独立单次请求策略，不加入自动重试。 |
| Google 分页 | 读取至 `nextPageToken` 缺失，包括空中间页。无效/重复 Token、incomplete search、重复 item ID、错误 parent、malformed data 或后续页失败均中止完整响应，客户端须从头刷新。 |
| Google 元数据读取 | 每个 HTTP multipart request 最多 100 个 GET，保留请求顺序；同一操作共享祖先读取，不跨读取缓存。401 触发有界授权刷新；限流（429 或支持的 403 reasons）、transport errors 和 5xx reads 使用有限次 Retry-After / backoff 重试。成功 batch parts 保留，只重试可重试失败；永久失败、malformed / missing part 使整个调用失败，不返回部分元数据。Google error bodies 不回显。 |
| Google 写入 | 单项使用一次 metadata-only PATCH，无范围/权限预检和路径读取；批量使用 PATCH parts，每个 multipart batch 最多 20 次写入，同时仅一个 batch 在途；只发送 `name`，不修改内容、parents 或 shortcut targets。每批重新校验项目范围、祖先和重命名权限；已知成功保留，仅对明确认证/限流拒绝做有界重试，逐项重试只含被拒绝 parts。 |
| Google 未知写入与回滚 | transport errors、5xx writes 或 malformed / incomplete successful responses 产生 `RENAME_OUTCOME_UNKNOWN`；既有 execution service 按 ID 查询元数据，不重放写入，未解决时停止后续分组并返回可空实际名称。循环、依赖及尽力回滚复用既有 Engine；Google Drive 第三阶段未引入状态格式迁移或新的公共 Schema。 |

## 未实现与已移除的契约

未实现：

- RuleSet API 或持久化。
- History、Undo、Redo API / persistence。
- 服务端文件选择、分页、搜索、排序或筛选。

原有 Provider / path 浏览、Local / OneDrive settings、Provider 专属 authentication callback，以及 `/rename/preview` endpoints 已移除，不提供重定向或转换。`/rename/execute`、`/rename/progress/{preview_id}`、`/rules`、`/health` 仍是共享 endpoints；storage ID 不提供 `local` / `onedrive` aliases。
