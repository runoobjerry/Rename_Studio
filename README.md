# Rename_Studio

一个本地优先、规则驱动的批量文件重命名 WebUI。Local/OneDrive 多存储基础已由用户构建测试并确认可用；本轮接口精简与状态展示优化仅完成静态检查。

## 当前能力

- 在受限根目录内浏览本地文件和子目录
- 在 WebUI 中选择并持久化本地根文件夹
- 多选当前目录中的文件和子文件夹名称并生成只读重命名预览
- 使用短期预览凭证确认并执行本地批量重命名
- 通过唯一临时名称安全处理交换和循环重命名
- 按注册表扩展的有序规则链架构
- 填充规则：数字序列补零、文本自定义字符左/右填充
- 替换规则：支持全部、首个、末个，大小写、全字和扩展名选项
- 移除规则：与替换规则共享一致的字面量匹配选项
- 插入规则：支持前缀、后缀、字符位置及指定文本前后插入
- 文件名合法性、同批目标重复和已有文件冲突检测
- 统一 API 错误结构
- React WebUI、TanStack Query 服务端状态和 Zustand 选择状态
- OneDrive 个人账号 OAuth 2.0 授权、目录浏览和 Graph 批量重命名
- 当前目录文件及子文件夹名称的全选、反选
- App ID、刷新令牌本地持久化、连接状态和一键清理
- 多个 Local/OneDrive 独立连接、配置/授权隔离、目录 ID 导航和连接级 API

当前已注册填充、替换、移除和插入规则；空规则链仍会保持原文件名。历史和撤销尚未实现。只有用户确认有效预览后，`POST /rename/execute` 才会修改本地文件或 OneDrive 项目。

## 项目结构

```text
backend/
  app/
    api/          HTTP 路由与依赖组装
    core/         配置与领域错误
    providers/    StorageProvider、LocalProvider 与 OneDriveProvider
    rules/        规则接口与注册表
    schemas/      Pydantic API 契约
    services/     文件服务、Rename Engine、Preview Service
  tests/
frontend/
  src/
    api/          API 客户端
    features/     文件、规则和预览功能
    stores/       页面 UI 状态
    types/        前端 API 类型
```

## 本地运行

### 用户使用发布包

Windows 用户提前安装 Python 3.12+，在包含完整 `frontend/dist` 的发布包根目录运行 `./Start.ps1`，也可右键选择“使用 PowerShell 运行”。脚本创建独立运行环境、按需安装依赖，启动服务后打开 `http://localhost:8000`；用户不需要 Node.js。保持启动窗口打开，按 Q 或 Ctrl+C 安全退出。

首次安装需要联网。启动日志保存在 `.runtime/logs`；更新程序时保留 `backend/settings.json`。参数、环境重建、发布包准备及人工测试见 [PS1 启动与验收](docs/LAUNCHER.md)。

### 开发环境

要求：Python 3.12+、Node.js 20+。以下开发启动方式保持不变。

### 1. 配置本地目录

首次启动默认浏览后端当前系统用户的 Documents 文件夹（Windows 使用系统登记的位置，支持文档目录重定向）。已有连接仍使用保存的目录，不会被覆盖。工作台和连接设置均可选择后端电脑上的目录，也可手动输入已有目录的绝对路径；多连接配置保存在 `backend/settings.json`。可以复制 `.env.example` 为 `.env`，用 LOCAL_STORAGE_ROOT 设置首次启动默认目录；已保存的无效配置会明确报错，不静默回退：

```dotenv
LOCAL_STORAGE_ROOT=D:/rename-test
FRONTEND_ORIGIN=http://localhost:5173
STORAGE_REDIRECT_URI=http://localhost:8000/auth/storage/callback
```

Local Provider 会解析并校验所有路径，拒绝访问配置根目录之外的内容。建议使用专门的测试目录，不要直接指向重要文件。

系统文件夹选择器只能选择运行后端的电脑上的目录，并要求后端进程具有桌面会话；远程服务器或无图形界面环境应使用绝对路径输入。

### 2. 启动后端

在 PowerShell 中：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m uvicorn app.main:app --reload
```

API 默认运行于 `http://127.0.0.1:8000`，交互文档位于 `http://127.0.0.1:8000/docs`。

### 3. 启动前端

另开一个 PowerShell：

```powershell
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`。Vite 会把 `/api` 请求代理到后端。

## OneDrive 个人版设置

1. 在 Microsoft Entra 管理中心注册应用，支持的账户类型选择包含“个人 Microsoft 账户”的选项。
2. 在“身份验证”的公共客户端配置中添加连接回调 `http://localhost:8000/auth/storage/callback`，启用“允许公共客户端流”。自定义地址时同步设置对应环境变量。
3. 在 Microsoft Graph 的委托权限中确认已添加 `Files.ReadWrite` 和 `User.Read`。
4. 在设置页创建或编辑 OneDrive 连接，保存 App ID 后点击“网页登录”，并选择要操作的账号；每个连接独立授权。
5. 在侧栏选择连接，通过文件夹 ID 导航；也可输入相对路径，例如 `照片/待整理`，留空表示根目录。同名目录导致路径歧义时使用文件夹导航。

