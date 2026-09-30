# 前端交接文档

## 当前状态

生产可用的 UI 基线已完成。当前阶段：优化、统一性、性能、可访问性和可维护性。

当前可用的前端支持本地文件和 OneDrive 个人版，覆盖从文件浏览到经预览确认后执行重命名的完整流程。规则集（RuleSet）、历史记录（History）和撤销/重做（Undo/Redo）尚不可用，不得将其呈现为可用功能。

## 技术栈

- React 18 和 TypeScript 5.6
- Vite 5
- Material UI 9 和 Emotion
- TanStack Query 5
- Zustand 5
- Vitest、Testing Library 和 JSDOM

## 当前架构

- `src/App.tsx` 仅用于默认导出 `WorkspaceApp`，保持最小化；未使用的旧版应用已移除。
- `WorkspaceApp.tsx` 负责查询/变更编排以及三个内存视图：工作区、规则选择器和设置。当前没有 URL 路由器或深层链接路由。
- 设置和规则选择器视图采用懒加载。
- `features/` 包含文件浏览、规则编辑、重命名预览/操作以及设置 UI。
- TanStack Query 负责服务端状态和缓存失效。Zustand 仅存储已选择的 ID 和当前规则链。
- `api/client.ts` 是唯一的前端 HTTP 层；`types/index.ts` 映射 API 响应结构。
- `theme.ts` 定义明暗模式的语义颜色和共享 MUI 覆盖样式。`styles.css` 仅用于页面布局、内部滚动、响应式组合和自定义组件几何样式。

## 已实现功能

- 带有本地文件、OneDrive 和设置导航的响应式 MUI Drawer。
- 根据用户选择和系统偏好持久化明暗模式。
- 本地根路径输入以及由后端承载的文件夹选择器。
- OneDrive App ID 设置、OAuth 弹窗登录、账号切换、断开连接和凭据清理。
- 目录浏览、返回上级目录、手动刷新、文件/文件夹图标、名称工具提示、修改时间和表格内部滚动。
- 文件和文件夹选择，支持行复选框、全选、反选、已选数量，以及上下文变化时重置选择。
- 用于 `padding`、`replace`、`remove` 和 `insert` 的规则选择器及有序规则链。
- 规则启用/禁用、上移/下移、复制、删除和全部清除控件。
- 服务端生成的重命名预览，可呈现已更改、未更改、无效以及冲突/错误状态。
- 预览优先执行、MUI 确认 Dialog、防止重复提交、将逐项执行状态合并到预览表格、清除选择以及后台刷新目录。
- 基础的加载、空状态、错误、禁用、工具提示和响应式状态。

重命名选中的文件夹只会更改该文件夹的名称；不会递归重命名其中的内容。

## 重要组件

- `frontend/src/WorkspaceApp.tsx` — 应用外壳、视图状态、查询、变更和缓存失效规则。
- `frontend/src/features/files/FileBrowser.tsx` — 目录表格、导航和选择。
- `frontend/src/features/rules/RuleEditor.tsx` — 有序规则链和规则操作。
- `frontend/src/features/rules/RuleFields.tsx` — 四种受支持规则类型的配置 UI。
- `frontend/src/features/rules/RulePickerPage.tsx` — 次级规则选择页面。
- `frontend/src/features/rename/PreviewPanel.tsx` — 预览和合并后的执行结果。
- `frontend/src/features/rename/RenameActions.tsx` — 预览/执行按钮和确认 Dialog。
- `frontend/src/features/settings/SettingsPage.tsx` 和 `OneDriveSettingsPanel.tsx` — 外观和 OneDrive 设置。
- `frontend/src/api/client.ts`、`frontend/src/types/index.ts`、`frontend/src/stores/useRenameStore.ts`、`frontend/src/theme.ts` 和 `frontend/src/styles.css` — 共享边界。

## 稳定区域

- 后端 API 契约和 Pydantic 字段名称。
- 预览优先安全模型和使用一次性 `preview_id` 执行。
- Rename Engine、Rule Registry、Provider Registry、冲突规划和回滚行为。
- 本地和 OneDrive Provider 行为、OAuth 流程、令牌刷新、Graph 分页/批处理、重试和限流处理。
- Provider、路径、选择、规则或本地根目录变化时的查询键和状态清除行为。

除非任务明确要求，否则 UI 优化不应修改这些区域。

## 已知限制

- `api/client.ts` 的 `ApiError` 保留 HTTP status、code、message 和 details，兼容现有 `error.message`；网络失败保留原始错误。界面尚未按错误代码提供分类恢复。
- `components/NotificationProvider.tsx` 提供共享 Snackbar/Alert 队列，覆盖设置、OAuth、预览、执行、本地目录切换和手动刷新结果；上下文错误仍保留。
- 未显示预览的 `expires_at`，且 `PREVIEW_EXPIRED` 没有专用的恢复 UI。
- 初始目录、配置、规则和设置有 Skeleton/进度提示，后台刷新保留已有内容；OneDrive 状态区分加载、读取失败和未连接。OAuth 弹窗关闭/取消跟踪尚未实现。
- 四种规则字段布局均为手写实现。后端新增到 `/rules` 的规则不会自动获得前端字段。
- `styles.css` 现在专注于页面布局、内部滚动、响应式组合和自定义组件几何样式；共享控件样式位于 MUI 主题中。
- 前端自动化测试覆盖 FileBrowser、RuleEditor、PreviewPanel、RenameActions 和 API 客户端。工作区编排、设置、RulePicker、主题切换以及错误/加载流程尚未覆盖；新增客户端用例待用户运行。
- 前端支持文件类型和预览状态的多选展示筛选，默认全选。筛选本身只改变显示；全选/反选仅使用可见文件项并替换选择集合，不保留隐藏选择，表头取消全选清空选择。重命名执行仍按完整预览进行。没有搜索、排序、虚拟化、规则集（RuleSet）、历史记录（History）、撤销（Undo）或重做（Redo）。`/files` 没有分页/查询 API；OneDrive Graph 分页由后端聚合。

## 开发规则

- 默认只修改 `frontend/` 下的内容以及 `docs/` 下的文档。
- 不要因视觉问题修改后端、API 契约、Rename Engine、Rules、Providers、数据库或 OAuth 流程。
- 保持预览优先以及现有的查询失效/状态重置行为不变。
- 编辑前先阅读目标页面、其直接关联的组件/样式，以及 `API_REFERENCE.md` 中的相关章节。
- 优先进行小范围局部修改，并复用现有 MUI 组件和语义主题令牌。
- 不要重新引入已完成的 UI 迁移计划，也不要暴露后端尚不可用的能力。
- 默认仅执行静态检查；除非用户明确要求，否则由用户运行构建和测试。
