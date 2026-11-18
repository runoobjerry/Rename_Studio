# 开发文档索引

本页是人类开发者与 AI Agents 共用的开发文档导航入口，按主题列出正式文档及其职责。按当前任务选择阅读，无需通读。

## 项目基础与系统架构

| 文档入口 | 职责 |
| --- | --- |
| [项目 README](../README.md) | 项目概览、功能与使用入口。 |
| [开发环境与发布](DEVELOPMENT.md) | 安装、运行、开发环境、打包与发布。 |
| [系统架构](ARCHITECTURE.md) | 系统边界、跨端流程与业务不变量。 |
| [前端架构](frontend/ARCHITECTURE.md) | 前端模块、状态归属、依赖与核心流程。 |
| [后端架构](backend/ARCHITECTURE.md) | 后端模块、依赖装配、执行流程与目录缓存。 |

## 接口与设计

| 文档入口 | 职责 |
| --- | --- |
| [API 文档索引](api/README.md) | HTTP 资源与接口导航；子页定义字段、约束、请求响应、错误和执行结果。 |
| [UI 设计规范](frontend/UI_DESIGN.md) | 视觉、布局、交互、可访问性与 UX 文案。 |

## 测试与验收

| 文档入口 | 职责 |
| --- | --- |
| [前端测试与验收](frontend/TEST.md) | 前端测试入口、约定与验收方法。 |
| [后端测试与验收](backend/TEST.md) | 后端测试入口、约定与真实环境验收。 |
| [改名响应丢失模拟](frontend/TEST_MANUAL.MD) | 改名响应丢失的手动模拟场景。 |

## 浏览器扩展

| 文档入口 | 职责 |
| --- | --- |
| [扩展使用说明](browser-extensions/README.md) | 特性、兼容性、安装与使用。 |
| [扩展架构](browser-extensions/ARCHITECTURE.md) | 模块边界、导航流程与约束。 |
| [扩展开发](browser-extensions/DEVELOPMENT.md) | 开发、验证及独立发布。 |

## 临时任务资料

[临时任务文档索引](generated/README.md)管理阶段计划、交接与验收证据；完成后将稳定结论迁入对应主题文档。

## Agent 协作

Agent 行为约束与按任务阅读策略由 [根级 AGENTS.md](../AGENTS.md)、[前端 AGENTS.md](../frontend/AGENTS.md)及[后端 AGENTS.md](../backend/AGENTS.md)维护；[AI 写作指南](AI_WRITING_GUIDE.MD)规定文档写作、事实核对和导航维护方式。这些文件不替代上述开发文档的技术事实与契约。
