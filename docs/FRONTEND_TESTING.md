# 前端测试与 GitHub CI（半自动流程）

## 职责与流程

1. **Codex 开发**：只修改相关代码、补充有价值的回归测试，列明待验证功能；不自行构建、测试、提交或推送。
2. **人工本地验收**：用户在 `frontend/` 下执行 `npm run check`，必要时运行 `npm run dev` 检查实际界面；失败则提供结果给 Codex 修复，修复后人工复测。
3. **人工批准 Git 操作**：用户确认测试结果后，明确批准本次 Commit；检查提交内容后，再明确批准 Push 到指定开发分支。两个动作均不得默认授权，绝不直接推送 `main`。
4. **PR 与 CI**：Push 获批准后，可让 Codex 创建/更新 PR；GitHub Actions 自动复核。用户人工审查 PR 和 Checks，决定是否合并。
5. **CI 失败**：Codex 读取失败 Job 日志并修复；回到步骤 2 人工复测，新的 Commit/Push 必须再次获得批准。建议最多 3 轮后停止并说明原因。

## 人工本地检查命令

在项目根目录进入 `frontend/`：

```bash
cd frontend
npm ci
npm run check
npm run dev
```

`npm run check` 包含翻译静态检查、Vitest 全量测试、TypeScript 类型检查和 Vite 生产构建。翻译检查可单独执行 `npm run i18n:check`。需要时也可单独运行 `npm test`、`npm test -- src/features/files/FileBrowser.test.tsx`、`npm run test:watch` 或 `npm run build`。`npm run test:ci` 运行相同的完整测试集，同时保留终端输出并生成 `test-results/vitest.xml`；不增加覆盖率门槛。

## GitHub Actions

工作流位于 `.github/workflows/frontend-ci.yml`，所有 PR 及人工从 Actions 页面触发时均上报 `Frontend tests and build`；普通分支推送（包括 `main`）不自动触发。工作流不使用顶层 `paths` 过滤，避免必需检查因工作流未触发而一直等待。分流逻辑位于 [ci-scope.mjs](../frontend/scripts/ci-scope.mjs)，按 PR merge-base 到当前合并提交的完整 NUL 分隔差异判断，不读取 PR 标签或分支名。

| 差异范围 | 检查路径 |
|---|---|
| 不涉及 `frontend/**`、后端 `app/rules/**` / `app/providers/**`、`backend/app/api/dependencies.py` 或本工作流 | `skip`：输出范围说明，不安装依赖，正常上报同一检查 |
| 整个 PR 只新增/修改 `frontend/src/locales/<语言>/` 下的 `meta.json` 和六个命名空间 JSON，且未改变 en-US 默认词典键结构 | `translations`：安装依赖并执行 `npm run i18n:check` |
| 其他涉及上述前端范围的变更，或人工触发 | `full`：安装依赖、i18n 检查、`npm run test:ci`、`npm run build` |

删除、重命名语言资源，改变默认词典键结构，或语言资源混合其他文件的 PR 均走 `full`。默认词典属性顺序和字符串文本变化仍可走翻译路径。Git 读取或默认词典 JSON 解析失败会使检查失败，不会伪装成无关变更。翻译静态检查读取本地词典和注册代码，不调用后端或外部服务。

远程 CI 使用模拟数据，不访问真实 OneDrive 或执行实际云端重命名。推送版本标签时，独立的发布工作流执行 `npm run build`，仅进行前端类型检查与构建，不运行 Vitest；发布前由开发者在本地执行 `npm run check`，详见[版本发布](RELEASING.md)。

在 PR 的 **Checks** 或 **Actions → Frontend CI** 查看运行结果。完整路径的 Vitest 已运行时，成功或失败均尝试上传 `frontend-test-results`，保留 7 天；翻译和无关变更路径不生成测试报告。JUnit 是测试结果报告，不是代码覆盖率报告。失败时让 Codex 分析相关 Job 日志和修复建议，但所有新增提交/推送仍需要人工分别批准。

## 场景分工与辅助工具

测试从真实业务风险出发，先确定操作入口与关联状态，再选最小可验证层级：

| 层级 | 主要验证 | 边界 |
|---|---|---|
| 纯函数 / Store | 固定成员、原始快照、重复执行后的文件身份、独立未知结果保护 | 直接调用真实函数或 action，不搭建整个工作台 |
| Hook | 选择/规则/排序失效、目录与账号隔离、迟到响应、执行后 Query 缓存与任务一致性 | 使用真实 Hook、Zustand 和 QueryClient，仅模拟 API 与外部环境 |
| 组件 | 按钮、确认、过滤、规则编辑及回调参数 | 受控组件可由轻量 Harness 提供状态，避免重写业务算法 |
| 工作台集成 | 存储导航与隔离、预览/确认接线、语言及恢复出厂设置 | 三个 `WorkspaceApp*.test.tsx` 按业务拆分，不重复 Hook 的所有组合 |
| 基础设施 | 翻译检查器、CI PR 差异分流 | 验证实际路由风险和输入输出，不触发真实 Actions |

`src/test/fixtures.ts` 提供独立的文件、目录、连接、偏好与预览数据；可用 `fileItem(id, overrides)` 区分 ID 与名称。工厂的默认值不是业务期望，场景特有权限、错误和不透明 ID 必须在用例中明确写出。`deferred<T>()` 控制成功或失败响应；先等请求或状态就绪，再在 `act` 中 resolve/reject，最后等待目标状态，禁止用固定延时猜测调度。

`workspaceApiMock.ts` 只提供 mock 工厂，`vi.mock` 仍写在各测试入口。Hook 场景显式调用 `installWorkspaceTestHooks()`，工作台场景调用 `installWorkspaceAppTestHooks()`；导入辅助模块不会自动注册生命周期或替换通知。每个场景重置 API、Store、浏览器位置记忆和查询缓存；清理时卸载 React 并恢复 spies / globals。测试不得并发共享这套可变场景。

前置条件可以通过工厂、缓存或 Store 快速准备；被测操作必须通过真实 action、Hook 入口或用户交互触发。断言同时检查直接结果与相关的选择、任务、旧快照、文件身份、缓存或 API 参数；不要每次机械断言所有字段。已有参数化测试、组件测试和纯函数测试只在存在真实重复或遗漏时调整。

后续编写使用 [约束提示词](FRONTEND_TEST_PROMPT.md)，场景索引见 [前端测试清单](FRONTEND_TEST_CASES.md)，当前改动与验收状态见 [当前快照](UI_STATE.md)。

## 测试范围和边界

- 新增业务逻辑和真实 Bug 应补充必要回归测试，特别是文件选择、规则、旧预览失效、执行确认和账号/目录隔离。
- 纯样式、微小视觉或文案修改无需为了覆盖率增加低价值测试。
- JSDOM 不能代替浏览器响应式、视觉、焦点和真实云盘验收；由用户手动验证。
- 不允许删除有效测试、跳过断言或降低质量门槛来使 CI 通过。

Git 审批以根目录及 `frontend/AGENTS.md` 为准。如需阻止 CI 未通过的 PR 合并，用户可在 GitHub Rulesets 中手动设置必需检查 `Frontend tests and build`。
