# UI 自动化精简记录与人工验收清单

日期：2026-10-13。基于主分支提交 `17069ea8a1af3440eac16613f58541013bf8be74`。

## 修改范围

将纯视觉、尺寸、文案和动画效果转为人工浏览器验收。自动化用例从 134 个调整为 115 个，测试文件从 16 个调整为 14 个；移除的 19 个用例均来自原 P2 分类，P0 的 41 个和 P1 的 70 个保持不变。

未修改产品代码、超时设置或 CI 工作流，未移除 WorkspaceApp 业务测试。此次精简不宣称解决已有 CI 超时，也不承诺具体提速幅度。

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

此外，成功/错误通知五秒自动关闭的两项测试仍保留，但删除对 Snackbar 在退出动画期间存在、180ms 后卸载的实现细节断言。通知关闭行为、独立计时器和旧回调不影响新通知仍有自动化覆盖。

`theme.test.tsx` 与 `CheckboxFilterMenu.test.tsx` 全部内容属于上述视觉检查，因此删除整个测试文件；产品组件保持不变。

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

遵循仓库半自动流程，本地 npm 安装、测试、类型检查、构建和浏览器验收由用户执行，本次未运行上述检查。提交前仅静态核对删除范围、剩余用例与文档统计。请在合并前运行 `cd frontend && npm ci && npm run check`，并审查 PR Checks。已有 WorkspaceApp 超时仍需验证，不应通过删掉业务断言或放宽超时来掩盖。
