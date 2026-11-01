# Rename Studio Browser

扩展使用独立于本体的版本号，当前版本见 `manifest.json`。协议事实来源：[BROWSER_INTEGRATION.md](../../docs/BROWSER_INTEGRATION.md)。唯一产品入口是 OneDrive 页面右侧的可拖拽悬浮按钮；无 popup、action 提取动作或个人数据日志。

## 独立版本管理

在仓库根目录运行，示例版本 `0.3.0`：

```powershell
python scripts/set_version.py 0.3.0 --target browser --dry-run
python scripts/set_version.py 0.3.0 --target browser
python scripts/set_version.py 0.3.0 --target browser --check
```

只同步扩展的 `manifest.json`、`package.json` 和 `package-lock.json` 顶层及根包版本，不修改依赖版本或本体版本。扩展使用 `X.Y.Z`，不接受预发布后缀；每段为 0–65535，不能全部为零，遵循 [Chrome manifest 版本约束](https://developer.chrome.com/docs/extensions/reference/manifest/version)。修改后重新构建并加载扩展。省略 `--target` 时仍只管理本体版本。

## 安装发布包

1. 在项目 [Releases](https://github.com/runoobjerry/Rename_Studio/releases) 找到 **Rename Studio Browser** 发布条目，下载 `Rename_Studio-Browser-vX.Y.Z.zip`；本体的 Windows/macOS ZIP 不包含扩展，GitHub 的 Source code ZIP 也不是可加载的扩展构建。
2. 下载同一条目的 `SHA256SUMS.txt`，用 `Get-FileHash -Algorithm SHA256`（Windows）或 `shasum -a 256`（macOS）核对 ZIP。将 ZIP 解压到准备长期保留的目录，目录根部应直接包含 `manifest.json`。
3. Chrome / Edge 打开 `chrome://extensions` / `edge://extensions`，开启开发者模式，点击“加载已解压的扩展”，选择上一步目录。不要选择 ZIP，也不要选择源码目录。
4. 启动本体，打开 `http://localhost:8000` 并确认目标 OneDrive 账号已授权；刷新 OneDrive 和本体网页，点击 OneDrive 悬浮按钮跳转。支持范围及操作检查见下方人工验收。

更新时关闭旧网页，将新包解压后的内容替换到原扩展目录，在扩展管理页点击“重新加载”，再刷新 OneDrive 和本体网页；不要同时加载两份扩展。发布包不自动更新，也不自动安装或启动本体。配套本体验收版本见各扩展 Release 说明。

## 源码构建和加载（用户执行）

扩展使用原生 JavaScript、Vite 和 `@material/web`，依赖及构建与前端独立；不引入 React。Material 图标和进度组件打包进扩展，无 CDN 或外部字体。

管理页和工具栏图标使用本体 [brand-mark.svg](../../frontend/src/assets/brand-mark.svg) 导出的 16、32、48、128 像素 PNG，保存在 `icons/`，构建时原样复制；本体品牌图变更后需同步重新导出。悬浮按钮仍使用跳转图标。

Material 组件由独立 `material.js` 在 OneDrive 的 MAIN 环境提前注册；按钮交互及扩展通信仍在 ISOLATED 的 `onedrive.js` 中。Chrome 的隔离环境不提供 customElements，不能在其中直接导入自动注册的 Material 组件入口。修改此配置后须重新构建、重新加载扩展并刷新 OneDrive，旧 dist 文件不会自动更新。

在本目录执行：

```powershell
npm ci
npm run build
```

Chrome / Edge 111+ 打开 `chrome://extensions` / `edge://extensions`，开启开发者模式，加载 `extensions/browser/dist/production` 作为“已解压的扩展”。**不要加载源码目录**。构建目录内 `workspace-origin.json` 可检查目标 origin。

发布构建仅使用 `http://localhost:8000`。开发时运行 `npm run build:dev`，改为加载 `dist/development`，仅使用 `http://localhost:5173`。只加载一种构建，不同时启用两份扩展。需要 Vite 本体开发页面时，在 frontend 中由用户运行 `npm run dev`。不支持 127.0.0.1、其他端口、HTTPS 或公网本体地址；不自动扫描端口。

安装、重新加载扩展或切换构建后，刷新 OneDrive 和本体页面以加载对应内容脚本。构建产物与 node_modules 被现有 .gitignore 排除，`npm ci` 使用扩展自己的 package-lock.json。

## Actions 构建与发布

本体和扩展在同仓库独立构建、独立发布。扩展使用 [Release Browser Extension](../../.github/workflows/browser-release.yml)，本体继续使用 `Release ZIPs`；完整操作见[浏览器扩展独立发布](../../docs/RELEASING.md#浏览器扩展独立发布)。

- 推送 `browser-vX.Y.Z` 标签：检查标签与三个版本文件一致，构建发布版，生成扩展 ZIP 与校验和，再创建 **Release 草稿**。维护者完成验收后手动公开；扩展 Release 不设为仓库 Latest。
- 在 Actions 手动运行：按所选分支或标签构建，生成可下载的 `browser-package-vX.Y.Z` artifact，不创建 Release。下载后先解压 artifact 外层，取得真正的扩展 ZIP 和校验和，再按“安装发布包”操作。手动选择标签时也必须与扩展版本对应。
- 推送本体 `v*` 标签不会构建扩展，推送扩展标签也不会构建本体；普通分支推送不触发这两个发布工作流。标签指向的提交需已包含完整扩展代码和对应版本。

## 人工验收

1. 同一普通浏览器配置文件打开 OneDrive 个人版的普通“我的文件”目录，以及已启动、已有对应授权连接的 Rename Studio。点击悬浮按钮，应先显示 `md-circular-progress`；accepted 后本体标签页和所属窗口激活，目录真正打开后才出现成功通知，来源按钮附近也显示结果。
2. 根目录、多层子目录、中文/空格/`%`/`#` 目录均按真实 ID 导航。确认切到对应账号连接；不会自动选择文件、预览、执行重命名、添加连接或重新授权。根 ID 规范化成 root 应成功；缺少核对云盘所需的 drive ID 时明确拒绝。
3. 拖拽后松手不应触发导航；改变窗口大小后仍保留边距。窄窗口、浅色/深色模式下查看按钮与短提示；Tab 能聚焦，焦点清楚，Enter/Space 均可操作，屏幕阅读器读出“在 Rename Studio 中打开”。忙碌时重复点击无效。
4. OneDrive SPA 切换目录、返回/前进、替换页面内容后始终只有一个按钮，未点击时不提取账号或目录。搜索、最近使用、照片、回收站及共享范围点击后明确提示暂不支持，不回退根目录。网络节流时点击并立刻切换目录或账号，提取期间变化应丢弃结果。
5. 关闭本体页，点击后提示“请先启动并打开 Rename Studio”；打开两个就绪本体页则提示“请仅保留一个 Rename Studio 标签页后重试”。同名标题的普通 localhost 页面、其他端口和别名不能算可用本体。
6. 未授权、无匹配连接、连接 busy、正在预览/批量执行/单项改名、本地选择器、重置及未知写入状态下，确认拒绝原因在本体和来源提示均可见，当前保护记录不被清理。已有正常预览会释放，规则偏好保留。
7. 导航中手动切换本体目录、连接或设置，确认旧响应不会夺回工作区。权限/认证/限流等错误保留类别；读取失败不静默回根目录。正常重试须用户重新操作。
8. 节流目录请求至超过结果等待时间，或在投递后关闭/刷新本体页、让扩展 worker 断连。来源应显示“未收到打开结果，请查看 Rename Studio”，不能断言导航失败，不自动重放。随后请求不能被前一次迟到回执覆盖。检查双语通知以及扩展控制台无个人数据日志。

这些步骤尚待用户在真实 Chrome / Edge 验收；静态分析和模拟测试不等于扩展端联调完成。

## 回归命令（用户执行）

复用 frontend 已有 Vitest。安装前端依赖后，在 frontend 中执行：

```powershell
node ./node_modules/vitest/vitest.mjs run --config ../extensions/browser/vitest.config.mjs
npm test -- src/integrations/onedrive/browserBridge.test.ts src/WorkspaceApp.externalNavigation.test.tsx
npm run check
```

覆盖页面提取、双方协议边界一致性、精确 origin 与 ready 握手、唯一标签页、来源/accepted 校验、激活时机、超时/迟到回执、不重放，以及按钮单实例、加载和拖拽边界。测试模拟 API 或浏览器系统边界，不读取真实云盘。Codex 未运行上述命令或浏览器验收。
