# Browser Integration v1

本文件是浏览器消息协议的事实来源，后续阶段变更必须同步维护。消息不是 HTTP API，不新增 REST 端点。

## 当前交付与支持范围

阶段一建立提取和协议，阶段二建立本体导航业务入口，阶段三接通独立悬浮按钮、ready 握手与消息桥。阶段一临时 action、debug-content 和调试日志已移除。源码及必要模拟回归已编写；真实扩展端到端验收仍由用户执行，不将静态检查表述为联调通过。

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

传输封装命名空间固定为 `rename-studio.browser.v1`。本体不可信消息入口为 browserBridge.ts，校验来源、版本、类型、request_id 和完整载荷后，再调用 `frontend/src/integrations/onedrive/navigation.ts` 的 `openOneDriveFolder`。后者仍只接收已校验内部类型。本集成没有外部扩展消息入口、HTTP 导航端点或特权代理接口。

`accepted` 仅表示已接收，不表示目录已打开；只有现有目录 API 成功返回规范位置、当前工作区显示对应目录后才能回复 `opened`。最终结果保留相同 request_id；每次点击生成新 ID，只处理当前请求，忽略迟到结果，不承诺幂等、不持久化排队、不自动重放。阶段二内部入口返回最终结果 Promise，可选回调接收 accepted；同步匹配或保护失败直接 rejected，不先发送 accepted。

入口拒绝额外字段。字符串必须非空且不含 ASCII 控制字符；长度上限按 JS UTF-16 code units：request_id 64（仅 ASCII 字母、数字、`_`、`-`），account_cid 恰好 16 位十六进制，folder_id / drive_id 各 256，邮箱 320，姓名/目录名各 256。所有可选字段存在时也须满足边界。不把 folder_id 当路径处理，不修剪、重编码或改写不透明 ID。当前边界面向个人版适配，真实扩展验证发现不符时须更新本文件和校验器。

禁止传递 Token、Cookie、页面完整上下文、任意 API URL、文件列表、规则或可执行脚本。显示数据不是身份，不以邮箱或姓名兜底绑定，不建持久化映射。

## 账号、云盘与位置

后续仅在现有 `provider_type === "onedrive"` 连接中按 account_cid 匹配 account_id；仅在双方均已确认十六进制时忽略大小写，保留前导零。不推断十进制转换，不把该语义推广到其他 Provider。找不到唯一匹配时要求用户添加/检查连接。

storage_id 为独立连接 ID，不硬编码、不由 CID 构造。account_cid、drive_id、folder_id 分别保留语义，不假定 account_id 等于 drive_id。后续默认云盘核对应优先复用已有元数据，确需补读时在 Provider 内完成；前端不调用 Graph、不接收网页 Cookie。

目录提交 `{ kind: "id", value: folder_id }`，成功采用 Provider 规范位置；根目录也提交真实返回 ID，不拼造 root ID。阶段一不修改通用模型、后端 API、凭据或重命名工作流。

## 页面提取边界

`src/onedrive-page.js` 是唯一页面适配模块，通过 scripting 在 MAIN 执行完整读取与同源 GET。普通 ISOLATED 内容脚本不读取网页全局；OneDrive 内容脚本只接收 accepted 和有界结果，worker 负责校验 MAIN 返回值后投递有界目标。本体内容脚本只桥接该目标及有界回复。页面内部实现不是微软公共稳定契约，当前 Console 实测不能当作真实扩展联调已通过。

每次读取当前 URL、`_spPageContextInfo` 的 userHexCid / userCid、webAbsoluteUrl、listUrl，以及可选 userEmail、userDisplayName；邮箱缺失时读取 `$Config.email`。不用 `$Config.isAuthenticated` 判断登录。userHexCid 按明确十六进制字段处理；只有 userCid 时，仅接受恰好 16 位且含 A–F 的十六进制字符串，纯数字或数字类型明确失败，不猜进制。

仅允许精确 `/my` 或 `/my/` 路径、无 hash。查询参数白名单为 id、viewid（GUID）、cid（须匹配上下文 CID）、o、sortField、isAscending，禁止重复键；其他模式保守拒绝，待实测再扩展。无 id 时使用 listUrl；有 id 时 URLSearchParams 仅解码一次，作为服务器相对路径。webAbsoluteUrl 必须为 `https://onedrive.live.com/personal/{site}`，listUrl 必须位于该站点内，目标必须等于 listUrl 或位于 `listUrl + '/'` 边界内；拒绝空段、`.`、`..` 和反斜杠。

