# UI 当前工作快照

更新日期：2026-10-14。本轮在可读性整理基础上适度收紧 StorageSettingsPanel 排版。

## 当前工作

StorageSettingsPanel 保留上一轮提取的操作函数、命名禁用条件、错误文案及显式授权/连接状态分支，合并简单控件属性行；表头、复杂条件分支及表格样式仍展开，不新增组件或 Hook。本轮仅调整 19 处 JSX 标签排版，行数由 571 减至 482；TSX 语法解析无诊断，完整结构 AST 与本轮修改前一致。保留查询与授权生命周期、缓存刷新、请求参数、文案、body2/caption 层级、10 字符校验及忙碌保护；新增目录选择只填草稿，编辑目录选择立即保存。未修改测试或覆盖范围。静态证据不代表运行验证；测试、构建和浏览器验收由用户执行，上一轮授权各状态、新增/编辑/删除及目录选择差异的验收仍待完成。

## 上一阶段：重置组样式

SettingsPage 的重置入口使用 body2、500 字重及继承的正文颜色，与常规组“外观主题”一致，箭头随文字继承颜色；确认 Dialog 正文与操作按钮使用 body2 字号，最终恢复按钮保持 error 色。组标题沿用 subtitle1、600 字重，禁用原因保留 caption。仅调整 SettingsPage 样式与 UI 文档，不新增测试；未运行测试、构建或浏览器验收，待人工核对明暗主题下常规/重置组的文字颜色、禁用状态及确认 Dialog 的文字层级。

## 上一阶段

StorageSettingsPanel 的新增和编辑保存入口校验去除首尾空格后的连接名称，按 Unicode 码点计数，最多 10 字符；超限不发送创建/更新请求，通过现有 Snackbar 提示“连接名称最多为 10 个字符。”，保留草稿供修改。仅修改此组件，不改后端或 API；按用户要求不新增测试。静态差异检查结果见本次交付，未运行测试、构建或浏览器验收；待人工核对 10/11 字符及超限后缩短再保存。

## 上一轮工作

用户 npm check 报告授权/退出用例失败：缓存更新后 findByText 命中旧 Local 行的“已连接”，异步渲染替换行后返回节点已脱离文档。测试改为先等待 OneDrive 行，再在表格内 waitFor 状态断言；fetchStorages 模拟同步返回云连接，避免退出后的缓存刷新恢复 Local。仅调整测试，不修改生产 UI/API；用例数量和覆盖目标不变。

## 本轮之前的落点

新增连接的本地根目录右侧使用 FolderOpen 图标按钮和 Tooltip。新增 POST /local/folder-picker，只返回后端原生选择器结果，不复用会写入已有连接的接口；成功填入文本框，取消保留草稿，点击“保存连接”才持久化。浏览中禁用字段、保存、取消和 Dialog 关闭，避免迟到结果覆盖其他草稿。等待用户本地 check/pytest 与 UI 验收。

## 上轮落点

连接列表仅显示连接状态，账号信息保留在编辑授权区；授权两行文字收紧，退出登录成功通知为“账号已退出。”。Local 根目录右侧使用 FolderOpen 图标按钮及 Tooltip，移除独立文件夹选择区；选择仍立即保存。经用户授权，仅调整后端首次初始化默认值为系统 Documents，保留已有连接和环境变量覆盖；API、授权校验及忙碌保护不变，等待用户本地 check/pytest 和实际 UI 验收。

## 最近落点

- SettingsPage：返回按钮与组标题左对齐；“常规”为主题标题/描述及右侧下拉，“连接设置”为单张连接列表卡片。
- StorageSettingsPanel：移除保存后的关闭回调、confirmDelete状态及二次确认Dialog。授权采用warning ErrorIcon或success CheckCircle，紧凑两行body2/caption文字；已授权只显示退出登录，未授权只显示登录账号。保留standard字段、默认连接不可删除及忙碌保护；关闭不撤回保存和即时操作。
- useThemePreference/WorkspaceApp：偏好与实际模式分离，默认 system 并实时跟随系统，保留原 light/dark 设置；删除原启动时只读取一次系统外观和按实际模式覆盖偏好的逻辑。
- 前端清单为16文件/125用例：新增连接创建用例覆盖浏览后不即时保存，新增浏览中保护/取消保留草稿用例。后端补充独立选择器成功/取消、不写连接和不创建目录的回归源码；均未运行。
- backend/app/core/config.py：Windows 读取系统登记的 Documents（支持 OneDrive 重定向），其他系统使用用户目录下 Documents；默认值只影响未初始化连接，LOCAL_STORAGE_ROOT 优先。README 与 .env.example 同步，未修改已保存状态。

## 上阶段仍需接力的工作

