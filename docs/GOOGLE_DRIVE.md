# Google Drive 接入交接

阶段三在已有连接/OAuth 和 My Drive 读取能力上接入名称校验、预览、防重名与单项/批量重命名。注册信息为 `provider_type=google_drive`、`browser_auth=true`、`locations=["root","id"]`、`can_rename=true`。继续复用现有服务端快照、执行互斥、名称依赖分阶段处理、回滚及未知写入核查；Google 设置表单和工作区适配留到阶段四。

验收记录：2026-10-18 用户确认阶段一、阶段二均已完成并通过验收，已提交 `33e8e9e`。同日用户确认阶段三已完成并通过验收，批准提交代码。验收结论由用户提供；Codex 未代为执行测试或真实云盘验收。

## 配置与授权契约

- 用户自行创建 Google Cloud 项目，启用 Drive API，配置 OAuth 同意屏幕并创建 **Desktop app** 客户端。使用该客户端的 `client_id` 和 `client_secret`，不使用 Web application 客户端或服务账号。
- 固定权限为 `https://www.googleapis.com/auth/drive.metadata`，属于受限权限。应用只请求元数据访问；Google 项目的测试用户、发布状态及授权限制仍然适用。外部项目处于 Testing 时，相关 refresh token 通常七天后过期，需要重新授权。
- 回调复用 `STORAGE_REDIRECT_URI`，默认 `http://localhost:8000/auth/storage/callback`；阶段二回归应保留已验收的配置，Codex 本轮不重新执行真实 OAuth。
- `client_secret` 是创建/更新请求的顶层只写字段，不能放进公开 `config`；响应仅提供 `has_client_secret`。更新时省略或传 null 表示保留，空白值被拒绝。修改客户端 ID 或密钥清除账号令牌并提高连接版本；只改连接名称保留授权。
- 断开仅清除账号授权，保留客户端 ID 和密钥；删除连接或恢复默认设置移除整条连接。断开不调用 Google 的远端撤销接口。
- OAuth 使用 PKCE S256、一次性且十分钟过期的 state，以及连接版本绑定。新登录先清除旧账号授权。回调核验实际 scope 和 Drive `user.permissionId` 后才提交连接；邮箱/显示名可缺失，不以邮箱推断账号身份。
- Access token 只在内存；客户端密钥、refresh token、scope、账号身份和连接版本沿用 v3 JSON 原子保存。授权状态查询不访问 Google；重启后的令牌刷新由后续 `access_token()` 调用触发。

