# UI 自动化精简记录与人工验收清单

日期：2026-10-13。基于主分支提交 `17069ea8a1af3440eac16613f58541013bf8be74`。

## 修改范围

测试精简分两轮调整：第一轮（已合并的 PR #5）将视觉、尺寸、文案和动画检查转为浏览器人工验收；本轮将工作台状态细节下移到 Hook，合并重复 UI 测试和过细的异常输入组合，并简化测试覆盖清单。

完整工作台从 32 项调整为 12 项。以下数量仅记录本轮变更，日常维护不再同步总数与分类数量；实际用例数和执行状态以 Vitest / CI 输出为准。

产品代码、默认超时、CI 检查门槛未修改。实际提速和稳定性须由 CI 验证。

## 被移除的自动化用例

参数化测试按展开后的用例数计数。以下文件路径相对于 `frontend/src/`。

| 原测试文件 | 原测试名称或参数 | 数量 | 转移的检查 |
|---|---|---:|---|
| `theme.test.tsx` | `applies theme spacing to %s without local spacing overrides`；light/dark × menu/select/filter/rules | 8 | 菜单内外间距、行高、字号、圆角与一致性 |
| `components/CheckboxFilterMenu.test.tsx` | `uses a neutral off icon by default and accent when any option is checked`；light/dark | 2 | 筛选图标的颜色、尺寸和启用状态外观 |
| `components/CheckboxFilterMenu.test.tsx` | `shows a tooltip describing the default state`；light/dark | 2 | 未启用筛选的 Tooltip |
| `features/files/FileBrowser.test.tsx` | `uses shared icon-only toolbar controls in %s mode without changing the filter`；light/dark | 2 | 工具栏纯图标样式、间距和尺寸 |
| `features/files/FileBrowser.virtual.test.tsx` | `keeps checkbox geometry fixed when switching between large and small directories` | 1 | 大小目录、全选前后复选框与列宽稳定 |
| `features/rules/RuleEditor.test.tsx` | `places clear before add and shows descriptions in a tooltip` | 1 | 操作按钮顺序、规则说明 Tooltip |
| `features/rename/PreviewPanel.test.tsx` | `shows the empty preview guidance` | 1 | 无预览时的说明文案 |
| `components/NotificationProvider.test.tsx` | `shows a new notification immediately while the old one fades in place` | 1 | 新旧通知切换时的淡出效果 |
| `components/NotificationProvider.test.tsx` | `keeps a dismissed notification mounted until the normal reverse animation ends` | 1 | 手动关闭通知的退出动画 |
| **合计** | | **19** | |

此外，通知五秒自动关闭保留一项代表性测试；成功和错误共用同一计时逻辑，不再分别展开。移除 Snackbar 动画期间存在、180ms 后卸载及退出后 DOM 节点数量断言，保留关闭行为、独立计时器、旧回调不影响新消息及连续消息不显示中间消息的覆盖。

`theme.test.tsx` 与 `CheckboxFilterMenu.test.tsx` 全部内容属于上述视觉检查，因此删除整个测试文件；产品组件保持不变。

## 第二轮覆盖迁移与合并

| 原位置 / 场景 | 处理方式与承接位置 |
|---|---|
| WorkspaceApp 四种选择操作使旧预览失效 | 全部操作与实际选择 ID 在 `features/rename/useRenameWorkflow.test.ts` 验证；工作台保留单项选择与规则修改的 UI 接线流程 |
| 刷新后移除消失 ID、预览失效、只提交剩余 ID；刷新失败保留选择 | 迁到工作流 Hook，使用真实 QueryClient、Store 和 API mock，继续覆盖刷新后的替换 ID 与清空选择 |
| 部分执行结果在核对选择时保留，普通选择清除 | 迁到工作流 Hook；FileBrowser 和 PreviewPanel 保留任务筛选和结果展示验证 |
| 超 1000 项提示取消、偏好保存、继续后只提交 1000 项 | 迁到工作流 Hook，不挂载 1001 项的完整页面；Store 的 1000 / 2000 项测试保留；提示框 UI 补充人工验收 |
| 选择清除后仍保留释放 ID；迟到选择预览释放；规则修改传递替换 ID | 迁到工作流 Hook；跨连接迟到预览仍在工作台验证 |
| 执行成功 / 响应丢失后不自动刷新，允许手动刷新 | 两种结果都迁到组合真实存储 Hook 与工作流 Hook 的测试，保留查询失效、结果身份缓存及未知批次断言 |
| 本地选择器确认 / 取消对任务的影响 | 两种结果迁到 `workspace/hooks/useWorkspaceStorage.test.ts`，仍验证真实工作流任务清理及保留 |
| 云默认目录缺账号、保存失败、读取失败、目录失败 | 迁到存储 Hook；账号切换和导航保存 / 重新进入保留完整工作台验证 |
| 工作台内联添加规则、旧布局元素不存在的断言 | 添加规则接线并入选择 / 规则失效流程；RuleEditor 保留菜单添加及配置独立性；旧布局断言删除 |
| API 非标准错误的六种输入 | 保留 HTML 网关错误及错误字段类型非法的 JSON；删除 `null`、数组、`error:null`、空白字段四种展开组合。真实结构化错误、缺可选元数据、网络失败、204 仍保留；不改解析器 |
| 成功 / 错误通知重复计时测试 | 保留共享计时的一项代表性用例；两类通知外观及关闭效果转人工验收 |

