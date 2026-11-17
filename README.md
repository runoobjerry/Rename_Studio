# Rename Studio

一款文件重命名 WebUI 程序，帮助您整理本地和云盘里混乱的文件名。

导航：[使用帮助](https://github.com/runoobjerry/Rename_Studio/wiki/Usage-Guide) · [配置说明](https://github.com/runoobjerry/Rename_Studio/wiki/Configuration) · [常见问题](https://github.com/runoobjerry/Rename_Studio/wiki/FAQ) · [浏览器扩展](https://github.com/runoobjerry/Rename_Studio/blob/main/docs/browser-extensions/README.md) · [开发知识库](https://github.com/runoobjerry/Rename_Studio/blob/main/docs/README.md)

章节：[特性](#特性) · [兼容性](#兼容性) · [快速开始](#快速开始) · [许可与使用须知](#许可与使用须知)

## 特性

- **本地和云支持**：支持本地文件、OneDrive 和 Google Drive 多个文件源的独立配置与授权。
- **批量重命名**：支持多个文件进行格式化批量重命名。
- **自定义规则链**：支持填充、替换、移除、插入和序列编号。序列编号按当前文件排序生成，可用于按顺序添加前缀，或将选中的文件依次命名为 `001.jpg`、`002.jpg`。规则按编辑器中的顺序应用。
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

> 浏览器最低要求依据当前 MUI 9 的[官方支持版本](https://mui.com/material-ui/migration/upgrade-to-v9/#supported-browsers-and-versions)及项目使用的现代浏览器 API。

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

> 默认本地目录为后端系统用户的 Documents 文件夹。每次预览使用当前选中的文件。调整选择、规则或排序后，需要重新预览。遇到超时或未知结果先核对进度和真实文件，不要盲目重试。

## 许可与使用须知

> [!WARNING] 
> 本项目为 Vibe Coding 实验性项目，大部分源代码由 AI 生成，开发过程采用人工测试验收。

项目按 [GNU AGPL v3](LICENSE) 提供，许可条件与责任条款见许可证。批量重命名会修改真实文件，操作前请备份，并使用自己拥有或获授权的数据。执行失败不自动回滚，目前没有历史撤销功能。

项目与 Microsoft 等第三方服务商无官方关联。第三方服务的可用性与条款由其提供方决定；请妥善保护本地凭据与账号授权。完整说明见[隐私政策](https://github.com/runoobjerry/Rename_Studio/wiki/Privacy-Policy)。
