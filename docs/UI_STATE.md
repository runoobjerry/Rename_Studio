# UI 当前工作快照

更新日期：2026-10-09。本轮实现大批量重命名分批处理，等待用户测试与验收。

## 当前工作

前端总选择不限，每批最多 1000 项，逐批重新预览并人工确认。会话任务保存原始快照、独立条目标识、规则副本、执行结果和人工核对记录；成功项不再选入本任务，失败项可重试，未知项须先核对。

## 最近落点

- useRenameStore/types：FileSnapshot/RenameTask，任务/批次/预览关联、pending/completed/failed/unknown 状态，保留 before 与 after。
- WorkspaceApp：每批提交上限、剩余选择、丢失响应锁定、后台刷新和上下文失效。
- FileBrowser/RenameActions：任务计数、状态筛选、剩余定位、下一批预览、人工身份核对和无变化批次确认。
- 后端 Schema/ExecuteService：1000 文件及 20 规则上限；current_file 可选字段返回成功/成功回滚后的 Provider 身份，本地路径 ID 不靠前端拼接。
- 现有测试文件增加批次边界、部分失败、未知锁定、本地身份、上下文失效、无变化确认和跨批次占用回归。

## 验证状态

仅静态检查：TypeScript noEmit 类型诊断、Python AST 语法检查及源代码核对。未运行自动化测试、构建、服务、浏览器或真实云盘操作；未执行 Git 命令。

## 待用户验收

- 在 backend 运行 pytest；在 frontend 运行 npm run check。新增测试存在不代表已通过。
- 2000 项两批处理、恰好 1000 项、后端 1001 项/21 规则拒绝。
- 部分成功、失败单独重试、丢失响应/未知项人工核对、成功项不可重复选择。
- 本地路径 ID 改变、目录刷新/删除项、筛选与剩余定位、全批无变化确认。
- 跨批次名称占用安全拒绝、规则/目录/连接/授权变化使旧批次失效。
- UI-05/06/07/08/11：大目录及窄屏下任务条、核对 Dialog、表格、通知与实际进度的视觉、键盘和性能验收。

## 接力

依次阅读 AGENTS.md、FRONTEND_HANDOFF.md、API_REFERENCE.md、UI_TODO.md、本文件。完整能力与限制见 FRONTEND_HANDOFF；本阶段不实现缓存同步、持久化历史、撤回或新的 Provider。