根目录 GET `{webAbsoluteUrl}/_api/v2.0/drive/root`；子目录 GET `.../drive/root:/{relativePath}`，每段独立 encodeURIComponent，带 `credentials: include` 和 `Accept: application/json;odata=nometadata`，禁止重定向，整次提取 10 秒超时，不自动重试。检查 HTTP、id、folder，拒绝 remoteItem 快捷方式。根目录和子目录提取均只读取目标目录一次；子目录不额外请求默认根目录，但必须包含 parentReference.driveId，缺失则 scope_unverified。根目录自身提取允许该字段缺失，绝不由 CID 构造 drive ID。默认云盘一致性由本体收到目录响应后核对，规则见下文阶段二说明。

仅在用户点击后提取；提取期间监听 Navigation API、popstate、hashchange，并每 50ms 重读 URL/账号/上下文，结束即清理；fetch 和 JSON 解析后及返回前再次比较。发现变化即中止并返回 page_changed，要求重新点击。worker 在标签页查找前保存当前 URL，查找后和提取后重新核对，以来源 documentId 绑定 MAIN 注入和 accepted 回传。整页跳转导致文档消失时不向新页面投递旧结果；没有持续浏览记录收集或后台 URL 轮询。

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

WorkspaceApp 使用独立 useOneDriveNavigation 显式连接 storage 与 rename Hook，两个 Hook 不互相调用。入口使用前端已有连接列表匹配真实 storage_id，并检查能力、忙碌及已有授权缓存，不再主动调用 fetchStorages 或 fetchStorageAuthStatus 复核；初步检查失败不更换工作区。若目标尚无授权缓存，由原有连接切换的 React Query 查询完成首次初始化；已有缓存在本次 pending 期间复用，不额外刷新。实际授权和访问权限仍由目录 API 判断，其错误码原样返回。仅内部当前请求有效，不排队；pending 期间重复请求返回 busy。未知记录在任何清理之前检查，提示先核对。

useWorkspaceStorage.openExternalTarget 一次安装目标连接、版本、账号就绪标记和 ID 位置。pending 期间暂停记忆/默认位置恢复；外部位置优先级仅限本次请求，不调用默认位置保存 API。离开时释放旧预览、清选择/任务，保留规则。手动位置/连接切换、打开设置、规则/排序变化或重置取消请求；预览/执行/单项操作等忙碌状态出现也取消尚未完成的请求。连接 revision/账号发生变化时旧请求不能重新夺回工作区或返回 opened。

目录仍经 POST `/storages/{storage_id}/files/list`，无新增导航端点。为核对默认云盘，DirectoryListing 最小新增可选 `drive_id: string | null`（其他 Provider 可为空）；OneDrive 仅从已有默认根目录响应 parentReference.driveId 提供，不构造、不增加请求。请求含 drive_id 时要求响应存在且逐值相同；缺失则 scope_unverified，不同则 unsupported_scope。请求缺 drive_id 仅允许服务端规范位置为 root，以兼容网页根响应尚未证实包含 drive ID 的情况；缺失 drive ID 的子目录拒绝。

每次外部目录读取采用唯一临时查询 key，保证缓存命中也发出真实请求，禁止自动重试。响应须对应 storage_id、revision、directory_id，且规范位置为 id/root；接受真实根 ID 被规范化成 root。成功后以 Provider 的规范位置接回普通目录缓存，显示后才返回 opened，并按已有会话机制保存位置。目录读取失败停留在目标的错误界面，保留真实错误和已有成功位置记忆；可用“重试读取目录”或现有连接切换，重试仍执行相同范围校验，不静默回根目录、不自动回滚。

用户建议运行：frontend 中 `npm test -- src/WorkspaceApp.externalNavigation.test.tsx src/workspace/hooks/useWorkspaceStorage.test.ts src/WorkspaceApp.storage.test.tsx`、`npm run check`；后端运行 `pytest tests/test_onedrive_provider.py`。Codex 仅静态检查，不运行这些命令。验收重点包括 Local/账号 A→B、默认/记忆位置竞争、预览释放、未知写入拒绝、并发及迟到取消、根规范化、权限失败后手动重试。

