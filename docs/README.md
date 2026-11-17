# 开发文档索引

[项目 README](../README.md) · [开发行为规范](../AGENTS.md) · [系统架构](ARCHITECTURE.md)

本知识库同时面向人类开发者和 AI Coding Agents，按任务提供文档入口与职责说明。编写和维护约定见[文档写作指南](WRITING_GUIDE.MD)。

## 从哪里开始

| 需要了解或修改 | 首选入口 | 继续阅读 |
| --- | --- | --- |
| 编写、维护与审查文档 | [文档写作指南](WRITING_GUIDE.MD) | [文档职责](#文档职责) |
| 安装与开发环境 | [开发环境](DEVELOPMENT.md#环境与开发启动) | [启动说明](LAUNCHER.md) |
| 系统组成、业务流程、安全边界 | [系统架构](ARCHITECTURE.md) | [前端架构](frontend/ARCHITECTURE.md)、[后端架构](backend/ARCHITECTURE.md) |
| 前端实现 | [前端架构](frontend/ARCHITECTURE.md) | [UI 设计](frontend/UI_DESIGN.md)、[前端 Agent 指令](../frontend/AGENTS.md)（AI） |
| 后端实现 | [后端架构](backend/ARCHITECTURE.md) | [API 索引](api/README.md)、[后端 Agent 指令](../backend/AGENTS.md)（AI） |
| 前端测试与 CI | [前端 TEST](frontend/TEST.md) | [UI 设计](frontend/UI_DESIGN.md)、[任务记录](generated/README.md) |
| 后端测试与真实环境验收 | [后端 TEST](backend/TEST.md) | [启动说明](LAUNCHER.md)、[前端 TEST](frontend/TEST.md) |
| 页面布局、控件、反馈、可访问性与文案 | [UI_DESIGN](frontend/UI_DESIGN.md) | [前端架构](frontend/ARCHITECTURE.md) |
| 手动模拟改名响应丢失 | [TEST_MANUAL.MD](frontend/TEST_MANUAL.MD) | [前端测试](frontend/TEST.md)、[执行契约](api/executions/index.md) |
| HTTP 请求、响应、错误与结果状态 | [API 索引](api/README.md) | 索引内的资源、对象与端点文档 |
| 浏览器扩展安装与使用 | [扩展 README](browser-extensions/README.md) | [扩展架构](browser-extensions/ARCHITECTURE.md) |
| 浏览器扩展实现、验证与发布 | [扩展架构](browser-extensions/ARCHITECTURE.md) | [扩展开发](browser-extensions/DEVELOPMENT.md) |
| 发布包启动与退出、故障排查 | [LAUNCHER](LAUNCHER.md) | [后端架构](backend/ARCHITECTURE.md) |
| 版本、打包、CI 和发布 | [开发与发布](DEVELOPMENT.md#发布流程) | [项目 README](../README.md) |
| 复杂任务计划、阶段交接、待验收证据 | [generated 索引](generated/README.md) | 索引内标注状态的任务文档 |

## 文档职责

- [WRITING_GUIDE.MD](WRITING_GUIDE.MD)：内容组织、事实核对、术语、格式、示例和维护检查约定。
- [根级 AGENTS.md](../AGENTS.md)：面向 AI Agents 的项目级行为、权限、完成标准与阅读路由；[前端 AGENTS.md](../frontend/AGENTS.md)和[后端 AGENTS.md](../backend/AGENTS.md)补充目录特有约定。
- 各份 `ARCHITECTURE.md`：系统地图、代码入口、模块职责、依赖、核心流程与约束；顶层说明跨端边界，前端、后端与浏览器扩展文档说明各自结构。
- [前端 TEST.md](frontend/TEST.md) / [后端 TEST.md](backend/TEST.md)：测试入口、编写约定、检查命令和证据边界；后端文档另含真实环境验收。
- [UI_DESIGN.md](frontend/UI_DESIGN.md)：设计目标与修改入口、MUI v9 / Material Design 2 视觉风格、布局与交互规范、UX 文案指南；实现位置由前端架构维护。
- [TEST_MANUAL.MD](frontend/TEST_MANUAL.MD)：仅维护在浏览器模拟改名响应丢失的手动场景。
- 浏览器扩展：[README](browser-extensions/README.md) 面向用户说明特性、兼容性、安装与使用；[ARCHITECTURE](browser-extensions/ARCHITECTURE.md) 维护模块边界、导航流程与约束；[DEVELOPMENT](browser-extensions/DEVELOPMENT.md) 维护开发、验证、版本及独立发布操作。
- [generated/](generated/README.md)：复杂任务的临时计划、分析、阶段交接与验收记录。

## 本次组织方式的依据

这套目录是根据项目规模采用的文档组织方式，参考官方工程经验，并保留本项目的人工验证与 Git 授权约定：

| 官方参考 | 在本仓库中的应用 |
| --- | --- |
| OpenAI：[Harness engineering](https://openai.com/index/harness-engineering/) | 精简 AGENTS 导航、仓库内知识库、按需读取、文档索引与交叉链接、显式架构边界 |
| OpenAI：[Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) | Agent 指令按目录限定、按任务提供资料入口，删减重复流程，明确授权边界和完成标准；具体代码地图与测试导航分别留在架构文档和 TEST |
| Anthropic：[Effective harnesses for long-running agents](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents) | 将复杂任务拆成可接续阶段，留下进展、验证证据和下一步，避免过早宣告完成 |
| Anthropic：[Harness design for long-running application development](https://www.anthropic.com/research/harness-design-long-running-apps) | 用明确验收标准评估 UI 与功能，区分实现完成与验证完成 |

Agent 的验证、Git 与发布权限见 [AGENTS.md](../AGENTS.md)。
