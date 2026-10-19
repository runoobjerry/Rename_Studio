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

规则按顺序应用：`File -> Rule chain -> Validation -> Preview -> Execute`。Engine 必须与云盘解耦，支持规则链、校验、冲突检测，保留原名，并且 Preview 绝不修改真实文件。

- 所有批量重命名必须先预览；预览至少给出 `original_name`、`new_name`、`changed`、`valid`、`conflict`、`error`。
- 服务端将预览保存为不可变快照，绑定 `storage_id`、连接版本、目录位置、源项与请求规则。客户端只持有短期 `preview_id`，不得构造或修改待执行项。
- Execute 仅接收服务端签发的 `preview_id`。执行前重新读取源项和同目录冲突集合，重新计算并确认与快照一致；连接配置、根目录、账号授权、过期、已消费或外部变更均使预览失效。
- 预览通过后也不信任客户端重新提交的文件、规则或目标名称。

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

## 执行安全与历史

执行前校验合法性、空名、重复名、已有名称冲突、Provider 禁止字符和循环冲突。交换、循环或名称占用链必须以唯一临时名分阶段处理；阶段失败应尽力回滚，并明确返回部分成功和未恢复状态，不能误报全部成功。

- 写入结果不确定时，不盲目重放整批或回滚未知项；按文件 ID 重新确认，并返回明确错误码及当前名称（无法确认时为 `null`）。
- 每次执行记录 `operation_id`、`provider`、`file_id`、`old_name`、`new_name`、`timestamp`、`status`、`error`；不要假定云盘 API 天然支持撤销。Undo、Redo、History 以这些记录为基础演进。

## API 契约

- API 保持 REST 风格，输入输出使用 Pydantic Schema，不直接返回 ORM Model。
- 已发布字段、枚举值和错误码是前后端契约。变更时同步后端 Schema、前端类型/API 客户端和测试；除非明确版本迁移，不改变含义或删除字段。
- 存储 API 以 `storage_id` 和 `StorageLocation` 为边界，Provider 类型不是连接路由参数；已删除 API 不提供别名、重定向或隐式转换。
- 统一错误结构为 `{"error":{"code":"...","message":"...","details":{}}}`；未知异常不泄露内部细节。错误应区分认证、Provider、限流、冲突和校验等真实类别。

## Frontend

前端负责文件浏览/选择、规则编辑、预览与冲突展示、执行确认和历史。Server State 使用 TanStack Query，UI State 使用 Zustand；不要将所有业务状态塞进单一全局 Store。具体前端模块边界由 `frontend/AGENTS.md` 约束。

- 服务端偏好、标签页浏览会话和重命名任务分开管理；位置记忆只保存成功打开后 Provider 返回的 `StorageLocation`，恢复前校验 `storage_id`、连接版本、账号身份和 Provider 位置能力。不得将显示路径当作 ID，也不得恢复旧预览或执行任务。
- 云默认目录以连接和稳定 `account_id` 隔离，不以邮箱或显示名代替；位置恢复完成前暂停目录读取。

## Persistence

- 连接状态以版本化 JSON 状态文档持久化；每次写入原子提交完整状态，配置、凭据和连接版本不得分离提交。
- 持久化响应和 API Schema 排除凭据；访问令牌仅在内存，状态、临时文件和迁移备份不得提交 Git。
- 升级先校验旧文档、保留可恢复备份，成功后才替换正式状态；失败不得覆盖可用状态。迁移至数据库时保留原子性、凭据隔离和版本失效语义。

## 编码、类型、错误与日志

- 优先 `Readable > Clever`、`Simple > Abstract`、`Explicit > Magic`、`Composition > Inheritance`；函数保持短小、单一职责和明确命名。避免过度抽象、过早优化、God Class、循环依赖和隐藏副作用。
- Python 使用明确类型；TypeScript 不无理由使用 `any`，优先 `interface`、`type`、`unknown`；前后端数据结构保持一致。
- 在用户输入、外部 API、文件系统、数据库、认证和权限等系统边界校验；进入内部契约后信任类型与上游保证。每项防御逻辑都应对应真实故障与明确恢复策略。
- 不用 `except Exception: pass`、无意义 fallback、重复日志、重复 `None`/类型检查或默认值掩盖程序错误。没有恢复策略时让异常传播。
- 日志记录 provider、operation、file_id、request_id、duration、error；绝不记录 access/refresh token、密码或 authorization header。

## 测试

测试真实业务行为与风险，优先级为：Rule Engine、Rename Engine、校验、冲突检测、Provider Adapter、API、Frontend。不要为不可达分支、语言/框架已保证的行为或覆盖率目标编写低价值测试，也不要 Mock 内部细节而非最终行为。

- 新 Rule 至少覆盖正常输入、空输入、边界值、Unicode、扩展名和异常配置。
- Preview/Execute 改动覆盖：服务端快照不可被客户端篡改、执行前重校验、过期/重复执行、连接版本变化、名称依赖链安全执行与失败回滚、未知写入结果。
- 新 Provider 覆盖单项与批量元数据/重命名、位置语义、名称规则和特有错误映射。
- Provider 元数据改动覆盖配置/凭据隔离和能力驱动行为，使用非内置类型的测试定义验证公共流程不依赖类型名；位置恢复覆盖连接版本/账号变化、不支持的位置及存储不可用。
- 存储连接改动覆盖多连接隔离、配置/授权变更导致的快照失效、执行互斥、持久化升级或失败不损坏既有状态。

## AI Coding与验证

每次只完成一个明确目标：先阅读相关代码和直接调用方，理解现有架构并确定最小范围，再实现、验证和说明。不得未经检查重写模块、因小需求大重构、修改无关文件、随意替换技术栈、创建重复工具、删除既有功能或为未来假设增加复杂抽象。

**尤其是保持代码简单，只处理真实存在的业务风险，不为理论上的极端情况增加复杂度**
例如：
- 在系统边界进行校验：用户输入、外部 API、文件系统、数据库、认证与权限等。
- 数据通过边界校验后，默认信任内部类型、模型和函数契约。
- 不重复进行已经由 Pydantic、类型系统、数据库约束或上游逻辑保证的校验。
- 不为“理论上可能发生”但业务流程中不可达的状态编写 fallback、异常分支或恢复逻辑。
- 避免无意义的 `try/except Exception`、重复日志、重复 `None`/类型检查以及多层兜底。
- 不使用 `getattr(..., None)`、`.get()`、默认值等方式掩盖本应暴露的程序错误。
- 只有存在明确恢复策略时才捕获异常；否则让异常正常传播。
- 每一项防御逻辑都应对应可解释的真实故障场景。

- 编译、测试和端到端验证由用户执行；可做静态检查，但不得将静态证据表述为运行验证。
- 在关键算法、安全边界和不直观业务逻辑处写简短注释，避免逐行复述代码。
- 交付时说明修改文件、简化或删除的逻辑、原因、测试结果与剩余风险。



## 新功能归属与最终原则

新增需求先判断归属并只修改相应模块：文件名规则属于 Rule；云存储接入属于 Provider；其余分别归 Rename Engine、Service、UI 或 Infrastructure。设计始终优先保持 Rename Engine 简单、Rules/Providers 易扩展、Preview/Execute 分离、云盘 API 与业务逻辑解耦，并以小步迭代避免提前复杂化。
