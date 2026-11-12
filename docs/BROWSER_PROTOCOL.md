# 浏览器消息协议 v1

本文定义 Rename Studio Browser 与本体的导航契约，是协议的事实来源；变更时同步维护本文及双方校验器。用户操作、支持范围和构建方式见[扩展 README](../extensions/browser/README.md)。浏览器消息不是 HTTP API，不新增导航 REST 端点。

## 请求与回复

```ts
interface OpenOneDriveFolderRequest {
  version: 1;
  type: "open-onedrive-folder";
  request_id: string;
  account_cid: string;
  folder_id: string;
  drive_id?: string;
  account_email?: string;
  account_display_name?: string;
  folder_name?: string;
}

interface OpenGoogleDriveFolderRequest {
  version: 1;
  type: "open-google-drive-folder";
  request_id: string;
  account_email: string;
  location: { kind: "root" } | { kind: "id"; value: string };
}

type NavigationReply =
  | { version: 1; request_id: string; status: "accepted" }
  | { version: 1; request_id: string; status: "opened"; storage_id: string }
  | { version: 1; request_id: string; status: "rejected"; code: string };
```

`accepted` 表示业务入口已接收，触发本体标签页和窗口激活；`opened` 只在目标目录成功显示后返回。匹配或执行保护失败直接返回 `rejected`。每次点击生成新的 request_id，回复保留同一 ID；不保证幂等、不持久化排队、不自动重放，迟到结果不得影响后续请求。

边界拒绝额外字段。字符串不得为空或含 ASCII 控制字符，长度以 JS UTF-16 code units 计：

| 字段 | 限制 |
| --- | --- |
| request_id | 1–64，仅 ASCII 字母、数字、`_`、`-` |
| account_cid | 恰好 16 位十六进制 |
| folder_id、drive_id | 各不超过 256 |
| account_email | 不超过 320 |
| account_display_name、folder_name | 各不超过 256 |
| opened.storage_id | 不超过 256 |
| rejected.code | 1–64，仅 ASCII 字母、数字、下划线 |

可选字段存在时也须满足限制。folder_id、drive_id 为不透明 ID，不按路径处理。消息不包含 Token、Cookie、完整页面上下文、任意 API URL、文件列表、规则或脚本。

## 身份与目录

通过 Provider 元数据 `browser_navigation === "onedrive_personal"` 选择连接类型，同时要求浏览器授权与 ID 位置能力，再以 account_cid 对应 account_id；个人版双方为十六进制时忽略大小写，保留前导零，不猜测进制转换。须唯一匹配，不以邮箱或姓名兜底绑定，不建立持久映射。storage_id 是本体连接 ID，不能由 CID 构造，也不假定 account_id 等于 drive_id。

目录以 `{ kind: "id", value: folder_id }` 提交给已有 `POST /storages/{storage_id}/files/list`。每次跳转强制读取目录，不直接使用已有文件列表缓存；校验响应的 storage_id、revision、directory_id，以及规范位置为 id/root。请求带 drive_id 时响应须存在且相同；请求缺少 drive_id 时仅接受规范位置为 root。允许真实根 ID 被 Provider 规范化为 root，不拼造根 ID。

本体外部导航发送 `refresh: true, reuse_ancestors: true`：实时读取目标元数据及内容，祖先链可通过服务端 DirectoryCache 反向索引复用。只提供目标 ID 即可，不依赖当前目录、显示名称或扩展提供的祖先关系。普通手动刷新及未知写入复核只发送 `refresh: true`。本优化不改变 v1 扩展消息字段、账号匹配和 opened 确认条件。

入口复用已有连接列表及授权缓存，不主动二次刷新；目标没有授权缓存时由普通连接查询初始化。实际授权和目录权限由现有 API 判断。任务占用、未知写入记录和单次并发保护保持有效；重复请求直接拒绝，不排队。

本次外部目标优先于连接恢复位置，不改写用户默认目录。离开旧目录时释放预览、清理选择和任务，保留规则及未知写入保护。手动操作、连接版本/账号变化、重置或卸载取消旧请求；导航协调只检查已提交的跳转状态。成功显示后接回普通缓存并保存规范位置；读取失败保留真实错误和已有成功位置记忆，手动重试仍执行范围校验，不静默回根目录。

Google 通过 `google_drive_my_drive` 能力筛选已有连接，邮箱去除首尾空白并转小写后须唯一匹配。邮箱为必填，不超过 320 字符，并须符合扩展支持的邮箱格式。连接选中后，授权核对和位置记忆继续使用连接的稳定 account_id。Google 位置仅接受 root 或 id，ID 为 1–256 位 ASCII 字母、数字、下划线或连字符。目录 API 核验 My Drive 祖先链、目录类型和权限。本体核对连接及 revision，根请求要求规范位置为 root，ID 请求核对 directory_id。

