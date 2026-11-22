# 后端测试与验收

[文档索引](../README.md) · [后端架构](ARCHITECTURE.md) · [后端 Agent 指令](../../backend/AGENTS.md) · [另一端测试](../frontend/TEST.md)

本文件面向人类开发者与 AI Agents，维护测试入口、编写约定、检查命令与验收方法，不记录具体版本的通过状态。**本地安装、测试、编译、构建和浏览器验收由用户执行**；Agent 的权限见[根级指令](../../AGENTS.md#验证与交付)。

章节：[测试定位与验证](#测试定位与验证) · [测试编写约定](#测试编写约定) · [真实环境验收](#真实环境验收) · [验收记录](#验收记录)

## 测试定位与验证

| 修改范围 | 测试入口 |
| --- | --- |
| API、Schema 与跨端结果 | [test_api](../../backend/tests/test_api.py)、[存储改名契约](../../backend/tests/test_storage_rename_contract.py) |
| 文件日志格式、级别、脱敏与操作关联 | [test_logging](../../backend/tests/test_logging.py) |
| 预览、冲突与快照 | [test_preview_service](../../backend/tests/test_preview_service.py) |
| 批量复核、部分/未知结果与取消 | [test_execute_service](../../backend/tests/test_execute_service.py) |
| 单项直接执行 | [test_single_rename_service](../../backend/tests/test_single_rename_service.py) |
| 目录模式、缓存与写入协调 | [test_directory_service](../../backend/tests/test_directory_service.py)、[test_directory_cache](../../backend/tests/test_directory_cache.py) |
| 连接、revision 与持久化 | [test_storage_connections](../../backend/tests/test_storage_connections.py) |
| Provider 读写与认证 | [Local](../../backend/tests/test_local_provider.py)、[OneDrive](../../backend/tests/test_onedrive_provider.py) / [认证](../../backend/tests/test_onedrive_auth.py)、[Google Drive](../../backend/tests/test_google_drive_provider.py) / [认证](../../backend/tests/test_google_drive_auth.py) |
| Rule 与引擎 | [test_rename_engine](../../backend/tests/test_rename_engine.py)及 [tests](../../backend/tests)中的对应规则测试 |

Provider 场景共用 [provider_fixtures](../../backend/tests/provider_fixtures.py)，在 HTTP / 文件系统边界构造输入，本地写入使用测试临时目录。测试断言公共行为与结果，不把内部实现副本当作业务期望。

用户在 `backend/` 的 Python 3.12+ 虚拟环境执行完整测试：Windows 为 `.\.venv\Scripts\python -m pytest`，macOS 为 `.venv/bin/python -m pytest`；追加对应 `tests/test_*.py` 路径可限定范围。环境安装见[开发环境](../DEVELOPMENT.md#环境与开发启动)。真实 OAuth、云端权限及改名按[真实环境验收](#真实环境验收)操作，结果放入[任务记录](../generated/README.md)。AI 运行权限见[根级指令](../../AGENTS.md#验证与交付)，测试编写约定见[下节](#测试编写约定)。

## 测试编写约定

- 复用 [provider_fixtures](../../backend/tests/provider_fixtures.py)及对应模块既有测试，在 HTTP / 文件系统等外部边界构造场景；本地文件用测试临时目录，云盘用虚构凭据，不访问真实账号或用户文件。
- 验证公共行为与关键故障，不通过模拟整个被测 Service 证明其结果。涉及写入时关注实时复核、明确失败/未知、部分结果、取消收尾及缓存协调。
- 本地运行权限遵循[根级约定](../../AGENTS.md#验证与交付)，交付时给出受影响测试和剩余真实环境验收。

## 真实环境验收

按本次修改选择相关场景，使用专用本地目录、测试云盘账号和文件副本，核对真实 API 响应与写入后的文件。故障注入在隔离测试环境进行。

| 修改范围 | 操作与通过标准 |
| --- | --- |
| Rule / 预览 | 用含文件、文件夹、扩展名与冲突目标的副本生成预览；顺序和规则结果符合契约，预览不修改文件 |
| 批量改名 | 预览后改变源项或目标占用，再执行；实时复核拒绝过时快照。正常执行核对逐项结果和真实文件，部分成功不自动回滚 |
| 单项改名 | 从独立单项入口提交，核对目标名、返回身份与后续浏览；不借用批量预览，具体同名语义遵循 Provider 和[单项 API](../api/executions/single.md) |
| 连接 / 授权 | 核对配置保存、登录、重启后的令牌刷新、断开或换号、revision 和忙碌保护；日志和响应不含凭据 |
| 目录 / 缓存 | 核对根目录、子目录、真实 ID、完整分页、手动刷新和改名后缓存协调；执行前复核不使用旧缓存 |
| 未知结果 / 取消 | 优先用自动化边界模拟核对响应丢失、按 ID 确认、停止补组与已提交写入收尾；真实环境只记录实际遇到的故障并核对文件，不直接重放请求 |
| 发布启动 | 按[启动说明](../LAUNCHER.md)和[发布流程](../DEVELOPMENT.md#发布流程)检查目标平台的页面/API、退出与状态保留；前端检查入口见[前端 TEST](../frontend/TEST.md) |
| 后端日志 | 在 Windows 和 macOS 分别用普通和调试模式启动，触发目录读取、预览和改名。按终端显示的路径打开 `app.log`，对照[模式表](../LAUNCHER.md#模式对照)检查级别和关联字段。 |

## 验收记录

在[对应任务记录](../generated/README.md)注明日期、分支/提交或工作区、执行者、操作系统、Python/Provider/账号环境（不含凭据）、数据规模、命令/步骤、预期与实际结果。区分未执行、静态核对、通过、部分通过和失败；失败保留复现与待修复范围，每条结果对应其实际验证的版本。
