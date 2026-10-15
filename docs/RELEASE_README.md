# Rename Studio {{TAG}}

本地优先的批量重命名工具：浏览与选择文件、组合规则、预览冲突，再确认执行。支持本地文件和 OneDrive 个人账号。

## 启动

请完整解压到可写目录，预先安装 Python 3.12+。当前自动发布检查基线为 Python 3.12、Windows x64 和 macOS Apple Silicon（ARM64）；其他 Python 版本、系统版本和架构需另行验证。无需 Node.js，首次启动安装依赖需要联网，后续本地操作可离线运行。

Windows 包：打开交互式 PowerShell，在解压目录执行：

```powershell
.\Start.ps1
```

若执行策略阻止启动，在确认信任发布包后，可仅对本次进程使用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start.ps1
```

macOS 包：在交互式终端执行，路径包含空格时保留引号：

```bash
bash "/完整路径/Rename_Studio/Start.sh"
```

服务仅监听本机 `127.0.0.1:8000`，就绪后打开 `http://localhost:8000`。保持启动终端打开；Windows 按 Q 或 Ctrl+C，macOS 输入 Q 后回车或按 Ctrl+C 退出。关闭浏览器不会停止服务。

## 数据与更新

首次使用请操作测试副本，先生成预览，检查名称与冲突，再确认执行。当前没有历史撤销功能。遇到超时或结果不确定时，先检查真实文件和执行进度，不要重复提交批次。

连接、授权与偏好保存在 `backend/settings.json`，其中的刷新令牌是未加密凭据，不要公开上传或分享。发布包不含任何用户状态或账号授权。

更新前先退出应用，再替换程序文件及完整 `frontend/dist`，保留 `backend/settings.json`、用户 `.env` 和 `.runtime`。不要跨系统、架构复制虚拟环境；项目移动或 Python 变化后按启动提示重建 `.runtime/venv`，保留状态文件。

OneDrive 需自行注册支持个人 Microsoft 账户的公共客户端应用，回调为 `http://localhost:8000/auth/storage/callback`，委托权限为 `Files.ReadWrite`、`User.Read`。无需客户端密钥；在连接设置中填写 App ID 后网页登录。完整步骤见对应版本的[项目 README](https://github.com/runoobjerry/Rename_Studio/tree/{{TAG}}#readme)。

更多参数、故障处理及验收事项见对应版本的[在线启动说明](https://github.com/runoobjerry/Rename_Studio/blob/{{TAG}}/docs/LAUNCHER.md)。日志位于 `.runtime/logs`。

## 许可与源码

本项目按 [GNU AGPL v3](LICENSE) 提供，不保证无错误运行；操作重要文件前请备份。项目与 Microsoft 无官方关联。

本版本完整源码：[Rename Studio {{TAG}}](https://github.com/runoobjerry/Rename_Studio/tree/{{TAG}})。带 `alpha`、`beta` 或 `rc` 后缀的版本均为预发布版本。
