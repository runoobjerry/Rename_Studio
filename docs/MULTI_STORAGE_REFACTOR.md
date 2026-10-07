# 多存储基础重构

更新日期：2026-10-07。当前 checkout 为唯一基线。

## 目标与范围

已实现 Local/OneDrive 多连接、连接独立配置与授权、目录 ID 导航、连接绑定的预览和必要前端管理流程。Google Drive、统一挂载、跨存储操作、History/Undo、后台任务和多进程协调未实现。

参考 AList 的驱动工厂、存储实例生命周期和对象 ID/路径分离；保留本项目 Preview First、禁止重复目标及临时名称/尽力回滚策略。

## 阶段与状态

多存储基础版本已由用户构建测试并确认可用。本轮按用户要求完成新版 API 收敛：删除旧存储 API/设置/认证兼容层，仅保留默认 Local，移除连接启停并显示连接状态及账号“名称(邮箱)”。本轮仅静态检查，更新后的测试和构建待用户执行。

| 阶段 | 交付 | 状态 |
| --- | --- | --- |
| 基础重构 | 工厂、连接管理、目录定位、授权及安全执行、前端多连接 | 用户确认构建测试可用 |
| API 收敛 | 删除旧 API、独立设置文件读写和认证组件；仅默认 Local | 已实现，静态检查通过 |
| 连接展示 | 删除启停字段/控件；显示连接状态和账号名称/邮箱 | 已实现，静态检查通过 |
| 状态升级 | v1 连接文档备份并升级 v2，保留已配置账号 | 已实现，待运行验收 |

## 架构与扩展接口

- ProviderRegistry 注册类型、Pydantic 配置 Schema、定位方式、能力和工厂；StorageManager 按连接和 revision 管理客户端。
- storage_id 是连接身份，provider_type 是实现类型。Provider 类型创建后不可修改；名称可编辑，仅 default-local 不可删除。
- StorageLocation 为 `{kind:"root"}`、`{kind:"id",value:string}` 或 `{kind:"path",value:string}`。ID 不进行路径解析；path 在输入边界规范化。
- FileItem 增加 location、parent_location、can_rename；path/parent_path 仅用于展示，不作为存储身份。目录返回当前位置和父位置，根目录父位置为 null。
- Local 的 ID 是根目录内相对路径，重命名后变化；OneDrive 的 ID 是稳定 Graph item ID。前端不得假设 ID 在所有 Provider 上稳定。
- OneDrive 正常浏览使用 ID；手动名称路径逐段解析，同名目录歧义时拒绝任意选择。分页须完整、合法，不能跳过坏项目或返回部分冲突集合。
- 通用 ConnectionAuth 管理状态、发起/完成授权、断开及 token 获取；OneDrive 负责具体协议和凭据转换。账号 ID 可为空，不使用邮箱或显示名作为替代身份。
- 新 Provider 实现目录、元数据、批量重命名、名称规范化/校验、执行批大小及可选认证适配，然后注册；前端配置控件按实际 Provider 实现。

## API

详见 API_REFERENCE.md 的多存储章节。所有存储操作使用 `/storages` 系列；旧 provider/path、Local/OneDrive 设置和认证 API、旧预览 API 已删除，不重定向或转换。连接 ID 不再提供 local/onedrive 别名。共享 health/rules/execute/progress 接口保留。

新 OAuth 使用 `/auth/storage/callback` 和 `storage-auth` 消息；在 Microsoft 应用中添加 `STORAGE_REDIRECT_URI` 指定的回调地址。默认地址为 `http://localhost:8000/auth/storage/callback`。发起授权响应返回 redirect_uri 供前端验证消息源。

Execute 仍只接收 preview_id。执行结果新增可选 error_code/actual_name；既有枚举值不变。状态未知不能解释为“确定未修改”，actual_name=null 表示未能确认当前名称。

## 持久化和迁移

默认状态文件为 `backend/.storage_connections.json`，可通过 STORAGE_STATE_FILE 配置。schema_version=1，connections 按 storage_id 保存记录；每个记录包含配置、revision、凭据和账号资料，单次原子替换提交整个文档。

新安装只创建 default-local（Local Files），使用 LOCAL_STORAGE_ROOT；用户在设置页自行创建 OneDrive 等云端连接。不再读取 .local_settings.json 或 .onedrive_credentials.json。

