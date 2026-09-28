# 前端 API 参考

本文仅描述当前 FastAPI 实际暴露的接口。

## 调用约定

- 后端路由没有统一 `/api` 前缀。开发环境前端请求 `/api/files`，由 Vite 代理并改写为后端 `/files`。
- JSON 字段使用 snake_case。
- `datetime` 字段为 ISO 8601 字符串。
- `204` 响应没有 Body。
- 除 OAuth HTML 回调外，领域错误统一返回：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": {}
  }
}
```

通用错误：

| HTTP | code | 含义 |
| --- | --- | --- |
| 401 | `AUTHENTICATION_ERROR` | OneDrive 未连接、授权失效或刷新失败 |
| 404 | `NOT_FOUND` / `PREVIEW_NOT_FOUND` | 文件、目录或预览不存在 |
| 409 | `RENAME_CONFLICT` / `PREVIEW_EXPIRED` | 名称冲突，或预览过期/状态已变化 |
| 422 | `REQUEST_VALIDATION_ERROR` | Pydantic 请求结构错误 |
| 422 | `VALIDATION_ERROR` | 路径、选择或业务校验失败 |
| 422 | `RULE_CONFIGURATION_ERROR` | 未知规则或规则配置错误 |
| 429 | `RATE_LIMIT_ERROR` | Graph 限流且重试后仍失败 |
| 502 | `PROVIDER_ERROR` | 文件系统、Graph 或微软认证服务失败 |
| 500 | `INTERNAL_ERROR` | 未处理错误；`details.request_id` 可用于日志定位 |

当前 `frontend/src/api/client.ts` 只保留错误 message。UI 重构可在前端扩展 `ApiError`，保留 code、details 和 status。

## 核心数据结构

### ProviderInfo

```ts
{ id: string; name: string; writable: boolean }
```

当前实际 Provider：`local`、`onedrive`。两者当前都返回 `writable: true`。

### FileItem

```ts
{
  id: string;
  name: string;
  path: string;
  parent_path: string;
  is_directory: boolean;
  size: number | null;
  modified_at: string | null;
}
```

- `id` 是后续选择、Preview 和 Provider 操作使用的稳定标识；不要从 `name` 推导。
- `path`、`parent_path` 是 Provider 根目录下的 `/` 分隔相对路径。
- 目录的 `size` 为 `null`。

### RuleSpec

```ts
{ type: string; enabled: boolean; config: Record<string, unknown> }
```

规则按数组顺序执行；`enabled: false` 时后端跳过该规则。

### PreviewItem

```ts
{
  file_id: string;
  original_name: string;
  new_name: string;
  changed: boolean;
  valid: boolean;
  conflict: boolean;
  error: string | null;
}
```

`conflict` 是冲突子集；其他非法名称可能 `valid: false` 但 `conflict: false`。UI 应优先展示 `error`，不能只看 conflict。

## System

### GET `/health`

- 用途：后端健康检查。
- Request：无。
- Response：`{ "status": "ok" }`。
- 错误：仅通用 500。
- 注意：当前前端未调用。

## Provider

### GET `/providers`

- 用途：列出已注册 Provider。
- Request：无。
- Response：`ProviderInfo[]`。
- 错误：通用 500。
- 注意：前端应使用返回的 `id` 发起文件和重命名请求，不要只依赖显示名称。

## 文件浏览与选择

### GET `/local/settings`

- 用途：读取 Local Provider 当前根文件夹。
- Request：无 Query、无 Body。
- Response：`{ "root_path": string }`，返回后端解析后的绝对路径。
- 可能错误：通用 500。
- 注意：该路径用于设置界面显示，不应拼接生成 `file_id`。

### PUT `/local/settings`

- 用途：将 Local Provider 切换到用户指定的本机文件夹并持久化。
- Query：无。
- Body：`{ "root_path": string }`，长度 1–4096，必须是后端所在机器上已经存在的目录。
- Response：`{ "root_path": string }`，返回解析后的绝对路径。
- 可能错误：路径为空、不存在或不是目录为 422；本地设置保存失败为 502。
- 注意：成功后前端必须回到相对根路径 `""`，清空选择、Preview 和 Execute 结果，并刷新 local 文件查询。后续浏览仍只能访问新根目录以内的路径。

### POST `/local/settings/pick`

- 用途：在运行后端的机器上唤起系统文件夹选择器，并在确认后切换 Local Provider 根目录。
- Request：无 Query、无 Body。
- Response：`{ "root_path": string, "selected": boolean }`。
- `selected: true` 表示用户确认了目录且切换成功；`false` 表示用户取消，`root_path` 仍为当前目录。
- 可能错误：系统缺少图形组件或没有桌面会话为 502；目录校验失败为 422；本地设置保存失败为 502。
- 注意：这是后端本机对话框，不是浏览器文件上传控件。前端只应在明确的用户点击操作中调用；成功后执行与 PUT `/local/settings` 相同的状态清理。

### GET `/files`

- 用途：读取某 Provider 下一个目录的直接子项。
- Query：
  - `provider: string`，可省略，默认 `local`。
  - `path: string`，可省略，默认根目录 `""`。
- Body：无。
- Response：

```ts
{
  provider: string;
  path: string;
  parent_path: string | null;
  items: FileItem[];
}
```

- `parent_path === null` 表示当前已在 Provider 根目录。
- 可能错误：未知 Provider/非法 `.`、`..` 路径为 422；目录不存在为 404；OneDrive 未连接为 401；Graph/本地读取失败为 502；Graph 限流为 429。
- 注意：返回目录和文件，目录排在前面。OneDrive 的 Graph 分页由后端聚合，API 本身没有分页参数。

### 文件/目录选择

`Not implemented`（没有服务端选择 API）。

选择是前端 UI 状态：保存当前 `DirectoryListing.items` 中的 `id`，并作为 `file_ids` 传给 Preview。文件和目录都可选；所有选择必须来自同一个直接父目录。进入其他目录或切换 Provider 时应清空选择。

## OneDrive

### GET `/onedrive/settings`

- 用途：读取本地 OneDrive 应用设置。
- Request：无。
- Response：

```ts
{
  configured: boolean;
  client_id: string | null;
  redirect_uri: string;
}
```

- 注意：不返回任何 Token。当前流程不使用 Client Secret。

### PUT `/onedrive/settings`

- 用途：保存 App ID。
- Body：`{ "client_id": string }`，长度 1–200，后端去除首尾空白。
- Response：同 GET `/onedrive/settings`。
- 可能错误：空值或结构错误为 422；本地保存失败为 502。
- 注意：更换 App ID 会清除旧账号授权；保存相同 App ID 会保留已有授权。

### DELETE `/onedrive/settings`

- 用途：删除 App ID、Refresh Token、账号资料和当前授权状态。
- Request：无。
- Response：204。
- 可能错误：本地文件删除失败为 502。

### GET `/onedrive/auth/status`

- 用途：读取配置和连接状态。
- Request：无 Query、无 Body。
- Response：

```ts
{
  configured: boolean;
  connected: boolean;
  account_display_name: string | null;
  account_email: string | null;
}
```

- 注意：后端重启后若存在 Refresh Token，`connected` 可先为 true；首次 Graph 请求会实际刷新并验证授权。

### POST `/onedrive/auth/start`

- 用途：创建 OAuth Authorization Code + PKCE 登录 URL。
- Request Body：无。
- Response：`{ "authorization_url": string }`。
- 可能错误：未配置 App ID 为 422；清理旧授权或保存本地状态失败为 502。
- 注意：调用此接口会先删除旧账号 Token，即使用户之后关闭或取消登录。前端应在直接用户操作中打开返回 URL，以降低弹窗拦截概率。

### GET `/auth/onedrive/callback`

- 用途：微软登录回调；供 OAuth 弹窗使用，不是普通 JSON API。
- Query：成功时 `code`、`state`；失败时可能有 `error`、`error_description`。
- Response：HTML。成功 HTTP 200，失败 HTTP 400。
- 浏览器消息：

```ts
{
  type: "onedrive-auth";
  status: "connected" | "failed";
  message: string;
}
```

- 注意：消息发送到配置的 `FRONTEND_ORIGIN`；前端必须校验 `event.origin`。不要把 callback 加上开发代理的 `/api` 前缀。

### DELETE `/onedrive/auth/session`

- 用途：断开当前账号，删除 Refresh Token 和账号资料，但保留 App ID。
- Request：无 Query、无 Body。
- Response：204。
- 可能错误：保存本地状态失败为 502。

## Rules

### GET `/rules`

- 用途：获取已注册规则及其 JSON Schema。
- Request：无。
- Response：

```ts
Array<{
  type: string;
  name: string;
  description: string;
  config_schema: Record<string, unknown>;
}>
```

- 注意：当前前端仍为已知规则手写控件，不能仅凭 JSON Schema 自动渲染新规则。

当前规则配置：

| type | config |
| --- | --- |
| `padding` | 必填 `mode: "number" | "text"`、`length: 1..255`；`fill_character` 默认 `_` 且必须为单字符；`side` 默认 `left`。数字模式对主文件名内每段数字补零；文本模式填充整个主文件名；文件扩展名始终保留。 |
| `replace` | 必填 `search: 1..255 字符`；`replacement` 默认空字符串；`occurrence` 默认 `all`，可选 `first/last`；`case_sensitive` 默认 true；`whole_word` 默认 false；`ignore_extension` 默认 true。 |
| `remove` | 与 `replace` 相同，但没有 `replacement`。 |
| `insert` | 必填 `text: 1..255 字符`；`position` 默认 `prefix`，可选 `suffix/index/before_text/after_text`；`index: 1..255` 默认 1；`from_right` 默认 false；`anchor` 默认空字符串，但文本相对位置要求非空。文件扩展名始终保留。 |

## Rename Preview

### POST `/rename/preview`

- 用途：对选中项目应用规则、验证结果并保存可执行快照；不会修改文件。
- Body：

```ts
{
  provider?: string;       // 默认 "local"
  path?: string | null;    // 前端应传当前 DirectoryListing.path
  file_ids: string[];      // 至少 1 项且不能重复
  rules?: RuleSpec[];      // 默认 []
}
```

- Response：

```ts
{
  preview_id: string;
  expires_at: string;
  items: PreviewItem[];
  valid: boolean;
}
```

- `valid` 只有在全部项目有效时才为 true。无变化项目仍会出现在 items 中。
- 可能错误：空/重复选择、跨目录选择、项目不在指定 path、选择 Provider 根、非法路径为 422；规则类型/配置错误为 422；文件或目录不存在为 404；OneDrive 认证/Provider 错误同文件浏览。
- 注意：传 path 时后端会读取一次该目录，同时验证选择属于该目录并检测冲突。Preview 默认 10 分钟后过期，且仅存在当前后端进程内。

## Rename Execute

### POST `/rename/execute`

- 用途：重新验证并执行服务端 Preview。
- Body：`{ "preview_id": string }`，非空。
- Response：

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
  }>;
}
```

- `skipped` 通常表示名称没有变化。
- 可能错误：Preview 不存在/已执行为 404 `PREVIEW_NOT_FOUND`；过期或文件状态变化为 409 `PREVIEW_EXPIRED`；无效 Preview 为 422；重新读取时还可能出现 Provider 错误。
- 注意：有效快照在开始真实执行前会被消费，不能重复执行。单项改名失败通常通过 HTTP 200 的 item status 和整体 `partial/failed` 返回，不能只根据 HTTP 状态判断成功。成功后应清空选择并刷新目录。

## RuleSet

`Not implemented`

当前没有 RuleSet Schema、路由或数据库读写。规则链只存在前端 Zustand 状态，并随 Preview 请求发送。

## History / Undo / Redo

`Not implemented`

当前没有 History、operation 查询、Undo 或 Redo API，也没有对应持久化模型。Execute Response 是目前唯一的执行结果来源，页面刷新后无法重新查询。

