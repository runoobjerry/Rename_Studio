# OneDriver Renamer

一个本地优先、规则驱动的批量文件重命名 WebUI。目前完成到 **M2：本地文件浏览、规则引擎骨架与安全预览**。

## 当前能力

- 在受限根目录内浏览本地文件和子目录
- 多选文件并生成只读重命名预览
- 按注册表扩展的有序规则链架构
- 文件名合法性、同批目标重复和已有文件冲突检测
- 统一 API 错误结构
- React WebUI、TanStack Query 服务端状态和 Zustand 选择状态

当前没有注册具体重命名规则，因此空规则链预览会保持原文件名。`POST /rename/execute`、OneDrive、历史和撤销尚未实现；预览不会修改任何文件。

## 项目结构

```text
backend/
  app/
    api/          HTTP 路由与依赖组装
    core/         配置与领域错误
    providers/    StorageProvider 与 LocalProvider
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
```

Local Provider 会解析并校验所有路径，拒绝访问配置根目录之外的内容。建议使用专门的测试目录，不要直接指向重要文件。

### 2. 启动后端

在 PowerShell 中：

```powershell
cd backend
py -3.12 -m venv .venv
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

测试覆盖本地目录排序与路径隔离、Windows/OneDrive 兼容名称验证、规则链顺序、空规则预览不可变性、重复文件 ID 和 API 错误结构。

## API

| Method | Path | 状态 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/health` | 可用 | 健康检查 |
| `GET` | `/providers` | 可用 | Provider 列表 |
| `GET` | `/files` | 可用 | 浏览本地目录 |
| `GET` | `/rules` | 可用 | 已注册规则定义；当前为空 |
| `POST` | `/rename/preview` | 可用 | 生成只读预览 |
| `POST` | `/rename/execute` | 未实现 | M3 安全执行 |

预览请求示例：

```json
{
  "provider": "local",
  "file_ids": ["example.txt"],
  "rules": []
}
```

加入具体规则时，只需实现 `RenameRule`、定义 Pydantic 配置、注册规则，并增加相应前端配置控件，无需修改 Rename Engine。
