# 前端 UI 阶段交接

本文以当前代码为准，供后续前端 UI 重构使用。仓库当前没有 `frontend/AGENTS.md`；开始工作前至少阅读根目录 `AGENTS.md`、本文、`API_REFERENCE.md` 和 `UI_TODO.md`。

## 当前状态

项目处于 M4。后端核心重命名流程基本完成，可操作本地目录和 OneDrive Personal。当前前端是可用的功能型界面，已经打通浏览、选择、规则链、预览、确认执行和 OneDrive 登录，但布局、交互层次、反馈状态和视觉一致性仍需整体重构。

尚未实现 RuleSet、History、Undo/Redo。不要在 UI 中把它们表现为可用能力。

## 已完成的核心功能

- `local`、`onedrive` 两个 Storage Provider。
- 可自定义并持久化本地根文件夹；当前目录浏览、目录优先、名称排序、进入子目录和返回上级。
- 选择当前目录内的文件或子文件夹名称；全选、反选。
- 有序规则链：添加、启用/禁用、上移/下移、复制、删除。
- 规则：`padding`、`replace`、`remove`、`insert`。
- Preview First：生成服务端预览、验证名称、检测批次重复和现有名称冲突。
- Execute：执行前重新验证；支持普通批量改名以及交换/循环名称的临时名处理和尽力回滚。
- OneDrive：App ID + OAuth 2.0 Authorization Code + PKCE 公共客户端登录、账号选择、令牌刷新、分页、Graph Batch、重试和限流处理。
- 统一 API 错误结构。

重命名只处理所选项目本身。选择子文件夹表示修改该文件夹名称，不会递归修改其内容。

## 架构与边界

```text
React UI
  ├─ TanStack Query：服务端状态、请求、缓存失效
  ├─ Zustand：selectedIds、rules 等 UI 工作状态
  └─ /api client
          ↓
FastAPI routes / Pydantic schemas
          ↓
File / Preview / Execute services
          ↓
Rename Engine + Rule Registry / Provider Registry
          ↓
Local filesystem 或 Microsoft Graph
```

前端负责展示、交互、选择和组装 API 请求，不应复制以下业务逻辑：

- 文件名合法性和 Provider 特有约束。
- 规则实际执行逻辑。
- 冲突、交换、循环和回滚规划。
- Preview 有效性、过期和执行前重新验证。
- Graph Token、重试、分页和批处理。

后端不保存前端布局状态，也没有“选择文件”API；选择状态由前端保存为当前目录内的 `file_id` 列表。

## 技术栈

前端：React 18、TypeScript 5.6、Vite 5、Material UI（MUI）、TanStack Query 5、Zustand 5、Vitest、Testing Library、JSDOM。

Material UI 是 UI 重构阶段确定采用的组件库。当前代码尚未使用 MUI，现有界面仍使用原生元素和 `styles.css`。

后端：Python 3.12+、FastAPI、Pydantic、httpx、SQLite/SQLAlchemy 依赖已安装但当前业务未使用数据库持久化。

开发环境中，Vite 将 `/api/*` 代理到 `http://127.0.0.1:8000/*` 并移除 `/api` 前缀。OAuth 回调是浏览器直接访问的后端地址，不经过 `/api`。

## 当前前端结构

```text
frontend/src/
├─ api/client.ts                         # fetch 封装及全部 API 调用
├─ types/index.ts                        # API 对应的 TypeScript 类型
├─ stores/useRenameStore.ts              # selectedIds、rules
├─ features/files/FileBrowser.tsx        # 目录列表、选择、导航
├─ features/rules/RuleEditor.tsx         # 规则链和 Rule Card
├─ features/rules/RuleFields.tsx         # 4 种规则配置控件
├─ features/rename/PreviewPanel.tsx       # 预览、确认、执行结果
├─ features/settings/OneDriveSettingsPanel.tsx
├─ App.tsx                               # 页面编排和请求协调
├─ styles.css                            # 全局单文件样式
└─ *.test.tsx                            # 三个核心组件的基础测试
```

## 已确定的重要设计决策

- 所有真实改名必须先 Preview，执行只提交服务端签发的 `preview_id`。
- Preview 默认有效期 10 分钟，保存在当前后端进程内；后端重启后失效。
- Preview 在文件、目录、Provider 或规则变化后应立即从 UI 清除。
- Execute 前后端都不能绕过服务端重新验证。
- 文件和文件夹可以同时选择，但必须属于同一个直接父目录。
- 规则顺序影响结果，必须始终显示明确序号。
- 扩展名语义只适用于文件；目录名称中的句点不是扩展名分隔规则。
- Provider/Rule 通过后端 Registry 扩展。前端可读取 `/rules` 元数据，但当前字段 UI 仍只支持 4 个已知规则。
- OneDrive 只需 App ID；不使用客户端密钥。登录会清除旧账号令牌并显示账号选择器。
- Refresh Token 和 App ID 保存在后端忽略提交的 `.onedrive_credentials.json`；Access Token 只在内存中。
- OneDrive 账号资料读取失败只影响账号名称显示，不应使有效授权失效。

