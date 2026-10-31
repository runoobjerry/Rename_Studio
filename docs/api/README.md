# API Reference

Python 后端与 React 前端之间的 API 契约。按资源定义对象，再列出接口；字段名、枚举值和错误码与当前代码一致。

## 全局说明

[通用约定](common/conventions.md) · [位置对象](common/locations.md) · [文件元数据](common/files.md) · [错误与校验原因](common/errors.md)

## 业务资源索引

| 资源 | 对象与接口索引 |
| --- | --- |
| Provider 定义 | [Provider 定义](providers/index.md) |
| 存储连接 | [存储连接](storages/index.md) |
| 目录 | [目录](directories/index.md) |
| 本地目录选择 | [本地目录选择](folder-pickers/index.md) |
| 授权 | [授权](authorization/index.md) |
| 规则 | [规则](rules/index.md) |
| 重命名预览 | [重命名预览](previews/index.md) |
| 重命名执行 | [重命名执行](executions/index.md) |
| 应用设置 | [应用设置](settings/index.md) |
| 健康状态 | [健康状态](health/index.md) |

## 接口导航

| 接口名称 | HTTP 方法 | 路径 | 文档 |
| --- | --- | --- | --- |
| 列出 Provider 定义 | `GET` | `/storage-providers` | [列出 Provider 定义](providers/index.md#endpoint-get-storage-providers) |
| 列出连接 | `GET` | `/storages` | [列出连接](storages/index.md#endpoint-get-storages) |
| 创建连接 | `POST` | `/storages` | [创建连接](storages/index.md#endpoint-post-storages) |
| 获取连接 | `GET` | `/storages/{storage_id}` | [获取连接](storages/index.md#endpoint-get-storages-storage-id) |
| 更新连接 | `PUT` | `/storages/{storage_id}` | [更新连接](storages/index.md#endpoint-put-storages-storage-id) |
| 删除连接 | `DELETE` | `/storages/{storage_id}` | [删除连接](storages/index.md#endpoint-delete-storages-storage-id) |
| 列出目录 | `POST` | `/storages/{storage_id}/files/list` | [列出目录](directories/list.md#endpoint-post-storages-storage-id-files-list) |
| 为新连接选择目录 | `POST` | `/local/folder-picker` | [为新连接选择目录](folder-pickers/index.md#endpoint-post-local-folder-picker) |
| 为连接选择根目录 | `POST` | `/storages/{storage_id}/local/pick` | [为连接选择根目录](folder-pickers/index.md#endpoint-post-storages-storage-id-local-pick) |
| 获取授权状态 | `GET` | `/storages/{storage_id}/auth/status` | [获取授权状态](authorization/session.md#endpoint-get-storages-storage-id-auth-status) |
| 断开账号 | `DELETE` | `/storages/{storage_id}/auth/session` | [断开账号](authorization/session.md#endpoint-delete-storages-storage-id-auth-session) |
| 开始授权 | `POST` | `/storages/{storage_id}/auth/start` | [开始授权](authorization/start.md#endpoint-post-storages-storage-id-auth-start) |
| 接收授权回调 | `GET` | `/auth/storage/callback` | [接收授权回调](authorization/callback.md#endpoint-get-auth-storage-callback) |
| 列出规则定义 | `GET` | `/rules` | [列出规则定义](rules/list.md#endpoint-get-rules) |
| 释放预览 | `DELETE` | `/storages/{storage_id}/rename/previews/{preview_id}` | [释放预览](previews/index.md#endpoint-delete-storages-storage-id-rename-previews-preview-id) |
| 创建预览 | `POST` | `/storages/{storage_id}/rename/preview` | [创建预览](previews/create.md#endpoint-post-storages-storage-id-rename-preview) |
| 获取执行进度 | `GET` | `/rename/progress/{preview_id}` | [获取执行进度](executions/index.md#endpoint-get-rename-progress-preview-id) |
| 执行预览 | `POST` | `/rename/execute` | [执行预览](executions/execute.md#endpoint-post-rename-execute) |
| 单项直接执行 | `POST` | `/storages/{storage_id}/rename/single/execute` | [单项直接执行](executions/single.md#endpoint-post-storages-storage-id-rename-single-execute) |
| 获取应用设置 | `GET` | `/app-settings` | [获取应用设置](settings/index.md#endpoint-get-app-settings) |
| 恢复默认设置 | `POST` | `/app-settings/factory-reset` | [恢复默认设置](settings/index.md#endpoint-post-app-settings-factory-reset) |
| 更新应用设置 | `PATCH` | `/app-settings` | [更新应用设置](settings/update.md#endpoint-patch-app-settings) |
| 获取健康状态 | `GET` | `/health` | [获取健康状态](health/index.md#endpoint-get-health) |

## 契约范围

当前没有 History、Undo、Redo、RuleSet 持久化或服务端文件选择接口。目录 API 不提供分页、搜索、排序、筛选参数。旧 Provider/path 路由、Provider 专属认证回调和 `/rename/preview` 已移除，不提供别名或重定向；`local`、`onedrive` 不能替代连接 ID。

契约依据：[共享路由](../../backend/app/api/router.py)、[连接路由](../../backend/app/api/storage_router.py)、[设置路由](../../backend/app/api/app_settings_router.py)、[Schema](../../backend/app/schemas)、[服务](../../backend/app/services)、[Provider](../../backend/app/providers)、[规则](../../backend/app/rules)及[前端客户端](../../frontend/src/api/client.ts)。组织形式参考 Stripe 的[对象定义](https://docs.stripe.com/api/customers/object)和[接口条目](https://docs.stripe.com/api/customers/create)。