Hook 测试不挂载完整 MUI 页面，使用真实查询和 Store，仅 mock API 与通知展示。工作台仍保留连接隔离、账号切换、过滤后选择、恢复出厂设置、执行期间锁定和关键回调连接。

## 人工验收方法

相关 UI 修改后检查对应项目；发布前完整检查。以下检查使用浅色与深色主题各执行一次，至少检查桌面宽度和窄窗口。可用测试目录和临时文件；观察预览即可，无需为视觉验收执行真实重命名。

| 编号 | 操作 | 通过标准 |
|---|---|---|
| UI-01 | 打开普通菜单、设置页主题 Select、文件/预览筛选菜单和添加规则菜单 | 内外间距、行高、字号与圆角协调；无文字截断或异常空隙；无需逐像素匹配旧断言 |
| UI-02 | 查看筛选按钮；选中一个选项，再取消全部选项 | 未启用时为中性图标，启用时为强调色图标；状态清楚，尺寸不跳动 |
| UI-03 | 鼠标悬停未启用的筛选按钮 | 显示说明未启用状态的 Tooltip；浅色/深色下均可读 |
| UI-04 | 查看文件区的返回上级、刷新、反选与筛选工具栏 | 图标大小和间距一致，布局无异常；全选入口在表头，无重复全选按钮 |
| UI-05 | 浏览小目录，再浏览超过虚拟化阈值的大目录；全选、取消选择，再切回小目录 | 复选框不拉伸，列和文字不明显跳动；大目录滚动时布局稳定 |
| UI-06 | 查看规则区操作按钮，打开添加规则菜单并悬停规则项 | 一键清除在添加规则之前；Tooltip 显示规则说明，无遮挡或截断 |
| UI-07 | 进入尚未生成预览的工作台 | 有清楚的预览说明，提示预览不会修改文件，存储名称正确 |
| UI-08 | 通过保存偏好等安全操作触发通知，旧通知消失前再触发新通知 | 新消息立即可见，旧消息平顺淡出；无重叠、闪烁或残留遮挡 |
| UI-09 | 通知出现后手动关闭；分别观察成功和错误通知自动关闭 | 手动关闭动画自然；自动关闭约五秒后发生，动画结束无残留通知 |
| UI-10 | 缩窄窗口并浏览较深目录；检查较长的规则菜单（如当前规则不足八项，记录未适用） | 当前目录仍可辨认，菜单可滚动，选项不会丢失；这是保留自动化测试之外的浏览器补充检查 |
| UI-11 | 选择超过 1000 项，点击刷新预览；取消后再次打开，勾选“下次不再提示”并继续 | 选择时不弹提示；点击预览才弹；取消保留选择且不生成预览；继续显示首批预览；之后不再提示；只观察预览，无需执行重命名 |
| UI-12 | 在有任务的工作台点击“浏览…”；分别取消与确认新的测试目录 | 取消保留当前任务和预览；确认后回到新根目录并清空旧选择 / 任务 / 预览 |
| UI-13 | 使用测试文件目录观察部分执行结果与目录 / 偏好读取失败时的界面（可借助开发环境模拟） | 结果、错误和“待核对”状态可辨认；不会显示可直接重复执行的过期预览；错误提示不遮挡操作。不要为验收故意中断真实云端执行 |

触屏设备没有鼠标悬停时，Tooltip 项可记录“未适用”；图标状态、菜单布局和通知仍需检查。

## 保留的自动化保障

- 执行前确认、取消不执行、执行期间控件禁用。
- 筛选与全选使用正确 ID，包括虚拟列表未挂载的文件。
- 批次上限、未知结果锁定、已完成项不重复执行。
- 连接/账号隔离、迟到响应处理和预览释放。
- 偏好保存、保存失败和快速编辑竞争。
- 恢复出厂设置的成功、取消及失败处理。
- 通知独立计时器、同次渲染消息竞争和错误信息。
- 当前目录保留、菜单溢出和虚拟列表键盘导航。

## 验收记录模板

```text
日期：
分支 / 提交：
浏览器及版本：
窗口宽度 / 设备：
主题：浅色 / 深色
通过项：
失败项及现象：
未适用项及原因：
截图或复现步骤：
```

## 自动化验证状态

遵循仓库半自动流程，本地 npm 安装、测试、类型检查、构建和浏览器验收由用户执行，本轮未运行上述检查。提交前仅做源码与覆盖对应关系的静态核对；不将静态检查表述为测试通过。

合并前运行 `cd frontend && npm ci && npm run check`，按相关人工清单验收并审查 PR Checks。PR 中的 CI 结果是提交对应的实际验证记录；若失败，应根据日志修复，不通过删业务断言或放宽超时掩盖。
