# UI 当前工作快照

更新日期：2026-10-11。本轮修复预览筛选在执行后的文案；此前重命名工作流 Hook 拆分及性能优化仍待最终人工验收。

## 当前工作

PreviewPanel 收到执行结果后，将筛选菜单“待修改”改为“已修改”，新预览无执行结果时恢复原文案；保留筛选值、勾选状态和执行范围。本轮按用户要求不新增测试、不运行 check/构建，以下既有工作流及性能验收信息继续保留。

## 最近落点

- PreviewPanel：筛选标签由现有 execution 响应决定；此前标签固定，导致成功项状态为“已修改”但菜单仍显示“待修改”。本轮只改展示文案和文档，未修改业务/API或测试文件。
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

静态检查：TypeScript noEmit 类型诊断为 0；4 个修改/新增 Python 文件 AST 解析通过。用户授权后执行 frontend 的 npm run check：15 个测试文件、101 个测试全部通过，tsc -b 和 Vite 生产构建成功，命令退出码 0。修复了菜单未关闭时查询背景表格的测试步骤，以及分批提示旧文案断言。未运行后端测试、服务启动或浏览器复测；未执行 Git 命令。优化前已获准在 Brave 测量 1011 项 OneDrive 目录及 1000 项只读预览，未执行重命名；这些旧数据不代表本轮优化后的结果。修改报告见 PERFORMANCE_OPTIMIZATION_REPORT.md。

## 待用户验收

以下均在人工审查批准后进行：

- 虚拟表格滚动到底、快速滚动、缩放/窄屏、长名称列宽、Tab/Shift+Tab/方向键/Home/End、筛选后滚动复位和焦点保持。
- 1011/5000/10000 项选择/筛选耗时、DOM 挂载数量、连续未执行预览只有一个草稿、结束任务后的堆变化、执行进度轮询不驱动表格更新。
- 配置性能日志命名空间的 INFO 输出，按 request_id 分析预览各阶段与 Graph 分页/重试耗时。

- 在 backend 运行 pytest；frontend 的 npm run check 已通过（15 文件/101 测试及生产构建），后续源码变更后再按需复检。
- 2000 项两批处理、恰好 1000 项、后端 1001 项/21 规则拒绝。
- 部分成功、失败单独重试、丢失响应/未知项禁止直接重试、成功项不可重复选择。
- 任务开始、执行成功/失败、缓存失效不自动读取目录；手动刷新仍可用，本地新 ID 直接来自执行结果。
- 超过 1000 项时只点击刷新预览才显示 Dialog；取消不提交，继续后仅提交 1000 项，下次不再提示可记忆。
- 本地路径 ID 改变、目录刷新/删除项、筛选与剩余定位、全批无变化确认。
- 跨批次名称占用安全拒绝、规则/目录/连接/授权变化使旧批次失效。
- UI-05/06/07/08/11：大目录及窄屏下任务面板、分组筛选和提示、表格、通知与实际进度的视觉、键盘和性能验收。

## 接力

依次阅读 AGENTS.md、FRONTEND_HANDOFF.md、API_REFERENCE.md、UI_TODO.md、本文件。完整能力与限制见 FRONTEND_HANDOFF；本阶段不实现缓存同步、持久化历史、撤回或新的 Provider。
