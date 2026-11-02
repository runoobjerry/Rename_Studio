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

### 阶段一兼容与后续迁移

1. 保留错误响应包装、现有错误码和 HTTP 状态；保留执行项三值 `status`、总体三值 `status`、现有 `error`、`details` 和名称/元数据字段。只增补应用原因，诊断文案可变。
2. 本次服务端与前端一起交付。旧 `failed` 状态按[执行结果映射](../executions/index.md#execution-outcomes)解释五种语义；后端 `RenameItemResult.outcome` 普通属性和前端 `renameItemOutcome` 即时计算，不增加第二个序列化结果字段，也不新增恢复状态。
3. 新前端遇到旧后端缺少原因的失败项，只按其已有稳定字段显示通用错误，不尝试从英文恢复未提交状态。结果缺失、明确未知错误码和既有待核对门控继续保留；诊断字段仍完整保留。需要精确区分未提交项时应同时升级前后端并刷新页面，不在执行期间热切换版本。
4. 若后续阶段将五种值直接用于公开 `status`，应先让全部客户端消费扩展枚举、更新 Schema/类型/测试/示例并明确部署顺序或 API 版本，再切换服务端输出；届时删除本次兼容映射，不长期维护两份结果真值。当前没有提前扩展公开枚举。
5. 后续阶段再完善 Provider 错误分类、读取/写入策略和端点显式操作标记。本阶段不重写网络请求、批量算法、本地系统错误分类或 API 客户端按方法/URL判断操作的现有机制。

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
