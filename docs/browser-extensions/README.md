# Rename Studio Browser

从 OneDrive 或 Google Drive 网页一键打开 Rename Studio 中对应账号的当前目录，省去手动查找。

导航：[项目主页](../../README.md) · [Releases](https://github.com/runoobjerry/Rename_Studio/releases) · [扩展架构](ARCHITECTURE.md) · [扩展开发](DEVELOPMENT.md) · [开发知识库](../README.md)

章节：[特性](#特性) · [兼容性](#兼容性) · [快速开始](#快速开始) · [常见问题](#常见问题) · [许可与隐私](#许可与隐私)

## 特性

- **从云盘直达目录**：在云盘网页点击悬浮按钮，切换到本体中对应的已有连接和目录。
- **按账号匹配连接**：支持 OneDrive 个人版和 Google Drive“我的云端硬盘”，无需再次手动选择账号。
- **保留工作保护**：任务占用或存在待核对的写入结果时阻止跳转，避免打断当前操作。
- **便捷操作**：按钮可拖拽移动，也可用 Tab 聚焦后按 Enter 或 Space 触发；支持简体中文和英语。

## 兼容性

| 项目 | 支持范围 |
| --- | --- |
| 浏览器 | 桌面 Chrome 117+、Edge 121+，同时满足[本体要求](../../README.md#兼容性)；不支持 Firefox、Safari |
| 系统与窗口 | Windows、macOS；扩展、云盘和本体位于同一浏览器配置文件的普通窗口 |
| OneDrive | `https://onedrive.live.com` 个人版“我的文件”根目录及普通子目录 |
| Google Drive | `https://drive.google.com`“我的云端硬盘”根目录及普通子目录 |
| 本体 | 已启动并打开 `http://localhost:8000`，已有对应账号的授权连接；配套验收版本见扩展 Release 说明 |

请使用同一浏览器配置文件的普通窗口，并通过 `http://localhost:8000` 访问本体；无痕窗口、跨配置文件及其他地址不在支持范围内。浏览器最低版本依据本体依赖与扩展使用的 API 要求确定。

不支持 OneDrive 企业版、SharePoint、共享链接、共享目录快捷方式，以及 Google 共享云端硬盘、共享给我的目录视图和带 `resourcekey` 的链接。搜索、最近使用、照片聚合、回收站等视图也不在支持范围内。

## 快速开始

### 下载与安装

1. 从项目 [Releases](https://github.com/runoobjerry/Rename_Studio/releases) 中找到 **Rename Studio Browser**，下载 `Rename_Studio-Browser-vX.Y.Z.zip` 和 `SHA256SUMS.txt`。扩展独立发布；本体 ZIP 和 GitHub 自动生成的 Source code ZIP 均不能用于安装扩展。
2. 核对 ZIP 的 SHA256，将其解压到长期保留的目录，确认目录根部包含 `manifest.json`。
3. 打开 `chrome://extensions` 或 `edge://extensions`，开启“开发者模式”，点击“加载已解压的扩展”，选择该目录。

当前仅提供 ZIP 下载和开发者模式安装。更新时将新包内容替换到原目录，在扩展管理页点击“重新加载”，再刷新已打开的云盘网页。本体标签页可以保持打开。

### 打开云盘目录

1. 启动 [Rename Studio](../../README.md#快速开始)，在同一浏览器配置文件中打开 `http://localhost:8000`，只保留一个可用的本体标签页。在本体中添加并授权对应账号的连接。
2. 在 [OneDrive](https://onedrive.live.com/) 进入“我的文件”，或在 [Google Drive](https://drive.google.com/) 进入“我的云端硬盘”，打开根目录或普通子目录。首次安装或重新加载扩展后，刷新已打开的云盘网页。
3. 点击云盘网页右侧的悬浮按钮“在 Rename Studio 中打开”。本体接收请求后激活其标签页，目标目录显示后提示“跳转成功”。

Google Drive 按邮箱匹配唯一的已有授权连接；使用多账号时，先在网页切换到目标账号，再点击按钮。

跳转只打开目录，不自动选择文件、生成预览、重命名、添加连接或重新授权。目录打开后可继续使用本体的常规操作。

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 没有悬浮按钮 | 确认扩展已启用，并刷新支持的云盘网页 |
| 找不到本体或存在多个本体 | 启动本体，核对地址，只保留一个可用的本体标签页后重试；扩展不会启动本体或新建标签页 |
| 找不到对应连接或需要授权 | 在本体中配置并授权同一账号，避免多个连接匹配同一账号；Google Drive 还需确认网页已登录且能读取当前邮箱 |
| 提示任务占用或写入结果待核对 | 等待预览、执行、单项重命名、本地目录选择或重置完成；待核对结果先在本体中处理 |
| 提示页面变化或请求取消 | 提取期间不要切换云盘目录或账号；本体导航期间不要手动切换连接或目录，稳定后重新点击 |
| 提示“未收到打开结果，请查看 Rename Studio” | 打开结果回复超时，先查看本体当前目录，确认目标是否已打开 |
| 原本可用的云盘页面突然无法提取 | 返回支持的普通目录重试；网站更新可能需要扩展适配，反馈时附浏览器、扩展及本体版本和错误提示 |

## 许可与隐私

扩展随项目按 [GNU AGPL v3](../../LICENSE) 提供，使用须知见[项目主页](../../README.md#许可与使用须知)。

只有点击按钮时才提取当前账号和目录。扩展不保存账号、目录或浏览历史，不把网页的 Token、Cookie 传给本体；OneDrive 页面登录态仅用于同源只读目录查询。完整说明见[隐私政策](https://github.com/runoobjerry/Rename_Studio/wiki/Privacy-Policy)。
