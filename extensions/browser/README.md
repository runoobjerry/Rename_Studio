# Rename Studio Browser

从 OneDrive 网页打开当前目录，自动切换到 Rename Studio 中对应账号的连接和目录，省去手动查找。

## 快速开始

### 下载与安装

1. 在项目 [Releases](https://github.com/runoobjerry/Rename_Studio/releases) 中找到 **Rename Studio Browser**，下载 `Rename_Studio-Browser-vX.Y.Z.zip` 和 `SHA256SUMS.txt`。扩展独立于本体发布；本体 ZIP 和 GitHub 自动生成的 Source code ZIP 均不能用于安装扩展。
2. 核对 ZIP 的 SHA256，将其解压到长期保留的目录。解压后的目录根部应包含 `manifest.json`。
3. 打开 `chrome://extensions` 或 `edge://extensions`，开启“开发者模式”，点击“加载已解压的扩展”，选择该目录。

当前仅提供 ZIP 下载和开发者模式安装。更新时将新包内容替换到原目录，在扩展管理页点击“重新加载”，再刷新 OneDrive 和本体网页。

### 打开 OneDrive 目录

1. 启动 [Rename Studio](../../README.md#快速开始)，在同一浏览器配置文件的普通窗口中打开 `http://localhost:8000`。本体需已有对应 OneDrive 账号的授权连接，并且只保留一个可用的本体标签页。
2. 打开 [OneDrive 个人版](https://onedrive.live.com/)，进入“我的文件”的根目录或子目录。首次安装或重新加载扩展后，刷新此页面和本体页面。
3. 点击 OneDrive 页面右侧的悬浮按钮，提示文字为“在 Rename Studio 中打开”。本体接收请求后激活其标签页，目录打开后显示“跳转成功”。

按钮可拖拽移动，也可用 Tab 聚焦后按 Enter 或 Space 触发。请求进行中不能重复点击；只有点击时才读取当前账号和目录。

跳转只打开对应目录，不自动选择文件、预览、重命名、添加连接或重新授权。正在预览、执行任务、单项重命名、选择本地目录或重置时不能跳转；存在待核对的写入结果时需先完成核对。

找不到本体时，先启动并打开；多个本体标签页可用时，仅保留一个再重试。提取期间切换 OneDrive 目录或账号会中止请求；本体导航期间手动切换连接或目录也会取消。提示“未收到打开结果，请查看 Rename Studio”时，先查看本体当前目录，不要据此认定跳转失败。

## 浏览器兼容性

| 项目 | 支持范围 |
| --- | --- |
| 浏览器 | 桌面 Chrome 117+、Edge 121+，同时满足本体要求；扩展自身的 manifest 最低版本为 111 |
| 系统与窗口 | Windows、macOS；同一浏览器配置文件内的普通窗口 |
| 目标网站 | `https://onedrive.live.com`，个人版默认云盘的普通 `/my`“我的文件”根目录和子目录 |
| 本体地址 | 发布版固定为 `http://localhost:8000` |
| 语言 | 简体中文、英语 |

## 限制

- 不支持 Firefox、Safari、无痕窗口、跨浏览器配置文件，以及通过 127.0.0.1、其他端口或公网地址访问本体。浏览器版本要求不代表逐版本实机验收，配套本体验收版本见扩展 Release 说明。
- 不支持 OneDrive 企业版、SharePoint、共享链接、共享目录快捷方式、跨云盘目录、搜索、最近使用、照片聚合和回收站。
- 目录提取依赖 OneDrive 网页的内部页面上下文和同源接口，网站更新后可能需要适配。扩展不会启动本体或自动新建本体标签页，也不会在多个本体实例之间自动选路。

## 开发

### 环境与构建

使用 Node.js 22.12+ 和 npm。版本管理脚本另需 Python 3.12+；安装发布 ZIP 无需本地构建扩展。

在 `extensions/browser` 中执行：

```powershell
npm ci
npm run build
```

发布产物位于 `dist/production`。开发本体使用 Vite 时，执行 `npm run build:dev`，产物位于 `dist/development`，仅连接 `http://localhost:5173`。

### 本地加载

打开浏览器扩展管理页，启用开发者模式，通过“加载已解压的扩展”选择 `dist/production` 或 `dist/development`。本体页面的运行模式应与扩展构建匹配，不同时启用两种构建。

修改源码后重新构建，在扩展管理页点击“重新加载”，再刷新 OneDrive 和本体页面。浏览器不会自动加载源码修改。

### 技术栈

使用 Manifest V3、原生 JavaScript 和 DOM、Vite，以及 `@material/web` 图标和进度组件；界面文案使用 Chrome i18n。扩展与本体共享仓库，依赖、构建和版本独立管理。

页面提取在 MAIN 环境执行，按钮和交互运行在 ISOLATED 环境；service worker 负责查找本体标签页和转发消息。本体通过消息桥接收导航意图，继续使用已有目录 API。接口约定见 [浏览器消息协议 v1](../../docs/BROWSER_PROTOCOL.md)。

### 目录结构

```text
extensions/browser/
├── manifest.json              扩展配置和版本
├── package.json               独立依赖和构建命令
├── package-lock.json          依赖锁文件
├── _locales/                  本地化文案
├── icons/                     扩展图标
├── scripts/build.mjs          发布版与开发版构建
├── src/
│   ├── floating-button.js     悬浮按钮和状态提示
│   ├── material-main.js       Material 组件注册
│   ├── onedrive-content.js    OneDrive 页面入口
│   ├── onedrive-page.js       账号和目录提取
│   ├── service-worker.js      消息路由和标签页激活
│   ├── transport.js           就绪握手和导航投递
│   ├── workspace-content.js   本体页面消息桥
│   ├── protocol.js            消息边界校验
│   └── config.js              构建时指定本体地址
├── tests/                     扩展行为回归
└── dist/                      构建产物，不提交 Git
```

### 验证

扩展测试复用前端 Vitest。先在 `frontend` 中执行 `npm ci`，再在该目录运行：

```powershell
node ./node_modules/vitest/vitest.mjs run --config ../extensions/browser/vitest.config.mjs
npm test -- src/integrations/onedrive/browserBridge.test.ts src/WorkspaceApp.externalNavigation.test.tsx
```

在真实浏览器中检查根目录、子目录、账号匹配、任务占用保护、手动取消和错误提示；同时检查按钮拖拽、键盘操作以及重新加载扩展后的行为。模拟测试和构建成功不能替代真实跳转验收。

### 版本与发布

在仓库根目录使用 `python scripts/set_version.py X.Y.Z --target browser` 同步扩展版本；可加 `--dry-run` 预览，或加 `--check` 检查一致性。

推送 `browser-vX.Y.Z` 标签触发独立扩展发布，生成 ZIP、校验和及 Release 草稿；Actions 手动运行仅生成验收包。公开前需验收并填写配套本体版本。完整步骤见[浏览器扩展独立发布](../../docs/RELEASING.md#浏览器扩展独立发布)。
