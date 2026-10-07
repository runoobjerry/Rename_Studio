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
- `WorkspaceApp.tsx` 编排连接查询、目录位置、变更和工作区/设置两个内存视图；没有 URL 路由或深层链接。规则选择已改为主页菜单，原二级页面移除。
- 设置页面懒加载，Vite 配置保留手动 vendor chunks。
- TanStack Query 管理服务端状态与缓存失效；Zustand 保存选择 ID 和规则链。筛选状态在组件内部，不持久化到 Store。
- `api/client.ts` 是共享 HTTP 层，`types/index.ts` 映射 API 数据。
- `theme.ts` 管理语义颜色和共享 MUI 控件样式；`styles.css` 保留布局、内部滚动、响应式组合及自定义组件几何样式，不要求整体迁移到 MUI。

## 已实现工作流

- 响应式 Drawer 按存储连接导航，支持多个本地目录/OneDrive 个人版账号连接和设置；明暗模式选择可持久化并支持系统偏好。
- 本地根路径输入与后端承载的文件夹选择器。选择器运行在后端机器上，必须保留手动路径输入。
- 设置页支持连接新增、编辑和删除；仅默认 Local 不可删除。连接状态只读显示，已连接账号显示名称(邮箱)，云连接由用户添加。OneDrive App ID 可配置/清理，OAuth 弹窗登录、账号切换和断开均关联连接；回调验证来源、弹窗和消息结构，前端不保存令牌。
- 目录浏览、返回上级、手动刷新、图标、文件名工具提示、修改时间、复选框选择和内部滚动。
- OneDrive 路径栏旁提供“设为默认路径”，保存当前成功打开的目录位置（含根目录），按 storage_id 与稳定 account_id 在浏览器 localStorage 中隔离。不再读取旧 Provider/账号路径；云连接由用户创建，唯一默认连接为 Local Files。重新进入连接或切换账号时恢复；不保存未提交输入，不跨浏览器同步，默认启动仍为 default-local。
- 四种规则 `padding`、`replace`、`remove`、`insert` 的字段配置，以及启用/禁用、上移/下移、复制、删除和清空规则链。
- 规则标题栏左侧“一键清除”、右侧“添加规则”；添加按钮打开紧凑 MUI 菜单，每项 34px/13px，最多同时显示八项，超出滚动显示，Tooltip 展示描述。选择后追加独立配置到规则链末尾、关闭菜单并恢复按钮焦点，不切换页面；使用现有 `onChange` 重置旧预览/执行结果，仅展示前端已适配的规则。
- 服务端预览、冲突/无效名称展示、MUI 执行确认 Dialog、防重复提交、逐项执行结果合并与目录后台刷新。

选中文件夹仅重命名该文件夹本身，不递归处理内容。规则集、历史记录和撤销/重做尚不可用，不得呈现为已支持功能。

## 已完成优化与必须保留的约定

### MUI、主题和规则字段

- 路径/设置/规则输入、操作按钮、上下文错误、连接状态和预览表格已迁移到 MUI；共享输入、表格、选中行和 Alert 样式归入主题。
- Checkbox、Switch 和强调类 contained 按钮使用明暗模式的 `primary` 语义颜色；浅色模式使用深绿色与白色文字，深色模式使用亮绿色与深色文字，不恢复硬编码的选中/按钮颜色。
- 设置中的破坏性操作使用 outlined 按钮，包括带边框的“清理设置”。
- 规则卡片输入和下拉值字号为 13px、输入控件高度为 38px；局部样式不影响其他页面输入。NumberStepper 使用 13px 字号与 38px 最小高度。
- NumberStepper 保留输入草稿，允许清空和编辑中的暂时越界；范围内整数即时写入规则，空值在失焦时恢复有效值，越界/小数在失焦或 Enter 时规范为范围内整数。规则配置不接收无效草稿，加减按钮保留边界限制。
- 所有 MUI Menu（含 Select 弹出菜单）统一由 `theme.ts` 的 `MuiMenu`/`MuiMenuItem` 控制：菜单内侧留白 4px、项目间距 2px、项目外边距 0、内边距上下 4px/左右 12px、行高 34px、字号 13px，菜单圆角 10px。`MENU_METRICS` 是可见条数计算的共享几何参数；以后新增菜单默认继承主题，不重复覆盖间距。规则添加菜单八项视窗为 294px（含留白和间距），较矮视口仍由 MUI 限制弹层尺寸。

### 表格、筛选与选择

