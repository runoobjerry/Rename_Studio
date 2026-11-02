# 阶段二 Provider 错误标准化：人工核实

本清单不表示测试已通过。Codex 只完成静态检查；编译、测试、构建及真实存储验收由人工执行。分类和字段定义以 [API 错误契约](api/common/errors.md#阶段二-provider-落点) 为准。

## 1. 本地回归测试

在 `backend` 目录、已配置项目依赖的 Python 环境执行：

```powershell
python -m pytest tests/test_local_provider.py tests/test_onedrive_provider.py tests/test_google_drive_provider.py tests/test_onedrive_auth.py tests/test_google_drive_auth.py tests/test_storage_rename_contract.py tests/test_single_rename_service.py
```

应核实：

- 本地 OS 错误对应缺失、权限、冲突、校验及 Provider 错误；同一失败只提交一次，异常链保留 errno。
- 本地已完成改名但确认元数据不可读的直接 Provider 用例已移除；该场景保留在 `test_api.py` 的单项/批量 API 用例中，执行方法见[阶段四验收清单](RESULT_CONTRACT_ACCEPTANCE.md)。
- Graph 的现有 HTTP 权限/限流分类及标准诊断字段保持正确，Google reason 及附加正文筛选由现存分类用例覆盖；Graph 嵌套码和 412 应用原因的专用用例已移除。
- 授权失败仍只在明确拒绝时导致原有断连/版本失效；429、503、网络故障保留已有授权。
- 既有批量、部分成功、未知结果暂停补组、取消等待在途写入和单项核实不重放的测试继续通过。

429、5xx、响应丢失及确认元数据失败使用测试中的 MockTransport / 文件系统边界故障复现，不需要对真实账号制造限流或大量写入。

## 2. Windows 文件占用

仅使用独立测试目录和可丢弃文件，在 UI 创建指向该目录的 Local 连接。先新建 `locked.txt`，在另一个 PowerShell 窗口执行（替换实际测试文件的绝对路径）：

```powershell
$probeHandle = [System.IO.File]::Open('C:\实际测试目录\locked.txt', 'Open', 'ReadWrite', 'None')
try { Read-Host '保持文件占用，完成界面重命名检查后按回车释放' }
finally { $probeHandle.Dispose() }
```

占用期间在 UI 用单项改名尝试改为 `renamed.txt`。预期文件未修改、无自动重复写入；浏览器开发者工具 Network 的执行响应中为 `PROVIDER_ERROR`，详情含 `provider_type: local` 和系统实际提供的 `errno` / `winerror`（共享/锁定错误通常为 32/33）。释放句柄后手动刷新，按现有流程重新提交应成功。若安全软件或文件系统允许改名，以系统实际行为为准，记录实际编号，不为了满足测试而修改真实目录权限。

## 3. OneDrive / Google Drive 各一次真实验证

使用专用测试文件夹和可丢弃文件，分别完成目录浏览、一次单项改名、一次两文件规则批量改名。预期元数据、身份更新、预览消费和成功项保留与阶段一一致；Google 继续允许第三方自身支持的同名行为。

若有可用的只读共享文件，在 UI 单项改名确认真实权限拒绝：记录 Network 中的逐项错误码、provider_status/provider_codes（若提供），以及实际文件名，确认不因第三方英文文案决定状态。没有可用只读资源时，此项记录为未实测，使用回归测试验证映射；无需更改生产账号权限。

无效 OAuth 配置仅在新建的测试连接检查：填写无效 Client ID（Google 同时填测试用无效 Secret）再授权，预期统一授权错误；响应 details 仅含 Provider 类型和 HTTP 状态，不含 Secret、令牌、请求头或第三方 OAuth 正文。取消用户授权或浏览器直接拒绝无效 Client ID 可能发生在回调前，不能作为令牌接口分类已实测的证据；该边界由 MockTransport 测试覆盖。已有可用连接不用于此检查。

## 4. 检查点与未覆盖风险

报告测试命令结果、操作系统及文件系统类型、两类云盘实测结果、未具备条件的项目即可。无需提供包含令牌或密钥的 HAR / 网络截图。

本阶段没有重新设计本地 rename 的跨平台原子防覆盖行为或网络挂载写入确定性，也没有调整重试预算。Windows 占用、ACL 和网络挂载行为仍依赖实际文件系统；未做对应实测时明确记录，不以模拟测试代替实测结论。阶段二验收确认后才进入下一阶段，提交和推送另行批准。
