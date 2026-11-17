# Frontend Agent Instructions

适用于 `frontend/` 下的 AI Coding Agents；与[根级指令](../AGENTS.md)共同使用。本文件只补充前端特有约定，按任务选择入口，无需每次读取全部文档。

[文档索引](../docs/README.md) · [前端架构](../docs/frontend/ARCHITECTURE.md)

## 按任务定位

| 修改内容 | 相关入口 |
| --- | --- |
| 工作流、状态、缓存或目录导航 | [状态归属与核心流程](../docs/frontend/ARCHITECTURE.md#依赖与状态归属) |
| 页面布局、控件、交互与可访问性 | [UI 设计规范](../docs/frontend/UI_DESIGN.md) |
| 文案、语言或错误展示 | [UX 文案规范](../docs/frontend/UI_DESIGN.md#ux-文案规范ux-writing) · [文案与错误链路](../docs/frontend/ARCHITECTURE.md#文案与错误) |
| 请求、类型或执行结果 | [API 索引](../docs/api/README.md)中的对应资源，以及 [client](src/api/client.ts) / [types](src/types/index.ts) |
| 浏览器扩展接入 | [扩展架构](../docs/browser-extensions/ARCHITECTURE.md)与 [integrations/browser](src/integrations/browser) |
| 测试修改或验证建议 | [测试定位与验证](../docs/frontend/TEST.md#测试定位与验证) |

## 实现约定

- `WorkspaceApp` 负责布局与跨 Hook 接线；目录/连接归 `useWorkspaceStorage`，预览与执行归 `useRenameWorkflow`。两个主 Hook 通过容器传值，展示组件保持受控。
- 服务端数据用 TanStack Query；选择、规则、提交/最近记录和待核对信息用 Zustand。排序、筛选与虚拟化基于完整集合；文件显示名和 DOM 不承担资源身份或结果判断。
- 修改选择、规则、排序、连接、账号、revision 或文件身份时，同步处理预览失效、快照释放、迟到响应和缓存更新。未知保护独立于当前视图，切换页面或关闭警告不能清除；结果只合并服务端确认的元数据。
- 规则字段在 `RuleFields` 显式适配；通用连接 UI 消费 Provider 能力与字段元数据。名称转换与冲突校验留在后端。
- UI 复用 MUI、主题和共享控件。固定文案、通知、Tooltip、ARIA 使用 `react-i18next`，同步维护 en-US / zh-CN；模块常量保存键，展示时翻译，文件名等用户数据保持原值。
- 错误通过 `errorPresentation` / `messages` 从结构化字段选择提示；展示层不决定是否重试或改变执行结果。OAuth 保留来源、窗口和连接身份校验，令牌不进入浏览器持久化。

## 测试与收尾

测试入口与编写约定见[TEST.md](../docs/frontend/TEST.md)。按受影响行为选择检查，交付时说明实际静态检查、用户待执行项与未验证范围；运行权限遵循[根级指令](../AGENTS.md#验证与交付)。