- 文件/预览面板的图标按钮（含筛选）复用 `components/PanelIconButton.tsx`：默认颜色 `text.secondary`、图标 20px、内边距 5px、无边框，禁用时沿用 MUI 状态色；新增面板操作也复用此组件。筛选仅在启用时覆盖为 `primary.main`，尺寸与间距不单独定义。文件工具栏不再提供“全选”按钮，由表头复选框全选；反选为带 Tooltip 的 `assets/icon/select-inverse.svg` 图标，用遮罩继承当前颜色。
- 预览表格铺满卡片；前两列按内容确定宽度，状态列承接剩余空间。长名称与错误状态在面板内横向滚动，不单独截断或溢出卡片。
- 共享带复选框的 MUI 下拉筛选菜单默认不勾选任何项，此时不过滤、显示全部。入口复用 PanelIconButton 并带状态 Tooltip；无勾选使用 `FilterListOff` 和 `text.secondary`，任意勾选使用 `FilterList` 和主题强调色 `primary.main`（适配明暗模式）。全部勾选仍属于筛选状态，取消最后一项恢复不过滤；菜单采用紧凑的 13px 字号、18px 复选框和 34px 菜单项，勾选时保持打开。
- 文件类型筛选为文件/文件夹，位于文件操作栏最右侧；预览筛选为错误/无变化/待修改，支持筛选计数和无匹配空状态。
- **改变文件筛选会清除被隐藏项的选择，保留仍可见项的选择；取消筛选不恢复旧选择。全选和反选仅针对可见项，替换整个选择集合，不保留隐藏项。** 表头状态依据可见项计算，取消表头全选清空选择；没有可见项时禁用批量选择。
- 目录成功刷新后，选中 ID 与完整目录取交集：移除已删除/移出的项、不自动选择新增项；选择收缩使旧预览失效，执行中的请求与进度不重置。读取失败保留选择，预览请求和操作区计数只使用当前目录中仍存在的选中项。
- **预览状态筛选只控制显示，不缩小执行范围；执行仍基于完整服务端预览。** 执行失败归入“错误”、跳过归入“无变化”；已修改项显示“已修改”，但保留原预览分类（通常仍位于“待修改”筛选中），没有独立完成筛选项。

### 通知、错误与加载

- `NotificationProvider` 提供底部居中的 Snackbar/Alert，所有级别统一 5 秒自动关闭（沿用 MUI 的悬停/窗口失焦暂停行为）。新通知立即显示，不排队；旧通知原地淡出，新通知同步进入。出现使用 Grow（225ms），正常超时/关闭反向 Grow 退出（180ms），被替换时仅淡出。退出结束才移除节点，旧计时/退出回调不影响新通知；淡出节点不接收交互或重复播报。保留上下文错误和逐项结果，不只依靠短暂通知解释失败。
- **正常预览生成不弹成功提醒；只提醒无效名称、冲突或请求失败。执行全部成功要提醒并显示已修改数量；部分失败为 warning，失败为 error。** 不要混淆预览与执行的通知偏好。
- 设置、OAuth、本地根目录切换、文件夹选择和手动刷新有结果反馈；选择器取消不报成功，后台刷新不逐次弹成功提醒。
- 首次目录/规则加载使用 Skeleton，配置/设置和后台刷新有进度反馈；后台刷新保留旧内容，刷新失败保留上下文错误。OneDrive 区分首次加载、读取失败和未连接，不能把加载或失败误报成未连接。
- 设置操作期间显示等待状态并禁用冲突操作；预览按钮有加载文案，执行期间禁用执行/确认操作，“开始修改”和“应用”保持固定文案。
- 执行确认 Dialog 标题使用 `phaseLabels` 对应阶段（初始“等待执行”），不重复显示独立状态文字；应用前保留不可恢复警告，应用后正文为“当前任务已处理 ${processed} 项目，共 ${total} 项”。轮询失败时正文替换为“暂时无法读取进度：${progressError}；执行请求仍在进行，请勿重复提交。”，实际执行失败单独说明，避免误称仍在进行；进度条轨道透明，仅保留强调色已处理部分。
- “确认修改”Dialog 底部有强调色 Linear determinate 进度条与已处理计数。用户授权新增只读 `GET /rename/progress/{preview_id}`，前端仅在执行 POST 等待期间每 500ms 轮询；不模拟增长，不因轮询失败重新执行。计数是已处理的变更项（包括失败），临时名称不计入完成；100%不代表全部成功，逐项结果仍为准。收到执行响应后显示100%约600ms再关闭卡片。保留重校验、一次性预览、串行执行锁与回滚规则；进度仅进程内保存，终止后保留10分钟，详情见 API_REFERENCE。
- `ApiError` 保留 HTTP `status`、`code`、`message`、`details`；非标准响应安全回退，网络错误保留原始错误，204 不解析 JSON。错误文案已识别授权失效、限流和预览过期，但专用恢复 UI 尚未完整实现。

## 代码定位