阶段二的 Console 手动构造目标验收方法已由阶段三悬浮按钮替代；内部业务函数继续供消息桥与回归测试使用，不作为用户调试入口。

## 阶段三：传输、就绪与生命周期

发布构建只允许 `http://localhost:8000`，开发构建显式指定 `http://localhost:5173`，每次构建只含一个本体 origin；本体桥分别使用 Vite 的生产/开发配置，与扩展构建对应。127.0.0.1、其他端口和公网地址不支持，不扫描端口。扩展需要构建后加载 dist/production 或 dist/development，不再直接加载源码目录。

内容脚本 → worker 只发送 `{namespace, type:'open-current-folder', request_id}`，不接收来自网页的任意 URL、方法、API 请求或代码。worker 校验 extension ID、OneDrive origin、顶层 frame、普通窗口及来源 documentId，每个来源标签页同时仅一个请求。先查询 localhost 标签页并精确过滤构建 origin，然后分别发送 `{namespace, version:1, type:'probe', request_id}`（1.5 秒内等待）；回复必须为 `{namespace, version:1, type:'ready', project:'rename-studio', request_id, instance_id}`。本体业务入口挂载后才答 ready。标题和域名命中本身不算项目就绪；零个就绪页返回 workspace_not_found，多个返回 multiple_workspaces，不广播导航、不新建标签页。

本体 ISOLATED 内容脚本的 instance_id 为本次文档生成的随机 UUID；worker 导航投递携带该值，刷新后的内容脚本不会接收旧文档的投递。该值用于文档关联，不是同源网页不可伪造的认证凭据。只有唯一就绪页才继续 MAIN 提取，worker 校验结果后向该页顶层发送 `{namespace, version:1, type:'navigate', request_id, instance_id, request}`。

window.postMessage 桥固定准确 targetOrigin，包裹格式如下：

```ts
// extension → app
{ namespace, direction: 'extension-to-app', version: 1, type: 'probe', request_id }
{ namespace, direction: 'extension-to-app', version: 1, type: 'navigate', request_id, request }
// app → extension
{ namespace, direction: 'app-to-extension', version: 1, type: 'ready', request_id, project: 'rename-studio' }
{ namespace, direction: 'app-to-extension', version: 1, type: 'navigation-reply', request_id, reply }
```

两端均核对 event.source 为当前 window、event.origin 为构建 origin、方向、命名空间、版本、类型和 request_id。目标入口拒绝额外字段并沿用 v1 长度限制；回复仅允许有界 accepted/opened/rejected，opened 的 storage_id 上限 256、拒绝码为 1–64 位 ASCII 字母数字/下划线。无回声转发、无 `*` targetOrigin。同源检查与 ready 标记不证明消息一定来自扩展，也不防御控制了相同 origin 的恶意网页；桥只接受受限目录导航意图，账号、连接、授权和范围仍由业务入口与现有 Provider 核对，不提供凭据或通用 API 能力。

校验按实际信任边界执行：worker 校验 MAIN 提取结果，本体应用校验网页导航意图，本体内容脚本校验网页回复。经过校验的目标和回复在扩展内部转发时不再完整校验载荷；继续保留路由、来源、请求关联和文档 instance 检查。Chrome 提供的 sender ID 类型不另设格式或长度限制。空回执/断连仍属于未确认结果。提取器只将明确的页面/API 失败转换为协议码，程序异常正常暴露，不统一伪装为页面格式错误。

业务并发由 useWorkspaceStorage 的当前操作引用同步占用，重复调用在 accepted 之前直接拒绝；integration Hook 不再维护第二份并发锁。消息桥与扩展的 pending 仅管理各自通信关联和超时，不承担业务锁。目录结果只在查询边界验证一次 Folder ID、Drive ID、根范围与连接 ID/版本；回填普通缓存后不重复验证相同响应。一个导航 effect 持续观察当前连接身份、版本、授权会话及忙碌状态变化以取消旧请求，保留手动操作与卸载取消机制。普通连接轮询和查询行为保持原有方式，不增加刷新请求。

