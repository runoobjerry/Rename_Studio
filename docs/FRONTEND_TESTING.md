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

`npm run check` 包含 Vitest 全量测试、TypeScript 类型检查和 Vite 生产构建。需要时也可单独运行 `npm test`、`npm test -- src/features/files/FileBrowser.test.tsx`、`npm run test:watch` 或 `npm run build`。

## GitHub Actions

工作流位于 `.github/workflows/frontend-ci.yml`，会在涉及前端或该工作流文件的 PR，以及人工从 Actions 页面触发时执行；普通分支推送（包括 `main`）不自动触发。远程 CI 使用模拟数据，不访问真实 OneDrive 或执行实际云端重命名。推送版本标签时，独立的发布工作流执行 `npm run build`，仅进行前端类型检查与构建，不运行 Vitest；发布前由开发者在本地执行 `npm run check`。原有 Frontend CI 继续运行测试与构建，详见[版本发布](RELEASING.md)。

在 PR 的 **Checks** 或 **Actions → Frontend CI** 查看运行结果。失败时让 Codex 分析相关 Job 日志和修复建议，但所有新增提交/推送仍需要人工分别批准。

## 测试范围和边界

- 新增业务逻辑和真实 Bug 应补充必要回归测试，特别是文件选择、规则、旧预览失效、执行确认和账号/目录隔离。
- 纯样式、微小视觉或文案修改无需为了覆盖率增加低价值测试。
- JSDOM 不能代替浏览器响应式、视觉、焦点和真实云盘验收；由用户手动验证。
- 不允许删除有效测试、跳过断言或降低质量门槛来使 CI 通过。

详见 [半自动流程操作指南](CODEX_CI_GUIDE.md)。如需阻止 CI 未通过的 PR 合并，用户可在 GitHub Rulesets 中手动设置必需检查 `Frontend tests and build`。
