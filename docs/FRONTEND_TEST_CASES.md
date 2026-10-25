# 前端测试覆盖清单

本文件只维护关键场景、验证层级和源文件链接。实际测试名称、参数、断言以源码为准；用例数与通过状态以 `npm test` / CI 的 Vitest 输出为准，不再手工维护总数、各文件数量和逐项中文副本。

工作台集成按业务拆分：[存储导航与隔离](../frontend/src/WorkspaceApp.storage.test.tsx)、[重命名接线](../frontend/src/WorkspaceApp.test.tsx)、[语言与恢复出厂设置](../frontend/src/WorkspaceApp.preferences.test.tsx)。下文“工作台集成”按场景对应这三个入口。测试层级及工具见 [测试指南](FRONTEND_TESTING.md)，后续编写使用 [约束提示词](FRONTEND_TEST_PROMPT.md)。

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
| 连接/账号/目录隔离，旧目录与旧预览不能污染新工作区 | [工作台存储集成](../frontend/src/WorkspaceApp.storage.test.tsx)、[默认云目录](../frontend/src/features/files/defaultCloudLocation.test.ts) |
| 工作区按 browser_auth 判定授权；元数据 pending/error 不读取授权或文件，恢复后使用原目录；元数据刷新失败保留账号身份与选择 | [存储 Hook](../frontend/src/workspace/hooks/useWorkspaceStorage.test.ts) |
| 非 Local 且无需浏览器授权的服务恢复 ID 位置，不发授权请求；未知 OAuth 服务等待授权，不支持的位置类型不请求 | 存储 Hook |
| 无浏览器授权服务的选择随成功列表同步 | 工作流 Hook |
| 选择及规则变化使旧预览失效；保留替换 ID、释放迟到或工作区变化后的预览 | [工作流 Hook](../frontend/src/features/rename/useRenameWorkflow.test.ts)、工作台集成 代表性 UI 接线 |
| 多次改名保留原始快照及任务身份，确认的 Local ID 随执行更新 | [Rename Store](../frontend/src/stores/useRenameStore.test.ts)、工作流 Hook |
| 首次刷新预览创建固定任务；禁止新增成员；规则变化和目录缺项不重建任务，结束任务释放预览 | 工作流 Hook |
| 排序作用于完整列表和全部选中项，超过 1000 项也一次提交；改变排序使旧预览失效 | 工作流 Hook、工作台集成、[虚拟列表](../frontend/src/features/files/FileBrowser.virtual.test.tsx) |
| 刷新只移除已消失的选择，失败保留选择；过滤隐藏项不恢复旧选择 | 工作流 Hook、工作台集成、[FileBrowser](../frontend/src/features/files/FileBrowser.test.tsx) |
| 执行成功或响应丢失后暂停自动目录读取，允许人工刷新；合并服务端确认的文件身份 | 工作流 Hook |
| 部分成功伴随未知/缺失结果时，只合并确认身份，阻止新的预览和写入；成功项可重新选择 | 工作流 Hook |
| 执行前确认，无变化时禁止执行，进度失败不虚构结果，执行中锁定控件 | [RenameActions](../frontend/src/features/rename/RenameActions.test.tsx)、工作台集成 |
| 未知执行结果由独立状态锁定；取消核对保留锁定，明确确认后清空选择并要求重新预览 | 工作台集成 |
| 全选和过滤覆盖完整数据集，包括虚拟列表未挂载的行 | FileBrowser、[虚拟列表](../frontend/src/features/files/FileBrowser.virtual.test.tsx) |
| 恢复出厂设置失败显示错误，保留规则、配置、路径记忆与当前连接，并保持确认框打开 | 工作台集成 |
| 预览创建传递替换 ID，释放只针对指定预览；错误项不能计入可修改数量 | [API client](../frontend/src/api/client.test.ts)、[PreviewPanel](../frontend/src/features/rename/PreviewPanel.test.tsx) |
| 单项改名直接提交完整目标名称、原名及连接版本，连接及位置使用真实 ID，不请求预览 | API client |
| 单项改名保留文件扩展名，无扩展名文件（如 .env）与文件夹按完整名称处理；普通目录不创建任务，成功后保留服务端确认的新 ID 选择 | [单项改名工作流](../frontend/src/features/rename/useSingleRenameWorkflow.test.ts) |
| 任务内单项改名保留成员、原始快照和其他成员结果，不修改规则链；打开或取消编辑保留批量预览，提交才失效并要求重新预览 | 单项改名工作流 |
| 单项直接执行的重复提交保护及刷新错误/忙碌门控 | 单项改名工作流 |
| 单项明确失败可重试；写入结果缺失、未知、响应丢失或成功但缺少确认元数据时锁定后续单项与批量改名 | 单项改名工作流 |
| 虚拟列表滚动后，选中项的 Edit 仍使用正确文件 ID | [虚拟列表](../frontend/src/features/files/FileBrowser.virtual.test.tsx) |
| 单项 Dialog 切换语言后更新标签，保留用户输入的主名与扩展名 | [SingleRenameDialog](../frontend/src/features/rename/SingleRenameDialog.test.tsx) |
| 从行内 Edit 直接执行单项改名，请求中显示进度并禁用输入、取消和应用，成功更新选择 | [工作台重命名接线](../frontend/src/WorkspaceApp.test.tsx) |

