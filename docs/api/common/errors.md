[API Reference](../README.md) · [通用约定](conventions.md) · [共享错误](errors.md)

<a id="errors"></a>
## 错误对象：ErrorResponse

应用错误使用统一 JSON 对象。OAuth callback 使用 HTML 和消息载荷，见[授权回调](../authorization/callback.md#auth-callback)。

### Attributes

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `error` | object | 否 | 错误内容。 |
| ↳ `code` | string | 否 | 稳定错误类别；与操作性质、结果确定性共同决定处理方式。 |
| ↳ `message` | string | 否 | 诊断信息；不作为业务标识或固定语言文案。 |
| ↳ `details` | object | 否 | 附加数据；没有附加数据时为 `{}`。 |

### HTTP 状态与错误码

| HTTP | `error.code` | 含义与客户端处理 |
| --- | --- | --- |
| 400 | `APPLICATION_ERROR` | 通用应用错误基类；有明确类别时使用对应子类。 |
| 401 | `AUTHENTICATION_ERROR` | 未连接账号或授权被拒绝。读取授权状态，按需重新授权。 |
| 403 | `PERMISSION_DENIED` | Provider 拒绝访问。提示检查权限。 |
| 404 | `NOT_FOUND` | 连接、目录或项目不存在。刷新对应资源。 |
| 404 | `PREVIEW_NOT_FOUND` | 预览不存在、已释放、已消费或已回收。重新预览。 |
| 409 | `PREVIEW_EXPIRED` | 预览过期或复核结果变化。重新预览。 |
| 409 | `STORAGE_CONNECTION_CHANGED` | 连接版本或账号变化。重新读取连接、目录；批量重新预览，单项更新请求版本。 |
| 409 | `STORAGE_BUSY` | 连接正在重命名。等待完成后再操作。 |
| 409 | `STORAGE_ACCOUNT_ALREADY_CONNECTED` | 账号已绑定其他同类连接。使用 `details.storage_id` 指向的连接。 |
| 409 | `RENAME_CONFLICT` | 目标名称冲突。修改名称或重新预览。 |
| 422 | `REQUEST_VALIDATION_ERROR` | 请求结构、类型或取值无效。根据 `details.errors` 修正请求。 |
| 422 | `VALIDATION_ERROR` | 配置、位置、选择或名称无效。根据 `details.reason` 提示或修正输入。 |
| 422 | `RULE_CONFIGURATION_ERROR` | 已启用规则的类型或配置无效。根据 `details.rule_type` 修正规则。 |
| 429 | `RATE_LIMIT_ERROR` | Provider 限流。稍后操作；写入不能据此盲目重发。 |
| 502 | `PROVIDER_ERROR` | Provider、文件系统、身份服务或状态保存失败。显示错误；写入失败先核对结果。 |
| 502 | `RENAME_OUTCOME_UNKNOWN` | 无法确认是否已写入。核对真实文件，不自动重放。执行接口通常在结果项中返回此码。 |
| 500 | `INTERNAL_ERROR` | 未预期错误。保留 `details.request_id` 供排查；不自动重放写入。 |

各接口的 Errors 仅列出需要额外处理的情形。HTTP 200 的重命名响应也可能含失败项，见[执行结果](../executions/index.md#execution-items)。

### 错误详情

以下字段按错误场景出现，不保证全部存在。`AppError.details` 和 API 错误对象使用同一规范；预览项及执行项的 `details` 复用适用字段。执行项无详情时仍允许 `null`。

| `details` 字段 | 类型 | 说明 |
| --- | --- | --- |
| `reason` | string | 应用定义的稳定细分原因，用于分类和本地化；不能直接填供应商错误码。 |
| `params` | object | `reason` 对应的展示参数，不能用作业务标识或重试指令。 |
| `stop_reason` | string | 停止继续提交的应用错误码；当前为 `RENAME_OUTCOME_UNKNOWN`，不表示本项写入未知。 |
| `file_ids` | array of string | 预览选择错误涉及的 ID。 |
| `errors` | array of object | 校验错误；每项通常含 `type`、`loc`、`msg`，可能有其他校验数据。 |
| `rule_type` | string | 配置错误涉及的规则类型。 |
| `storage_id`、`storage_name` | string | 账号已连接时指向已有连接。 |
| `execution_started` | boolean | 批量复核失败时为 `false`，表示尚未开始写入；缺失时不能推断写入状态。 |
| `request_id` | string | 未预期错误的请求标识。 |
| `actual_name` | string | 写入核对后确认的名称。 |
| `file_id`、`path`、`new_name` | string | 请求涉及的资源或目标名上下文；不作为写入结果证据。 |
| `provider` | string | 配置校验涉及的 Provider 类型；不是 `storage_id`。 |
| `graph_status`、`google_status` | integer | 保留的底层 HTTP 状态诊断字段；前端不据此分类或决定重试。 |
| `provider_type` | string | 产生底层错误的 Provider 类型，不是连接 ID。阶段二用于 HTTP 分类及本地 OS 异常。 |
| `provider_status` | integer | 底层 HTTP 状态；与旧 `graph_status` / `google_status` 从同一状态赋值，迁移期间兼容保留旧字段。不是对外 HTTP 状态。 |
| `provider_codes` | array of string | Graph 外层至内层的错误码或 Google `errors[].reason`，仅供诊断和 Provider 内部识别；缺失时不补假定值。 |
| `errno`、`winerror` | integer / null | 本地 OS 错误编号；`winerror` 仅在原异常提供时出现。不回显原异常中的绝对文件路径。 |

创建、更新连接和更新偏好的请求校验错误会移除条目的 `input`、`ctx`，避免回显敏感请求值。

字段的写入边界：

- Provider 仅输出已筛选的诊断字段和应用原因，不透传供应商响应、请求头、授权配置或任意异常对象。现有错误转换继续保留 Python 异常链；返回的逐项异常对象也保留原异常供内部排查。
- Service 只补充自己能证明的执行事实，例如复核失败的 `execution_started: false`、尚未发出写请求的 `RENAME_NOT_ATTEMPTED`。字段缺失表示未提供证据，不能反推写入已发生或未发生。
- API 保持原错误包装及应用 HTTP 状态，不直接照搬底层 HTTP 状态。例如 Graph `412` 继续映射 `RENAME_CONFLICT` / HTTP `409`，底层 `412` 留在诊断字段。
- `details` 只容纳 JSON 可序列化、经过明确选择的上下文；不得包含 access/refresh token、密码、Authorization header、完整凭据或未经筛选的第三方载荷。当前保持字典兼容，不新增通用脱敏器或第二份上下文对象。
- `error.details.actual_name` 是错误核实信息；执行项顶层 `actual_name` 是既有 API 投影，继续兼容并从同一核实结果赋值，不独立推导。`current_file` 是确认元数据，三者不能代替结果分类。

### 执行原因

| `error_code` | `details.reason` | 语义 |
| --- | --- | --- |
| `PROVIDER_ERROR` | `RENAME_NOT_ATTEMPTED` | 本项尚未发出写请求；当前由因未知结果停止补组的路径产生。`stop_reason: RENAME_OUTCOME_UNKNOWN` 表示另一项未知导致停止。 |
| `RENAME_CONFLICT` | `SOURCE_CHANGED` | Provider 报告源状态或前置条件已变化，刷新目录后重新预览或重新输入。Graph `412` 产生此原因。 |

不得将“下一次重试未提交”标记为 `RENAME_NOT_ATTEMPTED`：先前已发出请求的项目，仍按其已确认失败或未知结果分类。Google 批处理中因其他项未知而停止重试的已拒绝项继续属于失败，不属于尚未尝试。

### 错误分类与处理策略

`AppError` 及其子类继续作为唯一应用异常体系；`code` 表达发生了什么，`status_code` 表达应用 HTTP 语义，`message` 仅供诊断。现有公开错误码全部保留，本阶段不新增错误码或异常继承层。

| 职责 | 归属与边界 |
| --- | --- |
| 底层错误识别 | Provider 将 HTTP、供应商标识、文件系统异常转换为现有应用异常，必要时用 `raise ... from exc` 保留链。供应商标识只供诊断和 Provider 内部识别。 |
| 稳定分类与上下文 | `core/errors.py` 定义类别和 HTTP 状态，本页定义公共上下文。`RENAME_OUTCOME_UNKNOWN` 表示核实前的写入不确定性，不自动等于最终未知结果。 |
| 有限重试与冷却 | 继续由当前 Provider 请求层执行已有授权刷新、限流冷却和有限重试。本阶段不移动、叠加或改变重试循环。 |
| 写入核实和提交控制 | 业务层按文件 ID 核实未知写入，确认成功后保留成功，确认未达目标则失败，核实不了则保持未知；调度器暂停或停止补组并等待在途写入，不自动回滚。 |
| API 与前端 | API 输出稳定契约；前端按应用字段展示、汇总及保持待核对保护，不匹配英文诊断，不自动重放。 |

错误类别本身不等于策略：`PROVIDER_ERROR` 不证明可以重试，`RATE_LIMIT_ERROR` 不证明所有同批项都未执行，`RENAME_OUTCOME_UNKNOWN` 必须先核实；`stop_reason` 也不是当前项目的错误码。读取临时故障允许有限重试；写入只有在已知结果及现有安全重试条件下才可再次提交。取消后仍等待已发出的写入结束。不得在 `details` 添加由多层维护的 `retryable`、`should_retry` 等平行策略字段。

错误来源、底层状态、重试等待属于后续 Provider 分类/策略整理所需的内部信息，不在阶段一批量增加公共属性。本阶段不把内部策略对象序列化进 API；统一来源字段或替换旧诊断字段时须先给出迁移约定。

### 阶段四契约迁移

1. 保留统一错误包装、错误码和 HTTP 状态。逐项 `status` 扩展为 `renamed / skipped / failed / unknown / not_attempted`，批次 `completed / partial / failed` 保持原值；由五值逐项状态明确区分未知与未执行。没有第二份 `outcome` 字段或恢复状态。
2. 迁移前 `failed + RENAME_OUTCOME_UNKNOWN` 改为 `unknown`；`failed + details.reason: RENAME_NOT_ATTEMPTED` 改为 `not_attempted`；其他状态保持原义。该转换在 Service 构造最终结果时完成，前端三值推导函数和后端临时 `outcome` 属性已删除，客户端只读 `status`。
3. `details.reason` 和诊断字段继续保留原契约，用于解释原因与排查，不再承担前端结果推导。供应商 HTTP 状态仅诊断使用。`error` 可变或为空，已知错误码仍可翻译。
4. 本阶段要求配套更新服务端和前端。升级前等待在途执行结束并核实异常结果，再更新两端、刷新页面；不在执行期间混用旧页面或旧后端。旧三值后端与新客户端的混合运行不受支持，不添加文本或供应商状态兼容分支，不恢复旧执行任务或重放旧预览。
5. 客户端请求在调用处显式声明 `read / write`：目录 POST、规则预览和草稿目录选择是读取；执行、连接/授权/偏好变更是写入。公共请求层不再通过 HTTP 方法或 URL 后缀猜测。传输失败仍保留浏览器异常及 `status: 0`，该值不证明未写入。
6. 待核对流程保持现有实现：目录刷新成功仅解锁重新预览，旧预览仍不可执行；新预览失败继续保留待核对，新预览成功才清除。结束任务只清理现有界面状态，不提交撤回、不恢复文件、不增加核对入口或自动续跑。

人工验收见[阶段四验收清单](../../RESULT_CONTRACT_ACCEPTANCE.md)。

### 阶段二 Provider 落点

- OneDrive 的 HTTP 分类继续集中在 `_graph_error`：401 授权、403 权限、404 缺失、409/412 冲突、429 限流、400 校验，其他为 Provider 错误。Graph 错误码链用于诊断，不覆盖 HTTP 已确定的类别；412 继续提供 `SOURCE_CHANGED`。外层及子项 5xx 写入仍为未知，只增加已筛选诊断。
- Google 的 `_response_error` 统一提取各 HTTP 状态携带的原因；403 中仅原有 `rateLimitExceeded`、`userRateLimitExceeded` 进入限流分类。其他 403、日配额与存储额度原因不自动增加重试；非法 403 错误体仍为 Provider 错误。Google 同名语义不变，不新增重命名冲突映射。
- `providers/errors.py` 仅共享诊断构造与已有 OAuth HTTP 分类：令牌交换的 400/401/403 为授权错误，账号核实只有 401/403 为授权错误；429 为限流，其他拒绝为 Provider 错误。OAuth 响应正文不解析或回显，避免泄露凭据。认证刷新、连接版本失效与调度不变。
- Local 初始化、目录读取、元数据读取和重命名统一转换 `OSError` 并保留异常链：ENOENT/ENOTDIR → `NOT_FOUND`，EACCES/EPERM/EROFS → `PERMISSION_DENIED`，EEXIST/ENOTEMPTY → `RENAME_CONFLICT`，EINVAL/ENAMETOOLONG → `VALIDATION_ERROR`，其他（含 ENOSPC/EIO）→ `PROVIDER_ERROR`。Windows 32/33 的共享/锁定错误保持 `PROVIDER_ERROR`，不误报访问权限。读取使用实际 stat/lstat，避免 exists() 将权限错误掩盖为缺失。
- 本地 rename 已返回成功后读取确认元数据失败，返回 `RENAME_OUTCOME_UNKNOWN`，沿用既有 ID 核实流程；本地路径 ID 可能已改变，旧 ID 核实不了就保留未知。此处理不重试写入、不回滚。POSIX 的预检与 rename 之间存在的覆盖竞态、本地网络文件系统的写入确定性策略均未在本阶段重设计。

标准字段按可获得证据提供，并非所有应用校验异常都必须包含 Provider 诊断。原始 HTTP 响应、异常对象、OAuth 正文均不作为公共上下文透传；OS/网络异常链留在进程内。阶段二没有新增重试条件、修改并发或批大小，也未消除 Provider 特有分类。

依据：[Microsoft Graph 错误规范](https://learn.microsoft.com/en-us/graph/errors)、[Google Drive 错误规范](https://developers.google.com/workspace/drive/api/guides/handle-errors)。人工核实步骤见[阶段二验收清单](../../PROVIDER_ERROR_ACCEPTANCE.md)。

### 阶段三重试与写入处理

重试预算唯一实现在 `providers/retry.py`：一次单项 HTTP 操作或一个原始批处理组最多 4 次 HTTP 尝试（首次 + 最多 3 次重试）。同组外层响应与子项响应共用计数，只在实际发起 HTTP 请求时占用次数；重试子集不重置预算。不同组、分页请求、前置元数据读取分别拥有自己的预算，不能将此上限理解为整次用户操作总共只有 4 个请求。

| 操作 | 决策与边界 |
| --- | --- |
| 读取 | 传输故障允许有限重试；OneDrive 沿用 429/500/502/503/504，Google 沿用已分类限流及 5xx。401 按原有授权刷新流程处理并消耗相同数据请求预算，不重试权限、名称、缺失等明确业务拒绝。 |
| 写入 | 仅明确授权或限流拒绝允许原有的有限重试。传输异常、HTTP 408/5xx、缺失或不可解析的成功确认返回 `RENAME_OUTCOME_UNKNOWN`，不重放请求。已确认成功项不会进入重试子集。 |
| 核实 | 只按文件 ID 读取，使用 Provider 的只读预算；业务层不额外套重试循环。确认目标名则成功，确认其他名称则失败，读取失败仍未知。核实预算不能用于重新写入。 |

指数退避仍按已用 HTTP 次数计算：OneDrive 使用原有的 `min(2**attempt, 8)`，Google 保留随机抖动和 8 秒退避上限。`Retry-After` 仍支持秒数及 HTTP 日期；缺失、非法或非有限值使用原有退避，过去日期和负数归零。同连接共享冷却只延长不缩短，最后一次被限流仍会影响后续请求；不在 Service 再等待或叠加重试。8 秒只约束本地计算的退避，不截断服务端有效的 `Retry-After`。

HTTP 408 的标准语义及允许重发见 [RFC 9110 §15.5.9](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.9)。本项目对云写入采用先核实的保守策略，不声称 408 证明已写入，也不将中间层超时解释为可直接重放的证据。

同组出现未知项时，Provider 不再重试同组已被明确拒绝的项目；保留其原始应用错误（如 `RATE_LIMIT_ERROR`），不标为未尝试，也不覆盖为通用英文停止错误。Service 在核实前暂停补组；核实成功或确认失败后可继续原调度，仍未知则停止后续组并等待已启动组结束。未发出的剩余组继续用 `RENAME_NOT_ATTEMPTED` 表达。已确认成功项保留，不自动撤回或回滚。

OneDrive 批量确认元数据的名称与目标不同，按已确认未达目标返回失败及 `actual_name`，与 Google 和单项语义一致。未知经 ID 核实后确认原名或第三个名称，也仅证明当前未达目标，不证明此前写请求未执行；不据此重新提交。核实得到失败时保留原错误诊断及内部异常链。

取消机制保持原边界：停止 Service 补组，等待已启动组（包括组内冷却、允许的有限重试及核实）收敛后才释放执行互斥。取消不会撤销远端写入，也不会伪造完整结果；请求无完整最终响应时继续采用现有前端待核对保护。单请求超时沿用 Provider 配置，未新增整项任务总时限；有效的长 `Retry-After` 可能让等待持续较久，不强制取消在途写入或提前解锁连接。

阶段三保留的逐项三值兼容映射已在阶段四替换为五值 `status`；错误码与总体三值状态不变。人工验证方法见[阶段三验收清单](../../RETRY_WRITE_ACCEPTANCE.md)。

<a id="validation-reasons"></a>
### 校验原因

`reason`、`params` 可出现在 `error.details`、`PreviewItem.details` 或执行结果项的 `details` 中。预览项不含 `error_code`；按校验原因显示提示。未知原因回退为通用提示。

| `reason` | 含义 | `params` |
| --- | --- | --- |
| `CONNECTION_NOT_FOUND` | 连接不存在。 | `{}` |
| `ACCOUNT_NOT_CONNECTED` | 账号未连接。 | `{}` |
| `AUTHORIZATION_EXPIRED` | 已明确确认授权过期；普通授权拒绝不一定带此原因。 | `{}` |
| `LOCATION_OUTSIDE_ROOT` | 超出连接根目录。 | `{}` |
| `SYMBOLIC_LINK_UNSUPPORTED` | 不支持符号链接或目录联接。 | `{}` |
| `DEFAULT_CONNECTION_DELETE_FORBIDDEN` | 默认 Local 连接不可删除。 | `{}` |
| `PREVIEW_DUPLICATE_FILE_IDS` | 选择中有重复 ID。 | 不提供；ID 在 `details.file_ids`。 |
| `PREVIEW_ITEMS_NOT_IN_DIRECTORY` | 所选项目不在请求目录。 | 不提供；缺失 ID 在 `details.file_ids`。 |
| `RENAME_UNSUPPORTED` | 连接不支持重命名。 | `{}` |
| `ITEM_RENAME_UNAVAILABLE` | 项目当前不能重命名，也可能是不支持的类型。 | `{}` |
| `ROOT_RENAME_UNSUPPORTED` | 不支持重命名根目录。 | `{}` |
| `GOOGLE_DRIVE_SHORTCUT_RENAME_UNSUPPORTED` | 不支持重命名 Google Drive shortcut。 | `{}` |
| `NAME_EMPTY` | 名称为空或全为空白。 | `{}` |
| `NAME_DOT_SEGMENT` | 名称为 `.` 或 `..`。 | `{}` |
| `NAME_INVALID_CHARACTERS` | 包含禁止字符。 | `characters: string[]`、`control_characters: string`。 |
| `NAME_NULL_CHARACTER` | 包含 NUL。 | `{}` |
| `NAME_INVALID_ENDING` | 以空格或句点结尾。 | `{}` |
| `NAME_RESERVED_WINDOWS` | Windows 保留名称。 | `{}` |
| `NAME_TOO_LONG` | 名称过长。 | `max_length: integer`，当前 `255`。 |
| `ONEDRIVE_NAME_INVALID_PREFIX` | OneDrive 名称前缀无效。 | `prefixes: string[]`。 |
| `NAME_RESERVED_ONEDRIVE` | OneDrive 保留名称。 | `{}` |
| `NAME_RESERVED_IN_ROOT` | OneDrive 根目录保留名称。 | `name: string`，当前 `forms`。 |
| `ONEDRIVE_FOLDER_INVALID_PREFIX` | OneDrive 文件夹前缀无效。 | `prefixes: string[]`。 |
| `ONEDRIVE_PATH_TOO_LONG` | OneDrive 目标路径过长。 | `max_length: integer`，当前 `400`。 |

### 示例

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Duplicate file IDs are not allowed",
    "details": {"reason":"PREVIEW_DUPLICATE_FILE_IDS","file_ids":["IMG_1.jpg"]}
  }
}
```

前端将非成功 HTTP 响应转为 `ApiError`，保留 `status`、`code`、`message`、`details`。非标准响应使用 `code: null`、`details: {}`；网络或响应解析失败保留浏览器异常并标记 `status: 0`。`status: 0` 不表示服务端未执行写入。
