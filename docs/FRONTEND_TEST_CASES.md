# 前端测试用例清单

最后核对日期：2026-10-10。

本清单记录 `frontend/src/` 中的前端自动化测试，按故障影响分类。用例名称采用中文描述，实际测试名称和断言以源文件为准。参数化测试按展开后的独立用例计数。

## 维护规则

- 新增、删除、合并、迁移或修改测试覆盖范围时，在同一次变更中同步更新本文件。
- 同步维护源文件链接、用例描述、重要程度、各级数量、各文件数量和总数；修改参数化数据时重新核对展开数量。
- 删除或合并用例时，确认关键业务断言仍有覆盖；重要程度较低不构成删除理由。
- 本清单描述覆盖范围，不替代执行结果；源码和清单不一致时，先核对源码，再修正文档。
- 文档更新不改变既有测试、构建和 Git 操作的授权流程。

## 分类标准与数量

| 级别 | 含义 | 用例数 |
|---|---|---:|
| P0：关键业务与安全 | 防止错误执行、状态污染、跨账号混用和批次重复处理 | 40 |
| P1：业务功能与异常处理 | 保证主要交互、规则配置、接口和错误处理正确 | 53 |
| P2：UI 契约与体验回归 | 保证布局、主题、提示及动画行为符合约定 | 23 |
| **合计** | **15 个测试文件** | **116** |

重要程度用于安排验证优先级，P2 不代表可以删除。

| 测试文件（相对于 `frontend/src/`） | P0 | P1 | P2 | 合计 |
|---|---:|---:|---:|---:|
| `WorkspaceApp.test.tsx` | 17 | 11 | 0 | 28 |
| `stores/useRenameStore.test.ts` | 8 | 0 | 0 | 8 |
| `features/rename/RenameActions.test.tsx` | 3 | 2 | 0 | 5 |
| `features/rename/PreviewPanel.test.tsx` | 1 | 3 | 1 | 5 |
| `features/settings/StorageSettingsPanel.test.tsx` | 1 | 2 | 0 | 3 |
| `features/files/defaultCloudLocation.test.ts` | 2 | 0 | 0 | 2 |
| `features/files/FileBrowser.test.tsx` | 3 | 7 | 2 | 12 |
| `features/files/FileBrowser.virtual.test.tsx` | 3 | 1 | 1 | 5 |
| `features/files/LocationBreadcrumbs.test.tsx` | 1 | 1 | 1 | 3 |
| `features/rules/RuleEditor.test.tsx` | 0 | 7 | 2 | 9 |
| `features/rules/RuleFields.test.tsx` | 0 | 3 | 0 | 3 |
| `api/client.test.ts` | 1 | 12 | 0 | 13 |
| `components/NotificationProvider.test.tsx` | 0 | 4 | 4 | 8 |
| `components/CheckboxFilterMenu.test.tsx` | 0 | 0 | 4 | 4 |
| `theme.test.tsx` | 0 | 0 | 8 | 8 |
| **合计** | **40** | **53** | **23** | **116** |

## P0：关键业务与安全（40 个）

### [WorkspaceApp.test.tsx](../frontend/src/WorkspaceApp.test.tsx)（17 个）

1. 不显示上一个连接迟到的目录响应。
2. 刷新后移除不存在的选择、使旧预览失效，并只提交剩余文件 ID。
3. 连接版本变化后隔离目录缓存，清除旧任务和预览。
4. 文件夹选择器确认新目录时重置任务（`selected=true`）。
5. 过滤隐藏项后清除选择，刷新或取消过滤也不恢复旧选择。
6. 切换账号时不复用上一个账号的目录和选择。
7. 单项选择变化使旧预览失效（`toggle`）。
8. 全选变化使旧预览失效（`select-all`）。
9. 清空选择使旧预览失效（`clear`）。
10. 反选变化使旧预览失效（`invert`）。
11. 核对未知结果时保留部分执行结果，普通选择操作清除旧结果。
12. 执行期间锁定选择控件。
13. 记住批次提示偏好，继续后只提交 1000 项。
14. 选择变化重置预览后保留释放 ID，结束任务时释放预览。
15. 选择上下文变化后释放迟到的预览响应。
16. 规则变化使预览失效，并保留替换所需的旧预览 ID。
17. 切换连接后，将迟到的预览释放到原连接。

### [useRenameStore.test.ts](../frontend/src/stores/useRenameStore.test.ts)（8 个）

1. 重复预览替换草稿，忽略过时预览的执行结果。
2. 替换后续草稿时保留已报告结果和结果未知的批次。
3. 保存结果与 API 响应隔离，保留确认后的本地文件身份。
4. 处理 1000 项选择，不重新选择成功项。
5. 处理 2000 项选择，分批执行且不重新选择成功项。
6. 保留其他批次及失败项，未知结果必须显式核对后才能重试。
7. 响应丢失时锁定当前批次，保留尚未处理的批次。
8. 复制规则快照；上下文变化创建新任务，不改写旧快照。

