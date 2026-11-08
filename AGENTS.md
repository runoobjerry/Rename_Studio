# AGENTS.md

## 项目目标

构建面向 OneDrive 等云端存储的 WebUI 规则型批量重命名工具：浏览和选择文件、组合规则、预览与冲突检查、批量执行、历史/撤销，以及可扩展的 Rules 和 Providers。始终以**简单、模块化、可扩展、可测试、可迭代**为目标。

## 技术栈与目录

- 后端：Python 3.12+、FastAPI、Pydantic、SQLAlchemy、SQLite、httpx、pytest。
- 前端：React、TypeScript、Vite、TanStack Query、Zustand。
- 无明确需求时，不引入大型框架或复杂依赖，不为“企业级”形式增加无实际职责的层。
- 推荐边界：`backend/app/{api,core,models,schemas,services,providers,rules,repositories}`；`frontend/src/{api,components,features,hooks,pages,stores,types,utils,workspace}`；根目录保留 `docs/`、README与本文件。

## 核心架构

```text
Frontend -> FastAPI API -> Rename Engine / Rule Engine / Provider Layer / Service Layer / Persistence
```

- UI 不包含业务规则；API 层不直接实现重命名；Rule 不访问云盘；Provider 不实现重命名规则。
- `StorageManager` 负责独立连接的生命周期、连接版本和执行互斥；`ProviderRegistry` 保存 Provider 定义并按定义校验配置，不承担连接状态管理。
- 持久化模型和 Repository 只读写状态，不承载业务逻辑；Rename Engine 不绑定具体存储实现。

## Rename Engine 与 Preview First

Rename Engine 不依赖具体云盘实现；名称限制和文件读写由 Provider 提供。两种流程都保留原名；批量在写入前复核，单项直接执行由 Provider 校验并确认结果。

### 批量重命名

- 流程：文件 → 按顺序应用规则 → 校验和冲突检查 → 预览 → 执行。使用规则链时，即使只选一个文件也必须先预览。
- 预览不修改文件，返回 `original_name`、`new_name`、`changed`、`valid`、`conflict`、`error`。
- 服务端保存不可变的预览快照，记录连接、连接版本、目录、源项和规则。客户端执行时只提交服务端签发的短期 `preview_id`，不重新提交文件、规则或目标名称。
- 执行前重新读取源项和同目录文件，确认计算结果及源状态与快照一致。连接配置、根目录、账号授权或文件状态变化，以及预览过期、已消费时，拒绝执行，需重新预览。

### 单项快速重命名

- 对单个文件或文件夹进行重命名，不使用规则链，也不创建预览。
- 客户端提交 `storage_id`、连接版本、目录位置、文件 ID、原名、目标名和 `operation_id`。`operation_id` 只标识操作，不是预览 ID，也不保证重复请求只执行一次。
- 单项使用独立服务和前端请求流程，与批量共用 StorageManager 的连接执行互斥。核对连接版本后按文件 ID 直接调用 Provider，不读取整个目录、不重算预览、不比对原名；原名与目录位置仅保留为请求上下文。
- 名称、权限和冲突由 Provider 及第三方 API 判断，接受 Provider 的同名语义（例如 Google Drive 允许同目录同名）；Google 单项直接按 ID PATCH，由 API 决定是否允许，不做 My Drive、祖先、类型或权限预检；批量和浏览的范围限制保留。成功按返回文件更新身份，明确错误按统一错误码显示在输入框下。
- 单项结果的确认元数据不要求完整显示路径；显示路径由前端结合浏览上下文生成，不作为身份或成功依据。写入结果未知时先按文件 ID 读取元数据核对；无法确认就明确返回未知结果，不自动重放请求。

## Rules

所有规则实现统一接口，配置使用 Pydantic Model：

```python
class RenameRule:
    type: str

    def apply(self, filename: str, context: RuleContext) -> str:
        raise NotImplementedError
```

- 规则包括但不限于 `replace`、`regex_replace`、`prefix`、`suffix`、`remove`、`trim`、`case`、`number_extract`、`number_pad`、`sequence`、`extension`。
- 使用 Registry 注册规则，禁止通过不断增长的 `if/elif` 分发。新增规则应只需创建 Rule 和 Config、注册，并添加对应前端配置 UI；避免修改 Rename Engine 核心。
- 规则编辑器必须支持添加、删除、启用/禁用、排序和复制，并明确展示执行顺序。

## Providers 与认证

所有存储经统一 `StorageProvider` 访问，至少覆盖目录列举、单项/批量元数据与单项/批量重命名。`provider_type` 是实现类型，`storage_id` 是独立连接配置和账号，两者不得混用或为 Local/OneDrive 设置别名。

