# Backend Agent Instructions

适用于 `backend/` 下的 AI Coding Agents；与[根级指令](../AGENTS.md)共同使用。本文件只补充后端特有约定，按任务选择入口，无需每次读取全部文档。

## 按任务定位

| 修改内容 | 相关入口 |
| --- | --- |
| 服务边界、装配或持久化 | [依赖与对象装配](../docs/backend/ARCHITECTURE.md#依赖与对象装配)、[持久化与部署](../docs/backend/ARCHITECTURE.md#持久化与部署) |
| 预览、单项或批量改名 | [执行流程](../docs/backend/ARCHITECTURE.md#预览与执行)与 [API 执行契约](../docs/api/executions/index.md) |
| 目录、缓存或云盘分页 | [读取模式与缓存](../docs/backend/ARCHITECTURE.md#目录读取与缓存)、[目录 API](../docs/api/directories/list.md) |
| 新增 Rule / Provider | [扩展入口](../docs/backend/ARCHITECTURE.md#扩展入口) |
| HTTP、Schema、错误或结果枚举 | [API 索引](../docs/api/README.md)与[共享错误](../docs/api/common/errors.md) |
| 测试修改或验证建议 | [测试定位与验证](../docs/backend/TEST.md#测试定位与验证) |

## 实现约定

- 路由处理 HTTP 与 Schema，Service 编排业务；Rule 只转换名称，Driver 封装存储差异，Repository 只读写状态。跨 Provider 业务依赖统一接口，扩展通过 Registry 注册。
- 连接操作保留 `StorageManager` 的 revision、账号与 busy 保护；JSON 保存成功后再发布内存状态。同账号令牌轮换与换号保持不同语义。
- 批量写入前以 `verify` 读取实时完整子项并比较快照；单项遵守独立直接执行契约，不借用批量预览、读取整个目录或比对原名。修改任一路径时检查它与另一流程的互斥。
- 不确定写入优先按 ID 核对，不重放请求；核对仍未知时停止补组，已提交写入及取消收尾继续持有互斥保护。缓存仅按确认元数据修补，其余按范围失效。
- 第三方错误解析、驱动重试决策与前端提示分工明确。只读与写入使用各自策略；明确认证/限流拒绝按现有预算处理，响应丢失和服务端故障不能成为盲目重放写入的依据。
- 本地路径遵守配置根边界；云盘 ID 与 `StorageLocation` 保持不透明，显示路径不作为身份。输入、第三方 API 与文件系统边界建立契约后，内部直接使用可信对象。
- 修改跨端字段时同步 Schema、[前端类型](../frontend/src/types/index.ts)、[客户端](../frontend/src/api/client.ts)和必要测试；对应 API 文档按[根级文档权限](../AGENTS.md#文档权限)由主代理决定并直接修改或按需委派。日志和公开响应不包含敏感输入、令牌或密钥，测试仅用虚构凭据。

## 测试与收尾

按受影响行为选择测试与验收检查，交付时说明实际静态检查、用户待执行项与未验证范围；运行权限遵循[根级指令](../AGENTS.md#验证与交付)。
