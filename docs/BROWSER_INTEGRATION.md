# Browser Integration v1

本文件是浏览器消息协议的事实来源，后续阶段变更必须同步维护。消息不是 HTTP API，不新增 REST 端点。

## 当前交付与支持范围

阶段一仅交付可加载的 MV3 扩展、OneDrive 页面提取和临时 action 脱敏诊断。不查找或激活本体标签页、不发送导航、不添加悬浮按钮成品。本体前后端未接线。

目标环境为桌面 Chrome / Edge，普通窗口，同一浏览器配置文件；个人版 OneDrive 当前账号默认云盘的普通 `/my`“我的文件”根目录及子目录。最终流程只导航，不选择文件、不预览、不重命名、不添加连接、不重新授权。

不支持共享链接、共享目录快捷方式、跨云盘、SharePoint、企业版、搜索、最近使用、照片、回收站、无痕窗口、跨配置文件、多实例自动选路。最终找不到本体时要求用户启动并打开；存在多个可用本体标签页时要求仅保留一个，不广播、不随机选取、不启动进程或新建标签页。不新增全局单标签页锁，后续如已有所有权机制则复用。

## 逻辑请求与回复

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

type NavigationReply =
  | { version: 1; request_id: string; status: "accepted" }
  | { version: 1; request_id: string; status: "opened"; storage_id: string }
  | { version: 1; request_id: string; status: "rejected"; code: string };
```

传输封装命名空间固定为 `rename-studio.browser.v1`。上述请求为逻辑载荷，后续传输接线须在入口校验来源、版本、类型和载荷，不信任页面传入的数据。阶段一没有网页 `postMessage` 桥、外部扩展消息入口或本体消息接收器。

`accepted` 仅表示已接收，不表示目录已打开；只有现有目录 API 成功返回规范位置后才能回复 `opened`。最终结果保留相同 request_id；每次点击生成新 ID，只处理当前请求，忽略迟到结果，不承诺幂等、不持久化排队、不自动重放。阶段一只产生提取结果，不伪造 accepted/opened。

入口拒绝额外字段。字符串必须非空且不含 ASCII 控制字符；长度上限按 JS UTF-16 code units：request_id 64（仅 ASCII 字母、数字、`_`、`-`），account_cid 恰好 16 位十六进制，folder_id / drive_id 各 256，邮箱 320，姓名/目录名各 256。所有可选字段存在时也须满足边界。不把 folder_id 当路径处理，不修剪、重编码或改写不透明 ID。当前边界面向个人版适配，真实扩展验证发现不符时须更新本文件和校验器。

禁止传递 Token、Cookie、页面完整上下文、任意 API URL、文件列表、规则或可执行脚本。显示数据不是身份，不以邮箱或姓名兜底绑定，不建持久化映射。

## 账号、云盘与位置

后续仅在现有 `provider_type === "onedrive"` 连接中按 account_cid 匹配 account_id；仅在双方均已确认十六进制时忽略大小写，保留前导零。不推断十进制转换，不把该语义推广到其他 Provider。找不到唯一匹配时要求用户添加/检查连接。

storage_id 为独立连接 ID，不硬编码、不由 CID 构造。account_cid、drive_id、folder_id 分别保留语义，不假定 account_id 等于 drive_id。后续默认云盘核对应优先复用已有元数据，确需补读时在 Provider 内完成；前端不调用 Graph、不接收网页 Cookie。

目录提交 `{ kind: "id", value: folder_id }`，成功采用 Provider 规范位置；根目录也提交真实返回 ID，不拼造 root ID。阶段一不修改通用模型、后端 API、凭据或重命名工作流。

## 页面提取边界

`src/onedrive-page.js` 是唯一页面适配模块，通过 scripting 在 MAIN 执行完整读取与同源 GET。普通 ISOLATED 内容脚本不读取网页全局；仅接收 worker 筛选后的有界脱敏摘要。MAIN 返回值也视为外部数据并经过协议校验。页面内部实现不是微软公共稳定契约，当前 Console 实测不能当作真实扩展联调已通过。

每次读取当前 URL、`_spPageContextInfo` 的 userHexCid / userCid、webAbsoluteUrl、listUrl，以及可选 userEmail、userDisplayName；邮箱缺失时读取 `$Config.email`。不用 `$Config.isAuthenticated` 判断登录。userHexCid 按明确十六进制字段处理；只有 userCid 时，仅接受恰好 16 位且含 A–F 的十六进制字符串，纯数字或数字类型明确失败，不猜进制。

仅允许精确 `/my` 或 `/my/` 路径、无 hash。查询参数白名单为 id、viewid（GUID）、cid（须匹配上下文 CID）、o、sortField、isAscending，禁止重复键；其他模式保守拒绝，待实测再扩展。无 id 时使用 listUrl；有 id 时 URLSearchParams 仅解码一次，作为服务器相对路径。webAbsoluteUrl 必须为 `https://onedrive.live.com/personal/{site}`，listUrl 必须位于该站点内，目标必须等于 listUrl 或位于 `listUrl + '/'` 边界内；拒绝空段、`.`、`..` 和反斜杠。