- Provider 负责目录定位、名称校验与规范化、目标名限制、执行批大小和可用的批量语义；服务层据此做冲突检测和执行规划。逐项重命名仅是无批量 API 时的兼容回退。
- 每个 Provider 在自身模块维护配置 Model、Provider/认证工厂及 `ProviderDefinition`，经 `providers/builtin.py` 显式注册；认证实现遵守 `ConnectionAuth`。公共 Schema、依赖装配和业务层不重复维护各 Provider 的配置或类型分支。
- 配置字段、授权需求、位置类型和选择器等能力由 Provider 元数据声明，前端据此渲染和启用操作；元数据未就绪或缺失时暂停依赖操作，不以 Provider 名称推断能力。元数据不包含连接凭据，配置校验仍由服务端执行。
- `StorageLocation` 为根目录、Provider 不透明 ID 或边界规范化路径。前端和服务层将位置及文件 ID 视为不透明值；显示路径不是云资源身份，不假定重命名后文件 ID 不变。
- 业务层经 `Service -> StorageProvider -> OneDriveProvider -> Microsoft Graph API` 调用 Graph，不直接调用 Graph。
- OneDrive 使用 OAuth 2.0 授权码/浏览器登录；不硬编码 Token、不提交 Token、不保存账号密码。处理分页、批量、限流、重试、超时、401 刷新和 429 `Retry-After`，优先 batch、async 与有界并发，避免逐项串行请求。

## 目录读取与缓存

- `DirectoryService` 统一协调浏览和重命名流程的目录读取及缓存失效。目录缓存由 Provider 定义显式启用，按连接和版本隔离，目录列表以 Provider 返回的规范位置为键。Provider 负责解析位置、验证访问范围和构建目录结果，缓存的目录元数据只用于辅助读取。
- 浏览和预览可复用目录缓存。强制刷新和批量执行前复核均须绕过目录列表及目录元数据缓存，直接读取存储；未知写入的服务端核对仍按文件 ID 读取。
- 连接版本变化或删除时清除该连接的目录列表和元数据缓存。单项和批量写入共用失效机制，覆盖受影响的父目录以及被改名文件夹的子树；无法确定影响范围时清除连接缓存。防止迟到读取把失效数据写回缓存或覆盖较新的刷新结果。

## 执行安全与历史

批量执行前校验合法性、空名、重复名、已有名称冲突和 Provider 禁止字符。目标名被其他文件占用即判为冲突，包括选中项之间的交换、循环或名称占用链；不使用临时名，不自动回滚。执行保留成功项，并明确返回部分成功和失败状态，不能误报全部成功。

- 写入结果不确定时，不盲目重放整批；按文件 ID 重新确认，并返回明确错误码及当前名称（无法确认时为 `null`）。
- 单项与批量的执行记录都应保留操作标识、连接与目录上下文、提交时间，以及逐项原始身份、原名、目标名、执行状态、错误和已确认的结果。历史、撤销和重做以已确认的执行结果为基础；不要假定云盘 API 天然支持撤销。

## API 契约

- API 保持 REST 风格，输入输出使用 Pydantic Schema，不直接返回 ORM Model。
- 已发布的 HTTP 状态、字段、枚举值、错误码和结构化原因属于前后端契约。变更时同步后端 Schema、前端类型/API 客户端和测试；除非明确版本迁移，保留既有含义和兼容性。
- 存储 API 以 `storage_id` 和 `StorageLocation` 为边界，Provider 类型不是连接路由参数；已删除 API 不提供别名、重定向或隐式转换。
- 统一错误结构为 `{"error":{"code":"...","message":"...","details":{}}}`。Provider 在边界把底层失败映射为应用错误类别，API 返回的供应商状态和错误码仅用于诊断。`details.reason` 使用应用定义的稳定标识，错误详情只包含筛选后的非敏感数据，未知异常不泄露内部细节。

## Frontend

前端负责文件浏览/选择、规则编辑、预览与冲突展示、执行确认和历史。Server State 使用 TanStack Query，UI State 使用 Zustand；不要将所有业务状态塞进单一全局 Store。具体前端模块边界由 `frontend/AGENTS.md` 约束。

