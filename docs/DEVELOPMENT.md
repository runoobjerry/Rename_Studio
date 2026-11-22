# 开发与发布

[文档索引](README.md) · [系统架构](ARCHITECTURE.md) · [前端测试](frontend/TEST.md) · [后端测试](backend/TEST.md)

本页维护源码开发环境、版本、组包与发布操作。模块职责和代码地图见架构文档，检查命令见各端 TEST，发布模式见[启动说明](LAUNCHER.md)，避免重复维护。以下安装与启动命令由用户执行，AI 权限见[根级指令](../AGENTS.md#验证与交付)。

章节：[环境与开发启动](#环境与开发启动) · [版本管理](#版本管理) · [发布流程](#发布流程) · [本地组包与检查](#本地组包与检查) · [失败与重跑](#失败与重跑)

## 环境与开发启动

需要 Python 3.12+ 和 Node.js 20+（CI 使用 22）。以下分别在仓库根目录新开的两个终端执行。

**后端（PowerShell）：**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m uvicorn app.main:app --reload --no-access-log
```

macOS 使用 `python3` 创建环境，并将虚拟环境解释器路径替换为 `.venv/bin/python`。API 默认位于 `http://127.0.0.1:8000`，交互文档位于 [/docs](http://127.0.0.1:8000/docs)。

**前端：**

```powershell
cd frontend
npm ci
npm run dev
```

访问 [开发页面](http://localhost:5173)。Vite 将 `/api` 代理到后端并移除前缀；开发模式无需构建产物。可复制 `.env.example` 为根目录 `.env`，环境变量含义见[具体配置说明](https://github.com/runoobjerry/Rename_Studio/wiki/Configuration)。

后端每次启动或重载都会创建日志会话，并在终端显示路径。开发启动只清理已结束的旧会话。普通与调试日志内容见[模式对照](LAUNCHER.md#模式对照)。

需要关闭日志输出时，在 `backend/` 目录通过 PowerShell 运行以下命令。需要 DEBUG 文件日志时，用 `--debug` 替换 `--no-log`。macOS 使用 `.venv/bin/python`。

```powershell
.\.venv\Scripts\python -m app.main --reload --no-log
```

## 版本管理

版本由 [set_version.py](../scripts/set_version.py) 统一同步，支持正式版及 `alphaN`、`betaN`、`rcN`。Git 标签使用 `vX.Y.Z`，Python 包版本由脚本转换为 PEP 440 形式。以下 `v1.0.0` 仅为示例，由维护者在仓库根目录执行并替换为本次目标版本：

```powershell
python scripts/set_version.py v1.0.0 --dry-run
python scripts/set_version.py v1.0.0
python scripts/set_version.py v1.0.0 --check
```

脚本只同步和检查版本，不提交、不打标签或发布。扩展独立使用 `browser-vX.Y.Z` 标签，操作见[扩展开发与发布](browser-extensions/DEVELOPMENT.md)。已公开版本不覆盖、不移动标签。

## 发布流程

1. 在开发分支准备版本及说明，由用户按[前端 TEST](frontend/TEST.md)、[后端 TEST](backend/TEST.md)完成相关检查，再审查并合入 `main`。Git 与发布权限见[根级指令](../AGENTS.md#git-权限)。
2. 可先在 **Actions → Release ZIPs → Run workflow** 选择待发布提交构建验收包；手动运行只保留构建产物，不创建 Release。
3. 维护者确认工作区干净、目标提交和版本一致后，为该提交创建 `vX.Y.Z` 标签并推送标签，触发 [Release ZIPs](../.github/workflows/release.yml)。普通分支推送不触发发布。
4. 工作流成功后，在 Release 草稿中核对版本、更新说明、Windows/macOS ZIP 与 `SHA256SUMS.txt`。下载目标平台附件，核对校验和并按[启动说明](LAUNCHER.md)验证；用文件副本完成相关改名及云盘业务验证。
5. 维护者确认后手动公开 Release；预发布版本保留 **Pre-release** 标记。GitHub 自动附带的 Source code ZIP 不含前端构建产物，用户应下载带系统名称的发布附件。

自动发布检查平台为 Windows x64 与 macOS ARM64，使用 Python 3.12，覆盖前端构建及解压包的运行依赖、页面/API、后端调试日志与退出。Vitest、pytest、真实浏览器、OAuth 和文件改名由用户按相关 TEST 文档验证。启动器参数在目标系统的交互式终端验收。

## 本地组包与检查

先由用户完成相关测试并准备完整 `frontend/dist`，然后在仓库根目录按目标平台组包：

```powershell
python scripts/build_release.py v1.0.0 --platform windows
python scripts/build_release.py v1.0.0 --platform macos
```

输出默认位于 `dist/releases/`，包含 ZIP 和对应 `.zip.sha256`；已有同名输出不覆盖。跨平台组包后，在目标平台验证启动与业务操作。包内仅包含运行所需文件、根目录 README 和 LICENSE，排除凭据、状态、虚拟环境与开发知识库。README 直接复制，其知识库导航使用在线地址。

需要检查解压包服务时，在目标平台的独立 Python 环境安装 [requirements-runtime.txt](../backend/requirements-runtime.txt) 后，由用户执行 `python scripts/check_release.py <发布ZIP路径>`。检查需端口 8000 空闲，不会停止其他服务；仍须完成实际启动与业务验证。组包和服务检查的实现入口分别为 [build_release.py](../scripts/build_release.py) 和 [check_release.py](../scripts/check_release.py)。

## 失败与重跑

- 构建或平台检查失败时先处理日志，不公开不完整产物。仅基础设施或网络临时失败、代码无需变更时，可重跑失败工作流。
- 草稿上传中断可能留下不完整草稿；维护者核对后仅删除未公开草稿，保留标签，再重跑。工作流拒绝覆盖已有同标签 Release。
- 需要修改代码或已公开版本有问题时，用新版本重新发布，不强推旧标签或替换已公开附件。
- 更新应用前退出服务，替换程序和完整前端，保留用户状态、`.env` 与 `.runtime`；启动与更新说明见 [LAUNCHER](LAUNCHER.md)。
