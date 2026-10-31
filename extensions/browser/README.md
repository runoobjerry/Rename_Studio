# Rename Studio Browser — 阶段一

版本独立维护于 manifest.json 与 package.json（当前 0.1.0）。原生 JS ES modules，不依赖 React，不需要安装或构建。协议唯一事实来源：[BROWSER_INTEGRATION.md](../../docs/BROWSER_INTEGRATION.md)。

## 加载与真实浏览器验收（用户执行）

1. 桌面 Chrome / Edge 106+ 打开 `chrome://extensions` / `edge://extensions`，开启开发者模式，加载本目录作为“已解压的扩展”。修改后重新加载扩展，并刷新 OneDrive 页面以加载内容脚本。
2. 同一普通配置文件登录 OneDrive 个人版，在普通“我的文件”根目录点击扩展 action。检查 badge 为 OK、悬停提示，以及扩展 service worker 控制台的脱敏摘要。无 drive_id 的根响应也应成功。
3. 进入多层子目录再次点击；检查 folder_id 存在，drive_id 存在。包含中文、空格、`%`、`#` 的目录也应可提取。不显示实际身份或路径值，可在本地 DevTools 断点检查返回值与已验证数据逐值核对；不要发布原始个人数据。
4. 在网络节流下点击后立刻切换目录或账号，结果应为 page_changed 或文档销毁后的 transport_unavailable；重复点击只保留最新结果。不应发送任何本体导航。
5. 搜索、最近使用、照片、回收站、共享入口应失败。子目录缺失 drive ID、纯数字且无 userHexCid 的模糊 CID 应明确失败。若实际普通目录 URL 含未支持参数，请记录参数名供核查，不直接放宽范围。
6. 检查两个语言环境下名称和提示；检查未产生本体切换、选择、预览、重命名、新建连接、授权或持久化。

当前成功日志只证明字段与结构可提取，不证明扩展与本体已联调。失败查看 code；说明见协议文档。若没有页面 Console 输出，以扩展 service worker 控制台和 action 提示为准。

## 行为回归（用户执行）

复用仓库 frontend 已有 Vitest，无扩展额外依赖。已安装前端依赖后，在仓库根目录执行：

```powershell
Set-Location frontend
node ./node_modules/vitest/vitest.mjs run --config ../extensions/browser/vitest.config.mjs
```

测试覆盖根/子目录、路径编码、边界拒绝、账号及 URL 变化、未知进制、HTTP 类别、快捷方式和协议长度。测试模拟页面与 fetch，不访问真实云盘；真实 MV3 MAIN/ISOLATED 注入仍需按上面的浏览器步骤验证。Codex 未执行安装、测试或构建。

打包时仅包含 manifest.json、src/、_locales/；直接加载本目录无需打包。临时 action 和 debug-content 在最终悬浮按钮接线时删除。
