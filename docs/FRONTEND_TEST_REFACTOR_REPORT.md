# 前端测试与 CI 重构报告

日期：2026-10-22。

已按确认范围完成本地重构：保留有效测试，统一场景数据和异步工具，拆分工作台集成测试，补强执行结果的关联状态断言，并整理 GitHub Actions 分流。验证状态为**静态检查完成，测试、类型检查、构建及实际 Actions 待用户执行**。

## 依据与范围

参考用户提供的 Excalidraw 分析，并读取其固定提交 `1d4dc2c0e6e476911d0760e9c3cf3694f2d43384` 的 [API 辅助工具](https://github.com/excalidraw/excalidraw/blob/1d4dc2c0e6e476911d0760e9c3cf3694f2d43384/packages/excalidraw/tests/helpers/api.ts) 与 [历史测试](https://github.com/excalidraw/excalidraw/blob/1d4dc2c0e6e476911d0760e9c3cf3694f2d43384/packages/excalidraw/tests/history.test.tsx)。借鉴的是数据准备与真实操作分开、按场景检查多个相关状态的方式；没有照搬编辑器内部 API、历史系统或大规模测试设施。

本项目最需要保护的是 Preview First、连接/账号/目录隔离、批次快照、Provider 确认后的身份变化，以及未知执行结果不能自动重放。因此保留 Vitest + Testing Library、真实 Hook / Store / Query 的组合；未修改生产业务代码、后端、依赖版本或锁文件，未引入浏览器 E2E 框架、测试分片、覆盖率依赖或门槛。

CI 沿用双方确认的边界：PR 与手动触发；普通 push 不触发；Release 仍只执行 build；所有 PR 上报现有必需检查；无关改动快速结束，纯翻译仅做 i18n 检查，其他相关改动走完整检查。

## 原状与对应改动

| 原状 | 本次处理 | 保留的保障 |
|---|---|---|
| 原 `WorkspaceApp.test.tsx` 混合存储、重命名、语言和重置，重复准备环境 | 按业务拆成三个入口，共用页面环境与渲染辅助工具 | 保留 UI 与 Hook / Store 的真实接线、用户交互和原有断言 |
| Hook 与 UI 各自准备连接、Provider、偏好和预览响应 | 提取类型明确的文件、目录、连接、偏好及预览工厂 | 场景仍可覆盖权限、账号、位置及非内置 Provider |
| `workspaceHarness` 导入即注册生命周期和通知 mock | 改为入口显式安装生命周期，API / 通知 mock 留在测试文件 | 测试入口可看出其外部边界，纯数据导入不注册 Hook |
| 共享环境重置全部 mock，可能覆盖全局 setup 刚设置的语言 / Canvas | 仅重置 API mock 与通知，场景结束恢复 spies / globals | 保留每次 setup 的语言与浏览器环境约定 |
| 多处手写 Promise 的 resolve / reject 变量 | 复用 `deferred<T>()`，保持请求就绪 → 结束响应 → 等待结果的顺序 | 迟到响应、连续编辑、失败回退和执行中锁定仍被验证 |
| 执行身份、未知结果、重试集合已有分层测试，但需要跨状态一致性场景 | 增加部分成功伴随未知或缺失结果的 Hook 场景 | 文件缓存、任务快照、逐项身份、记录及后续预览参数一起检查 |
| CI 分流嵌入 YAML，顶层路径过滤可能不报告必需检查 | 提取分流脚本及用例，所有 PR 触发同一 Job | 完整 PR 差异、默认词典结构检查、手动全量和失败传播 |
| CI 只提供终端测试输出 | 增加 `test:ci` 和 JUnit artifact | 同一测试集、相同失败退出语义，未放宽断言或超时 |

有效的排序、组件、API、国际化和 Provider 表单测试继续按现有层级保留；未为统一文件外观重写所有测试，未删除有效用例或增加 skip / only。

## 文件与职责

| 文件 | 修改内容 |
|---|---|
| [WorkspaceApp.test.tsx](../frontend/src/WorkspaceApp.test.tsx) | 保留重命名的排序/预览/确认、规则和选择失效、执行锁定与迟到预览接线 |
| [WorkspaceApp.storage.test.tsx](../frontend/src/WorkspaceApp.storage.test.tsx) | 承接 Provider 能力、连接/版本/账号隔离、目录响应、过滤、默认目录与导航 |
| [WorkspaceApp.preferences.test.tsx](../frontend/src/WorkspaceApp.preferences.test.tsx) | 承接语言切换保持任务、偏好失败回退、恢复出厂设置成功/失败/取消 |
| [fixtures.ts](../frontend/src/test/fixtures.ts)、[deferred.ts](../frontend/src/test/deferred.ts) | 生成独立数据，控制外部响应；不计算被测业务期望 |
| [workspaceApiMock.ts](../frontend/src/test/workspaceApiMock.ts)、[workspaceHarness.tsx](../frontend/src/test/workspaceHarness.tsx)、[workspaceAppHarness.tsx](../frontend/src/test/workspaceAppHarness.tsx) | API mock 工厂、显式场景生命周期、真实 Hook 组合、页面浏览器环境与渲染 |
| [useRenameWorkflow.test.ts](../frontend/src/features/rename/useRenameWorkflow.test.ts)、[useWorkspaceStorage.test.ts](../frontend/src/workspace/hooks/useWorkspaceStorage.test.ts) | 显式安装环境、共用 mock 工厂和异步工具；前者补强结果一致性与重试安全 |
| [useRenameStore.test.ts](../frontend/src/stores/useRenameStore.test.ts) | 复用文件工厂，保留批次、快照、确认身份和未知结果断言 |
| [useThemePreference.test.ts](../frontend/src/features/settings/useThemePreference.test.ts)、[LanguageProvider.test.tsx](../frontend/src/i18n/LanguageProvider.test.tsx)、[StorageSettingsPanel.test.tsx](../frontend/src/features/settings/StorageSettingsPanel.test.tsx) | 使用共享 deferred，保留连续写入、失败、迟到响应和目录草稿场景 |
| [ci-scope.mjs](../frontend/scripts/ci-scope.mjs)、[ci-scope.test.mjs](../frontend/scripts/ci-scope.test.mjs) | 完整 PR 范围判定及回归场景，细节见下一节 |
| [frontend-ci.yml](../.github/workflows/frontend-ci.yml)、[package.json](../frontend/package.json)、[.gitignore](../.gitignore) | 移除顶层路径过滤，按范围执行步骤，生成/上传并忽略本地 JUnit 产物 |
| [frontend/AGENTS.md](../frontend/AGENTS.md)、[测试指南](FRONTEND_TESTING.md)、[场景清单](FRONTEND_TEST_CASES.md)、[约束提示词](FRONTEND_TEST_PROMPT.md) | 固化编写约束、层级分工、工具使用、CI 路径与验证边界 |

原有两个未跟踪文件 `docs/BACKEND_TEST_CASES.md` 和 `docs/BACKEND_TEST_MAINTENANCE_ANALYSIS.md` 未修改。没有 Commit、Push 或远程配置变更。

## 重点新增场景

以三个文件的执行为例：第一个成功并返回不同的不透明 ID，第二个明确报告未知或从响应中缺失，第三个明确失败。场景通过真实工作流入口执行，然后同时检查：

- 状态分别为 completed、unknown、failed；仅第一个使用服务端确认的新身份。
- 目录缓存仅合并确认结果；任务 ID、原始快照和已报告批次记录保留。
- 选择仅剩明确失败项；再次全选仍不能包含成功或未知项。
- 后续预览仅提交明确失败项，并携带旧预览 ID；不会额外执行或自动读取目录。

未知项的人工核对与任务后续演进继续由原有 Store / Hook 及人工验收承接；这不是对服务端重命名算法或真实云盘行为的证明。

## CI 行为

检查名仍为 `Frontend tests and build`，不要求更改现有必需检查名称。保持单 Job，避免新增聚合 Job、矩阵或重复安装依赖。

| 输入 | 行为 |
|---|---|
| 仅文档或不涉及前端相关范围 | scope=skip；不安装依赖，输出原因并成功上报 |
| 仅新增/修改语言 JSON，默认英文词典键结构保持一致 | scope=translations；安装依赖并运行 i18n 检查 |
| 组件、测试、锁文件、CI、自身分流脚本、Rule / Provider 或注册入口变化 | scope=full；i18n、完整 Vitest、类型检查与构建 |
| 删除/移动资源、改变英文键结构、翻译混合其他文件 | scope=full |
| 手动运行 | scope=full，不需要 PR base |
| Git 读取或用于比较的默认英文 JSON 解析失败 | Job 失败，不回退为 skip |

相关路径保持原有前端与元数据边界：`frontend/**`、`backend/app/rules/**`、`backend/app/providers/**`、`backend/app/api/dependencies.py` 和本工作流。该分流不是后端测试流程，后端其他改动仍需按其自身风险验证。

差异从 PR merge-base 比较到 HEAD，包含整个 PR，使用 NUL 分隔路径并关闭重命名识别；移出前端目录仍会留下删除项。英文词典只比较键结构和叶子类型，不因属性顺序或译文内容不同而触发全量。

分流测试包含上述范围、混合改动、删除/移动、默认词典结构、手动运行、merge-base 参数、带空格路径与 Git/JSON 错误。完整路径使用 `test:ci`，测试成功或失败后尝试上传 `frontend-test-results`，保留 7 天；JUnit 不代表覆盖率。

## 静态验证与剩余风险

已完成的证据：

- `git diff --check`：通过。
- 新增 `.mjs` 文件 `node --check`：通过。
- `node frontend/scripts/check-i18n.mjs`：静态检查通过，0 errors；输出的 13 处动态翻译表达式仍需人工审阅，不等同于语言切换运行验证。
- 修改和新增 TypeScript / TSX / MJS 文件的 AST 语法解析：通过，未执行类型检查或编译。
- 新增/修改代码的本地相对导入，以及新增提示词/报告中的本地链接：未发现缺失目标。
- 工作流 YAML 解析：通过；静态读取确认 PR/手动触发、无顶层 paths、原 Job 名称与三个执行路径。
- 拆分前后工作台场景声明与 `expect(...)` 操作数的静态对照：未发现遗漏。此对照不证明匹配器、异步调度或实际测试已经通过。

未执行 npm 安装、Vitest、TypeScript 类型检查、Vite 构建、浏览器验收或真实 Actions；未测量运行时长或覆盖率变化。新增 mock 工厂的类型匹配、React 异步时序、场景间隔离及 JUnit 生成/上传均须由以下运行验证确认。既有文档引用了当前工作区不存在的 `docs/TRANSLATING.md`；本次未扩展到补写翻译贡献文档。

## 用户验证与验收

在 `frontend/` 执行完整本地检查：

```bash
npm run check
```

需要单独检查 CI 报告生成时执行 `npm run test:ci`，确认 `test-results/vitest.xml` 存在；依赖尚未安装时先自行执行 `npm ci`。如果失败，提供失败测试名与完整错误，按具体问题修复，不扩大超时或降低断言强度。

人工 UI 重点检查：选择/规则/排序变化后旧预览不可执行；执行确认与执行中锁定；连接/账号/目录切换后不显示旧结果；语言切换保留任务与文件数据；恢复出厂设置取消/失败保留配置、成功清理当前任务与位置记忆。真实云盘结果未知时按界面流程核对，不尝试重放未知项。

在用户批准后通过真实 PR 分别确认文档、纯翻译、英文键结构变化、翻译混合文件、前端改动和手动运行的分流；确认必需检查不滞留 Pending，完整路径的成功/失败运行可取得 JUnit artifact。保持用户本地验收、分别批准 Commit / Push、人工合并和发布的既有流程。

## 首次人工复测后的修正

用户执行 `npm run check` 后报告 5 个失败，分属两类测试预期问题：

- 两个工作流参数化用例以单参数断言完整 mock 调用，但当前安装的 TanStack Query 调用 mutationFn 时还传入内部 context。改为保留调用次数检查，并精确检查第一个业务参数为原 preview_id；仍检查没有重复执行。
- 三个英文新建连接用例查找 `Add connection`，当前默认词典的实际按钮文本为 `Add`。修正可访问名称，并用 `findByRole` 等待切换后的按钮出现；保留原始配置和密钥提交断言。

仅修正上述测试，不改动生产代码或 CI，不删除场景或放宽超时。修正后由用户再次运行验证；Codex 仍只进行静态检查，未自行运行测试或构建。