### UI 重构技术约定

- 使用 `@mui/material` 作为基础组件库，使用 `@mui/icons-material` 提供图标。
- 使用 MUI Theme 统一 palette、typography、spacing、shape、shadows、breakpoints 和组件默认属性。
- Dialog、Snackbar、Alert、Tooltip、Drawer、Table、Card、Skeleton 等通用交互优先使用 MUI 组件。
- 优先通过 Theme、`sx`、`styled` 和组件 overrides 定制界面，不再扩展大规模全局 CSS。
- 不同时引入另一套大型 UI 组件库。
- 允许按组件逐步迁移；每完成一个组件的迁移，应删除其废弃 CSS，避免长期维护两套样式和产生优先级冲突。
- MUI 仅负责表现和交互。TanStack Query 继续管理服务端状态，Zustand 继续管理选择和规则等 UI 状态。
- UI 迁移不得改变 API 契约、RuleSpec 数据结构、查询缓存失效行为或 Preview First 安全流程。
- 响应式布局和 Dark Mode 应建立在同一套 MUI Theme 与 design tokens 上。

## UI 重构阶段不应随意修改

- `backend/app/services/rename_engine.py`
- `backend/app/services/preview_service.py`
- `backend/app/services/execute_service.py`
- `backend/app/services/preview_store.py`
- `backend/app/providers/*`
- `backend/app/rules/*`
- 当前 Pydantic API 字段、错误 code 和 Preview/Execute 语义
- OneDrive OAuth、令牌刷新和 Graph Batch 实现

UI 重构优先保持 `frontend/src/api/client.ts` 和 `frontend/src/types/index.ts` 的外部契约稳定。若只是调整布局、组件拆分或视觉状态，不应要求后端重构。

## 前端现有行为

- Provider 切换和目录变化会清空选择、预览与执行结果。
- OneDrive 未连接时不请求目录；断开后清空云端路径和相关缓存。
- 规则变化和选择变化会清除旧预览/执行结果。
- 目录复选框用于选择目录名称；点击目录名称才进入目录。
- Preview 无选择时禁用；无效预览或没有变化时禁用执行。
- Execute 使用二次确认；成功后清空选择，并在后台刷新文件列表。
- OAuth 使用弹窗和 `postMessage` 通知主窗口，主窗口会校验回调 origin。

## 当前已知问题与兼容性注意事项

- OneDrive 公共客户端登录和真实 Graph 改名仍需用户用真实账号验收。Entra 必须配置公共客户端、准确回调 URI，以及 `Files.ReadWrite`、`User.Read` 委托权限。
- 点击“网页登录/切换账号”会先删除旧 Refresh Token；若用户取消弹窗，旧会话不会恢复。
- Refresh Token 当前保存在本地 JSON。UI 不得读取、展示或记录该文件内容。
- API Client 目前只把错误 `message` 转为普通 `Error`，丢弃 `code`、`details` 和 HTTP status；重构错误体验时应先在前端保留这些字段，不需要修改后端错误结构。
- `RuleEditor` 用硬编码 `DEFAULT_RULES` 和类型分支渲染字段；后端新增规则不会自动获得 UI。
- OneDrive 文件夹路径当前为自由文本；后端统一使用无首尾斜杠的 `/` 分隔相对路径。
- 本地根文件夹支持绝对路径输入，也可通过 `POST /local/settings/pick` 唤起后端所在机器的系统目录选择器。远程或无桌面环境可能无法使用选择器，必须保留路径输入和错误反馈。
- Preview 文案写有“本地文件”，在 OneDrive 场景不准确。
- Preview 到期时间已返回但 UI 未展示；过期或文件变化会在执行时返回错误。
- `FileItem.modified_at` 已返回但未显示；文件大小目前只格式化到 B/KB。
- 页面只有基础的 780px 响应式布局，没有 Sidebar、统一 Toolbar、Dialog/Toast 系统、骨架屏或 Dark Mode；这些能力应在 MUI 重构中统一实现。
- Query loading、background refresh、empty、auth failure 和 provider failure 的视觉区分较弱。
- `App.tsx` 同时承担页面布局和流程协调，重构时可拆分，但需保留查询 key 与状态失效行为。
- 当前没有分页、搜索或排序 API；文件列表由后端一次返回当前目录全部项目，OneDrive Provider 内部会自动遍历 Graph 分页。
- 当前仓库不存在 `frontend/AGENTS.md`。