- 服务端偏好、标签页浏览会话和页面内的重命名状态分开管理。位置记忆只保存成功打开后 Provider 返回的 `StorageLocation`，恢复前校验 `storage_id`、连接版本、账号身份和 Provider 位置能力。选择、预览、执行记录和待核对状态留在当前页面，不随浏览位置恢复。
- 云默认目录以连接和稳定 `account_id` 隔离，不以邮箱或显示名代替；位置恢复完成前暂停目录读取。
- 浏览器扩展只传递导航意图，网站提取和账号、目录匹配由各自注册的适配器处理。工作区按 Provider 声明的导航能力匹配连接，核对账号和目标范围后才打开目录。协议变更须同步双方校验器与 [浏览器消息协议](docs/BROWSER_PROTOCOL.md)，并保持已发布消息的兼容性。
- 新 UI 文案使用 i18next 翻译键，默认与回退资源为 `en-US`，同步维护 `zh-CN`；新增 Rule/Provider 同步稳定 ID 对应词条。翻译值不得用作业务标识，不翻译文件名、路径、连接名称或账号数据。翻译贡献指南见 [README 的开发章节](README.md#开发)。

## Persistence

- 连接状态以版本化 JSON 状态文档持久化；每次写入原子提交完整状态，配置、凭据和连接版本不得分离提交。
- 持久化响应和 API Schema 排除凭据；访问令牌仅在内存，状态、临时文件和迁移备份不得提交 Git。
- 升级先校验旧文档、保留可恢复备份，成功后才替换正式状态；失败不得覆盖可用状态。迁移至数据库时保留原子性、凭据隔离和版本失效语义。

## 日志

- 日志记录 provider、operation、file_id、request_id、duration、error，避免重复记录。严禁记录 access/refresh token、密码或 authorization header。

## 测试

测试真实业务行为与风险，优先级为：Rule Engine、Rename Engine、校验、冲突检测、Provider Adapter、API、Frontend。不要为不可达分支、语言/框架已保证的行为或覆盖率目标编写低价值测试，也不要 Mock 内部细节而非最终行为。

- 新 Rule 至少覆盖正常输入、空输入、边界值、Unicode、扩展名和异常配置。
- Preview/Execute 改动覆盖：服务端快照不可被客户端篡改、执行前重校验、过期/重复执行、连接版本变化、名称依赖冲突拒绝、部分成功、未知写入结果。
- 新 Provider 覆盖单项与批量元数据/重命名、位置语义、名称规则和特有错误映射。
- Provider 元数据改动覆盖配置/凭据隔离和能力驱动行为，使用非内置类型的测试定义验证公共流程不依赖类型名；位置恢复覆盖连接版本/账号变化、不支持的位置及存储不可用。
- 存储连接改动覆盖多连接隔离、配置/授权变更导致的快照失效、执行互斥、持久化升级或失败不损坏既有状态。
- 目录缓存改动覆盖连接及版本隔离、强制刷新和执行复核绕过缓存、重命名后的失效范围，以及并发读取在失效或刷新后迟到的结果。
- 错误契约改动覆盖相关 HTTP 状态、应用错误码、结构化原因与执行结果的确定性。前端测试通过结构化响应验证操作保护和本地化提示。

## AI Coding与验证

每次只完成一个明确目标：先阅读相关代码和直接调用方，理解现有架构并确定最小范围，再实现、验证和说明。不得未经检查重写模块、因小需求大重构、修改无关文件、随意替换技术栈、创建重复工具、删除既有功能或为未来假设增加复杂抽象。

- 优先 `Readable > Clever`、`Simple > Abstract`、`Explicit > Magic`、`Composition > Inheritance`。函数保持短小、单一职责和明确命名。避免过度抽象、过早优化、God Class、循环依赖和隐藏副作用。
- Python 使用明确类型，TypeScript 优先使用 `interface`、`type`、`unknown`，避免无理由使用 `any`。前后端数据结构保持一致。
- 在用户输入、外部 API、文件系统、数据库、认证和权限等系统边界校验。通过校验后信任内部契约及 Pydantic、类型系统、数据库或上游逻辑提供的保证，避免重复检查。
- 防御逻辑须对应真实故障和明确处理方式。避免为不可达状态增加分支或多层兜底。只有存在明确恢复策略时才捕获异常，否则让异常传播。禁止用 `except Exception: pass`、`getattr(..., None)`、`.get()` 或默认值掩盖程序错误。
- 在关键算法、安全边界和不直观业务逻辑处写简短注释，避免逐行复述代码。
- 编译、测试和端到端验证由用户执行。可做静态检查，但不得将静态证据表述为运行验证。
- 交付时说明修改文件、简化或删除的逻辑、原因、测试结果与剩余风险。

## 新功能归属与最终原则

新增需求先判断归属并只修改相应模块：文件名规则属于 Rule；云存储接入属于 Provider；其余分别归 Rename Engine、Service、UI 或 Infrastructure。设计始终优先保持 Rename Engine 简单、Rules/Providers 易扩展、Preview/Execute 分离、云盘 API 与业务逻辑解耦，并以小步迭代避免提前复杂化。