### [RenameActions.test.tsx](../frontend/src/features/rename/RenameActions.test.tsx)（3 个）

1. 有效重命名必须先确认，确认后使用 `preview_id` 执行。
2. 进度查询失败时不虚构进度，不使用其他预览的进度数据。
3. 即使当前批次没有名称变化，也必须确认后提交服务端执行。

### [StorageSettingsPanel.test.tsx](../frontend/src/features/settings/StorageSettingsPanel.test.tsx)（1 个）

1. 禁止编辑正在执行的连接，默认连接不可删除。

### [defaultCloudLocation.test.ts](../frontend/src/features/files/defaultCloudLocation.test.ts)（2 个）

1. 即使目录同名，也按连接和账号隔离默认目录。
2. 忽略已移除的、按 Provider 保存的旧目录配置。

### [FileBrowser.test.tsx](../frontend/src/features/files/FileBrowser.test.tsx)（3 个）

1. 未过滤及过滤后的批量选择使用正确的可见 ID，表头状态基于可见行。
2. 文件过滤变化时清除隐藏项的选择。
3. 保留目录中已缺失的任务快照，锁定身份未知的项目。

### [FileBrowser.virtual.test.tsx](../frontend/src/features/files/FileBrowser.virtual.test.tsx)（3 个）

1. 只挂载有限窗口，但全选包含未挂载的过滤结果。
2. 过滤变化时清除整个数据集中被隐藏的选择。
3. 错误过滤覆盖未挂载的预览行，同时保留完整预览统计。

### [LocationBreadcrumbs.test.tsx](../frontend/src/features/files/LocationBreadcrumbs.test.tsx)（1 个）

1. 狭窄空间仍保留当前目录，忙碌期间禁止导航。

### [PreviewPanel.test.tsx](../frontend/src/features/rename/PreviewPanel.test.tsx)（1 个）

1. 校验错误不计入待修改数量，正确区分冲突、非法名称和具体错误。

### [client.test.ts](../frontend/src/api/client.test.ts)（1 个）

1. 创建预览传递替换 ID，释放接口只释放指定预览。

## P1：业务功能与异常处理（53 个）

### [WorkspaceApp.test.tsx](../frontend/src/WorkspaceApp.test.tsx)（11 个）

1. 目录刷新失败时保留选择。
2. 文件夹选择器取消选择时保留任务（`selected=false`）。
3. 不离开工作区即可通过内联菜单添加规则。
4. 进入和重新进入云连接时恢复默认目录，保存通过导航打开的目录。
5. 缺少账号 ID 时仍可浏览，但不保存共享默认目录。
6. 保存默认目录失败时显示错误，不替换已有配置。
7. 默认目录配置无法读取时回退到根目录。
8. 请求目录加载失败时不覆盖默认目录。
9. 仅点击预览时打开批次提示，取消后不创建任务。
10. 执行成功后不自动刷新，但允许手动刷新（`success`）。
11. 执行响应丢失后不自动刷新，但允许手动刷新（`lost-response`）。

### [RenameActions.test.tsx](../frontend/src/features/rename/RenameActions.test.tsx)（2 个）

1. 为当前选择请求预览。
2. 显示服务端处理数量，完成状态短暂显示后关闭弹窗。

### [StorageSettingsPanel.test.tsx](../frontend/src/features/settings/StorageSettingsPanel.test.tsx)（2 个）

1. 使用明确配置创建独立存储连接。
2. 显示云连接状态、账号名称和邮箱。

### [FileBrowser.test.tsx](../frontend/src/features/files/FileBrowser.test.tsx)（7 个）

1. 同名文件夹及父目录使用不透明位置标识导航。
2. 当前过滤没有匹配行时禁用批量操作。
3. 选中目录名称文本时不进入目录。
4. 点击目录名称时才执行导航。
5. 仅显示任务成员，默认筛选待处理项，任务状态选项沿用原菜单。
6. 任务开始前禁用任务状态过滤，退出任务后恢复文件选择。
7. 选择超过 1000 项时不自动弹出批次提示。

### [FileBrowser.virtual.test.tsx](../frontend/src/features/files/FileBrowser.virtual.test.tsx)（1 个）

1. 滚动显示远处行，键盘导航能够到达最后一行。

### [LocationBreadcrumbs.test.tsx](../frontend/src/features/files/LocationBreadcrumbs.test.tsx)（1 个）

1. 根目录、祖先目录、父目录及当前目录使用正确的位置语义导航。

### [RuleEditor.test.tsx](../frontend/src/features/rules/RuleEditor.test.tsx)（7 个）