## Google Drive 提取边界

在 `https://drive.google.com` 上支持 `/drive/u/{数字}/my-drive` 和 `/drive/u/{数字}/folders/{ID}`，允许末尾斜杠，拒绝 resourcekey 链接。账号序号仅用于匹配路径形状。点击时按页面顺序扫描可见账号入口，从首个含可识别邮箱的 `aria-label` 取第一个邮箱并转为小写。未找到可用邮箱时返回 `account_email_unverified`。传输层核对来源 URL 和注入结果的文档 ID，发现不一致时返回 `page_changed`。页面原始标签和 URL 不进入导航消息。

## 模块边界与兼容

扩展通过 `src/adapters/index.js` 显式注册网站 origin、请求类型、MAIN 提取函数及载荷校验；共用网站入口、worker 和传输层不包含 OneDrive 分发分支。来源适配器由浏览器 sender.origin 决定，提取结果的请求类型必须与该适配器一致。新增网站仍需显式更新 manifest 权限和发布。

本体共用入口位于 `frontend/src/integrations/browser/`，适配器负责请求解析、账号匹配及目录范围校验；工作区只持有连接、目标位置和校验方法，统一管理强制读取、取消、重试、缓存及显示完成。失败后保留的目标仍调用同一适配器校验，不因手动重试跳过范围检查。

Google 使用新增的 v1 请求类型，旧本体拒绝该请求并提示核对集成版本。现有 v1 命名空间、OneDrive 请求、握手、回执与时限保持不变，旧扩展可连接新本体。新增元数据仅扩展 `GET /storage-providers`，不改变 HTTP 导航接口、认证或持久化账号模型；前后端需配套更新。安装与验证见[扩展 README](../extensions/browser/README.md)。

## OneDrive 提取边界

`adapters/onedrive-page.js` 通过 scripting 在 MAIN 中读取当前 URL、页面上下文和同源目录接口。ISOLATED 脚本不读取网页全局，worker 校验有界结果后投递。网页内部实现不是微软承诺稳定的公共契约。

每次提取重新读取 `_spPageContextInfo` 中的 userHexCid/userCid、webAbsoluteUrl、listUrl 及可选 userEmail/userDisplayName；邮箱可读 `$Config.email`，不用 `$Config.isAuthenticated` 判断登录。userHexCid 按明确十六进制字段处理；仅有 userCid 时只接受 16 位且包含 A–F 的十六进制字符串，不把纯数字或数字类型猜测转换。

视图只允许 `/my` 或 `/my/` 且无 hash。查询参数限 id、viewid（GUID）、cid（匹配上下文）、o、sortField、isAscending，不允许重复键。id 由 URLSearchParams 解码一次，作为服务器相对路径；缺失时使用 listUrl。webAbsoluteUrl 须位于 `https://onedrive.live.com/personal/{site}`，listUrl 位于该站点，目标等于 listUrl 或位于 `listUrl + '/'` 边界内；拒绝空路径段、`.`、`..` 和反斜杠。

根目录 GET `{webAbsoluteUrl}/_api/v2.0/drive/root`；子目录 GET `.../drive/root:/{relativePath}`，各路径段独立编码，使用 `credentials: include` 和 `Accept: application/json;odata=nometadata`，禁止重定向。仅读取目标一次，检查 HTTP、id、folder，拒绝 remoteItem 快捷方式；子目录必须返回 parentReference.driveId，根目录允许缺失，不从 CID 构造 drive ID。

只在点击后提取。请求期间监听 Navigation API、popstate、hashchange，并每 50ms 核对上下文；fetch、JSON 解析后及返回前再次核对，完成后清理监听和计时器。发生变化则丢弃目标，要求重新点击；不持续收集浏览记录。

## 传输与生命周期

命名空间为 `rename-studio.browser.v1`。发布版精确 origin 为 `http://localhost:8000`，开发版为 `http://localhost:5173`，不扫描端口。Chrome host/match pattern 不区分端口，因此 localhost 匹配范围内的内容脚本和 worker 必须在操作前核对构建 origin。

