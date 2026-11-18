# 后端架构

[文档索引](../README.md) · [系统架构](../ARCHITECTURE.md) · [后端 Agent 指令](../../backend/AGENTS.md) · [前端架构](../frontend/ARCHITECTURE.md) · [测试与验收](TEST.md) · [API](../api/README.md)

章节：[代码地图](#代码地图) · [依赖与对象装配](#依赖与对象装配) · [预览与执行](#预览与执行) · [目录读取与缓存](#目录读取与缓存) · [持久化与部署](#持久化与部署) · [扩展入口](#扩展入口)

## 代码地图

| 入口 | 职责 |
| --- | --- |
| [main.py](../../backend/app/main.py) | FastAPI 创建、生命周期、请求日志上下文、统一异常响应 |
| [api/router.py](../../backend/app/api/router.py)、[storage_router.py](../../backend/app/api/storage_router.py)、[app_settings_router.py](../../backend/app/api/app_settings_router.py) | 共享、连接级和设置路由 |
| [api/dependencies.py](../../backend/app/api/dependencies.py) | 单进程共享服务装配、内置 Rule 与 Provider 注册 |
| [schemas](../../backend/app/schemas) | 输入输出、位置、配置、持久化状态和结果结构 |
| [StorageManager](../../backend/app/services/storage_manager.py) | 连接配置、revision、驱动与认证实例、OAuth 会话、身份、互斥、偏好与目录服务生命周期 |
| [ProviderRegistry](../../backend/app/providers/registry.py)、[builtin.py](../../backend/app/providers/builtin.py) | Provider 定义、配置模型校验与显式注册内置 Provider |
| [DirectoryService](../../backend/app/services/directory_service.py)、[DirectoryCache](../../backend/app/services/directory_cache.py)、[directory_metadata](../../backend/app/providers/directory_metadata.py) | 读取策略、并发请求合并、缓存与祖先索引、写入期间发布隔离和改名后的缓存协调 |
| [PreviewService](../../backend/app/services/preview_service.py)、[PreviewStore](../../backend/app/services/preview_store.py) | 评估源项/规则/冲突，保存与释放有期限、绑定 revision 的预览快照 |
| [RenameEngine](../../backend/app/services/rename_engine.py)、[rules](../../backend/app/rules) | 规则配置解析、顺序应用与带索引的 RuleContext |
| [ExecuteService](../../backend/app/services/execute_service.py) | 批量实时复核、快照消费、分组调度、进度与结果汇总 |
| [SingleRenameService](../../backend/app/services/single_rename_service.py)、[rename_write](../../backend/app/services/rename_write.py) | 单项直接执行、共享结果核对、写入取消后的收尾 |
| [StorageDriver](../../backend/app/providers/base.py)、[StorageAuth](../../backend/app/providers/auth.py)、[local](../../backend/app/providers/local)、[onedrive](../../backend/app/providers/onedrive)、[google_drive](../../backend/app/providers/google_drive) | 统一存储与授权接口及各 Provider 实现 |
| [core/errors](../../backend/app/core/errors.py)、[providers/errors](../../backend/app/providers/errors.py)、[retry](../../backend/app/providers/retry.py)、[cooldown](../../backend/app/providers/cooldown.py) | 应用错误、第三方诊断解析、重试预算和连接级限流等待 |
| [JsonStorageRepository](../../backend/app/repositories/storage_repository.py)、[core/config](../../backend/app/core/config.py)、[core/paths](../../backend/app/core/paths.py) | JSON 原子保存、环境/缓存配置、本地路径边界 |
| [release.py](../../backend/app/release.py)、[launcher.py](../../backend/app/launcher.py) | 静态资源组装、发布服务启动和退出 |

## 依赖与对象装配

路由通过 `dependencies.py` 取得共享对象。装配时显式注册内置 Provider，再把 `ProviderRegistry` 交给 `StorageManager`。Registry 管理 Provider 定义与配置校验。Manager 使用定义中的工厂创建驱动与认证实例，管理连接状态、目录服务与资源生命周期。应用退出时由 Manager 关闭驱动。

装配时将同一个 `StorageManager` 注入 `PreviewService`、`ExecuteService` 和 `SingleRenameService`，由它提供连接 revision、Provider 定义、驱动与目录服务。批量和单项执行共用 Manager 的连接级执行锁。名称转换交给 `RenameEngine` 与 Rule，各 Provider 实现 `StorageDriver` 并按需提供 `StorageAuth`。

装配入口定义默认连接 `default-local` 并处理首次启动和已保存连接的配置校验。Manager 使用注入的默认连接定义处理恢复出厂设置和删除保护。Repository 负责 JSON 状态的读取、结构校验与原子保存。

OAuth 路由调用 Manager 开始授权并处理回调。Manager 将 Provider 返回的 `state` 绑定到连接和 revision，在回调时一次性消费会话并检查有效期、revision 和忙碌状态。Provider 负责 PKCE 与令牌交换，路由负责 HTTP 响应和回调页。

## 预览与执行

### 预览

已知目录时，`PreviewService.evaluate` 一次取目录列表，同时得到源项与冲突集合；没有位置时按 ID 取元数据并读取同目录项。按请求的 ID 顺序构造 RuleContext，配置在一轮评估中解析一次，校验目标名、可改名能力和名称占用。目标被其他项占用即冲突，包含本批次中将改名的项；不承诺交换名称或临时名调度。

`PreviewStore` 保存请求、源元数据、结果、连接 revision 与过期时间；新预览保存成功后才释放被替换快照。快照不会修改文件，生命周期见[预览 API](../api/previews/index.md)。

### 批量执行

`ExecuteService` 使用进程级批量锁和 `StorageManager.execution` 的连接级 revision / busy 保护。复核以 `mode="verify"` 读原目录完整实时子项，按原 ID 顺序重建源项、重新评估并比较快照结果。复核失败标记 `execution_started: false`；通过后消费快照，再按驱动的批次大小和并发度执行。

出现不确定写入时，`rename_write.resolve_rename_outcome` 优先按 ID 读取元数据核对目标名；并发调度暂停补组等待核对，核对后仍有未知结果则停止补组。已经发出的写入必须收尾，取消请求也不能提前释放保护。结果及进度的精确定义见[执行 API](../api/executions/index.md#execution-outcomes)。成功项不自动回滚。

### 单项直接执行

`SingleRenameService` 检查连接 revision、互斥与 Provider 可改名能力，在目录写入协调范围内调用 `rename_single`。名称和存储边界由 Schema 与驱动按[单项契约](../api/executions/single.md)检查。Google 单项按 ID PATCH，遵循第三方同名语义。单项与批量共用未知结果核对与连接保护。

## 目录读取与缓存

浏览请求参数在路由中转换为内部模式；精确参数见[目录 API](../api/directories/list.md)。

| 内部模式 | 用途与读取 | 缓存关系 |
| --- | --- | --- |
| `cached` | 普通浏览，可复用目录列表、父目录提示及已知祖先 | 按 Provider 能力、授权与连接 revision 使用缓存；同代请求可合并 |
| `refresh` | 手动刷新、未知结果核对，完整实时读取并核验目录关系 | 绕过旧读取结果；成功后协调/更新缓存，不复用祖先 |
| `navigate` | 外部导航实时读取内容，允许复用已知祖先但仍核验目标 | 对应 `refresh: true, reuse_ancestors: true` |
| `verify` | 批量执行前仅取实时完整子项；云盘按目录 ID 读取，不取目标/祖先元数据 | 不读写目录缓存，不复用祖先，不合并普通缓存读取 |

云盘驱动负责把分页完整取回。`verify` 可能因目录为空、不存在或权限隐藏而取得空成功响应；服务继续核对源 ID 并比较快照，源项缺失时拒绝执行。

目录列表以连接、revision、规范位置隔离，使用 cachetools 的过期/LRU 管理；祖先索引来自缓存列表，生命周期随列表维护。容量和 TTL 见[配置源](../../backend/app/core/config.py)与 [cache.toml](../../backend/cache.toml)，不另维护尺寸/默认值副本。

generation 和写入范围防止迟到读取覆盖新状态。写入期间旧缓存保留给协调使用，但不直接作为读取结果；结束后只按确认元数据修补，未知、位置不明或异常中断时失效相应范围。修改此处同时检查前端 Query 缓存失效和未知结果恢复链路。

## 持久化与部署

`StorageManager` 构造新状态，Repository 原子保存成功后才发布到内存；连接配置、授权身份变化会驱动 revision 与缓存/实例失效，同账号令牌轮换保留身份语义。状态文件包含未加密凭据，对外 `StorageInfo` 不返回凭据，只返回必要状态及密钥是否存在。

预览、进度、锁和缓存均在单进程内；重启丢失，不支持多 worker 协同。开发入口是 `app.main:app`，发布入口通过 `release.py` 同时提供静态页面、根路径 API 与 `/api`。安装、启动、发布不在此重复，见[开发环境](../DEVELOPMENT.md#环境与开发启动)、[启动说明](../LAUNCHER.md)与[发布流程](../DEVELOPMENT.md#发布流程)。

## 扩展入口

| 扩展 | 代码入口 | 关联契约与调用方 |
| --- | --- | --- |
| Rule | [RenameRule](../../backend/app/rules/base.py)、具体规则/配置、[RuleRegistry](../../backend/app/rules/registry.py)、[依赖装配](../../backend/app/api/dependencies.py) | [规则 API](../api/rules/index.md)、[前端 RuleFields](../../frontend/src/features/rules/RuleFields.tsx)及语言词条 |
| Provider | [ProviderDefinition / Registry](../../backend/app/providers/registry.py)、[builtin](../../backend/app/providers/builtin.py)、具体配置/认证/Driver、[StorageDriver](../../backend/app/providers/base.py) | [Provider API](../api/providers/index.md)、前端字段/能力适配，必要时扩展浏览器导航适配器 |

Rule 接收调用方给定的 RuleContext，不访问存储或自行排序；序列编号使用输入顺序。Provider 负责位置、完整分页、名称约束、认证、错误与读写策略；核心 Service 通过统一接口复用这些能力。接口扩展需要同步所有实现与直接调用方，跨端字段同步 Schema、[前端类型](../../frontend/src/types/index.ts)及[客户端](../../frontend/src/api/client.ts)。
