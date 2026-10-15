# Rename Studio

本地优先、规则驱动的批量重命名 WebUI，当前支持本地文件和 OneDrive 个人账号。先预览名称与冲突，再确认执行；支持多个独立存储连接。

## 如何使用

### 功能与限制

- 浏览本地或 OneDrive 目录，选择当前目录中的文件和子文件夹，支持全选、反选与筛选。
- 按顺序组合填充、替换、移除、插入四类规则，支持添加、删除、启用/禁用、排序和复制。
- 预览原名、新名、名称合法性与冲突，确认后执行，并展示进度和逐项结果。
- 管理多个独立连接，保存主题、云盘默认目录和分批提示偏好，支持恢复默认设置。

每批最多处理 **1000 项**，最多组合 **20 条规则**。选择超过 1000 项时，本批只处理前 1000 项；完成后可通过“待处理项目”筛选继续操作。每批只处理同一目录的直接子项：可以重命名子文件夹，但不会递归修改其中的文件。

| 规则 | 用法 |
| --- | --- |
| 填充 | 对每段连续数字补零，或用单个字符从左/右填充文本。例如长度为 3 时，`episode1-part12.mp4` 变为 `episode001-part012.mp4`。 |
| 替换 / 移除 | 按字面量匹配全部、首个或末个结果，可设置大小写、全字匹配及是否忽略扩展名；输入不作为正则表达式。 |
| 插入 | 在前缀、后缀、指定字符位置或指定文本前后插入；文本定位使用区分大小写的首个匹配，找不到时保持原名。 |

填充和插入保留文件的最后一个扩展名；文件夹按完整名称处理，不将句点后的文本视为扩展名。空规则链保持原名。

### 启动发布包

要求预先安装 **Python 3.12+**，项目目录可写，首次安装依赖需要联网。包含完整 `frontend/dist` 的发布包不需要 Node.js；从源码下载的仓库需先由开发者构建前端。

**Windows：** 在发布包根目录打开交互式 PowerShell 5.1+，执行：

```powershell
.\Start.ps1
```

也可右键脚本选择“使用 PowerShell 运行”。保持启动窗口打开，按 **Q 或 Ctrl+C** 退出。

**macOS：** 在交互式终端执行，路径含空格时保留引号：

```bash
bash "/项目完整路径/Start.sh"
```

保持终端打开，输入 **Q 后按 Enter**，或按 **Ctrl+C** 退出。macOS 启动脚本和固定依赖安装仍需实机验收，详见[启动与验收](docs/LAUNCHER.md)。