云盘网站的顶层脚本发送 `{namespace, type:'open-current-folder', request_id}`。worker 核对 extension ID、顶层 frame、普通窗口、已注册的网站 origin 和来源 documentId。候选本体页须通过 `{namespace, version:1, type:'probe', request_id}` 握手，回复 `{namespace, version:1, type:'ready', project:'rename-studio', request_id, instance_id}`；业务入口挂载后才答 ready。没有就绪页返回 workspace_not_found，多个返回 multiple_workspaces，唯一时才继续提取和投递。

候选标签页的探测消息发送失败时，worker 向该标签页的顶层文档注入本体内容脚本，然后再探测一次。安装或重载扩展后，已打开的本体页可以通过这一步恢复通信。

instance_id 是本体内容脚本文档的 UUID，用于关联文档，不是认证凭据。投递格式为 `{namespace, version:1, type:'navigate', request_id, instance_id, request}`。本体内容脚本以 window.postMessage 桥接应用，始终使用准确 targetOrigin：

```ts
// extension → app
{ namespace, direction: 'extension-to-app', version: 1, type: 'probe', request_id }
{ namespace, direction: 'extension-to-app', version: 1, type: 'navigate', request_id, request }
// app → extension
{ namespace, direction: 'app-to-extension', version: 1, type: 'ready', request_id, project: 'rename-studio' }
{ namespace, direction: 'app-to-extension', version: 1, type: 'navigation-reply', request_id, reply }
```

双方校验 event.source、event.origin、方向、命名空间、版本、类型和 request_id，避免回声。同源检查不能证明消息来自扩展；桥只接受有界导航意图，账号、连接、授权及范围仍由本体校验，不作为特权 API 代理。worker 校验 MAIN 结果，应用校验网页目标，本体内容脚本校验网页回复；扩展内部已收敛的载荷不重复完整校验，但保留来源和请求关联检查。

accepted 通过 `{namespace, type:'navigation-accepted', request_id, instance_id}` 回传 worker。worker 最多激活一次本体标签页和窗口，向来源 documentId 返回 accepted；激活失败不改变真实目录结果。仅 opened 显示成功，本体和来源分别显示最终结果。

通信使用一次 runtime.sendMessage 最终响应和一次 accepted 事件，不使用长连接、定时保活或持久队列。OneDrive 同源读取超时 10 秒，页面注入等待上限 12 秒；ready 探测 1.5 秒，本体内容脚本等待 19.5 秒，worker 20 秒，来源整体 35 秒。本体窗口桥 20 秒后清理通信状态，实际业务仍由工作区取消机制管理。

投递前明确错误返回 `{transport:'rejected', code}`。投递后的失联、非最终回复或超时返回 `{transport:'unconfirmed', code:'result_timeout'}`，提示“未收到打开结果，请查看 Rename Studio”，不表示导航失败，不自动重放。请求映射仅保存在 worker 内存，完成、超时或来源关闭后清理。

## 失败语义

| 类别 | 代码及处理 |
| --- | --- |
| 页面上下文 | context_unavailable、invalid_page_data、account_format_unsupported：回到普通我的文件，格式不符需检查适配 |
| Google 账号 | `account_email_unverified` 表示页面未提取到可用邮箱，请核对登录状态和当前账号。 |
| 范围与结果 | unsupported_view、unsupported_scope、scope_unverified、invalid_response：不导航，不回退根目录 |
| 网页变化 | page_changed：重新点击 |
| OneDrive 读取 | auth_required（401）、permission_denied（403）、directory_unavailable（404）、rate_limited（429）、provider_error（其他 HTTP 错误） |
| 网络与提取超时 | network_error、request_timeout：检查网络后手动重试 |
| 消息边界 | unsupported_version、invalid_request：检查双方版本与载荷 |
| 本体与传输 | workspace_not_found、multiple_workspaces、transport_unavailable；投递后无法确认使用 result_timeout |
| 本体导航保护 | connection_not_found、auth_required、busy、outcome_unresolved、cancelled、unsupported_scope、scope_unverified |

目录 API 的现有错误码原样保留，例如 PERMISSION_DENIED、AUTHENTICATION_ERROR、NOT_FOUND、STORAGE_CONNECTION_CHANGED；不统一转换为“目录不存在”。传输结果不新增为后端错误码。

## 权限

扩展声明 scripting，以及 `https://onedrive.live.com/*`、`https://drive.google.com/*`、`http://localhost/*` host 权限；不申请 all_urls、cookies、debugger、webRequest、activeTab 或 tabs 权限。MAIN Material 脚本仅注册界面组件，不承担消息转发；ISOLATED 脚本管理按钮和通信。网页凭据仅用于 OneDrive 同源只读提取，不交给本体；不记录或持久化账号、目录和原始响应日志。
