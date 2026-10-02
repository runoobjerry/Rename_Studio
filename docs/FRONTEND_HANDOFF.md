# 前端交接文档

## 定位与接力入口

本文件记录已实现能力、架构和必须保留的交互约定，不作为任务池或逐次工作日志。生产可用 UI 基线已完成，当前处于优化与维护阶段；代码已实现不等于最新变更已通过运行验收。

开始前依次阅读：`AGENTS.md` → 本文件 → `API_REFERENCE.md` → `UI_TODO.md` → `UI_STATE.md`，然后只读取目标页面、直接关联组件/样式和对应 API 类型，不扫描整个项目。

- `FRONTEND_HANDOFF.md`：已经具备什么能力，以及维护时不能遗忘的边界和约定。
- `UI_TODO.md`：未来任务池、优先级和依赖，不保留已完成清单或当前进度。
- `UI_STATE.md`：当前工作、最近落点、验证状态和接力入口，不累积完整历史或重复长期任务池。
- `API_REFERENCE.md`：API 契约；本文件不复制完整请求/响应定义。

## 技术栈与架构

- React 18、TypeScript 5.6、Vite 5、MUI 9、Emotion、TanStack Query 5、Zustand 5；测试使用 Vitest、Testing Library 和 JSDOM。
- `frontend/src/App.tsx` 仅默认导出 `WorkspaceApp`；未使用的 `LegacyApp` 及旧 CSS 已移除。
- `WorkspaceApp.tsx` 编排查询、变更和工作区/规则选择器/设置三个内存视图；没有 URL 路由或深层链接。
- 设置与规则选择器懒加载，Vite 配置保留手动 vendor chunks。
- TanStack Query 管理服务端状态与缓存失效；Zustand 保存选择 ID 和规则链。筛选状态在组件内部，不持久化到 Store。
- `api/client.ts` 是共享 HTTP 层，`types/index.ts` 映射 API 数据。
- `theme.ts` 管理语义颜色和共享 MUI 控件样式；`styles.css` 保留布局、内部滚动、响应式组合及自定义组件几何样式，不要求整体迁移到 MUI。

## 已实现工作流

- 响应式 Drawer，支持本地文件、OneDrive 个人版和设置导航；明暗模式选择可持久化并支持系统偏好。
- 本地根路径输入与后端承载的文件夹选择器。选择器运行在后端机器上，必须保留手动路径输入。
- OneDrive App ID 保存/清理、OAuth 弹窗登录、账号切换和断开连接；回调验证来源和消息结构，前端不保存令牌。
- 目录浏览、返回上级、手动刷新、图标、文件名工具提示、修改时间、复选框选择和内部滚动。
- OneDrive 路径栏旁提供“设为默认路径”，保存当前成功打开的目录（含根目录），按 Provider ID 与稳定 `account_id` 在当前浏览器 localStorage 中隔离持久化。重新进入云盘、刷新页面后进入云盘或切换账号时恢复；新设置只覆盖对应账号。不会保存尚未提交的路径输入，不跨浏览器同步，也不改变默认启动在本地文件的行为。
- 四种规则 `padding`、`replace`、`remove`、`insert` 的字段配置，以及启用/禁用、上移/下移、复制、删除和清空规则链。
- 服务端预览、冲突/无效名称展示、MUI 执行确认 Dialog、防重复提交、逐项执行结果合并与目录后台刷新。

选中文件夹仅重命名该文件夹本身，不递归处理内容。规则集、历史记录和撤销/重做尚不可用，不得呈现为已支持功能。

## 已完成优化与必须保留的约定

### MUI、主题和规则字段

- 路径/设置/规则输入、操作按钮、上下文错误、连接状态和预览表格已迁移到 MUI；共享输入、表格、选中行和 Alert 样式归入主题。
- Checkbox、Switch 和强调类 contained 按钮使用明暗模式的 `primary` 语义颜色；浅色模式使用深绿色与白色文字，深色模式使用亮绿色与深色文字，不恢复硬编码的选中/按钮颜色。
- 设置中的破坏性操作使用 outlined 按钮，包括带边框的“清理设置”。
- 规则卡片输入和下拉值字号为 13px、输入控件高度为 38px；局部样式不影响其他页面输入。NumberStepper 使用 13px 字号与 38px 最小高度。
- NumberStepper 保留输入草稿，允许清空和编辑中的暂时越界；范围内整数即时写入规则，空值在失焦时恢复有效值，越界/小数在失焦或 Enter 时规范为范围内整数。规则配置不接收无效草稿，加减按钮保留边界限制。

### 表格、筛选与选择

- 预览表格铺满卡片；前两列按内容确定宽度，状态列承接剩余空间。长名称与错误状态在面板内横向滚动，不单独截断或溢出卡片。
- 共享带复选框的 MUI 下拉筛选菜单默认全选，采用紧凑的 13px 字号、18px 图标/复选框和 34px 菜单项；勾选时保持菜单打开。
- 文件类型筛选为文件/文件夹，位于文件操作栏最右侧；预览筛选为错误/无变化/待修改，支持筛选计数和无匹配空状态。
- **改变文件筛选本身只改变显示，不立即清除已有选择。全选和反选仅针对可见项，替换整个选择集合，不保留隐藏项。** 表头状态依据可见项计算，取消表头全选清空选择；没有可见项时禁用批量选择。
- **预览状态筛选只控制显示，不缩小执行范围；执行仍基于完整服务端预览。** 执行失败归入“错误”、跳过归入“无变化”；已修改项显示“已修改”，但保留原预览分类（通常仍位于“待修改”筛选中），没有独立完成筛选项。

