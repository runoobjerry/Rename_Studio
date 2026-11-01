# ZIP 构建与版本发布

## 发布约定

- Git 标签和 ZIP 使用 `v1.0.0-alpha2`；前端和 FastAPI 使用 `1.0.0-alpha2`；Python 包使用 PEP 440 规范形式 `1.0.0a2`。统一由 `scripts/set_version.py` 转换与检查，不直接比较两种形式的字符串。
- 浏览器扩展独立版本使用 `python scripts/set_version.py 0.3.0 --target browser` 管理；支持同样的 `--dry-run` / `--check`，仅同步扩展的 manifest、package 和 lockfile 根包版本。扩展由 `browser-v*` 标签触发独立发布，不进入本体 ZIP，详见[浏览器扩展独立发布](#浏览器扩展独立发布)。
- 支持正式版、`alphaN`、`betaN` 和 `rcN`。本轮为内测版，后续可递增为 `v1.0.0-alpha3`；正式发行使用 `v1.0.0`。已公开版本不覆盖、不移动标签。
- 首批检查平台为 Windows x64（`windows-2022`）和 macOS ARM64（`macos-15`），Python 3.12。运行环境不随 ZIP 分发，用户需预装 Python，首次启动联网安装依赖。其他平台、架构、Python 版本及更旧的桌面系统尚需另行验收。
- 推送 `v*` 标签触发 `Release ZIPs` 工作流。全部检查成功后创建 **Release 草稿**，由维护者最后公开；带预发布后缀的版本自动勾选 **Pre-release**，不设置为 Latest。
- 从 Actions 手动触发时，以所选分支或标签的对应产品版本构建、检查并上传工作流产物，**不创建 Release**。普通分支推送不触发发布工作流。

采用 Bitwarden 同仓库按产品分开构建、分开组织 Release 的方式：[浏览器构建](https://github.com/bitwarden/clients/blob/main/.github/workflows/build-browser.yml)、[桌面构建](https://github.com/bitwarden/clients/blob/main/.github/workflows/build-desktop.yml)、[浏览器 Release 示例](https://github.com/bitwarden/clients/releases/tag/browser-v2026.10.1)。本项目保留既有本体标签，并使用扩展专属标签；不会引入其多客户端构建矩阵、签名或商店上传流程。

| 产品 | 工作流 | 标签 | 正式发布附件 |
| --- | --- | --- | --- |
| 本体 | `Release ZIPs` | `vX.Y.Z` 或已有预发布格式 | Windows/macOS ZIP、校验和 |
| 浏览器扩展 | `Release Browser Extension` | `browser-vX.Y.Z` | 独立扩展 ZIP、校验和 |

## 自动工作流

```mermaid
flowchart TD
    A[推送版本标签 或 手动运行] --> B[按当前提交检出代码]
    B --> C[复用 set_version.py 校验版本及 PEP 440 转换]
    C --> D[npm ci 与 npm run build：类型检查、构建]
    D --> E[上传完整 frontend/dist]
    E --> W[Windows x64 组装 ZIP]
    E --> M[macOS ARM64 组装 ZIP]
    W --> WC[全新 Python 3.12 环境安装运行依赖与 pip check]
    M --> MC[全新 Python 3.12 环境安装运行依赖与 pip check]
    WC --> WS[解压包检查：页面、资源、API、优雅退出]
    MC --> MS[解压包检查：页面、资源、API、优雅退出]
    WS --> G{两个平台均成功?}
    MS --> G
    G -->|否| F[工作流失败，不进入草稿创建]
    G -->|是| H{由标签 push 触发?}
    H -->|否| I[保留 Actions 构建产物]
    H -->|是| J[复核 ZIP 校验和]
    J --> K[创建草稿并上传 ZIP 与 SHA256SUMS.txt]
    K --> L[维护者下载验收、检查说明与预发布标记]
    L --> N[维护者公开 Release]
```

发布工作流前端执行 `npm ci` 和 `npm run build`，保留 TypeScript 类型检查与 Vite 构建，不运行 Vitest；开发者发布前在本地执行 `npm run check` 完成前端测试。后端仅安装运行依赖，不运行 pytest、不访问真实 OneDrive、不执行文件重命名。启动检查使用临时解压目录、临时本地根目录和独立状态文件，通过停止文件退出服务；它不能替代 PowerShell/Bash 交互、浏览器、OAuth 和真实业务验收。

## 首次配置与验收

1. 将发布工作流、脚本与说明经代码审查合入 `main`。仓库需允许 GitHub Actions、官方 actions 及工作流声明的 `contents: write` 权限。写权限仅用于创建草稿的 job，其他 job 为只读；使用内置 `GITHUB_TOKEN`，无需另建 PAT 或配置云盘凭据。
2. 在 **Actions → Release ZIPs → Run workflow** 选择包含新工作流的分支，先执行一次完整构建检查。每个成功的平台产物名为 `release-package-windows` / `release-package-macos`，其中含 ZIP 与对应 `.zip.sha256`；工作流产物外层压缩包需要先解压，取得其中的发布 ZIP。
3. 在两台目标系统上使用无 `.runtime` 的解压包，按 [LAUNCHER.md](LAUNCHER.md) 完成全新安装、后续离线启动、中文/空格路径、端口冲突、重复启动、正常及执行中退出等验收。
4. 使用测试副本核对 Local 预览/执行、OneDrive 登录与重启后的刷新、测试项目预览/执行，以及更新后保留连接、授权和偏好。未通过实机验收的平台不能仅凭 CI 启动检查宣布支持。

GitHub 运行器标签与架构见[官方运行器说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。草稿与预发布选项见 [GitHub CLI 发布命令](https://cli.github.com/manual/gh_release_create)。

## 发布新版本的操作流程

以下命令由维护者在仓库根目录执行，示例为本次 `v1.0.0-alpha2`；下一次内测改为 `v1.0.0-alpha3`。

1. 在开发分支准备版本及说明，检查差异：

   ```powershell
   $releaseTag = 'v1.0.0-alpha2'
   python scripts/set_version.py $releaseTag --dry-run
   python scripts/set_version.py $releaseTag
   python scripts/set_version.py $releaseTag --check
   git diff
   ```

   脚本支持从其他目录通过完整路径调用。`--check` 一致时退出码为 0，不一致为 1；参数错误也返回非 0。只同步自身版本，不更新依赖、不提交、不打标签。

2. 由维护者在 `frontend/` 本地执行 `npm ci` 和 `npm run check`，完成前端测试、类型检查与构建，以及必要的人工验收，再审查并提交变更，经开发分支和 PR 合并到 `main`。发布工作流不重复运行 Vitest。不要将状态文件、凭据、虚拟环境或构建输出加入提交。本步骤不由版本脚本自动完成。
3. 确认本地工作区干净，再更新本地 `main`，确认版本检查成功后打标签并推送：

   ```powershell
   git switch main
   if ($LASTEXITCODE -ne 0) { throw '切换 main 失败，请先处理 Git 状态。' }
   git pull --ff-only origin main
   if ($LASTEXITCODE -ne 0) { throw '更新 main 失败，请先处理 Git 状态。' }
   $releaseTag = 'v1.0.0-alpha2'
   python scripts/set_version.py $releaseTag --check
   if ($LASTEXITCODE -ne 0) { throw '版本不一致，不能发布。' }
   git tag -a $releaseTag -m "Rename Studio $releaseTag"
   if ($LASTEXITCODE -ne 0) { throw '标签创建失败，请检查是否已存在。' }
   git push origin $releaseTag
   ```

   普通代码 Push 不会创建 Release；需要推送标签本身。工作流读取标签所指提交的代码，不会用 `main` 最新代码替换它。

4. 在 **Actions → Release ZIPs** 确认三个构建检查 job 成功、草稿创建 job 成功。失败时阅读对应 job 日志，不公开失败或不完整产物。
5. 在 **Releases** 打开草稿，确认版本、提交、更新说明以及三个附件：

   ```text
   Rename_Studio-v1.0.0-alpha2-windows.zip
   Rename_Studio-v1.0.0-alpha2-macos.zip
   SHA256SUMS.txt
   ```

   下载对应平台 ZIP，核对校验和并执行发布包验收。内测版保留 **Pre-release** 标记。确认后手动点击 **Publish release**；用户下载带系统名称的附件，GitHub 自动附带的 Source code ZIP 不含前端构建产物。

Windows 校验单个附件可用 `Get-FileHash -Algorithm SHA256 .\Rename_Studio-v1.0.0-alpha2-windows.zip`；macOS 可用 `shasum -a 256 Rename_Studio-v1.0.0-alpha2-macos.zip`。将结果与 `SHA256SUMS.txt` 中对应行比较，只下载一个平台时只核对该 ZIP。

## 浏览器扩展独立发布

扩展工作流为 [.github/workflows/browser-release.yml](../.github/workflows/browser-release.yml)。首次使用需将该文件合入默认分支，Actions 页面才会显示手动运行入口；仓库需允许 GitHub Actions，草稿 job 使用内置 `GITHUB_TOKEN` 的 `contents: write` 权限。无需商店凭据或额外 PAT。

1. 在开发分支设置扩展版本，以下 `0.3.0` 仅为示例；在仓库根目录执行：

   ```powershell
   $browserVersion = '0.3.0'
   python scripts/set_version.py $browserVersion --target browser --dry-run
   python scripts/set_version.py $browserVersion --target browser
   python scripts/set_version.py $browserVersion --target browser --check
   if ($LASTEXITCODE -ne 0) { throw '扩展版本不一致，不能发布。' }
   ```

2. 按[扩展 README](../extensions/browser/README.md#回归命令用户执行)执行本地回归与人工验收，提交、审查并合入 `main`。可先在 **Actions → Release Browser Extension → Run workflow** 选择待验收分支构建；成功后下载 `browser-package-vX.Y.Z` artifact。它包含独立 ZIP 和 `SHA256SUMS.txt`，不是已公开的 Release。该工作流只安装扩展依赖、构建及检查包资源，不运行本体测试或真实浏览器验收。
3. 确认发布提交后，在 `main` 上推送独立标签。以下 Git 命令由维护者执行；版本操作不代表批准提交或推送：

   ```powershell
   git switch main
   git pull --ff-only origin main
   if ($LASTEXITCODE -ne 0) { throw '更新 main 失败，请先处理 Git 状态。' }
   $browserVersion = '0.3.0'
   $browserTag = "browser-v$browserVersion"
   python scripts/set_version.py $browserVersion --target browser --check
   if ($LASTEXITCODE -ne 0) { throw '扩展版本不一致，不能发布。' }
   git tag -a $browserTag -m "Rename Studio Browser v$browserVersion"
   if ($LASTEXITCODE -ne 0) { throw '标签创建失败，请检查是否已存在。' }
   git push origin $browserTag
   ```

4. 工作流读取标签提交，要求标签等于 `browser-v` 加 manifest 版本，并通过 `set_version.py --target browser --check` 校验 package 和 lockfile。使用 Node 22、`npm ci` 和 `npm run build`，仅打包 `extensions/browser/dist/production`，确认版本、发布版 origin、内容脚本、双语资源和图标存在。本体不用重新构建；Chrome/Edge 共用这一份发布包。
5. 构建成功后生成 `Rename_Studio-Browser-v0.3.0.zip` 和 `SHA256SUMS.txt`，验证校验和后自动创建 **Rename Studio Browser v0.3.0** 草稿。ZIP 根目录直接包含 `manifest.json`，不含源码、node_modules 或开发版。扩展 Release 固定不设为仓库 Latest，避免覆盖本体默认下载入口；本体和扩展的版本号均保持独立。
6. 下载草稿附件，核对校验和，按[发布包安装教程](../extensions/browser/README.md#安装发布包)加载并完成真实跳转验收。在草稿中补充本次改动和**实际验收的本体版本**；确认后手动点击 **Publish release**。浏览器消息协议版本仍按 [BROWSER_INTEGRATION.md](BROWSER_INTEGRATION.md) 管理，不随软件版本递增。

```mermaid
flowchart TD
    A[推送 browser-vX.Y.Z 标签] --> C[校验扩展独立版本]
    B[Actions 手动运行] --> C
    C --> D[扩展发布版构建与资源检查]
    D --> E[ZIP 与 SHA256SUMS.txt 上传为 artifact]
    E --> F{标签推送触发?}
    F -->|否| G[下载验收包，不创建 Release]
    F -->|是| H[复核校验和，创建扩展 Release 草稿]
    H --> I[人工安装验收，补充配套本体版本]
    I --> J[维护者公开 Release，不设为 Latest]
```

任一步骤失败不继续创建草稿。已有同标签 Release（包括草稿）时拒绝覆盖；草稿上传中断后的处理、网络故障重跑和已公开版本修复遵循下方“失败与重跑”。扩展更新无需重发本体，本体发布也不重复附带扩展 ZIP。

## 本地组包与启动检查

本地组包与检查命令在源码仓库中执行，用户 ZIP 不包含这些开发脚本。需要已有完整 `frontend/dist`，先由维护者在 `frontend/` 执行 `npm ci` 和 `npm run check`，再回到仓库根目录：

```powershell
python scripts/build_release.py v1.0.0-alpha2 --platform windows
python scripts/build_release.py v1.0.0-alpha2 --platform macos
```

两个命令可在同一系统组装对应文件集合，不能据此宣称另一平台运行通过。输出默认位于被 Git 忽略的 `dist/releases/`；可用 `--output` 指定另一输出目录。已有同名 ZIP 或校验文件时拒绝覆盖，应更换空输出目录或由维护者处理旧输出后重建。

脚本从空临时目录按白名单组包，只包括后端 Python 源码、元数据与运行依赖清单、完整前端产物、平台入口、面向用户的 README 和 LICENSE。macOS 包额外包含启动控制器；发布包 README 链接到对应版本的在线启动说明。不复制整个 backend，不依赖 `.gitignore` 排除用户状态。发现本地数据混入、版本不一致或 Shell 换行错误时失败。

ZIP 内只有一个 `Rename_Studio/` 根目录。每个平台另生成 `.zip.sha256`；Actions 汇总并复核后生成面向用户的 `SHA256SUMS.txt`。

启动检查需在目标平台使用只安装运行依赖的独立 Python 环境执行，示例为 Windows：

```powershell
# 在仓库之外自行选择一个全新的检查环境目录
python -m venv "$env:TEMP\rename-studio-release-check"
& "$env:TEMP\rename-studio-release-check\Scripts\python.exe" -m pip install -r backend/requirements-runtime.txt
& "$env:TEMP\rename-studio-release-check\Scripts\python.exe" -m pip check
& "$env:TEMP\rename-studio-release-check\Scripts\python.exe" scripts/check_release.py dist/releases/Rename_Studio-v1.0.0-alpha2-windows.zip
```

macOS 使用独立环境的 `bin/python` 和 macOS ZIP。检查时端口 8000 必须空闲；检查脚本不会停止其他已运行服务。检查不调用交互式启动器、不打开浏览器，不能替代用户启动验收。

## 失败与重跑

- 构建或平台检查失败：不创建草稿。基础设施或网络临时失败且代码无需改变时，可在 Actions 重跑失败 job 或全部 job；CI artifact 允许覆盖，Release 附件不覆盖。
- 草稿创建或附件上传中途失败：可能残留不完整草稿；维护者检查后，仅删除该未公开草稿，保留标签，再重跑草稿 job。工作流拒绝覆盖任何已有同标签 Release（含草稿），不会自动删除或公开它。
- 需要修改代码或已公开版本有问题：修改并按新版本重新发布；不强推或重用已发布标签，不替换已公开附件。
- 新版依赖未在目标平台安装通过：修正运行依赖清单并重新验收，不能绕过检查发布。GitHub 镜像检查通过也不代表所有较旧的系统版本兼容。

ZIP 保留了单进程发布模式；开发仍使用 Vite 与 `app.main:app --reload`。更新安装时先退出应用，替换程序与完整前端，保留用户状态、`.env` 和 `.runtime`，详见启动文档。
