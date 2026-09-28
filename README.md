# OneDriver Renamer

一个本地优先、规则驱动的批量文件重命名 WebUI。目前进入 **M4：OneDrive 个人版接入**。

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

默认浏览 `backend/local_storage`。启动后可以在 WebUI 点击“浏览…”唤起后端所在电脑的系统文件夹选择器，也可以直接输入已有文件夹的绝对路径；选择结果保存在后端 `.local_settings.json`。也可以复制 `.env.example` 为 `.env`，用 `LOCAL_STORAGE_ROOT` 设置首次启动或本地配置不可用时的默认目录：

```dotenv
LOCAL_STORAGE_ROOT=D:/rename-test
FRONTEND_ORIGIN=http://localhost:5173
ONEDRIVE_REDIRECT_URI=http://localhost:8000/auth/onedrive/callback
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
2. 将原来的 **Web** 回调移除，改为在“身份验证”中添加“移动和桌面应用程序”平台及回调地址 `http://localhost:8000/auth/onedrive/callback`，并在高级设置中启用“允许公共客户端流”。
3. 在 Microsoft Graph 的委托权限中确认已添加 `Files.ReadWrite` 和 `User.Read`。
4. 启动前后端，在页面“连接设置”中只填写 App ID，保存后点击“网页登录”，并在微软账号选择器中选择要操作的账号。
5. 授权完成后选择 `OneDrive Personal`，输入相对根目录的文件夹路径，例如 `照片/待整理`；留空表示根目录。

OAuth 使用个人账户的 `consumers` 租户、公共客户端授权码流程和 PKCE，不需要客户端密钥，并请求 `Files.ReadWrite`、`User.Read` 与 `offline_access` 委托权限。授权完成后页面会显示当前账号；“切换账号”先删除旧账号令牌，再打开账号选择器；“断开账号”删除账号令牌但保留 App ID；“清理设置”同时删除 App ID 和账号令牌。App ID、刷新令牌和账号显示信息默认保存在已被 Git 忽略的 `backend/.onedrive_credentials.json`，访问令牌只保存在进程内存中。后端重启后会使用刷新令牌恢复登录。

刷新令牌等同于长期登录凭据，应保护该本地文件，不要复制、提交到 Git 或写入日志。旧版本配置中的客户端密钥会在后端读取后自动移除。

Graph 目录读取支持分页和字段裁剪，网络连接在应用生命周期内复用；超过 20 项的批次采用有限并发。预览通过一次当前目录读取完成源文件与冲突确认，执行时复用实时校验结果。普通无名称依赖的项目直接改名，只有交换、循环或名称占用链使用临时名称。遇到 401 会尝试刷新令牌，遇到 429 或暂时性服务错误会遵循 `Retry-After` 并只重试失败项。真实账号授权与改名测试由用户执行。

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
| `GET/PUT/DELETE` | `/onedrive/settings` | 可用 | 读取、更新或清理本地 App ID 与授权状态 |
| `GET` | `/onedrive/auth/status` | 可用 | 查询配置与连接状态 |
| `POST` | `/onedrive/auth/start` | 可用 | 创建浏览器授权地址 |
| `DELETE` | `/onedrive/auth/session` | 可用 | 断开当前账号并保留应用设置 |
| `GET` | `/auth/onedrive/callback` | 可用 | Microsoft OAuth 回调 |

预览请求示例：

```json
{
  "provider": "local",
  "path": "",
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