### 通知、错误与加载

- `NotificationProvider` 提供底部居中的 Snackbar/Alert 队列，错误显示 8 秒，其余 5 秒，可关闭；保留上下文错误和逐项结果，不只依靠短暂通知解释失败。
- **正常预览生成不弹成功提醒；只提醒无效名称、冲突或请求失败。执行全部成功要提醒并显示已修改数量；部分失败为 warning，失败为 error。** 不要混淆预览与执行的通知偏好。
- 设置、OAuth、本地根目录切换、文件夹选择和手动刷新有结果反馈；选择器取消不报成功，后台刷新不逐次弹成功提醒。
- 首次目录/规则加载使用 Skeleton，配置/设置和后台刷新有进度反馈；后台刷新保留旧内容，刷新失败保留上下文错误。OneDrive 区分首次加载、读取失败和未连接，不能把加载或失败误报成未连接。
- 设置操作期间显示等待状态并禁用冲突操作；预览/执行按钮与确认 Dialog 有忙碌状态。
- `ApiError` 保留 HTTP `status`、`code`、`message`、`details`；非标准响应安全回退，网络错误保留原始错误，204 不解析 JSON。错误文案已识别授权失效、限流和预览过期，但专用恢复 UI 尚未完整实现。

## 代码定位

- `frontend/src/WorkspaceApp.tsx`：外壳、查询/变更、通知接入、选择和状态重置。
- `frontend/src/components/NotificationProvider.tsx`、`CheckboxFilterMenu.tsx`：共享通知与筛选菜单。
- `frontend/src/features/files/FileBrowser.tsx`：导航、文件表格、类型筛选与可见项选择。
- `frontend/src/features/files/defaultCloudPath.ts`：按云盘和账号隔离的默认目录存储；当前仅 OneDrive 有账号接口，其他云盘需在对应功能接入后使用，不能宣称已支持。
- `frontend/src/features/rules/RuleEditor.tsx`、`RuleFields.tsx`、`RulePickerPage.tsx`：规则链、字段与内置 NumberStepper、规则选择页。
- `frontend/src/features/rename/PreviewPanel.tsx`、`RenameActions.tsx`：预览/执行结果、状态筛选与确认操作。
- `frontend/src/features/settings/SettingsPage.tsx`、`OneDriveSettingsPanel.tsx`：外观和OneDrive连接设置。
- `frontend/src/api/client.ts`、`types/index.ts`、`stores/useRenameStore.ts`、`theme.ts`、`styles.css`：共享边界。

## 安全边界与已知限制

- 必须先预览，再确认执行；使用服务端生成的一次性 `preview_id`，不能由 UI 绕过执行前重校验。预览存活 10 分钟，后端重启会失效；过期时间尚未展示。
- Provider、路径、本地根目录、选择或规则变化时，保留现有查询键和预览/执行状态重置逻辑；执行响应后清除选择并刷新目录。
- 云盘目录查询键包含账号会话，恢复默认路径前暂停目录请求；账号切换清除选择/预览/执行状态。`account_id` 缺失不表示授权失败，仍可浏览，但禁用默认路径保存并提示重新登录，不以邮箱/显示名回退；存储读写失败有通知。失效的默认目录保留原设置并显示目录错误，用户可手动打开根目录或其他目录后覆盖。
- OAuth 弹窗关闭/取消跟踪尚未实现；凭据清理仍使用原生 `window.confirm`。后续任务见 `UI_TODO.md`。
- 四种规则字段为手写配置 UI；新增后端规则不会自动产生前端字段，不应擅自实现通用表单引擎。
- 没有搜索、排序或虚拟化；`/files` 没有分页/查询 API，OneDrive Graph 分页由后端聚合。
- 已有测试文件：`api/client.test.ts`、`components/NotificationProvider.test.tsx`、`features/files/FileBrowser.test.tsx`、`features/rules/RuleEditor.test.tsx`、`RuleFields.test.tsx`、`features/rename/PreviewPanel.test.tsx`、`RenameActions.test.tsx`（均相对 `frontend/src/`）。测试文件存在不代表已运行通过；工作区编排、设置/OAuth、RulePicker 和主题切换等覆盖仍待扩充。
- 默认路径回归用例位于 `frontend/src/WorkspaceApp.test.tsx` 与 `frontend/src/features/files/defaultCloudPath.test.ts`，覆盖恢复、覆盖保存、账号/云盘隔离、缺失 ID 和存储失败；运行验收状态见 STATE。

## 开发与文档维护规则

- 默认只修改 `frontend/` 和任务要求的 `docs/` 文档。不因视觉问题修改 backend、API Contract、Rename Engine、Rules、Providers、数据库或 OAuth 协议流程。
- 优先小范围局部修改，复用现有 MUI 组件和语义主题令牌，保持设计系统一致，不破坏现有响应式行为。保留复杂布局 CSS，不重新引入已完成的迁移计划。
- 默认只做静态检查，构建、测试和端到端验收由用户执行，除非明确要求运行。记录“已实现”“静态检查”“运行通过”时必须区分证据。
- 每完成明显阶段，更新 `UI_STATE.md` 的当前快照，并在 `UI_TODO.md` 移除已完成任务、补充真实发现的后续任务；长期交互约定或架构变化同步到本文件。
- STATE 只引用 TODO 任务编号及本轮接力信息；已完成基线只在本文件维护，不在三份文档重复累积历史。
