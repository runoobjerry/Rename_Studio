# 阶段三：重试策略与写入结果人工验收

Codex 仅做静态检查，以下测试及真实存储检查由人工执行。规则以 [API 错误契约](api/common/errors.md#阶段三重试与写入处理) 为准；本清单不表示已经通过。

## 回归测试

在 `backend` 目录使用项目虚拟环境执行（若使用其他虚拟环境，替换 Python 路径）：

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_onedrive_provider.py tests/test_google_drive_provider.py tests/test_storage_rename_contract.py tests/test_single_rename_service.py tests/test_execute_service.py tests/test_api.py
```

检查以下具体证据：

| 场景 | 用例与预期 |
| --- | --- |
| 同组成功、未知、明确拒绝 | OneDrive 的 `test_uncertain_part_preserves_success_and_refusal_without_resubmission`、Google 的 `test_unknown_part_prevents_retry_of_other_refused_parts`；成功不撤回、未知不重放、被拒绝项保留真实错误，尚未提交的后续组才标未尝试。 |
| 超时与不完整数据 | Google 的 `test_ambiguous_write_response_is_never_replayed` 覆盖 503、损坏或缺失响应、错 ID 等；请求已经在模拟存储写入后出现异常，仍只有一次写入。OneDrive 混合组用例覆盖子项 408/503。 |
| 确认名称不是目标 | OneDrive 的 `test_verified_different_batch_name_is_failed_without_replay`，及单项 `test_single_unknown_write_is_reconciled_once_without_replay`；核实第三名称、目标名、不可读取分别得到失败、成功、未知，写入均仅一次。 |
| 暂停补组和核实后恢复 | storage contract 的 `test_unknown_group_pauses_refill_and_drains_other_in_flight_group`；核实未完成前不补组，确认成功后可继续，核实失败则停止并准确列出未尝试项。 |
| 取消与在途写入 | storage contract 的串行取消、并发取消/异常用例及 single service 的取消用例；反复取消也不能提前释放连接，不启动下一组；已启动组完成后才结束，已写文件不回滚。 |
| 冷却与真实等待边界 | Provider 现有 Retry-After 用例；有效秒数/日期优先于退避，非法值回退，其他同连接请求不会绕过共享冷却，最后一次限流仍阻挡随后请求。 |

外层与子项共享总预算的两个专用测试已移除；单层有限重试仍由原有用例覆盖，当前不再由专门用例验证内外层交替限流的累计次数。

这些故障由 HTTP / 文件系统边界模拟，不需对真实账号制造限流、删除真实文件或故意中断生产批次。不要把通过模拟用例表述为已验证真实供应商的所有异常形态。

## UI 与真实存储检查

1. 在 OneDrive 和 Google Drive 各建独立测试目录，放入 3 个可丢弃文件。先做一次单项改名，再对 2 个文件走规则预览和批量执行。核对真实名称、成功数量、确认元数据和旧预览不可重放；Google 继续使用其自身同名语义。
2. 如有测试用只读文件，提交单项改名，检查明确权限失败、没有后台重复提交，其他测试文件仍可正常操作。没有该资源时注明未实测，使用回归测试验证分类。
3. 使用上述模拟用例核实未知及取消，不必通过 UI 制造不确定云写入。浏览器只看到一次 `/rename/execute` 不能证明后端未重放第三方请求；第三方请求次数应以 MockTransport 记录及 Provider 日志为证据。
4. 若在测试环境自然遇到响应丢失：记录 preview/operation ID、请求日志及实际文件名；界面应保留待核对保护，不能自动重放旧预览。目录刷新成功只解锁重新预览，失败继续锁定。不要为完成此项反复发送执行请求。

## 检查点与限制

提交测试结果和上述真实存储检查结果，注明未具备条件的项目。客户端断开或取消不会证明远端停止；已启动组可能继续等待 Retry-After，再按原规则完成/核实。不存在新增的总任务超时，因此不以立即解锁为取消验收标准。

本阶段保留原调度、分页、批大小和并发。没有新增客户端自动或手动重试入口、回滚、恢复状态或后台任务；不以当前名称判断请求是否执行过。确认本阶段验收后才进入下一阶段；Git 提交、推送仍需分别批准。
