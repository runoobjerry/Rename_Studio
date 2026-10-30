# Rename Studio

一款文件重命名 WebUI 程序，帮助您整理本地和云盘里混乱的文件名。

## 特性

- **本地和云支持**：支持本地文件、OneDrive 和 Google Drive 多个文件源的独立配置与授权。
- **批量重命名**：支持多个文件进行格式化批量重命名。
- **自定义规则链**：目前支持填充、替换、移除、插入规则，可将多个命名规则组合为规则链，按逻辑顺序应用每个规则操作。
- **预览与校验**：预览展示新旧名称，服务端设置多重校验以检查名称冲突与合法性。

## 兼容性

正式支持 **Windows 和 macOS**，Linux 或移动端未经测试。

| 项目 | 最低要求或支持范围 |
| --- | --- |
| 后端 Python | **3.12+** |
| 前端浏览器 | **Chrome 117+、Edge 121+、Firefox 121+、Safari 17.0+（macOS）**。 |
| Windows 启动 | 交互式 PowerShell **5.1+**，已安装 Python，项目目录可写。 |
| macOS 启动 | 交互式终端、系统 Bash 与已安装的 Python，项目目录可写。 |
| 自动发布检查平台 | Windows x64、macOS Apple Silicon（ARM64）；其他架构需另行验证。 |
| 网络 | 首次安装依赖及云盘功能需要联网；依赖就绪后，本地文件操作可离线使用。 |