## 业务功能、异常与交互

翻译工作流的补充覆盖：[检查器](../frontend/scripts/check-i18n.test.mjs) 验证 JSON/重复属性、非法或重复元数据、命名空间、结构、插值、zh-CN 完整性、社区语言缺词报告，以及代码和新增注册元数据缺词失败；[Vite 目录发现](../frontend/src/i18n/catalog.test.ts) 验证模拟语言自动发现和跨命名空间英文回退。[语言解析](../frontend/src/i18n/languages.test.ts) 覆盖浏览器候选顺序与变体；偏好恢复、重置、工作区独立和 Rule/Provider 交互沿用下表已有测试。人工复核步骤见 [TRANSLATING](TRANSLATING.md)。

| 场景 | 自动化承接位置 |
|---|---|
| 默认云目录恢复、导航后保存；重新进入优先使用尚未设为默认值的工作路径；读取/目录请求失败不覆盖配置 | 工作台集成、[存储 Hook](../frontend/src/workspace/hooks/useWorkspaceStorage.test.ts) |
| 标签会话记忆：刷新重挂载恢复当前连接与服务端规范位置、新会话回到根目录；旧连接版本、其他账号位置和损坏数据不复用，目录读取失败保留成功位置 | 存储 Hook；云端重新进入由 工作台集成 承接，真实刷新及关闭标签行为由人工验收 |
| 同连接点击保留进行中的导航、选择和预览；设置页两种返回入口保留路径；连接删除返回默认 Local、非当前连接配置变化和断开授权清理旧记忆，旧连接/旧版本的迟到目录响应不覆盖记忆 | 存储 Hook、工作台集成 |
| 普通选择变化清除旧预览和执行展示 | 工作流 Hook；[PreviewPanel](../frontend/src/features/rename/PreviewPanel.test.tsx) 验证结果和筛选展示 |
| 显式主题保存与重挂载恢复、保存失败回退、前次保存失败后继续处理队列、迟到读取不覆盖保存 | [主题偏好 Hook](../frontend/src/features/settings/useThemePreference.test.ts) |
| 自动发现语言、浏览器候选优先级与简繁边界、显式/不可用偏好和英文回退；有效语言日期格式化 | [语言解析](../frontend/src/i18n/languages.test.ts) |
| 首次读取门控、语言即时切换与持久化恢复、保存失败回退、连续切换、auto 跟随浏览器且不重挂载 | [语言 Provider](../frontend/src/i18n/LanguageProvider.test.tsx) |
| 设置语言菜单接线、读取失败的本地化警告、保存失败通知、切换时保留选择且不重新请求目录/元数据 | 工作台集成 |
| 已有预览与确认框随语言更新；保持选中项和降序排列，不额外预览、执行或释放快照 | 工作台集成 |
| 错误类别只按稳定 code 翻译，原始 message/details 保留，未知 code 或普通异常不从英文内容推断类别 | [错误翻译](../frontend/src/i18n/messages.test.ts) |
| 连接创建/编辑/关闭草稿、本地选择器、授权状态与失败保留输入 | StorageSettingsPanel |
| 未硬编码的 Provider 根据字段元数据渲染、校验必填、按字段 key 回填目录、提交多个配置及 nullable 空值；无 browser_auth 不请求授权，定义缺失禁止编辑和创建 | StorageSettingsPanel |
| 编辑密钥留空不提交；失败保留新密钥、重试成功后清空，密码不回显 | StorageSettingsPanel |
| 任意 Provider 通过元数据定义配置字段及密码式顶层密钥，缺词显示原始 Provider/字段 ID；创建/切换/重开清空，配置不完整禁用登录，授权弹窗校验来源和连接 | StorageSettingsPanel |
| 明确不可重命名项在权限变化后退出旧选择和预览请求，未知权限项保留 | 工作流 Hook |
| 目录语义导航、文本选择不误导航、目录折叠与键盘/滚动访问 | FileBrowser、虚拟列表、[LocationBreadcrumbs](../frontend/src/features/files/LocationBreadcrumbs.test.tsx) |
| 虚拟列表先对完整数据排序再截取渲染行；切换排序重置滚动位置，全选使用完整排序结果 | [虚拟列表](../frontend/src/features/files/FileBrowser.virtual.test.tsx) |
| 规则添加、编辑、移动、复制、删除及数字草稿归属；加载时禁止添加，溢出菜单仍可访问；公共数字字段的草稿、边界提交及规则字段接线 | [RuleEditor](../frontend/src/features/rules/RuleEditor.test.tsx)、[RuleFields](../frontend/src/features/rules/RuleFields.test.tsx)、[NumberField](../frontend/src/components/NumberField.test.tsx) |
| 未知规则显示稳定 ID，切换启用状态保留原始 type/config | RuleEditor |
| Local/OneDrive 双语编辑字段保留原始连接名称和配置；Google Drive 双语编辑与已保存密钥帮助、未授权状态及账号缺省文案；元数据定义的新建流程验证顶层密钥提交 | StorageSettingsPanel |
| 扩展 Provider 回退英文词典，未翻译字段显示 ID，不使用 Schema title；未知类型仍按能力渲染并提交原配置 | StorageSettingsPanel |
| API 偏好 PATCH / 恢复接口 / 进度 ID 编码；结构化错误、HTML 网关错误和代表性非法 JSON；成功、204、网络失败 | API client |
| 通知五秒关闭、新通知独立计时、连续消息不泄漏中间消息、过期预览提供操作提示；切换语言保持数量插值与真实路径，路径作为纯文本保留 | [NotificationProvider](../frontend/src/components/NotificationProvider.test.tsx) |

优先级按失败后果确定。删除连接的确认形式、狭窄空间布局等交互不再单独标为 P0。视觉和真实浏览器行为不靠 JSDOM 推断；检查步骤及本轮迁移记录见人工验收清单。

## CI 基础设施

[PR 差异分流](../frontend/scripts/ci-scope.test.mjs) 覆盖无关改动、纯翻译、翻译与其他文件混合、删除/移动资源、默认词典结构变化、前端及 Rule/Provider 元数据改动、手动触发、merge-base 和 NUL 文件名解析，以及 Git/JSON 错误传播。它验证分流脚本，不代表 GitHub Actions 已运行；工作流触发、必需检查与产物上传由实际 PR 人工确认。