根目录 GET `{webAbsoluteUrl}/_api/v2.0/drive/root`；子目录 GET `.../drive/root:/{relativePath}`，每段独立 encodeURIComponent，带 `credentials: include` 和 `Accept: application/json;odata=nometadata`，禁止重定向，整次提取 10 秒超时，不自动重试。检查 HTTP、id、folder，拒绝 remoteItem 快捷方式。子目录另读默认根目录，比较两者 parentReference.driveId；任一缺失则 scope_unverified，不同则 unsupported_scope，防止经快捷方式进入其他云盘后看似普通的后代目录。根目录自身提取允许该字段缺失，绝不由 CID 构造 drive ID；若实际根响应没有该字段，子目录将保守失败，此兼容限制须由真实扩展验证确认。此阶段不宣称已完成 Provider 侧默认云盘身份核对。

提取期间监听 Navigation API、popstate、hashchange，并每 50ms 重读 URL/账号/上下文；fetch 和 JSON 解析后及返回前再次比较。发现变化即中止并返回 page_changed，要求重新点击。worker 再核对当前标签页 URL，以 documentId 定向回传；新点击使旧结果失效。整页跳转导致文档消失时报告传输失败，不向新页面投递旧结果。

## 失败语义

当前实际实现的提取码：

| 代码 | 含义与恢复 |
| --- | --- |
| context_unavailable / invalid_page_data | 页面上下文缺失或字段不符；回到普通我的文件重试 |
| account_format_unsupported | CID 格式/进制不能确认；检查适配，不做自动转换 |
| unsupported_view / unsupported_scope | 不支持的视图或范围；回到支持目录 |
| scope_unverified | 子目录缺少 drive ID；停止并检查适配 |
| page_changed | 提取期间上下文变化；重新点击 |
| auth_required / permission_denied | 同源请求 401 / 403；检查网页登录/访问权限 |
| directory_unavailable | 同源请求 404；检查目录是否仍可访问 |
| rate_limited | 同源请求 429；稍后手动重试 |
| provider_error | 其他非成功 HTTP 状态；稍后检查服务状态，不冒充目录不存在 |
| network_error / request_timeout | 请求失败 / 超时；检查网络后重试 |
| invalid_response | 非文件夹或响应结构不符；停止并检查适配 |
| unsupported_version / invalid_request | 协议版本不支持 / 载荷不合法；停止并检查版本 |
| transport_unavailable | 注入、文档销毁或扩展回传失败；刷新支持页面并重试 |

后续导航接线时才启用实际分支的拒绝码，例如 connection_not_found、auth_required、busy、outcome_unresolved、directory_unavailable、cancelled。这些是预留语义，不是当前已实现行为；底层现有认证、权限、网络错误继续保留类别，不能都压成目录不存在。workspace_not_found、multiple_workspaces、transport_unavailable 属扩展传输结果，绝不新增后端错误码。

## 权限与诊断生命周期

当前只有 `scripting` 和 `https://onedrive.live.com/*` host 权限；无 all_urls、cookies、debugger、webRequest、activeTab、tabs 权限，无本体注入。本体明确允许地址预定为 `http://localhost:8000`、`http://127.0.0.1:8000`、开发用两主机的 `:5173`；后续接线只接受这些精确 origin（Chrome host 匹配模式不能约束端口时，仍须代码再次核对 origin）。本阶段无需访问本体，暂不申请该权限。

MAIN 注入使用声明的 scripting 与 OneDrive host 权限，遵循 [Chrome scripting 文档](https://developer.chrome.com/docs/extensions/reference/api/scripting)；世界隔离见 [Content scripts 文档](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)。

临时 action 只输出字段是否存在及长度，不输出邮箱、姓名、CID、目录 ID/名、URL或原始响应；不持久化数据。悬浮按钮接通后必须移除 action、debug-content 以及调试日志。扩展语言使用 Chrome en_US / zh_CN，对应本体 en-US / zh-CN。

## 用户验证

见 [扩展 README](../extensions/browser/README.md)。本阶段结束等待用户测试和真实浏览器验收后再推进。Commit 和 Push 分别需要明确批准，不直接 Push main；合并和发布由用户执行。
