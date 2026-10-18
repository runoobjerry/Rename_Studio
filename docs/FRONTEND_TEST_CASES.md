# 前端测试覆盖清单

本文件只维护关键场景、验证层级和源文件链接。实际测试名称、参数、断言以源码为准；用例数与通过状态以 `npm test` / CI 的 Vitest 输出为准，不再手工维护总数、各文件数量和逐项中文副本。

## 维护规则

- 新功能、实际 Bug 或覆盖范围变化时，只更新受影响的场景行；移动测试时更新链接。
- 仅拆分、合并用例或调整参数而未改变覆盖范围时，无需改清单。
- 业务状态优先在 Store / Hook 验证；组件验证回调和展示；完整工作台只保留关键连接。不要在工作台重复展开同一状态的全部组合。
- 删除或合并前，确认关键断言的承接位置；不能用跳过断言、放宽超时或删除业务保障解决 CI 失败。
- 纯视觉、尺寸、动画与说明文案按 [人工验收清单](UI_MANUAL_ACCEPTANCE.md) 检查。
- 本清单不代表测试已通过，不改变 [半自动验证和 Git 流程](FRONTEND_TESTING.md)。

## 关键业务与安全：优先验证

| 场景 | 自动化承接位置 |
|---|---|
| 连接/账号/目录隔离，旧目录与旧预览不能污染新工作区 | [WorkspaceApp](../frontend/src/WorkspaceApp.test.tsx)、[默认云目录](../frontend/src/features/files/defaultCloudLocation.test.ts) |
| 选择及规则变化使旧预览失效；保留替换 ID、释放迟到或结束任务的预览 | [工作流 Hook](../frontend/src/features/rename/useRenameWorkflow.test.ts)、WorkspaceApp 代表性 UI 接线 |
| 排序与完整列表、预览、1001 项分批保持一致；草稿可重排且旧预览不能复活，执行后冻结顺序并保留 Local 新 ID 与已有记录 | 工作流 Hook、[Rename Store](../frontend/src/stores/useRenameStore.test.ts)、WorkspaceApp、[虚拟列表](../frontend/src/features/files/FileBrowser.virtual.test.tsx) |
| 刷新只移除已消失的选择，失败保留选择；过滤隐藏项不恢复旧选择 | 工作流 Hook、WorkspaceApp、[FileBrowser](../frontend/src/features/files/FileBrowser.test.tsx) |
| 1000 / 2000 项分批、固定任务快照、成功项不重复选择、失败重试与未知结果显式核对 | [Rename Store](../frontend/src/stores/useRenameStore.test.ts)、工作流 Hook |
| 执行成功或响应丢失后暂停自动目录读取，允许人工刷新；合并服务端确认的文件身份 | 工作流 Hook、Rename Store |
| 执行前确认，未变化批次也必须确认，进度失败不虚构结果，执行中锁定控件 | [RenameActions](../frontend/src/features/rename/RenameActions.test.tsx)、WorkspaceApp |
| 全选和过滤覆盖完整数据集，包括虚拟列表未挂载的行；未知身份禁止选择 | FileBrowser、[虚拟列表](../frontend/src/features/files/FileBrowser.virtual.test.tsx) |
| 恢复出厂设置成功清空内存规则、选择及路径记忆并回到默认 Local 根目录，保留其他会话键；取消不请求，失败保留配置和路径记忆 | WorkspaceApp |
| 连接执行期间不能编辑，默认连接不能删除 | [StorageSettingsPanel](../frontend/src/features/settings/StorageSettingsPanel.test.tsx) |
| 预览创建传递替换 ID，释放只针对指定预览；错误项不能计入可修改数量 | [API client](../frontend/src/api/client.test.ts)、[PreviewPanel](../frontend/src/features/rename/PreviewPanel.test.tsx) |

## 业务功能、异常与交互

