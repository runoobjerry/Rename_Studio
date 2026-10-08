# 前端自动化测试

## 流程

Codex 修改前端 → 运行受影响测试 → `npm run check` → 提交 PR → GitHub Actions 重新运行 `npm test` 和 `npm run build`。

- **Vitest + React Testing Library（JSDOM）**：验证 API 客户端、文件选择与导航、规则编辑、预览、执行确认、连接设置等业务交互。
- **TypeScript + Vite**：`npm run build` 执行类型检查和生产打包，发现类型或构建问题。
- **GitHub Actions**：前端或工作流文件变更的 PR、`main` Push、手动触发时自动执行。仅用本地模拟数据，不启动后端、不访问真实云盘、不需要 OAuth 凭据。

## 命令

在 `frontend/` 目录下运行：

```bash
npm ci                 # 按锁文件安装依赖（首次/依赖变化时）
npm test               # 全量自动测试：一次运行后退出
npm test -- src/features/files/FileBrowser.test.tsx  # 仅运行受影响测试
npm run test:watch     # 本地监听模式
npm run build          # TypeScript 类型检查 + Vite 构建
npm run check          # 全量测试 + 类型检查 + 构建
```

GitHub Actions 工作流位于 `/.github/workflows/frontend-ci.yml`。进入 PR 的 **Checks** 或仓库 **Actions → Frontend CI** 查看日志。CI 失败时，先查看失败的测试或构建步骤，修复后重新 Push。

## Codex 的测试范围

1. **必须覆盖**：新增业务行为、已复现 Bug，以及涉及选择、规则顺序、旧预览失效、执行确认/防重、账号/目录隔离的修改。
2. **按需覆盖**：组件事件、表单、错误状态与 API 参数；复用现有测试，不重复创建同样的用例。
3. **无需自动补测**：纯 CSS、微小视觉调整、静态文案或与产品无关的理论极端场景。

**边界**：JSDOM 测试不能证明真实浏览器的宽度、焦点、滚动或视觉正确性；这些改动需要手动进行移动端、桌面端和明暗模式检查。真实 OneDrive 授权与重命名始终由用户在专用测试目录中验收。当前不引入浏览器 E2E 工具，避免在已有测试基础上增加不必要的依赖和维护成本。

如需阻止未通过测试的 PR 合并，在 GitHub 仓库规则中把 `Frontend tests and build` 配置为必需状态检查；创建工作流本身不会自动修改仓库保护规则。
