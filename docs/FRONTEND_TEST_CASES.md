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
| 工作区按 browser_auth 判定授权；元数据 pending/error/missing 不读取授权或文件，恢复后使用原目录；元数据刷新失败保留账号身份、任务与选择 | [存储 Hook](../frontend/src/workspace/hooks/useWorkspaceStorage.test.ts) |
| 非 Local 且无需浏览器授权的服务恢复 ID 位置，不发授权请求；未知 OAuth 服务等待授权，不支持的位置类型不请求 | 存储 Hook |
| 目录按钮分别按 browser_auth/local_picker 展示，侧栏图标按 icon 展示，未授权提示使用 Provider 名称；无浏览器授权服务的选择随成功列表同步 | 工作台集成、工作流 Hook |
| 选择及规则变化使旧预览失效；保留替换 ID、释放迟到或结束任务的预览 | [工作流 Hook](../frontend/src/features/rename/useRenameWorkflow.test.ts)、工作台集成 代表性 UI 接线 |
| 排序与完整列表、预览、1001 项分批保持一致；草稿可重排并保留任务身份与原始快照，执行后冻结顺序并保留 Local 新 ID 与已有记录 | 工作流 Hook、[Rename Store](../frontend/src/stores/useRenameStore.test.ts)、工作台集成、[虚拟列表](../frontend/src/features/files/FileBrowser.virtual.test.tsx) |
| 刷新只移除已消失的选择，失败保留选择；过滤隐藏项不恢复旧选择 | 工作流 Hook、工作台集成、[FileBrowser](../frontend/src/features/files/FileBrowser.test.tsx) |
| 1000 / 2000 项分批、固定任务快照、成功项不重复选择、失败重试与未知结果显式核对 | [Rename Store](../frontend/src/stores/useRenameStore.test.ts)、工作流 Hook |
| 执行成功或响应丢失后暂停自动目录读取，允许人工刷新；合并服务端确认的文件身份 | 工作流 Hook、Rename Store |
| 部分成功并伴随未知/缺失结果时，文件身份、缓存、原始快照、批次记录与重试集合一致；重新全选不包含成功/未知项，后续预览只提交明确失败项 | 工作流 Hook、Rename Store |
| 执行前确认，未变化批次也必须确认，进度失败不虚构结果，执行中锁定控件 | [RenameActions](../frontend/src/features/rename/RenameActions.test.tsx)、工作台集成 |
| 全选和过滤覆盖完整数据集，包括虚拟列表未挂载的行；未知身份禁止选择 | FileBrowser、[虚拟列表](../frontend/src/features/files/FileBrowser.virtual.test.tsx) |
| 恢复出厂设置失败显示错误，保留规则、配置、路径记忆与当前连接，并保持确认框打开 | 工作台集成 |
| 连接执行期间不能编辑，默认连接不能删除 | [StorageSettingsPanel](../frontend/src/features/settings/StorageSettingsPanel.test.tsx) |
| 预览创建传递替换 ID，释放只针对指定预览；错误项不能计入可修改数量 | [API client](../frontend/src/api/client.test.ts)、[PreviewPanel](../frontend/src/features/rename/PreviewPanel.test.tsx) |

## 业务功能、异常与交互

翻译工作流的补充覆盖：[检查器](../frontend/scripts/check-i18n.test.mjs) 验证 JSON/重复属性、非法或重复元数据、命名空间、结构、插值、zh-CN 完整性、社区语言缺词报告，以及代码和新增注册元数据缺词失败；[Vite 目录发现](../frontend/src/i18n/catalog.test.ts) 验证模拟语言自动发现和跨命名空间英文回退。[语言解析](../frontend/src/i18n/languages.test.ts) 覆盖浏览器候选顺序与变体；偏好恢复、重置、任务独立和 Rule/Provider 交互沿用下表已有测试。人工复核步骤见 [TRANSLATING](TRANSLATING.md)。