OAuth 使用个人账户的 consumers 租户、公共客户端授权码流程和 PKCE，无需客户端密钥，请求 Files.ReadWrite、User.Read 和 offline_access。切换账号先删除该连接旧令牌，断开保留 App ID；将 App ID 清空并保存可清理授权配置。配置和刷新令牌保存在被 Git 忽略的 `backend/settings.json`，访问令牌仅在内存中；重启后按连接刷新。

首次启动只创建 `default-local`（Local Files），云连接由用户添加。连接与应用偏好统一保存在 v3 状态文件中；仅默认 Local 不可删除。旧版独立设置文件和 v1/v2 状态文件不再读取。接口见 [API 参考](docs/API_REFERENCE.md)。Google Drive 尚未实现。

刷新令牌等同于长期登录凭据，应保护该本地文件，不要复制、提交到 Git 或写入日志。连接状态文件不存储客户端密钥。

Graph 支持完整分页、字段裁剪和连接复用，Provider 管理批量请求及有限并发。预览和执行分别读取完整目录，快照绑定连接版本；执行期间拒绝该连接的配置/授权变更。交换、循环和占用链使用临时名称。401 尝试刷新，429 遵循 Retry-After；写入超时或不确定的服务端错误先核对元数据，不盲目重放已可能成功的写入。真实账号授权与改名验收由用户执行。

## 测试

后端：

```powershell
cd backend
.\.venv\Scripts\python -m pytest
```

前端：

```powershell
cd frontend
npm ci
npm run check
```

半自动流程：Codex 完成开发后由用户在本地手动运行 `npm run check` 和 UI 验收；Git Commit 与 Git Push 必须分别获得用户明确批准，Push 仅针对开发分支。GitHub Actions 在 PR 上自动复核，PR 合并由用户手动完成。详见 [前端测试与 CI](docs/FRONTEND_TESTING.md) 和 [操作指南](docs/CODEX_CI_GUIDE.md)。

测试覆盖本地目录排序与路径隔离、名称验证、规则链、预览不可变性、冲突检测、短期预览、普通执行、循环交换、状态失效、部分失败，以及 OneDrive 授权 URL、密钥隐藏、分页映射和批处理适配。

## API

| Method | Path | 状态 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/health` | 可用 | 健康检查 |
| `GET` | `/storage-providers` | 可用 | Provider 定义、配置 Schema 与能力 |
| `GET/POST` | `/storages` | 可用 | 查询、创建连接 |
| `GET/PUT/DELETE` | `/storages/{storage_id}` | 可用 | 查询、编辑、删除连接 |
| `POST` | `/storages/{storage_id}/files/list` | 可用 | 按目录位置浏览 |
| `POST` | `/storages/{storage_id}/local/pick` | 可用 | 为 Local 连接选择根目录 |
| `GET` | `/rules` | 可用 | 已注册规则定义 |
| `POST` | `/storages/{storage_id}/rename/preview` | 可用 | 生成只读预览 |
| `POST` | `/rename/execute` | 可用 | 执行服务端预览 |
| `GET` | `/rename/progress/{preview_id}` | 可用 | 查询真实执行进度 |
| `GET` | `/storages/{storage_id}/auth/status` | 可用 | 查询账号连接状态 |
| `POST` | `/storages/{storage_id}/auth/start` | 可用 | 创建浏览器授权地址 |
| `DELETE` | `/storages/{storage_id}/auth/session` | 可用 | 断开账号并保留连接配置 |
| `GET` | `/auth/storage/callback` | 可用 | 连接级 OAuth 回调 |

向 `/storages/default-local/rename/preview` 发送预览请求：

```json
{
  "location": { "kind": "root" },
  "file_ids": ["example.txt"],
  "rules": [
    {
      "type": "padding",
      "enabled": true,
      "config": {
        "mode": "number",
        "length": 3,
        "fill_character": "_",
        "side": "left"
      }
    }
  ]
}
```

预览响应包含有效期约 10 分钟的 `preview_id`。执行时只提交该 ID：

```json
{
  "preview_id": "server-generated-preview-id"
}
```

执行前服务端会重新读取文件并再次检查名称和冲突。预览过期、文件变化或重复执行都会被拒绝。当前预览凭证保存在单进程内存中，后端重启后自动失效。

每个批次只允许选择同一目录下的直接子项。该限制同时适用于本地和 OneDrive：子文件夹可以改名，但不会递归枚举或重命名其中的文件；进入其他目录或切换 Provider 时，当前选择会被清空。

数字模式会把主文件名中的每段连续数字分别补零，例如 `episode1-part12.mp4` 在长度为 3 时得到 `episode001-part012.mp4`。文本模式将整个主文件名填充到目标长度，可指定单个填充字符以及从左侧或右侧填充。两种模式都保留最后一个扩展名。

替换与移除规则按字面量查找，不会把输入当成正则表达式。操作序数支持全部、首个和末个；“仅全字匹配”使用 Unicode 单词边界；开启“忽略扩展名”后，只处理最后一个扩展名前的主文件名。

插入规则始终保留最后一个扩展名。字符位置从 1 开始：从左计数时在第 N 个字符后插入，从右计数时在倒数第 N 个字符前插入；超出长度时收敛到主文件名首部或尾部。指定文本前后插入采用区分大小写的字面量首个匹配，找不到指定文本时保持文件名不变。

加入具体规则时，只需实现 `RenameRule`、定义 Pydantic 配置、注册规则，并增加相应前端配置控件，无需修改 Rename Engine。