schema_version 为 2。已有版本 1 连接文档读取、校验后，先保留同目录 .pre-storage-v2.bak 备份，再原子提交升级：移除所有 enabled 字段；仅删除 ID 为 default-onedrive、名称为 OneDrive、App ID 为空且无凭据的自动连接。已有 App ID、账号授权或用户改名的云连接保留，其 ID、目录默认值和授权不会被替换；这些云连接允许删除。原来停用的连接升级后也按实际授权状态使用，不再提供停用功能。重复启动不重复升级，升级失败不覆盖正式状态。

状态文件、临时文件和迁移备份均被 Git 忽略。配置响应排除 credentials，配置 Schema 不含令牌字段；访问令牌只保留在内存。

如需回退至版本 1，停止后端后恢复连接状态备份；备份不包含升级后的配置和授权变化。不要在多个后端进程间并发共享此 JSON 文件。

## 执行安全

- 快照保存规范化连接 ID、revision、目录位置、源项和规则；创建预览期间连接改变时拒绝保存，执行前再次核对版本与完整目录。
- 配置、根目录和账号授权变化使旧快照失效；token 正常刷新不改变 revision，授权撤销会失效。
- 保留全局执行锁；执行连接的用户修改、授权、删除返回 STORAGE_BUSY（409）。其他连接配置仍可修改。
- STORAGE_CONNECTION_CHANGED（409）要求重新预览，不自动替换账号或重新执行。
- 同名索引保存所有所有者，禁止重复目标或占用未选中项目；依赖链先暂存，临时名称也执行目标校验。
- 写入响应丢失/服务端写入结果不确定时，不重放整批。按 ID 核对已达到目标的项目；仍无法确认时返回 RENAME_OUTCOME_UNKNOWN 并停止后续依赖写入。
- 回滚是尽力操作，失败明确报告错误及能确认的当前名称。不能确认未知项目时不盲目执行其回滚。
- 预览、进度和锁仍属于单进程。外部客户端仍可在校验与写入之间修改文件；没有跨系统事务或分布式锁保证。

## 前端约定

侧栏按连接切换，设置页可新增、编辑、删除和授权；默认 Local 只能修改，不能删除。连接状态以只读标记展示，账号显示名称(邮箱)，不提供启停控件。执行期间禁用当前连接的配置与导航冲突操作。

目录查询键包含 storage_id、revision、location；旧连接的延迟响应不会进入当前目录。预览结果绑定连接、目录、选择及规则上下文。切换清理选择/预览，规则链保留，执行中的请求与真实进度不因后台变化被重置。

默认云目录保存成功打开的 location，按 storage_id/account_id 隔离，不再读取旧 Provider/账号路径。没有稳定账号 ID 时不保存默认目录。原选择筛选、通知和执行确认约定保持。

## 待用户运行的验收清单

- [ ] JSON 首次初始化、v1→v2 升级、重复启动、重启恢复、无效状态、保存失败与凭据隔离。
- [ ] 多 Local/OneDrive 连接，修改/断开/删除一项不影响另一项。
- [ ] ID 导航、同名目录歧义、根目录和本地越界、分页失败。
- [ ] 同名占用者、重复目标、名称规范化、交换与多项占用链。
- [ ] 过期/重复执行、源项变化、连接版本变化和旧 OAuth 回调。
- [ ] 暂存/直接/最终阶段失败、回滚失败、写入结果未知与后续停止。
- [ ] 前端创建/修改/删除、状态与名称(邮箱)展示、弹窗授权来源校验、切换后的延迟响应隔离。
- [ ] 默认目录按连接/账号隔离、缺失账号 ID、执行忙碌状态、进度读取失败不重提交。
- [ ] 旧 API 已删除、新 API 契约一致；前端构建及真实账号下浏览/预览/确认执行。

建议运行：后端 pytest（Windows 使用 checkout 内 --basetemp 和 -p no:cacheprovider），前端 npm test / npm run build，再使用可恢复的专用目录完成账号验收。

本轮仅静态验证：Python AST、TypeScript --noEmit、差异空白检查、接口/类型与凭据暴露审查；未启动服务、运行测试、构建或操作真实云盘。
