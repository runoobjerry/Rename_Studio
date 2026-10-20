# 贡献翻译

Rename Studio 使用 i18next + react-i18next。`en-US` 是完整的默认词典与固定回退语言，`zh-CN` 同样完整维护；其他语言可逐步翻译。语言资源随前端打包，不在运行时从网络拉取，不依赖外部翻译平台或自动 Git 同步。

## 添加语言

1. 在 `frontend/src/locales/` 新建规范 BCP 47 语言目录，例如 `fr-FR`。使用规范大小写和连字符，不使用 `auto`、下划线或已有语言代码。
2. 添加 UTF-8 `meta.json`：`{"code":"fr-FR","name":"Français"}`。`code` 必须与目录完全一致且唯一，`name` 使用该语言的自称，显示在设置菜单中。
3. 复制 `en-US` 的六个命名空间 JSON，保持键结构并翻译字符串。命名空间文件必须全部存在；逐步翻译时删除尚未翻译的叶子键（允许 `{}`），让运行时回退英文。复制但未改写的英文值不算缺失，检查器不能判断翻译质量。
4. 保留所有插值占位符及出现次数，例如 `{{count}}`、`{{name}}`、`{{message}}`。可调整顺序，不要翻译变量名或改变格式指令。使用 JSON 转义表达引号、换行，不加入 HTML 或 `dangerouslySetInnerHTML`。
5. 执行本地检查，并在实际界面切换语言查看效果，通过 PR 提交。新增目录不需要修改 Python 语言枚举、React 入口或语言注册列表；Vite 的 `import.meta.glob` 自动发现 `meta.json` 和词典。

所有词条为非空字符串，分组为对象，不使用数组、数字、null、重复属性或带 `.` / `:` 的属性名。语言元数据只接受 `code` 和 `name`。新词条先加到 en-US 和 zh-CN，再补充其他语言；不能仅在社区语言添加默认词典不存在的键。

## 命名空间和术语

| 命名空间 | 内容 |
| --- | --- |
| `common` | 复用的基础操作、加载、筛选状态 |
| `settings` | 常规设置、连接管理、授权、重置及其通知 |
| `files` | 文件浏览、位置、选择、预览、执行、进度及工作区通知 |
| `rules` | 规则编辑字段、规则名称与说明 |
| `providers` | 服务名称、账号缺省文案、动态配置字段文案 |
| `errors` | 根据稳定错误码翻译的常见错误提示 |

键按模块组织，语义稳定，基础操作复用 common。核心术语统一为：连接 / connection（独立 storage_id）、存储服务 / storage service（provider_type）、规则 / rule、预览 / preview、执行 / execute、任务 / task。沿用现有词典的界面用语；服务商及应用品牌保留官方名称。

Rule 使用 `rules:types.<type>.name` 和 `.description`。Provider 使用 `providers:<provider_type>.name`、`.accountLabel` 和 `.fields.<key>.label`。可选变体为 `.createLabel`、`.help`、`.createHelp`、`.savedHelp`：缺少变体时回到基础标签/帮助，缺少帮助时不显示。新增内置 Rule/Provider 必须同步 en-US 和 zh-CN 的对应词条；需要不同新建标签或密钥帮助时也应贡献变体。

显示层按当前语言、en-US、稳定 ID 回退；未知扩展缺词不会阻止业务操作。Provider 的授权、目录选择和位置能力仍来自后端元数据，不能按 provider_type 编写业务分支。用户连接名（包括持久化的 `Local Files`）、账号资料、文件名、路径、规则输入和配置 key/value 均不是待翻译 UI 文案。

## 运行时约定

偏好默认 `auto`，先等待服务端设置再显示工作区，避免浏览器语言与已保存语言之间闪烁。auto 按 `navigator.languages` 优先级匹配已有语言：英语变体对应 en-US，简体中文及 zh/zh-CN/zh-SG/zh-Hans 变体对应 zh-CN，繁体中文不会冒充简体中文；完全不匹配时使用 en-US。已注册语言的精确匹配优先于别名。

