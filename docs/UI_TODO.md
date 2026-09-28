# 前端 UI 重构 TODO

标记说明：`重构现有` 表示功能已打通，只调整前端；`尚未实现` 表示可基于现有 API 完成；`后期` 表示低优先级或受缺失 API 阻塞。

UI 重构统一采用 Material UI（MUI），并以 `API_REFERENCE.md` 为契约，不改 Rename Engine、Preview/Execute、Provider 或 OAuth 核心。

## P0

- [ ] `重构现有` App Layout：将单页长布局拆为清晰的应用壳、主工作区和辅助区域，保留 Provider/path/selection/rules/preview 的失效联动。
- [ ] `尚未实现` MUI 基础设施：安装 `@mui/material`、`@mui/icons-material` 及其必要 peer dependencies，建立根级 `ThemeProvider`、`CssBaseline` 和类型安全 Theme。
- [ ] `尚未实现` MUI Theme：统一 palette、typography、spacing、shape、shadows、breakpoints、状态色和组件默认属性，作为 Light/Dark Mode 的唯一设计来源。
- [ ] `尚未实现` Sidebar：使用 MUI Drawer 承载 Provider、当前位置、OneDrive 账号状态和设置入口；移动端使用临时 Drawer。不要展示尚不可用的 History/RuleSet 导航。
- [ ] `重构现有` File Browser：建立清晰的 breadcrumb、返回上级、目录打开与项目选择交互；保持“点复选框选择目录名、点目录名称进入目录”。
- [ ] `重构现有` File Table：使用 MUI Table 统一文件/目录行、全选、反选、选中计数、名称截断、文件大小和类型表达；为 `modified_at` 预留列或详情区域。
- [ ] `重构现有` Toolbar：使用 MUI Toolbar 集中 Provider、路径、刷新、全选/反选和选中数量；OneDrive 路径仍须提交 `/` 分隔的相对路径。
- [ ] `重构现有` Local Folder 设置：保留绝对路径输入和“浏览…”系统选择器；明确选择的是后端机器目录，并覆盖取消、无桌面环境、校验失败及切换后的状态清理。
- [ ] `重构现有` Rule Editor：规则链必须保持顺序可见，支持添加、启用/禁用、排序、复制和删除；继续使用后端 `/rules` 判断可用类型。
- [ ] `重构现有` Rule Card：使用 MUI Card、表单控件和 Tooltip 改善字段分组、条件字段、校验提示和操作可达性；保持当前四类 RuleSpec 字段和值不变。
- [ ] `重构现有` Rename Preview：同时呈现原名、新名、changed/valid/conflict/error；根据当前 Provider 修正文案，不要固定写“本地文件”。
- [ ] `重构现有` Execute 确认：使用 MUI Dialog，明确 Provider、目录、变化数量和不可绕过 Preview；执行期间禁止重复提交。
- [ ] `重构现有` Conflict/Error 状态：使用一致的 Alert、Chip 和状态色区分字段配置错误、单项非法、名称冲突、Preview 过期、认证失败、限流和 Provider 故障。
- [ ] `尚未实现` API Error 类型：前端保留 HTTP status、`error.code`、`message`、`details`，替代当前只保留 message 的普通 Error。
- [ ] `重构现有` Loading 状态：使用 Skeleton、LinearProgress 或 CircularProgress 分别覆盖应用初始化、目录首次加载、后台刷新、Preview、Execute、OneDrive 设置和 OAuth 启动；避免把未连接误显示成加载中。
- [ ] `重构现有` Empty 状态：区分空目录、无选择、无规则、无 Preview、无变化和 OneDrive 未连接。
- [ ] `重构现有` OneDrive 登录：只输入 App ID；清楚区分网页登录、切换账号、断开账号、清理设置。切换前提示“开始登录会删除旧令牌”。
- [ ] `重构现有` 状态安全：Provider、路径、选择或规则变化必须清除旧 Preview 和 Execute 结果；执行成功后清空选择并刷新目录。
- [ ] `重构现有` Responsive：确保 320px 起可用，表格允许横向滚动或切换卡片模式，操作按钮不能溢出。
- [ ] `重构现有` CSS 迁移：按组件迁移 `styles.css` 到 MUI Theme、`sx`、`styled` 或 overrides；每完成一处迁移即删除对应旧规则，避免两套样式长期并存。
- [ ] `重构现有` 回归测试：保留并扩展 FileBrowser、RuleEditor、PreviewPanel 测试，覆盖新的 Dialog、错误状态和状态清理行为。

## P1

- [ ] `尚未实现` Notification：使用 MUI Snackbar + Alert 统一展示保存 App ID、登录成功/失败、断开、Preview、Execute 和后台刷新结果；错误详情仍应在相关区域保留。
- [ ] `尚未实现` Dialog 基础设施：基于 MUI Dialog 统一确认、危险操作和设置 Dialog；保持焦点管理、Escape、恢复焦点和键盘操作。
- [ ] `重构现有` OneDrive Settings：从持续占据主工作区改为 Sidebar/Settings Dialog，并持续展示当前账号和连接状态。
- [ ] `重构现有` Preview 过期体验：展示 `expires_at`，接近过期时提示，收到 `PREVIEW_EXPIRED` 后引导重新生成。
- [ ] `重构现有` Execute Result：用摘要和逐项状态替代原始英文 status 列表，清楚区分 renamed/skipped/failed/partial。
- [ ] `尚未实现` 文件显示增强：格式化 B/KB/MB/GB 和日期；提供名称 tooltip、文件/文件夹图标和选中行状态。
- [ ] `尚未实现` 可访问性：补齐表头关联、可见 focus、ARIA live 状态、按钮名称、错误关联和不依赖颜色的状态表达。
- [ ] `尚未实现` 前端组件分层：将 `App.tsx` 的查询编排与纯展示组件分开；保留现有 query key 和 Zustand 边界，避免建立单一巨型 Store。
- [ ] `尚未实现` 规则输入即时提示：依据已知规则约束显示长度和必填状态；服务端仍是最终校验来源。
- [ ] `尚未实现` Dark Mode：通过 MUI Theme mode 和 `prefers-color-scheme` 实现，并提供用户切换；确保冲突和错误状态对比度。

## P2

- [ ] `后期` RuleSet UI：等待 RuleSet API 实现后再设计保存、加载、重命名和删除；当前不得用假数据冒充持久化。
- [ ] `后期` History / Undo / Redo UI：等待 History/Undo API；当前 Execute 结果仅是本次会话响应。
- [ ] `后期` 文件搜索、排序、筛选和大目录虚拟化：当前 API 没有服务端查询参数；可先评估纯前端处理，但不要假设后端分页存在。
- [ ] `后期` 拖拽规则排序：在键盘可访问的上移/下移操作保留后再增加。
- [ ] `后期` 快捷键、批量规则模板和高级工作流。
- [ ] `后期` 动效和微交互：遵守 reduced-motion，不影响执行安全和状态可读性。
- [ ] `后期` 视觉品牌深化、插图和高级主题。

## 暂不纳入 UI 重构

- 新 Provider、数据库迁移、Rule Engine 改造。
- 修改 Preview/Execute 安全语义。
- Token、Graph Batch、重试或冲突执行算法。
- 在没有后端 API 的情况下伪造 RuleSet、History 或 Undo。