本体内容脚本收到 accepted 时向 worker 发送 `{namespace, type:'navigation-accepted', request_id, instance_id}`。worker 只接受当前目标标签页/顶层 frame/精确 origin/extension ID/文档 instance 的关联消息，最多激活一次目标标签页及窗口，并向来源 documentId 发送 `{namespace, type:'accepted', request_id}`。标签页激活为 UI 操作，其失败不改变目录操作的真实结果；本体内容脚本等待此回传处理完成后再结束最终结果通道，避免极快完成时漏掉激活。仅 opened 显示跳转成功，本体和来源分别使用自己的语言显示最终结果；业务错误码不改写为统一目录不存在。

通信采用一次 runtime.sendMessage 的最终响应通道和一次 accepted 事件，不使用长连接、定时保活或持久消息队列。worker 的请求映射只保存在本次运行内存，最终回执/超时即清理，重启或来源关闭不重放。提取自身 10 秒、注入等待最多 12 秒；本体内容脚本等待结果 19.5 秒，worker 20 秒，来源整体 35 秒。本体窗口桥 20 秒清理通信状态并显示未确认提示，真实业务请求仍由阶段二的状态和取消规则管理。

投递后的失联、非最终回执或超时返回扩展传输结果 `{transport:'unconfirmed', code:'result_timeout'}`；该 code 表示没有收到打开结果，不代表目录操作失败，固定提示“未收到打开结果，请查看 Rename Studio”。投递前的明确提取/范围/本体查找错误为 `{transport:'rejected', code}`，保留其真实 code。来源等待结束即解绑 request_id；应用/内容脚本通过当前 entry 身份丢弃迟到回复，不覆盖后续请求、不自动重试。扩展实际断连也使用未确认语义，不假定 worker 永远运行。

## 权限与界面

OneDrive 页面增加独立 `material.js` 内容脚本，在 MAIN / document_start 仅注册 Material 自定义元素；原 `onedrive.js` 显式运行在 ISOLATED / document_idle，仅创建 DOM、处理交互和使用扩展通信。Chromium 的 ISOLATED 中 customElements 为 null，不在该环境导入自动注册的 Material 入口。此拆分不向 MAIN 提供 Chrome API、消息转发能力或账号目录数据，也不扩大 host 权限；原有按点击执行的 MAIN 提取模块保持独立。

仅 `scripting`、`https://onedrive.live.com/*` 与 `http://localhost/*` host 权限；无 all_urls、cookies、debugger、webRequest、activeTab、tabs 权限。Chrome match pattern 不表达端口，故 localhost 内容脚本匹配与 host 权限一致，但在执行任何桥接前必须精确核对构建 origin；worker 候选筛选同样精确核对。只在已获 host 权限的标签页读取 URL。最低 Chrome/Edge 111（静态 MAIN 内容脚本），生命周期不依赖永久 worker。

MAIN 注入使用声明的 scripting 与 OneDrive host 权限，遵循 [Chrome scripting 文档](https://developer.chrome.com/docs/extensions/reference/api/scripting)；世界隔离见 [Content scripts 文档](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)。

右中间默认 44px 圆角正方形，拖拽移动不导航，resize 后留边并限制在窗口内，无位置持久化。原生 button 提供 Tab 焦点、Enter/Space，显式名称、焦点样式、tooltip 和 aria-live 短提示；pending 拦截重复点击并展示 `@material/web` md-circular-progress。md-icon 使用内嵌 Material open_in_new SVG，不依赖远程字体；配色取本体 theme.ts 的绿色、背景与圆角。支持视图无法单凭静态 URL 完全判定，按钮保留，点击后由适配器明确拒绝不支持视图，绝不默认打开根目录。按钮挂在 documentElement 下以避开 SPA body 替换，仅观察根的直接子节点以保证单实例，不后台轮询。

临时 action、debug-content、调试名称/文案和所有提取日志均已删除。不输出/持久化邮箱、姓名、CID、目录 ID/名、URL或原始响应。扩展使用 Chrome en_US / zh_CN，本体使用现有 i18next en-US / zh-CN。Material 组件按 [官方 Icon](https://github.com/material-components/material-web/blob/main/docs/components/icon.md) 与 [Progress](https://github.com/material-components/material-web/blob/main/docs/components/progress.md) 文档使用。生命周期参考 [Chrome 文档](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)，不通过保活规避其限制。

## 用户验证

见 [扩展 README](../extensions/browser/README.md)。本阶段结束等待用户测试和真实浏览器验收后再推进。Commit 和 Push 分别需要明确批准，不直接 Push main；合并和发布由用户执行。