启动脚本创建独立的 `.runtime/venv`，按需安装运行依赖，并打开 [本地页面](http://localhost:8000)。服务仅监听 `127.0.0.1:8000`；关闭浏览器不会停止服务。日志位于 `.runtime/logs`。指定 Python、关闭自动打开浏览器、端口冲突和环境修复等说明见[启动与验收](docs/LAUNCHER.md)。

### 第一次重命名

1. 选择存储连接。首次启动仅创建 `Local Files`，默认根目录为运行后端的系统用户的 Documents 文件夹；可在工作台或连接设置中更换目录。
2. 进入目标目录，选择文件或子文件夹。建议先使用少量测试副本。
3. 添加并排列规则，生成预览，核对新名称与冲突提示。
4. 确认有效预览后执行，等待完成并检查逐项结果。修改文件、连接配置或授权后，需要重新预览。

系统目录选择器操作的是**运行后端的电脑**，并需要桌面会话与 Tk 支持；不可用时可手动输入已有目录的绝对路径。本地浏览受所配置根目录限制。

预览默认有效期为 10 分钟，后端重启后失效。执行期间不要强制结束后端或覆盖程序文件。遇到超时、部分失败或结果不确定时，先检查进度和真实文件名称，再决定后续操作，避免重复改名。

### 连接 OneDrive 个人账号

1. 在 Microsoft Entra 管理中心注册支持个人 Microsoft 账户的应用。
2. 在“身份验证”的移动和桌面应用程序配置中添加回调 `http://localhost:8000/auth/storage/callback`，启用“允许公共客户端流”。
3. 配置 Microsoft Graph 委托权限 `Files.ReadWrite` 和 `User.Read`。
4. 在应用设置中添加 OneDrive 连接，保存应用的客户端 ID（App ID），点击“网页登录”完成授权。无需客户端密钥，每个连接独立授权。
5. 在侧栏选择连接，通过文件夹导航浏览；也可输入相对路径，例如 `照片/待整理`，留空表示根目录。同名目录造成歧义时使用文件夹导航。

当前授权使用个人账户端点、授权码流程与 PKCE，请求 `offline_access`、`Files.ReadWrite` 和 `User.Read`。断开账号会清除该连接的登录凭据并保留 App ID；重新登录可选择其他账号。云盘操作需要联网。

### 配置、更新与数据保护

连接配置、刷新令牌和应用偏好统一保存在 `backend/settings.json`。**刷新令牌属于长期登录凭据，状态文件是未加密的 JSON**：请限制访问，不要提交到 Git、公开上传或随发布包分发。访问令牌仅保存在内存中。

更新前退出应用，替换程序文件及完整 `frontend/dist`，保留 `backend/settings.json`、用户 `.env` 与 `.runtime`。不要跨系统或 CPU 架构复制虚拟环境；项目移动或 Python 变化后按启动提示重建运行环境。

“恢复默认设置”会清除额外连接、已保存授权、偏好和当前工作台状态，重新建立默认 Local 连接；不会撤销已经执行的重命名，也不会删除真实文件。执行中的批次完成后才能重置。

## 开发者

### 环境与启动

后端使用 Python 3.12+、FastAPI、Pydantic 和 httpx；前端使用 React、TypeScript、Vite、MUI、TanStack Query 和 Zustand。连接与应用偏好当前使用版本为 3 的 JSON 状态文档持久化。

需要 Python 3.12+ 与 Node.js 20+；仓库前端 CI 使用 Node.js 22。以下命令在仓库根目录开始执行。

如需覆盖首次初始化的本地根目录，先将 `.env.example` 复制为根目录 `.env`，取消 `LOCAL_STORAGE_ROOT` 的注释并设置已有目录：

```dotenv
LOCAL_STORAGE_ROOT=D:/rename-test
FRONTEND_ORIGIN=http://localhost:5173
STORAGE_REDIRECT_URI=http://localhost:8000/auth/storage/callback
```

`LOCAL_STORAGE_ROOT` 用于首次初始化和恢复默认设置，不覆盖已保存的连接目录。无效的已保存状态会报错，不会静默回退。旧版独立设置文件及 v1/v2 状态文档不再读取。

**启动后端（PowerShell）：**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m uvicorn app.main:app --reload
```

API 默认位于 [127.0.0.1:8000](http://127.0.0.1:8000)，交互文档位于 [/docs](http://127.0.0.1:8000/docs)。macOS 可使用 `.venv/bin/python` 替换上述虚拟环境解释器路径。

**另开终端启动前端：**

```powershell
cd frontend
npm ci
npm run dev
```

访问 [localhost:5173](http://localhost:5173)。Vite 将 `/api` 请求代理到后端并移除此前缀。开发模式无需 `frontend/dist`；发布模式使用单进程后端提供静态页面，同时保留根路径 API 和 `/api` 挂载。发布启动器固定本地端口、前端 Origin 和 OAuth 回调；修改开发环境回调时需同步应用注册配置。

### 目录与职责

```text
backend/
  app/
    api/           HTTP 路由与依赖组装
    core/          配置、错误、路径与日志上下文
    providers/     统一存储接口及 Local / OneDrive 适配
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
    components/    共享 UI 组件
    features/      文件、规则、重命名与设置功能
    stores/        工作台 UI 与批次状态
    workspace/     工作台组件与编排 hooks
    types/         前端契约类型
  AGENTS.md        前端模块边界

docs/              API、交接、测试与人工验收文档
Start.ps1          Windows 发布入口
Start.sh           macOS 发布入口
```

- Rule 负责名称转换；Provider 负责存储访问和名称限制；服务层负责预览、冲突校验与执行规划；UI 负责交互。
- 新规则实现 `RenameRule` 和 Pydantic 配置，在注册表中注册，并补充前端默认配置与编辑控件，无需修改 Rename Engine。
- 新存储实现 `StorageProvider`，提供配置 Schema 并注册。`provider_type` 表示实现类型，`storage_id` 表示独立连接；位置和文件 ID 按不透明值传递。
- `StorageManager` 管理连接生命周期、版本和执行互斥；Repository 原子提交完整状态，API 响应不暴露凭据。

具体约束见 [AGENTS.md](AGENTS.md)、[前端约束](frontend/AGENTS.md)和[前端交接](docs/FRONTEND_HANDOFF.md)。

### API 与执行契约

完整接口、请求示例和错误码见 [API 参考](docs/API_REFERENCE.md)，运行时 Schema 见后端 `/docs`。主要接口按职责分组如下：

| 职责 | 接口 |
| --- | --- |
| 健康检查与定义 | `GET /health`、`GET /rules`、`GET /storage-providers` |
| 连接管理与浏览 | `/storages`、`/storages/{storage_id}`、`POST /storages/{storage_id}/files/list` |
| 本地目录选择 | `POST /local/folder-picker`、`POST /storages/{storage_id}/local/pick` |
| 预览与执行 | `POST /storages/{storage_id}/rename/preview`、`DELETE /storages/{storage_id}/rename/previews/{preview_id}`、`POST /rename/execute`、`GET /rename/progress/{preview_id}` |
| 授权 | `GET /storages/{storage_id}/auth/status`、`POST /storages/{storage_id}/auth/start`、`DELETE /storages/{storage_id}/auth/session`、`GET /auth/storage/callback` |
| 应用设置 | `GET/PATCH /app-settings`、`POST /app-settings/factory-reset` |

所有批量重命名必须先预览。服务端保存不可变快照，绑定连接版本、目录、源项和规则；执行只接收 `preview_id`，重新读取源项与冲突集合并校验。过期、已消费或不再匹配当前状态的预览被拒绝。快照与执行进度位于单进程内存中，不能据此部署多 worker。

交换、循环和名称占用链通过唯一临时名称分阶段处理，失败时尽力回滚并返回逐项结果。未知写入结果先查询真实状态，不能盲目重放整批。OneDrive Provider 负责 Graph 分页、批量请求、有界并发、认证刷新及限流处理，业务服务不直接调用 Graph。

### 测试、构建与发布

由开发者或维护者手动执行以下命令；静态文档核对不能替代测试、浏览器操作和真实云盘验收。

```powershell
# 后端：在 backend 目录执行
.\.venv\Scripts\python -m pytest

# 前端：在 frontend 目录执行
npm ci
npm run check
```

`npm run check` 依次运行 Vitest、TypeScript 检查与 Vite 构建；单独构建使用 `npm run build`。原有 Frontend CI 在涉及前端或对应工作流文件的 PR、main 分支推送，以及手动触发时运行前端测试与构建。

发布使用独立的 **Release ZIPs** 工作流：推送 `v*` 标签后校验版本、测试并构建前端，在 Windows x64 / macOS ARM64 的 Python 3.12 全新环境检查运行依赖与解压包服务，全部成功后上传两个系统 ZIP 和校验和至 **Release 草稿**，由维护者最后公开。预发布版本自动标记 Pre-release。手动触发只生成 Actions 构建产物，不创建 Release。工作流不运行后端 pytest，不访问真实 OneDrive，也不能替代实机验收。

发布包需包含完整前端构建产物、后端程序、运行依赖清单及对应平台启动文件，不包含用户状态、凭据、开发环境或 `node_modules`。固定运行依赖的全新安装和 macOS 实机启动仍需人工验收，不能仅依据脚本存在宣称验证通过。

- [版本更新、构建工作流程图与发布操作](docs/RELEASING.md)
- [启动、发布包与人工验收](docs/LAUNCHER.md)
- [前端测试与 CI](docs/FRONTEND_TESTING.md)
- [前端测试用例](docs/FRONTEND_TEST_CASES.md)
- [UI 人工验收](docs/UI_MANUAL_ACCEPTANCE.md)
- [当前前端状态](docs/UI_STATE.md)与[待办](docs/UI_TODO.md)

### 免责声明

本项目按仓库 [LICENSE](LICENSE) 中的 GNU AGPL v3 许可条款提供，不作适销性、特定用途适用性或无错误运行的保证；责任限制以该许可证为准。

批量重命名会修改真实文件或云端项目。预览、冲突检测与回滚机制不能替代备份，也不能保证在网络中断、第三方服务异常、外部并发修改或进程被强制终止时完整恢复。请仅操作自己拥有或获授权的文件，使用前备份重要数据，并先在测试副本上验证规则。当前没有历史撤销功能，执行前请自行确认结果。

本项目为独立工具，与 Microsoft 等第三方服务提供商无隶属或官方背书关系。第三方服务的可用性、限制及使用条款由其提供方决定；请妥善保护本地凭据和账号授权。