- 新增 useRenameWorkflow，迁移有效选择、预览/执行 mutation、ID 生命周期、上下文重置、选择/规则操作和分批提示偏好；WorkspaceApp 保留布局、导航保护、任务订阅及存储恢复协调。补充规则失效/预览替换和跨连接迟到预览释放回归
- useRenameStore/types：FileSnapshot/RenameTask，任务/批次/预览关联、pending/completed/failed/unknown 状态，保留 before 与 after。
- WorkspaceApp：每批提交上限、剩余选择、丢失响应锁定、任务中禁用目录自动刷新、直接合并确认结果、点击预览触发分批 Dialog 和上下文失效。
- FileBrowser/CheckboxFilterMenu：任务成员视图、合并分组筛选、默认待处理、Logout 退出、超过 1000 项分批 Dialog 和浏览器记忆偏好；移除独立任务操作条、整体进度、状态列和核对弹窗。RenameActions 保留无变化批次确认。
- 后端 Schema/ExecuteService：1000 文件及 20 规则上限；current_file 可选字段返回成功/成功回滚后的 Provider 身份，本地路径 ID 不靠前端拼接。
- 现有测试文件增加批次边界、部分失败、未知锁定、本地身份、上下文失效、无变化确认和跨批次占用回归。

## 性能优化落点

- FileBrowser/PreviewPanel：复用格式器、memo 行和派生数据；超过 100 行启用共享虚拟滚动，完整集合仍负责选择、筛选和统计。
- useVirtualTable/VirtualTableSpacer：真实单行行高、上下各 8 行缓冲、完整文本列宽、占位行、跨窗口键盘导航、RAF/ResizeObserver 清理。
- WorkspaceApp/RenameActionsWithProgress：稳定回调和任务视图，局部进度订阅；preview/execute/进度闲置缓存不延迟保留。
- useRenameStore/types：未执行草稿替换，保留已报告/未知批次；一次深拷贝结果由条目和批次共享。
- PreviewService/OneDriveProvider/log_context/main：请求关联的预览阶段、Graph 分页和请求尝试计时。不改变预览新鲜度、分页参数、重试或执行复核。
- 新增虚拟窗口/完整集合选择与过滤、草稿替换/未知锁定/结果隔离回归源码；未运行。

## 复选框尺寸修复

- 选择列固定为原有 44px，不再从 Checkbox 当前布局反推宽度；文件名列吸收表格剩余空间。表头和项目 Checkbox 直接共享 20px 控件/图标、零内边距样式。
- 新增模拟 48.008px 测量结果的回归，覆盖大目录、全选状态及返回小目录；仅验证布局约束，真实浏览器像素仍待人工复核。

## 验证状态

本轮 TypeScript noEmit 静态类型诊断为0，Python修改文件AST解析及差异检查通过。未运行 npm test/check/build、pytest、浏览器或真实云盘验收，新增和调整测试尚未证明运行通过；未提交或推送。此前记录的15文件/101测试及生产构建通过仅属于旧版本，不覆盖本轮。历史性能测量及优化报告见 PERFORMANCE_OPTIMIZATION_REPORT.md，不代表当前改动的运行结果。

## 待用户验收

以下均在人工审查批准后进行：

- 设置页两组布局、返回对齐、明暗主题及320px窄屏；列表不显示账号，长连接名称不撑破页面；本地根目录右侧图标、Tooltip及选择成功/取消行为。
- 新安装无 LOCAL_STORAGE_ROOT 时使用 Documents（含 Windows 重定向）；已有保存目录与环境变量覆盖保留。不要删除现有状态文件来验收默认值，应使用隔离测试状态。
- 新增连接浏览成功只填字段；取消选择保留手动路径，取消新增不创建连接；选择器期间禁止重复浏览/保存/关闭，失败保留草稿并显示错误。已有连接的编辑选择器仍立即保存。
。
- 配置性能日志命名空间的 INFO 输出，按 request_id 分析预览各阶段与 Graph 分页/重试耗时。

- 用户在 frontend 运行 npm run check 复检当前源码；后端pytest及旧工作流人工验收仍待完成。。
- 部分成功、失败单独重试、丢失响应/未知项禁止直接重试、成功项不可重复选择。
- 任务开始、执行成功/失败、缓存失效不自动读取目录；手动刷新仍可用，本地新 ID 直接来自执行结果。

- 本地路径 ID 改变、目录刷新/删除项、筛选与剩余定位、全批无变化确认。
- UI-05/06/07/08/11：大目录及窄屏下任务面板、分组筛选和提示、表格、通知与实际进度的视觉、键盘和性能验收。

## 接力

依次阅读 AGENTS.md、FRONTEND_HANDOFF.md、API_REFERENCE.md、UI_TODO.md、本文件。完整能力与限制见 FRONTEND_HANDOFF；本阶段不实现缓存同步、持久化历史、撤回或新的 Provider。
