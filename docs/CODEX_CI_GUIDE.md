# Rename Studio：Codex 前端测试与 GitHub CI 操作指南（半自动）

## 一、分工

| 步骤 | 操作者 | 做什么 |
| --- | --- | --- |
| 1. 编写代码 | Codex | 修改前端、更新必要的回归测试，并交代验收要点 |
| 2. 本地验收 | **你** | 手动运行测试、构建，检查浏览器 UI |
| 3. Git Commit | Codex（**需你单独批准**） | 在你确认测试后，提交本次更改 |
| 4. Git Push | Codex（**需你单独批准**） | 将已批准提交推送到指定开发分支 |
| 5. PR | Codex（按指令） | 创建或更新 PR，交给 GitHub Actions 复核 |
| 6. GitHub CI | 自动 | 独立运行前端测试和构建 |
| 7. PR 合并 | **你** | 审查代码与 CI 结果后手动合并到 `main` |

**底线：** Codex 不得自行运行本地测试/构建、自动 Commit、自动 Push、直接 Push `main` 或合并 PR；“完成开发”不代表你已授权 Git 操作。

## 二、每天怎么做

**1. 告诉 Codex 开发任务。** 它修改文件、更新必要测试，列出变更和建议的人工验收项目，然后停下。

**2. 你在本地手动检查。** 打开项目终端：

```bash
cd frontend
npm ci          # 首次使用、依赖变化时再运行
npm run check   # Vitest 测试 + TypeScript 检查 + Vite 构建
npm run dev     # 需要检查页面外观或交互时执行
```

如果失败，把终端错误交给 Codex 修复，再自己重跑；UI 交互、移动端、明暗主题和真实云盘操作也需要你检查。

**3. 你分别批准 Commit 和 Push。** 先审阅文件变更与提交说明，发出“批准本次 Commit”；Codex 提交后再决定是否发出“批准 Push 到分支 xxx”。未经批准只能准备建议命令，不能执行 Git 写入。

**4. 查看 PR 检查。** GitHub 的 **Checks → Frontend tests and build** 显示自动复核。该流程通常由前端相关 PR 触发，单独 Push 开发分支不会触发当前 CI。

**5. 你最后手动合并 PR。** 即使 CI 变绿也不会自动合并。

## 三、CI 失败怎么办

1. 打开失败的 Job 日志：`Run Vitest` 是测试问题，`Type-check and production build` 是类型或构建问题，`Install locked dependencies` 可能是依赖或网络问题。
2. 让 Codex 读取日志并仅修复相关问题；不要删测试、跳过断言或关闭检查。
3. **回到步骤 2：由你本地重测，再分别批准新的 Commit 和 Push。** 不会无人值守反复提交。
4. 建议最多处理 3 轮；仍有问题则由 Codex 汇报原因，你决定下一步。若确认只是 GitHub Runner 临时故障，你可以手动点击 **Re-run jobs**。

## 四、可以直接发送给 Codex

> 根据 Rename Studio 的半自动流程完成本次前端任务：修改关联代码并补充必要测试，列出改动及待人工验证项目后停止。不要自行执行本地测试或构建，也不要自行 Commit 或 Push。我会手动运行 `npm run check` 和 UI 验收，并单独批准本次 Commit；提交完成后，还需我另行批准才能 Push 到指定开发分支。Push 获批准后可以按要求创建/更新 PR。GitHub Actions 失败时读取日志、做最小修复，再交给我本地复测；每一轮新的 Commit 与 Push 都需要重新批准。不自动合并 PR，不推送 `main`。

## 五、常见注意事项

- `npm run check` **不会**自动提交或推送代码。
- GitHub Actions 会在 PR 上自动测试，**不需要**你的电脑一直开机。
- CI 通过只代表已有测试和构建通过，不代表界面和真实云盘操作完全没有问题。
- GitHub 仓库若配置了必需状态检查，可以阻止 CI 未通过的 PR 合并；该设置由你手动管理。
- 之前的 [CI 初始化 PR #2](https://github.com/runoobjerry/Rename_Studio/pull/2) 已合并，不必重复合并。现有工作流无需更改。