> 浏览器最低要求依据当前 MUI 9 的[官方支持版本](https://mui.com/material-ui/migration/upgrade-to-v9/#supported-browsers-and-versions)，同时满足项目使用的现代浏览器 API；这是依赖与代码要求，不代表已逐版本实测。

## 快速开始

### 安装与解压

安装 [Python 3.12 或更新版本](https://www.python.org/downloads/)，从项目 [Releases](https://github.com/runoobjerry/Rename_Studio/releases) 下载对应系统的发布 ZIP，完整解压到可写目录。

### 启动

**Windows：** 在发布包目录打开 PowerShell，运行：

```powershell
.\Start.ps1
```

也可右键脚本选择“使用 PowerShell 运行”。保持窗口打开，按 **Q 或 Ctrl+C** 退出。

**macOS：** 在终端运行：

```bash
bash "/项目完整路径/Start.sh"
```

保持终端打开，输入 **Q 后按 Enter**，或按 **Ctrl+C** 退出。

> 脚本创建独立的 `.runtime/venv` 并按需安装依赖，随后打开 [本地页面](http://localhost:8000)。服务仅监听 `127.0.0.1:8000`，关闭浏览器不会停止后端。启动失败可先查看 `.runtime/logs`，再查阅[常见问题](https://github.com/runoobjerry/Rename_Studio/wiki/FAQ)。

### 预览并执行

1. 选择默认 `Local Files` 连接，通过“浏览…”选择文件目录；也可在设置中添加本地或云盘连接。
2. 选择当前目录中的文件或子文件夹，添加规则并排列顺序。
3. 生成预览，检查新名称与冲突，确认后执行并核对逐项结果。

> 默认本地目录为后端系统用户的 Documents 文件夹。首次刷新预览创建固定文件集合的任务，结束任务后可重新选文件。遇到超时或未知结果先核对进度和真实文件，不要盲目重试。

## 用户文档

详细使用与配置说明见[项目 Wiki](https://github.com/runoobjerry/Rename_Studio/wiki) 。

| 文档 | 内容 |
| --- | --- |
| [使用帮助](https://github.com/runoobjerry/Rename_Studio/wiki/Usage-Guide) | 文件选择、规则参数、预览执行、目录记忆、更新与重置 |
| [配置说明](https://github.com/runoobjerry/Rename_Studio/wiki/Configuration) | 启动参数、环境变量、本地与云服务的配置与授权 |
| [常见问题](https://github.com/runoobjerry/Rename_Studio/wiki/FAQ) | 安装失败、端口占用、目录权限、授权失败、密钥与执行结果 |
| [隐私政策](https://github.com/runoobjerry/Rename_Studio/wiki/Privacy-Policy) | 数据处理、本地凭据、浏览器会话、第三方请求、日志与数据清理 |

> [!WARNING] 
> 云盘需自行配置 OAuth 客户端。`backend/settings.json` 是含长期登录凭据的**未加密 JSON**，不要公开或随发布包分发。完整说明见上述配置与隐私文档。

## 开发

如果你需要为项目贡献语言翻译，请阅读[指南](https://github.com/runoobjerry/Rename_Studio/wiki/Contribute-translations)和[Agents版指南](https://github.com/runoobjerry/Rename_Studio/wiki/Contribute-translations-(Agents))。

### 技术栈

| 范围 | 技术 |
| --- | --- |
| 后端 | Python 3.12+、FastAPI、Pydantic / pydantic-settings、httpx、Uvicorn |
| 前端 | React、TypeScript、Vite、MUI；TanStack Query 管理服务端状态，Zustand 管理文件选择、规则与执行保护状态 |
| 持久化 | JSON 状态文档，原子保存连接配置、凭据和应用偏好；当前未使用数据库存储这些状态 |
| 测试 | pytest / pytest-asyncio、Vitest、Testing Library、JSDOM |
| 发布 | PowerShell / Bash 启动入口，Python 发布脚本，GitHub Actions |

### 目录结构

```text
backend/
  app/
    api/           HTTP 路由与依赖组装
    core/          配置、错误、路径与日志上下文
    providers/     统一存储接口、注册表与 builtin.py 内置注册
      local/       本地存储配置、定义与驱动
      onedrive/    OneDrive 配置、定义、认证与驱动
      google_drive/ Google Drive 配置、定义、认证与驱动
    repositories/  JSON 状态读写与原子提交
    rules/         规则实现、配置与注册表
    schemas/       Pydantic 输入输出契约
    services/      连接管理、授权、预览与重命名执行
    launcher.py    发布服务启动与退出控制
    release.py     API 与静态资源组装
  scripts/         macOS 启动控制器
  tests/           后端测试
frontend/
  src/
    api/           API 客户端
    assets/        静态资源
    components/    共享 UI 组件
    features/      文件、规则、重命名与设置功能
    hooks/         通用 hooks
    i18n/          语言发现、解析、偏好与格式化
    locales/       meta.json 与按命名空间组织的词典
    stores/        文件选择、规则与执行保护状态
    test/          测试环境与交互 harness
    types/         前端契约类型
    utils/         通用工具
    workspace/     工作台组件、编排 hooks 与浏览会话
docs/              API、交接、测试与人工验收文档
scripts/           版本同步、发布包组装与服务检查
.github/workflows/ 前端 CI 与发布工作流
Start.ps1          Windows 发布入口
Start.sh           macOS 发布入口
```

### 环境与开发启动

需要 Python 3.12+ 和 Node.js 20+（CI 使用 22）。以下分别在仓库根目录新开的两个终端执行。

**后端（PowerShell）：**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m uvicorn app.main:app --reload
```

macOS 使用 `python3` 创建环境，并将虚拟环境解释器路径替换为 `.venv/bin/python`。API 默认位于 `http://127.0.0.1:8000`，交互文档位于 [/docs](http://127.0.0.1:8000/docs)。

**前端：**

```powershell
cd frontend
npm ci
npm run dev
```

访问 [开发页面](http://localhost:5173)。Vite 将 `/api` 代理到后端并移除前缀；开发模式无需构建产物。可复制 `.env.example` 为根目录 `.env`，环境变量含义见[具体配置说明](https://github.com/runoobjerry/Rename_Studio/wiki/Configuration)。

### 构建、测试与发布

```powershell
# 在 frontend 目录：单独构建
npm run build

# 在 frontend 目录：翻译静态检查、Vitest、TypeScript 检查与 Vite 构建
npm run check

# 在 backend 目录：后端测试（macOS 使用 .venv/bin/python）
.\.venv\Scripts\python -m pytest
```

构建生成完整 `frontend/dist` 后，可从仓库根目录使用 `Start.ps1` / `Start.sh` 验证发布模式。发布启动器使用单进程后端提供静态页面，保留根路径 API 和 `/api` 挂载；预览和执行状态位于进程内存中，不支持多 worker 部署。

Frontend CI 在相关前端、Rule/Provider 注册代码的 PR 或手动触发时运行翻译静态检查、前端测试和构建。Release ZIPs 在 `v*` 标签推送时构建、按白名单组装 ZIP，并在 Windows x64 / macOS ARM64 的全新 Python 3.12 环境检查依赖和解压包服务，成功后创建 Release 草稿；发布工作流不运行 Vitest 或 pytest，也不代替启动交互、浏览器、OAuth 和真实改名验收。

### 模块边界与维护文档

规则位于 `backend/app/rules`；各 Provider 的配置、定义、认证与驱动位于 `backend/app/providers`，经 `builtin.py` 显式注册。前端依据 Provider 元数据渲染连接配置与操作；`StorageManager` 管理连接生命周期、版本和执行互斥，Repository 原子保存完整状态。新增规则或 Provider 不应将具体存储逻辑引入 Rename Engine。

Rule/Provider 的界面文案维护在 `frontend/src/locales`：规则使用 `rules:types.<type>`，Provider 及配置字段使用 `providers:<provider_type>.fields.<key>`。新增实现需同步补齐语言文案；后端元数据仅保留稳定标识、配置结构与能力，接口形状见 [API 参考](docs/API_REFERENCE.md)。


### 许可与免责声明

> [!WARNING] 
> 本项目为 Vibe Coding 实验性项目，大部分源代码由 AI 生成，仅供个人学习使用，每次提交均有人工测试验收，但无法保证完全无错误运行。

项目按 [GNU AGPL v3](LICENSE) 提供，责任限制以许可证为准。批量重命名会修改真实文件，预览与回滚不能替代备份；目前没有历史撤销功能，请仅操作自己拥有或获授权的数据。

项目与 Microsoft 等第三方服务商无官方关联。第三方服务的可用性与条款由其提供方决定；请妥善保护本地凭据与账号授权。完整说明见[隐私政策](https://github.com/runoobjerry/Rename_Studio/wiki/Privacy-Policy)。
