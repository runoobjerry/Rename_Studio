# 浏览器扩展开发

[文档索引](../README.md) · [扩展 README](README.md) · [扩展架构](ARCHITECTURE.md) · [本体开发环境](../DEVELOPMENT.md) · [本体发布流程](../DEVELOPMENT.md#发布流程)

章节：[环境与构建](#环境与构建) · [本地加载与调试](#本地加载与调试) · [验证](#验证) · [版本管理](#版本管理) · [发布](#发布) 

本页维护源码开发、验证和独立发布操作。模块职责、消息与安全约束见[扩展架构](ARCHITECTURE.md)，用户安装见 [README](README.md#快速开始)。以下安装、测试、构建与浏览器验收由用户执行，AI 权限遵循[根级指令](../../AGENTS.md#验证与交付)。

## 环境与构建

需要 Node.js 22.12+ 和 npm；版本管理另需 Python 3.12+。本体开发环境按[开发环境](../DEVELOPMENT.md#环境与开发启动)准备。安装发布 ZIP 无需本地构建。

在仓库的 `extensions/browser` 目录执行：

```powershell
npm ci
npm run build:dev
```

| 构建命令 | 产物目录（相对扩展目录） | 配套本体地址 |
| --- | --- | --- |
| `npm run build:dev` | `dist/development` | `http://localhost:5173`，Vite 开发页面 |
| `npm run build` | `dist/production` | `http://localhost:8000`，本体发布模式 |

扩展与本体共享仓库，依赖、构建和软件版本独立管理。构建入口见 [scripts/build.mjs](../../extensions/browser/scripts/build.mjs)，不要手改产物来切换地址；`dist/` 不提交 Git。

## 本地加载与调试

1. 在 `chrome://extensions` 或 `edge://extensions` 启用开发者模式，点击“加载已解压的扩展”，选择对应构建目录。
2. 启动配套模式的本体，只保留一个可用标签页；开发版与发布版扩展不要同时启用。
3. 刷新已打开的云盘网页，进入支持的普通目录后检查跳转。
4. 修改源码后重新构建，在扩展管理页点击“重新加载”，再刷新云盘网页。浏览器不会自动加载源码变化；本体页可在跳转时恢复消息接收。

调试时从扩展管理页检查 service worker，从云盘页检查按钮和提取问题，从本体页检查导航及目录读取错误。反馈记录浏览器、扩展和本体版本、页面类型、错误码和操作步骤，不记录 Token、Cookie 或原始页面上下文。

## 验证

### 自动化检查入口

扩展测试使用前端的 Vitest。先在仓库 `frontend` 目录执行 `npm ci`，再在该目录运行：

```powershell
node ./node_modules/vitest/vitest.mjs run --config ../extensions/browser/vitest.config.mjs
npm test -- src/integrations/browser/browserBridge.test.ts src/integrations/browser/navigation.test.ts src/WorkspaceApp.externalNavigation.test.tsx
```

[扩展测试](../../extensions/browser/tests)覆盖网页提取、边界校验、传输、内容脚本与按钮行为；本体测试覆盖消息桥、连接匹配和工作区导航。涉及目录 HTTP 契约或 Provider 时，再按[前端测试](../frontend/TEST.md)和[后端测试](../backend/TEST.md)选择相关回归。根据变更运行对应构建，并从产物加载扩展，核对网页按钮、账号匹配及目标目录打开流程。

## 版本管理

在仓库根目录执行，以下 `X.Y.Z` 替换为目标扩展版本：

```powershell
python scripts/set_version.py X.Y.Z --target browser --dry-run
python scripts/set_version.py X.Y.Z --target browser
python scripts/set_version.py X.Y.Z --target browser --check
```

[版本脚本](../../scripts/set_version.py)同步扩展 manifest、package 和 lockfile 的版本，不修改本体版本。检查失败时先处理不一致，再提交或发布。消息版本独立维护，软件升级不自动递增消息版本；消息兼容约束见[扩展架构](ARCHITECTURE.md#消息与生命周期)。

## 发布

扩展通过 [Release Browser Extension](../../.github/workflows/browser-release.yml) 独立发布，不进入本体 ZIP，Chrome / Edge 共用发布包。发布本体无需重发扩展，扩展更新也无需重发本体。

首次使用需将工作流合入默认分支，仓库允许 GitHub Actions 及工作流声明的发布权限；使用内置 `GITHUB_TOKEN`，无需商店凭据或额外 PAT。

| 触发方式 | 获取结果 |
| --- | --- |
| Actions → Release Browser Extension → Run workflow，选择待验收分支 | 下载 `browser-package-vX.Y.Z` artifact，取得 ZIP 与校验和；不创建 Release |
| 推送 `browser-vX.Y.Z` 标签 | 版本检查和构建通过后创建 Release 草稿，附独立 ZIP 与校验和；不设为仓库 Latest |

发布由维护者按以下步骤完成；提交、分支推送、标签推送及公开发布遵守[项目 Git 权限](../../AGENTS.md#git-权限)。

1. 设置扩展版本，完成[相关回归和真实浏览器验收](#验证)，准备更新说明，审查后将变更经 PR 合入 `main`。可先用 Actions 手动构建待验收分支。
2. 确认发布提交及版本检查结果，创建指向该提交的 `browser-vX.Y.Z` 标签并推送标签；普通分支推送不触发发布。标签版本必须与扩展版本一致。
3. 检查 Actions 成功并打开 Release 草稿。工作流检查版本、构建和包资源，不执行扩展 / 本体回归测试或真实浏览器验收。
4. 下载 `Rename_Studio-Browser-vX.Y.Z.zip` 和 `SHA256SUMS.txt`，比较对应 ZIP 的 SHA256。Windows 可用 `Get-FileHash -Algorithm SHA256 .\Rename_Studio-Browser-vX.Y.Z.zip`，macOS 可用 `shasum -a 256 Rename_Studio-Browser-vX.Y.Z.zip`。
5. 按 [README](README.md#快速开始) 从草稿 ZIP 安装并验收，确认 ZIP 根部直接包含 `manifest.json`。在草稿中填写本次改动和**实际验收的本体版本**。
6. 确认附件、说明及验收结果后，维护者手动点击 **Publish release**，保持扩展不设为仓库 Latest，避免覆盖本体下载入口。
