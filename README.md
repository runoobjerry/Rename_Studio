# OneDriver Renamer

一个本地优先、规则驱动的批量文件重命名 WebUI。目前进入 **M4：OneDrive 个人版接入**。

## 当前能力

- 在受限根目录内浏览本地文件和子目录
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
- App ID/客户端密钥本地持久化、连接状态和一键清理

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

要求：Python 3.12+、Node.js 20+。

### 1. 配置本地目录

默认浏览 `backend/local_storage`。也可以复制 `.env.example` 为 `.env`，将 `LOCAL_STORAGE_ROOT` 改为需要测试的绝对目录：

```dotenv
LOCAL_STORAGE_ROOT=D:/rename-test
FRONTEND_ORIGIN=http://localhost:5173
ONEDRIVE_REDIRECT_URI=http://localhost:8000/auth/onedrive/callback
```

Local Provider 会解析并校验所有路径，拒绝访问配置根目录之外的内容。建议使用专门的测试目录，不要直接指向重要文件。

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
2. 在“身份验证”中添加 **Web** 重定向 URI：`http://localhost:8000/auth/onedrive/callback`。
3. 创建客户端密钥，并复制密钥的 **Value**（不是 Secret ID）。
4. 启动前后端，在页面“连接设置”中填写 App ID 与客户端密钥，保存后点击“连接账号”。
5. 授权完成后选择 `OneDrive Personal`，输入相对根目录的文件夹路径，例如 `照片/待整理`；留空表示根目录。

OAuth 使用个人账户的 `consumers` 租户、授权码流程、PKCE 以及委托权限 `Files.ReadWrite`，并请求 `offline_access` 以刷新短期访问令牌。App ID 和客户端密钥默认保存在 `backend/.onedrive_credentials.json`，该文件已被 Git 忽略；后端启动时会自动加载，只有点击“清理设置”才会删除。待完成授权状态、访问令牌和刷新令牌仍仅保存在进程内存，不写入本地文件或日志，因此重启后端只需重新点击“连接账号”，不需要重填应用凭据。

Graph 目录读取支持分页；预览元数据和重命名按每批最多 20 项发送。遇到 401 会尝试刷新令牌，遇到 429 或暂时性服务错误会遵循 `Retry-After` 并只重试失败项。真实账号授权与改名测试由用户执行。

## 测试

后端：

```powershell
cd backend
.\.venv\Scripts\python -m pytest
```

前端：

```powershell
cd frontend
npm test
npm run build
```

测试覆盖本地目录排序与路径隔离、名称验证、规则链、预览不可变性、冲突检测、短期预览、普通执行、循环交换、状态失效、部分失败，以及 OneDrive 授权 URL、密钥隐藏、分页映射和批处理适配。

## API

| Method | Path | 状态 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/health` | 可用 | 健康检查 |
| `GET` | `/providers` | 可用 | Provider 列表 |
| `GET` | `/files` | 可用 | 浏览本地或 OneDrive 目录 |
| `GET` | `/rules` | 可用 | 已注册规则定义 |
| `POST` | `/rename/preview` | 可用 | 生成只读预览 |
| `POST` | `/rename/execute` | 可用 | 执行服务端生成的有效预览 |
| `GET/PUT/DELETE` | `/onedrive/settings` | 可用 | 读取、更新或清理本地应用设置 |
| `GET` | `/onedrive/auth/status` | 可用 | 查询配置与连接状态 |
| `POST` | `/onedrive/auth/start` | 可用 | 创建浏览器授权地址 |
| `GET` | `/auth/onedrive/callback` | 可用 | Microsoft OAuth 回调 |

预览请求示例：

```json
{
  "provider": "local",
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