| 场景 | 自动化承接位置 |
|---|---|
| 默认云目录恢复、导航后保存；重新进入优先使用尚未设为默认值的工作路径；缺账号不保存，读取/保存/目录请求失败不覆盖配置 | WorkspaceApp、[存储 Hook](../frontend/src/workspace/hooks/useWorkspaceStorage.test.ts) |
| 标签会话记忆：多本地连接位置隔离、刷新重挂载恢复当前连接与服务端规范位置、新会话回到根目录；旧连接版本、其他账号位置和损坏数据不复用，目录读取失败保留成功位置，浏览器存储禁用时保留内存状态并提示 | 存储 Hook；云端重新进入由 WorkspaceApp 承接，真实刷新及关闭标签行为由人工验收 |
| 同连接点击保留进行中的导航、任务和预览；设置页两种返回入口保留路径；连接删除返回默认 Local、非当前连接配置变化和断开授权清理旧记忆，旧连接/旧版本的迟到目录响应不覆盖记忆 | 存储 Hook、WorkspaceApp |
| 本地文件夹选择确认后清理任务，取消保留任务 | 存储 Hook；UI 入口按人工清单检查 |
| 超上限只在请求预览时提示；取消不建任务、继续只提交一批、偏好保存到后端 | 工作流 Hook；提示框交互按人工清单检查 |
| 核对选择保留部分执行结果，普通选择清除旧结果 | 工作流 Hook；[PreviewPanel](../frontend/src/features/rename/PreviewPanel.test.tsx) 验证结果和筛选展示 |
| 主题跟随系统、服务器偏好恢复、保存失败回退、连续编辑串行、迟到读取不覆盖保存 | [主题偏好 Hook](../frontend/src/features/settings/useThemePreference.test.ts) |
| 连接创建/编辑/关闭草稿、本地选择器、授权状态与失败保留输入 | StorageSettingsPanel |
| Google 配置顶层密钥、留空保留、保存/关闭/切换清空；配置不完整禁用登录，复用弹窗来源与连接校验 | StorageSettingsPanel |
| Google 服务端 ID 面包屑、同名和含分隔符名称、祖先改名、窄屏折叠菜单；只读/快捷方式不参与选择但保留目录导航 | LocationBreadcrumbs、FileBrowser、工作流 Hook |
| Google 默认/会话位置按账号及版本恢复、断开清理；目录失败返回根目录；ID 浏览到预览确认执行的 UI 接线 | 存储 Hook、WorkspaceApp |
| 目录语义导航、文本选择不误导航、任务过滤、目录折叠与键盘/滚动访问 | FileBrowser、虚拟列表、[LocationBreadcrumbs](../frontend/src/features/files/LocationBreadcrumbs.test.tsx) |
| MUI 表头升降序、选择不随排序变化、锁定提示；中文数字名称自然排序、等价名称稳定比较、真实时间/时区、同时间及缺失值分组置后、不修改源数组 | FileBrowser、[文件排序](../frontend/src/features/files/fileSort.test.ts) |
| 规则添加、编辑、移动、复制、删除及数字草稿归属；加载时禁止添加，溢出菜单仍可访问 | [RuleEditor](../frontend/src/features/rules/RuleEditor.test.tsx)、[RuleFields](../frontend/src/features/rules/RuleFields.test.tsx) |
| API 偏好 PATCH / 恢复接口 / 进度 ID 编码；结构化错误、HTML 网关错误和代表性非法 JSON；成功、204、网络失败 | API client |
| 通知五秒关闭、新通知独立计时、连续消息不泄漏中间消息、过期预览提供操作提示 | [NotificationProvider](../frontend/src/components/NotificationProvider.test.tsx) |

优先级按失败后果确定。删除连接的确认形式、狭窄空间布局等交互不再单独标为 P0。视觉和真实浏览器行为不靠 JSDOM 推断；检查步骤及本轮迁移记录见人工验收清单。
