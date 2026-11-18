# 前端测试

[文档索引](../README.md) · [前端架构](ARCHITECTURE.md) · [前端 Agent 指令](../../frontend/AGENTS.md) · [另一端测试](../backend/TEST.md)

本文件面向人类开发者与 AI Agents，维护测试入口、编写约定、检查命令与 CI 范围，不记录具体版本的通过状态。**本地安装、测试、编译、构建由用户执行**；Agent 的权限见[根级指令](../../AGENTS.md#验证与交付)。

章节：[测试定位与验证](#测试定位与验证) · [测试编写约定](#测试编写约定)；响应丢失模拟见 [TEST_MANUAL.MD](TEST_MANUAL.MD)。

## 测试定位与验证

本节定位主要业务风险的现有测试，不维护用例总数、逐项断言副本或历史通过状态。

| 修改范围 | 测试入口 |
| --- | --- |
| 目录恢复、刷新、连接与账号隔离 | [存储 Hook](../../frontend/src/workspace/hooks/useWorkspaceStorage.test.ts)、[工作台存储接线](../../frontend/src/WorkspaceApp.storage.test.tsx) |
| 预览失效、排序、批量结果与未知保护 | [工作流 Hook](../../frontend/src/features/rename/useRenameWorkflow.test.ts)、[工作台接线](../../frontend/src/WorkspaceApp.test.tsx) |
| 单项身份合并、移动、未知与输入 | [单项工作流](../../frontend/src/features/rename/useSingleRenameWorkflow.test.ts)、[Dialog](../../frontend/src/features/rename/SingleRenameDialog.test.tsx) |
| 全集选择、虚拟化与导航 | [FileBrowser](../../frontend/src/features/files/FileBrowser.test.tsx)、[虚拟列表](../../frontend/src/features/files/FileBrowser.virtual.test.tsx)、[面包屑](../../frontend/src/features/files/LocationBreadcrumbs.test.tsx) |
| 规则编辑、结果展示与执行确认 | [RuleFields](../../frontend/src/features/rules/RuleFields.test.tsx)、[RuleEditor](../../frontend/src/features/rules/RuleEditor.test.tsx)、[PreviewPanel](../../frontend/src/features/rename/PreviewPanel.test.tsx)、[RenameActions](../../frontend/src/features/rename/RenameActions.test.tsx) |
| 设置、授权、语言、主题与重置 | [连接面板](../../frontend/src/features/settings/StorageSettingsPanel.test.tsx)、[主题](../../frontend/src/features/settings/useThemePreference.test.ts)、[偏好接线](../../frontend/src/WorkspaceApp.preferences.test.tsx)、[语言 Provider](../../frontend/src/i18n/LanguageProvider.test.tsx) |
| API、错误、通知与外部导航 | [API client](../../frontend/src/api/client.test.ts)、[错误展示](../../frontend/src/i18n/errorPresentation.test.ts)、[通知](../../frontend/src/components/NotificationProvider.test.tsx)、[消息桥](../../frontend/src/integrations/browser/browserBridge.test.ts)、[能力匹配](../../frontend/src/integrations/browser/navigation.test.ts)、[导航接线](../../frontend/src/WorkspaceApp.externalNavigation.test.tsx) |
| 翻译检查器与 CI 分流 | [检查器测试](../../frontend/scripts/check-i18n.test.mjs)、[分流测试](../../frontend/scripts/ci-scope.test.mjs) |

数据工厂、可控异步响应和接线工具位于 [src/test](../../frontend/src/test)。Hook 场景保留真实 QueryClient 与 Store，组件测试验证用户入口，工作台测试承接跨模块关系；可变场景显式安装/清理生命周期，不并发共享。异步断言等待目标 DOM 状态更新。

用户在 `frontend/` 执行 `npm run check`，覆盖翻译静态检查、Vitest、TypeScript 与 Vite 构建；相关测试可用 `npm test -- <测试文件>`。安装与开发环境见[开发环境](../DEVELOPMENT.md#环境与开发启动)，脚本以 [package.json](../../frontend/package.json)为准。测试结果及待验证项记录在[对应任务文档](../generated/README.md)，真实云端写入按[后端验收方法](../backend/TEST.md#真实环境验收)核对。

[Frontend CI](../../.github/workflows/frontend-ci.yml) 在 PR 与手动触发时上报同一检查，由 [ci-scope](../../frontend/scripts/ci-scope.mjs)区分无关变更、纯翻译和完整检查，按分流结果运行相应检查或跳过。发布检查的覆盖范围见[发布流程](../DEVELOPMENT.md#发布流程)。AI 运行权限见[根级指令](../../AGENTS.md#验证与交付)，测试编写约定见[下节](#测试编写约定)。

## 测试编写约定

- 用最小有效层级验证业务行为：Hook 保留真实 QueryClient / Store，组件验证交互，工作台验证跨模块接线；模拟 API / 浏览器等外部边界，不模拟被测业务。
- 复用 [fixtures](../../frontend/src/test/fixtures.ts)、[deferred](../../frontend/src/test/deferred.ts)与现有 [test harness](../../frontend/src/test)。数据注入只准备前置条件，被测操作走真实入口；异步断言等待目标状态，不靠固定延时或放宽超时。
- 本地运行权限遵循[根级约定](../../AGENTS.md#验证与交付)，交付时给出受影响测试与未验证范围。
