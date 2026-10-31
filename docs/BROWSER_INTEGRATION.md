# Browser Integration v1

本文件是浏览器消息协议的事实来源，后续阶段变更必须同步维护。消息不是 HTTP API，不新增 REST 端点。

## 当前交付与支持范围

阶段一已交付可加载的 MV3 扩展、OneDrive 页面提取和临时 action 脱敏诊断。阶段二实现本体内部导航业务入口，尚未接浏览器传输，不查找或激活本体标签页、不添加悬浮按钮成品。

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

传输封装命名空间固定为 `rename-studio.browser.v1`。上述请求为逻辑载荷，后续传输接线须在入口校验来源、版本、类型和载荷，不信任页面传入的数据。当前没有网页 `postMessage` 桥、外部扩展消息入口或本体浏览器消息接收器。阶段二 `frontend/src/integrations/onedrive/navigation.ts` 的 `openOneDriveFolder` 只接收已经校验的内部类型；不是不可信消息入口。

`accepted` 仅表示已接收，不表示目录已打开；只有现有目录 API 成功返回规范位置、当前工作区显示对应目录后才能回复 `opened`。最终结果保留相同 request_id；每次点击生成新 ID，只处理当前请求，忽略迟到结果，不承诺幂等、不持久化排队、不自动重放。阶段二内部入口返回最终结果 Promise，可选回调接收 accepted；同步匹配或保护失败直接 rejected，不先发送 accepted。

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

阶段二实际导航拒绝码：connection_not_found（无唯一匹配）、auth_required（授权未连接）、busy（已有外部请求/预览/执行/单项改名/连接忙碌/本地选择器/重置）、outcome_unresolved（未知或待核对写入）、cancelled（手动切换、账号/连接版本/上下文变化）、unsupported_scope / scope_unverified（范围不符/无法核对）。现有 API 错误码原样保留，例如 PERMISSION_DENIED、AUTHENTICATION_ERROR、NOT_FOUND、STORAGE_CONNECTION_CHANGED；未收到可用响应为 network_error。不将底层错误统一压成目录不存在。workspace_not_found（当前业务入口未挂载）、后续的 multiple_workspaces、transport_unavailable 属传输/接入结果，绝不新增后端错误码。

## 阶段二：本体协调与目录响应补充

WorkspaceApp 使用独立 useOneDriveNavigation 显式连接 storage 与 rename Hook，两个 Hook 不互相调用。入口先匹配真实 storage_id、能力与忙碌状态，再刷新连接及授权状态；这些阶段失败不更换工作区。仅内部当前请求有效，不排队；pending 期间重复请求返回 busy。未知记录在任何清理之前检查，提示先核对。

useWorkspaceStorage.openExternalTarget 一次安装目标连接、版本、账号就绪标记和 ID 位置。pending 期间暂停记忆/默认位置恢复；外部位置优先级仅限本次请求，不调用默认位置保存 API。离开时释放旧预览、清选择/任务，保留规则。手动位置/连接切换、打开设置、规则/排序变化或重置取消请求；预览/执行/单项操作等忙碌状态出现也取消尚未完成的请求。连接 revision/账号发生变化时旧请求不能重新夺回工作区或返回 opened。

目录仍经 POST `/storages/{storage_id}/files/list`，无新增导航端点。为核对默认云盘，DirectoryListing 最小新增可选 `drive_id: string | null`（其他 Provider 可为空）；OneDrive 仅从已有默认根目录响应 parentReference.driveId 提供，不构造、不增加请求。请求含 drive_id 时要求响应存在且逐值相同；缺失则 scope_unverified，不同则 unsupported_scope。请求缺 drive_id 仅允许服务端规范位置为 root，以兼容网页根响应尚未证实包含 drive ID 的情况；缺失 drive ID 的子目录拒绝。

每次外部目录读取采用唯一临时查询 key，保证缓存命中也发出真实请求，禁止自动重试。响应须对应 storage_id、revision、directory_id，且规范位置为 id/root；接受真实根 ID 被规范化成 root。成功后以 Provider 的规范位置接回普通目录缓存，显示后才返回 opened，并按已有会话机制保存位置。目录读取失败停留在目标的错误界面，保留真实错误和已有成功位置记忆；可用“重试读取目录”或现有连接切换，重试仍执行相同范围校验，不静默回根目录、不自动回滚。阶段二尚未完成真实扩展到本体联调。

用户建议运行：frontend 中 `npm test -- src/WorkspaceApp.externalNavigation.test.tsx src/workspace/hooks/useWorkspaceStorage.test.ts src/WorkspaceApp.storage.test.tsx`、`npm run check`；后端运行 `pytest tests/test_onedrive_provider.py`。Codex 仅静态检查，不运行这些命令。验收重点包括 Local/账号 A→B、默认/记忆位置竞争、预览释放、未知写入拒绝、并发及迟到取消、根规范化、权限失败后手动重试。

阶段二可在 Vite 开发页面的 Console 中导入内部入口进行人工验收（生产构建不暴露源码模块路径）：

```js
const { openOneDriveFolder } = await import('/src/integrations/onedrive/navigation.ts');
await openOneDriveFolder({
  version: 1, type: 'open-onedrive-folder', request_id: crypto.randomUUID(),
  account_cid: '替换为已确认的16位十六进制CID',
  folder_id: '替换为真实DriveItem ID',
  drive_id: '替换为真实默认云盘ID', // 根响应缺失时可省略；子目录不可省略
});
```

此入口假定传入值已符合上文契约；示例占位符必须替换，勿将原始个人数据贴到公开日志。只用本地开发模块调用，不安装 window 调试全局、不新增调试按钮或浏览器传输入口。使用网络节流等待目录请求时手动切换连接、进入设置，或发第二次请求，分别核对 cancelled / busy 且迟到响应不夺回工作区；在真实忙碌操作及未知结果状态下调用时应立即拒绝。

## 权限与诊断生命周期

当前只有 `scripting` 和 `https://onedrive.live.com/*` host 权限；无 all_urls、cookies、debugger、webRequest、activeTab、tabs 权限，无本体注入。本体明确允许地址预定为 `http://localhost:8000`、`http://127.0.0.1:8000`、开发用两主机的 `:5173`；后续接线只接受这些精确 origin（Chrome host 匹配模式不能约束端口时，仍须代码再次核对 origin）。本阶段无需访问本体，暂不申请该权限。

MAIN 注入使用声明的 scripting 与 OneDrive host 权限，遵循 [Chrome scripting 文档](https://developer.chrome.com/docs/extensions/reference/api/scripting)；世界隔离见 [Content scripts 文档](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)。

临时 action 只输出字段是否存在及长度，不输出邮箱、姓名、CID、目录 ID/名、URL或原始响应；不持久化数据。悬浮按钮接通后必须移除 action、debug-content 以及调试日志。扩展语言使用 Chrome en_US / zh_CN，对应本体 en-US / zh-CN。

## 用户验证

见 [扩展 README](../extensions/browser/README.md)。本阶段结束等待用户测试和真实浏览器验收后再推进。Commit 和 Push 分别需要明确批准，不直接 Push main；合并和发布由用户执行。