1. 编辑、移动、复制和删除规则时，数字草稿保持归属正确。
2. 保留父组件仍持有的规则对象，替换规则列表时重置草稿。
3. 打开内联菜单并添加配置独立的新规则。
4. 加载时禁用添加，不暴露未实现的规则类型。
5. 修改文本填充字符。
6. 修改替换匹配选项。
7. 添加并配置索引插入规则。

### [RuleFields.test.tsx](../frontend/src/features/rules/RuleFields.test.tsx)（3 个）

1. 允许清空并输入范围内数字，不立即强制最小值。
2. 超出范围的草稿不写入规则，失焦时限制到有效范围。
3. 空草稿恢复原值，按 Enter 提交整数。

### [PreviewPanel.test.tsx](../frontend/src/features/rename/PreviewPanel.test.tsx)（3 个）

1. 区分执行标签、成功项原始分类和完整列表计数，结果合并到预览行。
2. 正确筛选待修改行，将执行失败项归入错误。
3. 初始显示待修改项；仅在非空过滤排除全部行时显示过滤空状态。

### [client.test.ts](../frontend/src/api/client.test.ts)（12 个）

1. 编码预览 ID 后请求服务端执行进度。
2. 保留结构化错误字段，兼容 `Error.message`。
3. HTML 错误响应安全回退。
4. JSON `null` 错误响应安全回退。
5. JSON 数组错误响应安全回退。
6. `error: null` 错误响应安全回退。
7. 错误字段类型不正确时安全回退。
8. 错误消息为空白、错误码为空、详情为 `null` 时安全回退。
9. 缺少可选错误元数据时保留错误消息。
10. 成功 JSON 响应保持不变。
11. 空的 HTTP 204 响应不进行 JSON 解析。
12. 网络故障与 HTTP API 错误保持区分。

### [NotificationProvider.test.tsx](../frontend/src/components/NotificationProvider.test.tsx)（4 个）

1. 新通知拥有独立计时器，旧通知退出回调不影响新通知。
2. 同次渲染连续发送通知时仅显示最新消息，不泄漏中间消息。
3. 预览过期错误附加“重新预览”的操作提示。
4. 其他错误消息保持可用。

## P2：UI 契约与体验回归（23 个）

### [theme.test.tsx](../frontend/src/theme.test.tsx)（8 个）

以下用例验证共享主题间距，不使用局部间距覆盖。

1. 浅色主题：普通菜单（`light/menu`）。
2. 浅色主题：Select 菜单（`light/select`）。
3. 浅色主题：过滤菜单（`light/filter`）。
4. 浅色主题：规则菜单（`light/rules`）。
5. 深色主题：普通菜单（`dark/menu`）。
6. 深色主题：Select 菜单（`dark/select`）。
7. 深色主题：过滤菜单（`dark/filter`）。
8. 深色主题：规则菜单（`dark/rules`）。

### [CheckboxFilterMenu.test.tsx](../frontend/src/components/CheckboxFilterMenu.test.tsx)（4 个）

1. 浅色主题下，默认中性图标、选中后强调色。
2. 深色主题下，默认中性图标、选中后强调色。
3. 浅色主题下，Tooltip 说明默认过滤状态。
4. 深色主题下，Tooltip 说明默认过滤状态。

### [FileBrowser.test.tsx](../frontend/src/features/files/FileBrowser.test.tsx)（2 个）

1. 浅色主题下使用共享纯图标工具栏，不改变过滤控件。
2. 深色主题下使用共享纯图标工具栏，不改变过滤控件。

### [FileBrowser.virtual.test.tsx](../frontend/src/features/files/FileBrowser.virtual.test.tsx)（1 个）

1. 大、小目录切换时 Checkbox 尺寸保持固定。

### [LocationBreadcrumbs.test.tsx](../frontend/src/features/files/LocationBreadcrumbs.test.tsx)（1 个）

1. 空间不足时仅折叠左侧祖先目录，空间恢复后重新展开。

### [RuleEditor.test.tsx](../frontend/src/features/rules/RuleEditor.test.tsx)（2 个）

1. 清空按钮位于添加按钮之前，Tooltip 显示规则描述。
2. 菜单视口限制为八行，超出部分仍可访问。

### [PreviewPanel.test.tsx](../frontend/src/features/rename/PreviewPanel.test.tsx)（1 个）

1. 没有预览时显示预览操作说明。

### [NotificationProvider.test.tsx](../frontend/src/components/NotificationProvider.test.tsx)（4 个）

1. 新通知立即显示，旧通知在原位置淡出。
2. 手动关闭通知后，等待退出动画结束再卸载。
3. 成功通知五秒后关闭，退出动画结束后移除。
4. 错误通知五秒后关闭，退出动画结束后移除。