| 场景 | 自动化承接位置 |
|---|---|
| 默认云目录恢复、导航后保存；重新进入优先使用尚未设为默认值的工作路径；缺账号不保存，读取/保存/目录请求失败不覆盖配置 | 工作台集成、[存储 Hook](../frontend/src/workspace/hooks/useWorkspaceStorage.test.ts) |
| 标签会话记忆：多本地连接位置隔离、刷新重挂载恢复当前连接与服务端规范位置、新会话回到根目录；旧连接版本、其他账号位置和损坏数据不复用，目录读取失败保留成功位置，浏览器存储禁用时保留内存状态并提示 | 存储 Hook；云端重新进入由 工作台集成 承接，真实刷新及关闭标签行为由人工验收 |
| 同连接点击保留进行中的导航、任务和预览；设置页两种返回入口保留路径；连接删除返回默认 Local、非当前连接配置变化和断开授权清理旧记忆，旧连接/旧版本的迟到目录响应不覆盖记忆 | 存储 Hook、工作台集成 |
| 本地文件夹选择确认后清理任务，取消保留任务 | 存储 Hook；UI 入口按人工清单检查 |
| 超上限只在请求预览时提示；取消不建任务、继续只提交一批、偏好保存到后端 | 工作流 Hook；提示框交互按人工清单检查 |
| 核对选择保留部分执行结果，普通选择清除旧结果 | 工作流 Hook；[PreviewPanel](../frontend/src/features/rename/PreviewPanel.test.tsx) 验证结果和筛选展示 |
| 主题跟随系统、服务器偏好恢复、保存失败回退、连续编辑串行、迟到读取不覆盖保存 | [主题偏好 Hook](../frontend/src/features/settings/useThemePreference.test.ts) |
| 自动发现语言、浏览器候选优先级与简繁边界、显式/不可用偏好和英文回退；有效语言日期格式化 | [语言解析](../frontend/src/i18n/languages.test.ts) |
| 首次读取门控、语言即时切换与持久化恢复、保存失败回退、连续切换、auto 跟随浏览器且不重挂载 | [语言 Provider](../frontend/src/i18n/LanguageProvider.test.tsx) |
| 设置语言菜单接线、读取失败的本地化警告、保存失败通知、切换时保留选择且不重新请求目录/元数据 | 工作台集成 |
| 已有预览与确认框随语言更新；保持任务快照、选中项和降序排列，不额外预览、执行或释放快照 | 工作台集成 |
| 错误类别只按稳定 code 翻译，原始 message/details 保留，未知 code 或普通异常不从英文内容推断类别 | [错误翻译](../frontend/src/i18n/messages.test.ts) |
| 连接创建/编辑/关闭草稿、本地选择器、授权状态与失败保留输入 | StorageSettingsPanel |
| 打开的连接编辑器随语言更新，保留名称/目录草稿，未知字段显示稳定 ID，不发保存或元数据请求 | StorageSettingsPanel |
| 未硬编码的 Provider 根据字段元数据渲染、校验必填、按字段 key 回填目录、提交多个配置及 nullable 空值；无 browser_auth 不请求授权，定义缺失禁止编辑和创建 | StorageSettingsPanel |
| 编辑密钥留空不提交；失败保留新密钥、重试成功后清空，密码不回显 | StorageSettingsPanel |
| 任意 Provider 通过元数据定义配置字段及密码式顶层密钥，缺词显示原始 Provider/字段 ID；创建/切换/重开清空，配置不完整禁用登录，授权弹窗校验来源和连接 | StorageSettingsPanel |
| 明确不可重命名项在权限变化后退出旧选择和预览请求，未知权限项保留 | 工作流 Hook |
| 目录语义导航、文本选择不误导航、任务过滤、目录折叠与键盘/滚动访问 | FileBrowser、虚拟列表、[LocationBreadcrumbs](../frontend/src/features/files/LocationBreadcrumbs.test.tsx) |
| 虚拟列表先对完整数据排序再截取渲染行；切换排序重置滚动位置，全选使用完整排序结果 | [虚拟列表](../frontend/src/features/files/FileBrowser.virtual.test.tsx) |
| 规则添加、编辑、移动、复制、删除及数字草稿归属；加载时禁止添加，溢出菜单仍可访问 | [RuleEditor](../frontend/src/features/rules/RuleEditor.test.tsx)、[RuleFields](../frontend/src/features/rules/RuleFields.test.tsx) |
| Rule 菜单、说明 Tooltip、卡片与 ARIA 按 type 翻译；切换后继续提交原始 type/config，未知规则显示 ID | RuleEditor |
| Local/OneDrive/Google Drive 双语字段、新建/编辑/已保存密钥帮助、未授权状态及账号缺省文案；原始 key/value 与顶层密钥提交 | StorageSettingsPanel |
| 扩展 Provider 回退英文词典，未翻译字段显示 ID，不使用 Schema title；未知类型仍按能力渲染并提交原配置 | StorageSettingsPanel |
| API 偏好 PATCH / 恢复接口 / 进度 ID 编码；结构化错误、HTML 网关错误和代表性非法 JSON；成功、204、网络失败 | API client |
| 通知五秒关闭、新通知独立计时、连续消息不泄漏中间消息、过期预览提供操作提示；翻译键通知随语言切换更新且不重复创建，数量插值正确，路径作为纯文本保留 | [NotificationProvider](../frontend/src/components/NotificationProvider.test.tsx) |

优先级按失败后果确定。删除连接的确认形式、狭窄空间布局等交互不再单独标为 P0。视觉和真实浏览器行为不靠 JSDOM 推断；检查步骤及本轮迁移记录见人工验收清单。

## CI 基础设施

[PR 差异分流](../frontend/scripts/ci-scope.test.mjs) 覆盖无关改动、纯翻译、翻译与其他文件混合、删除/移动资源、默认词典结构变化、前端及 Rule/Provider 元数据改动、手动触发、merge-base 和 NUL 文件名解析，以及 Git/JSON 错误传播。它验证分流脚本，不代表 GitHub Actions 已运行；工作流触发、必需检查与产物上传由实际 PR 人工确认。