- `frontend/src/WorkspaceApp.tsx`：外壳、查询/变更、通知接入、选择和状态重置。
- `frontend/src/components/NotificationProvider.tsx`、`CheckboxFilterMenu.tsx`：共享通知与筛选菜单。
- `frontend/src/components/PanelIconButton.tsx`：文件/预览面板图标按钮的共享外观；有状态控件可局部覆盖状态颜色，不重复定义尺寸和间距。
- `frontend/src/features/files/FileBrowser.tsx`：导航、文件表格、类型筛选与可见项选择。
- `frontend/src/features/files/defaultCloudLocation.ts`：按连接/账号隔离的默认目录位置；不宣称已支持其他云盘。
- `frontend/src/features/rules/RuleEditor.tsx`、`RuleFields.tsx`：规则链、主页添加菜单、字段与内置 NumberStepper；旧 `RulePickerPage.tsx` 已删除，不重新引入。
- `frontend/src/features/rename/PreviewPanel.tsx`、`RenameActions.tsx`：预览/执行结果、状态筛选与确认操作。
- `frontend/src/features/settings/SettingsPage.tsx`、`StorageSettingsPanel.tsx`：外观、多连接配置和授权；仅使用连接级 API，旧 OneDriveSettingsPanel 已删除。
- `frontend/src/api/client.ts`、`types/index.ts`、`stores/useRenameStore.ts`、`theme.ts`、`styles.css`：共享边界。

## 安全边界与已知限制

- 必须先预览，再确认执行；使用服务端生成的一次性 `preview_id`，不能由 UI 绕过执行前重校验。预览存活 10 分钟，后端重启会失效；过期时间尚未展示。
- 查询键包含 storage_id、revision 和 location；目录/上级导航使用后端返回位置。连接、目录、账号、根目录、选择或规则变化使旧预览失效，规则链保留；过时目录/预览响应不能覆盖当前上下文。执行响应后清除选择并刷新目录，执行期间保留请求与进度并禁用冲突操作。
- 云盘查询在默认目录恢复前暂停；连接版本/账号切换后隔离缓存与旧预览。account_id 缺失不表示授权失败，仍可浏览但禁用默认目录保存，不以邮箱/显示名回退；失效默认目录保留设置并显示读取错误，用户可手动打开根目录后覆盖。
- 连接面板跟踪弹窗关闭并使用 MUI Dialog 确认删除；仅 default-local 禁止删除，云连接均可删除。连接状态使用只读标记，已连接账号显示名称(邮箱)，不提供启停。
- 四种规则字段为手写配置 UI；新增后端规则不会自动产生前端字段，不应擅自实现通用表单引擎。
- 没有搜索、排序或虚拟化；连接级目录接口没有分页/查询 API，OneDrive Graph 分页由后端聚合。
- 已有测试文件：`api/client.test.ts`、`components/NotificationProvider.test.tsx`、`features/files/FileBrowser.test.tsx`、`features/rules/RuleEditor.test.tsx`、`RuleFields.test.tsx`、`features/rename/PreviewPanel.test.tsx`、`RenameActions.test.tsx`（均相对 `frontend/src/`）。测试文件存在不代表已运行通过；工作区编排、设置/OAuth 和主题切换等覆盖仍待扩充。添加规则用例已改为主页菜单，并补充按钮顺序、Tooltip、八项滚动上限、焦点恢复和独立配置检查。
- `frontend/src/theme.test.tsx` 检查明暗主题下标准 Menu、Select、筛选和规则添加菜单继承一致的间距；不以样式用例替代实际视觉验收。
- 默认路径回归用例位于 `frontend/src/WorkspaceApp.test.tsx` 与 `frontend/src/features/files/defaultCloudLocation.test.ts`，覆盖恢复、覆盖保存、账号/云盘隔离、缺失 ID 和存储失败；运行验收状态见 STATE。

## 开发与文档维护规则

- 默认只修改 `frontend/` 和任务要求的 `docs/` 文档。不因视觉问题修改 backend、API Contract、Rename Engine、Rules、Providers、数据库或 OAuth 协议流程。
- 优先小范围局部修改，复用现有 MUI 组件和语义主题令牌，保持设计系统一致，不破坏现有响应式行为。保留复杂布局 CSS，不重新引入已完成的迁移计划。
- 默认只做静态检查，构建、测试和端到端验收由用户执行，除非明确要求运行。记录“已实现”“静态检查”“运行通过”时必须区分证据。
- 每完成明显阶段，更新 `UI_STATE.md` 的当前快照，并在 `UI_TODO.md` 移除已完成任务、补充真实发现的后续任务；长期交互约定或架构变化同步到本文件。
- STATE 只引用 TODO 任务编号及本轮接力信息；已完成基线只在本文件维护，不在三份文档重复累积历史。
