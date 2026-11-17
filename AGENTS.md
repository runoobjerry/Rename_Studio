# AGENTS.md

本文件面向 AI Coding Agents，提供项目级行为规范和文档导航。Rename Studio 是面向本地文件与云盘 API 的规则型批量重命名工具。目录特有约定见对应 `AGENTS.md`，架构与设计事实见 `docs/`。

## 按任务阅读

按任务需要查阅下列入口与直接调用方。拼写、纯文案等局部修改可直接定位相关文件，无需先通读架构或整套文档。

| 任务 | 阅读入口 |
| --- | --- |
| 安装、运行、开发环境 | [项目 README](README.md) · [开发环境](docs/DEVELOPMENT.md) |
| 查找文档、维护文档 | [文档索引](docs/README.md) · [文档写作指南](docs/WRITING_GUIDE.MD) |
| 系统边界、核心流程与业务不变量 | [系统架构](docs/ARCHITECTURE.md) |
| 前端开发、状态和测试约定 | [前端 Agent 指令](frontend/AGENTS.md) · [前端架构](docs/frontend/ARCHITECTURE.md) · [测试与验收](docs/frontend/TEST.md) |
| 前端 UI / UX | [UI 设计规范](docs/frontend/UI_DESIGN.md) |
| 后端开发、Provider、规则和测试约定 | [后端 Agent 指令](backend/AGENTS.md) · [后端架构](docs/backend/ARCHITECTURE.md) · [测试与验收](docs/backend/TEST.md) |
| HTTP 字段、错误码与结果状态 | [API 索引](docs/api/README.md)及对应资源文档 |
| 浏览器扩展使用、架构与开发 | [扩展 README](docs/browser-extensions/README.md) · [扩展架构](docs/browser-extensions/ARCHITECTURE.md) · [扩展开发](docs/browser-extensions/DEVELOPMENT.md) |
| 启动器与发布 | [启动说明](docs/LAUNCHER.md) · [发布流程](docs/DEVELOPMENT.md#发布流程) |
| 复杂阶段性任务、接续记录 | [临时文档索引与使用规则](docs/generated/README.md) |

## 开发行为

- 先理解现有实现，再以最小完整改动解决当前需求；保持模块职责与依赖清晰，复用现有抽象，不为假设需求添加配置、兼容层或回退路径。
- 在输入、第三方 API、文件系统等不可信边界校验；内部已建立的契约不重复防御。仅在有明确处理策略时捕获异常，不吞错或用默认值掩盖缺陷。
- 遵守[架构不变量](docs/ARCHITECTURE.md#业务与安全不变量)：预览不写入，批量执行实时复核，单项遵守独立契约；未知写入不推断成功、不盲目重试；不绕过版本、身份或互斥保护，不泄露凭据。
- 契约变化同步调用方、类型、必要测试与文档。UI 遵循现有 i18n；不通过诊断消息、译文或显示名称决定业务状态。
- 保留用户已有改动，不做无关重构。架构、设计、接口与任务文档放在 `docs/`，目录级 Agent 指令放在对应代码目录的 `AGENTS.md`；按[导航与引用约定](docs/WRITING_GUIDE.MD#导航与引用)维护入口和关联文档。
- 在已授权范围内自行完成必要的阅读、编辑、关联同步与静态检查，不为常规实现选择反复请求确认。只有需要用户决定的范围变化、明确受限操作或真实阻碍才提出具体问题；可独立推进的工作继续完成。

## 验证与交付

- 测试按业务行为与回归风险选择；优先公共接口和可观察结果，不追求数量或机械覆盖率，不删除有效测试、弱化断言或跳过检查来掩盖失败。任务完成后可删除不再需要的一次性专项测试。
- **本地依赖安装、编译、测试、构建和端到端 / 浏览器验收由用户执行。Agent 只做代码阅读与静态分析，不擅自运行上述命令，不声称未执行的验证已通过。**
- 复杂任务按可验收阶段推进，必要时在 [generated](docs/generated/README.md) 留下范围、决定、证据、阻碍与下一步；未执行和未通过必须明确区分。
- 交付前完成目标范围的实现、调用方/契约/文档同步和静态收尾，不停在首版实现后请求继续。说明修改范围、关键设计、重要新增/移除/破坏性逻辑、实际检查、未验证内容、用户待执行检查与剩余风险；不能完成时明确阻碍。

## Git 权限

- 未经明确批准不 Commit 或 Push；用户本地验证后分别批准本次 Commit 与目标开发分支的 Push。仅提交本任务文件，提交前说明范围与建议消息，基本格式为 `type(scope): subject`，其中 scope 要能够表达主要受影响的模块，subject 要使用祈使语气，准确描述实际改动。提交正文采用简洁的 Markdown 列表，每项对应一项主要变更。
- 不直接 Push 到 `main`。PR 合并、启用自动合并及正式发布由用户操作；CI 修复后仍遵守本地验证与分别授权流程。

约束正确性与业务不变量，避免规定无必要的实现步骤。
