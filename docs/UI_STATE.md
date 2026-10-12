# UI 当前工作快照

更新日期：2026-10-12。本轮修复连接设置回归测试的缓存切换时序竞争。

## 当前工作

用户 npm check 报告授权/退出用例失败：缓存更新后 findByText 命中旧 Local 行的“已连接”，异步渲染替换行后返回节点已脱离文档。测试改为先等待 OneDrive 行，再在表格内 waitFor 状态断言；fetchStorages 模拟同步返回云连接，避免退出后的缓存刷新恢复 Local。仅调整测试，不修改生产 UI/API；用例数量和覆盖目标不变。待用户重新运行 npm run check。

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

- 阶段三：新增 useRenameWorkflow，迁移有效选择、预览/执行 mutation、ID 生命周期、上下文重置、选择/规则操作和分批提示偏好；WorkspaceApp 保留布局、导航保护、任务订阅及存储恢复协调。补充规则失效/预览替换和跨连接迟到预览释放回归；源码比对确认核心迁移块一致，未运行测试/构建或 commit/push，等待最终人工验收。
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
- 主题下拉三种偏好、刷新恢复、系统外观实时变化；用户已有明亮/黑暗偏好保留。
- 新增保存/取消、编辑保存后保持打开、关闭未提交草稿、错误保留、直接删除和焦点恢复；默认Local不可删除，执行/授权/请求中防重复提交与关闭。
- 授权状态横向布局、warning/success图标、两行长名称/邮箱及右侧按钮；已授权无切换入口，换号先断开再登录。账号操作与本地选择器即时生效，关闭不撤销已完成操作。
- 虚拟表格滚动到底、快速滚动、缩放/窄屏、长名称列宽、Tab/Shift+Tab/方向键/Home/End、筛选后滚动复位和焦点保持。
- 1011/5000/10000 项选择/筛选耗时、DOM 挂载数量、连续未执行预览只有一个草稿、结束任务后的堆变化、执行进度轮询不驱动表格更新。
- 配置性能日志命名空间的 INFO 输出，按 request_id 分析预览各阶段与 Graph 分页/重试耗时。

- 用户在 frontend 运行 npm run check 复检当前源码；后端pytest及旧工作流人工验收仍待完成。
- 2000 项两批处理、恰好 1000 项、后端 1001 项/21 规则拒绝。
- 部分成功、失败单独重试、丢失响应/未知项禁止直接重试、成功项不可重复选择。
- 任务开始、执行成功/失败、缓存失效不自动读取目录；手动刷新仍可用，本地新 ID 直接来自执行结果。
- 超过 1000 项时只点击刷新预览才显示 Dialog；取消不提交，继续后仅提交 1000 项，下次不再提示可记忆。
- 本地路径 ID 改变、目录刷新/删除项、筛选与剩余定位、全批无变化确认。
- 跨批次名称占用安全拒绝、规则/目录/连接/授权变化使旧批次失效。
- UI-05/06/07/08/11：大目录及窄屏下任务面板、分组筛选和提示、表格、通知与实际进度的视觉、键盘和性能验收。

## 接力

依次阅读 AGENTS.md、FRONTEND_HANDOFF.md、API_REFERENCE.md、UI_TODO.md、本文件。完整能力与限制见 FRONTEND_HANDOFF；本阶段不实现缓存同步、持久化历史、撤回或新的 Provider。