官方依据：[Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[令牌有效期](https://developers.google.com/identity/protocols/oauth2)、[about.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get)、[Drive User](https://developers.google.com/workspace/drive/api/reference/rest/v3/User)。

## 人工验收

以下操作由用户执行。不要把真实密钥、令牌、状态文件或含凭据的请求截图提交 Git。

1. 在添加首个 Google 连接前备份自己的 `backend/settings.json`。旧版本不认识 `google_drive`；降级时需恢复兼容备份，当前阶段不改变 v3 状态格式。
2. 启动开发或发布后端，进入其 `/docs`，通过 `POST /storages` 创建连接：

   ```json
   {
     "provider_type": "google_drive",
     "name": "My Google Drive",
     "config": {"client_id": "YOUR_DESKTOP_CLIENT_ID"},
     "client_secret": "YOUR_DESKTOP_CLIENT_SECRET"
   }
   ```

3. 检查创建/查询响应：`has_client_secret=true`，公开 config 只有 client ID，不出现密钥或令牌。保存不完整草稿应成功，但 `/auth/status` 的 `configured=false`，`/auth/start` 被拒绝。
4. 调用 `POST /storages/{storage_id}/auth/start`，在浏览器打开返回的 `authorization_url`。确认 Google 同意屏幕和账号选择；完成后查询 `/auth/status`，检查 `connected=true` 与正确账号资料。URL 和回调页面不应含密钥/令牌。取消、重放旧回调和错误客户端密钥均不能产生已连接账号。
5. 修改连接名称应保留授权；修改 client ID 或密钥应清除账号授权并提高 revision。只提交名称或省略密钥应保留原密钥；同值密钥不触发失效。断开后 `configured=true`、`connected=false`，可以重新连接。
6. 创建两个独立 Google 连接，分别授权不同账号；断开或修改一个连接不影响另一个。重启后应恢复各自账号状态。当前前端表单尚未适配，不通过现有 OneDrive 字段配置 Google 密钥。
7. 验证实际刷新时，可在 `backend/` 的交互脚本中使用下面代码，替换连接 ID；不打印返回令牌。重启后调用会刷新，`force_refresh=True` 可验证后续刷新。确认正常刷新不增加 revision。撤销 Google 授权后刷新应要求重连；网络/服务临时失败应保留已保存的授权。

   ```python
   import asyncio
   from app.api.dependencies import get_storage_manager

   async def check_refresh():
       manager = get_storage_manager()
       try:
           auth = manager.auth("YOUR_STORAGE_ID")
           await auth.access_token(force_refresh=True)
           print("Google token refresh completed; token omitted.")
       finally:
           await manager.aclose()

   asyncio.run(check_refresh())
   ```

8. 授权后通过 `POST /storages/{storage_id}/files/list` 读取 `{ "location": { "kind": "root" } }`；应返回完整根目录及 `storage_id`、`revision`、`location`、`parent_location`、`breadcrumbs`。进入子目录使用响应中的 `item.location`，返回上级使用 `parent_location`，祖先导航使用 `breadcrumbs`；不能从显示 path 拼接路径。
9. 在已准备的测试目录检查：超过 1000 个直接子项不漏页；多层、同名和包含分隔符的目录按 ID 定位正确；普通文件、文件夹、Google 文档标题、可空大小/修改时间和权限标记正确；快捷方式只展示且不读取其目标。路径形式（包括空 path）、My Drive 外 ID、共享盘、垃圾箱和快捷方式目录导航应被拒绝或返回真实的不可访问错误。
10. ；确认预览前后真实名称不变。普通文件、文件夹和 Google 文档使用原始标题；根目录和快捷方式不能重命名。空白名称、NUL 和新产生的同目录重名应被阻止；原有重名项保持不变可通过，大小写不同名称按不同目标处理。

13. 回归 Local/OneDrive 目录、预览与执行，特别检查重复目标、未选中项占用、循环依赖和失败回滚。阶段三没有调整前端表单和导航；当前验收通过 API 完成。

阶段二的单项/批量元数据沿用 Provider 接口，没有新增 HTTP 路由。可在 `backend/` 下用以下人工脚本核对已知目录；请替换连接 ID，目录不在根目录时使用对应 `IdLocation`。该脚本只读取，不输出令牌：

```python
import asyncio
from app.api.dependencies import get_storage_manager
from app.schemas.storage import RootLocation

async def check_metadata():
    manager = get_storage_manager()
    try:
        provider = manager.provider("YOUR_STORAGE_ID")
        listing = await provider.list_directory(RootLocation())
        print("items:", len(listing.items))
        print("breadcrumbs:", [(entry.name, entry.location) for entry in listing.breadcrumbs])
        ids = [item.id for item in listing.items[:2]]
        if ids:
            single = await provider.get_metadata(ids[0])
            batch = await provider.get_metadata_many(ids)
            print("single:", single.id, single.name, single.parent_location)
            print("batch:", [(item.id, item.name, item.parent_location) for item in batch])
    finally:
        await manager.aclose()

asyncio.run(check_metadata())
```

建议在 `backend/` 下执行：

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_google_drive_provider.py tests/test_google_drive_auth.py tests/test_storage_connections.py tests/test_onedrive_provider.py tests/test_onedrive_auth.py tests/test_storage_rename_contract.py tests/test_preview_service.py tests/test_execute_service.py tests/test_api.py
```

阶段三没有前端改动；需要整体验证时按现有流程由用户执行 `frontend/` 下的 `npm run check`。测试源码、静态检查与历史通过记录都不构成本阶段运行通过的证据。

## 后续依赖与验证状态

阶段四依赖本阶段验收，负责前端配置、工作区与面包屑消费。首期不展开/改名快捷方式、不开放共享云端硬盘、不新增历史/撤销实现、不扩大 OAuth scope，也不迁移持久化格式。

名称按原字符串比较，不折叠大小写或 Unicode 形式。应用拒绝空白和 NUL，不套用本地文件系统保留字/字符及猜测长度限制，其余限制由 Google 返回。仅保持不变的既有重名获准通过；改变后的目标仍与所有选中目标和未选中同目录项比较。

单项与批量写入复用 multipart 解析及现有执行服务；每批最多 20 项、并发一批，PATCH 请求只带 `name`。写前重新读取源项与祖先，防止已移出 My Drive、共享盘、垃圾箱或失去改名权限的项被写入。401/限流明确拒绝可有限重试；已成功子项不重放。传输失败、5xx、缺失/畸形响应、成功响应身份或位置异常统一作为未知结果交由引擎按 ID 核查。查证目标已达成则继续，无法查证则停止后续组并保留未知状态；不会盲目回滚未知项。

Google 不提供“同目录冲突检查 + 重命名”事务，也不原生禁止重名。执行前重校验只能减少竞态，其他客户端仍可能在检查后新建重名、移动文件或改变权限；回滚同样尽力而为，可能留下临时名或部分完成。发生这些情况按执行响应、进度及实际目录处理。阶段三测试源码覆盖元数据 PATCH 边界、逐项重试/部分失败、范围权限、重名策略、依赖与回滚、快照失效，以及未知写入核查不重放；阶段三已由用户确认完成并通过验收，具体运行结果以用户验收为准。

阶段二新增/调整回归测试源码，覆盖目录分页、空页、同名目录与真实祖先 ID、元数据批处理及顺序、范围越界、快捷方式、异常响应、逐项重试、权限映射与 API 只读边界。阶段一、二均已由用户确认验收通过；静态检查不单独构成运行证据。当前凭据存储沿用本地 JSON，没有新增加密存储；文档中的实际客户端凭据已恢复为占位符。

只读实现按本轮读取结果核验祖先，没有云端事务快照；外部移动、分页期间增删和权限变化可能要求刷新。读取失败不返回部分目录。缓存仅在一次操作内复用；祖先层级较深时仍需额外元数据请求。bulk 元数据每批最多 100 项、串行发送批次，逐项解析响应，失败重试不重读已成功子项。没有递归扫描整个云盘或全局目录缓存。

阶段二官方依据：[files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)、[files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get)、[File 字段与能力](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)、[multipart batch](https://developers.google.com/workspace/drive/api/guides/performance)、[错误与限流](https://developers.google.com/workspace/drive/api/guides/handle-errors)。

阶段三官方依据：[files.update（元数据 PATCH）](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update)、[multipart 批次与非事务语义](https://developers.google.com/workspace/drive/api/guides/performance)、[权限与错误分类](https://developers.google.com/workspace/drive/api/guides/handle-errors)。Google 单批上限为 100 个子请求；本项目写入使用现有执行服务的 20 项批次以复用调度与故障处理。