设置页面即时切换，偏好经现有写入队列保存至后端 settings.json，失败提示并恢复上次持久化选择。不可用的已存语言暂时显示英文，保留原标识；设置读取失败使用 auto 并警告。Factory Reset 恢复 `auto` 并重新解析浏览器偏好。切换更新 `document.lang`、可用 MUI locale 和显示日期语言；设置页构建时间保持 Asia/Shanghai，文件时间保持现有本地时区。切换不得改变文件名排序、选中项、请求参数、预览或任务。

React 内使用 `useTranslation`，通知保存翻译键和插值数据，在显示时翻译；非 React 上下文才使用统一实例。不要在模块导入时缓存翻译字符串。保留 AppError 的 code/message/details：常见 code 的提示可翻译，未知 code 原样显示 message 作为诊断，不按英文句子猜测类别。日期显示可使用现有 i18n/format 工具；不要把显示格式传入配置或排序。

界面之外的边界：系统目录选择框跟随后端机器的操作系统语言，OAuth 服务商页面由服务商控制；当前授权回调的短暂后端 HTML 页仍为英文，主窗口成功通知由前端翻译。原始后端/网络诊断也可能保持英文。这些不是遗漏的词典键；本轮不改变回调页面或授权消息契约。

## 本地验证与 PR

在 frontend 目录，由贡献者执行：

```bash
npm ci
npm run i18n:check
npm test -- scripts/check-i18n.test.mjs src/i18n/catalog.test.ts src/i18n/languages.test.ts
npm run check
npm run dev
```

`i18n:check` 只读取本地文件。它检查 JSON 语法/重复属性、语言代码与元数据、六个命名空间、叶子类型和结构、插值一致性；en-US/zh-CN 必须完整，社区语言缺词报告数量和每个键但不导致失败。缺少命名空间、非法结构和插值错误始终失败。`npm run check` 先运行同一静态检查，再运行 Vitest、TypeScript 和生产构建。PR 的 Frontend CI 执行这些检查，不会自动提交、推送或合并。

检查器使用已有 TypeScript 解析器提取字面量、条件/数组翻译键、通知/标签映射、错误码列表及进度阶段，并拦截中文源码字面量、直接 JSX 文案与可见属性中的固定文案（保留应用品牌与版本前缀）；也读取后端显式注册的 Rule/Provider 类型与字段，验证其默认名称/说明/标签。它不导入或运行后端代码。注册扫描仅支持当前显式 import/register/定义写法，遇到不支持的写法会报错，修改注册方式时需同步扫描器。

静态分析不能证明任意动态键、未知第三方扩展、译文准确性或布局完整性。输出中的 `dynamic expressions require review` 是人工复核清单：Rule/Provider 已有注册元数据补充检查，字段可选帮助靠词典结构校验和交互测试，其余变量来源须由评审核对。不要通过添加空默认值或删除有效断言掩盖缺词。

PR 请列出语言、翻译范围、缺失数量、本地命令结果，以及下列人工检查结果：

- 刷新后偏好恢复，auto 与 Factory Reset 行为正确；切换不丢失草稿、选择和任务。
- 工作区、设置、规则、Provider 动态表单、预览/确认、空状态、通知、Tooltip、ARIA 和 MUI 自带文本可理解，插值没有泄漏翻译键或 HTML。
- 英文/新语言下检查长标签、长文件名、日期与数量，在宽屏及窄窗口检查菜单、抽屉、表格横向滚动和按钮访问。窄窗口检查不表示项目已正式支持移动设备。

Codex/Agent 须遵守 AGENTS.md：可以编写与静态核对；本地测试、构建和浏览器验收由用户执行。Commit 和指定开发分支的 Push 各自需要明确批准，PR 合并由用户操作；本指南不扩大授权。
