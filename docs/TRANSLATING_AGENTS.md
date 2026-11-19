# AI 辅助翻译贡献指南

[文档索引](README.md#协作指南) · [项目协作规则](../AGENTS.md) · [前端协作规则](../frontend/AGENTS.md)

本页供贡献者与 AI Agent 协作维护 Rename Studio 主应用的前端词典，适用于修订译文、补齐缺失词条、添加语言和随功能变更新增 UI 词条。开始前，确认目标语言和修改范围，并查看对应的界面调用位置。

## 定位词典

语言资源位于 [`frontend/src/locales/`](../frontend/src/locales)。以 [`en-US`](../frontend/src/locales/en-US) 的键名和结构为基准。`en-US` 是默认及回退语言，[`zh-CN`](../frontend/src/locales/zh-CN) 与 `en-US` 都须覆盖全部词条。

| 文件 | 内容 |
| --- | --- |
| `common.json` | 保存、取消等通用文案 |
| `settings.json` | 语言、主题和应用设置 |
| `storage.json` | 文件来源、账号授权和连接管理 |
| `files.json` | 文件工作区、选择、预览和执行 |
| `rules.json` | 重命名规则名称、字段和说明 |
| `providers.json` | 存储服务名称、账号标签和配置字段 |
| `errors.json` | 错误及失败原因提示 |

## 按任务修改

### 修订译文或补齐词条

在目标语言的对应 JSON 文件中修改字符串值。补齐词条时，按 `en-US` 的键名和层级添加。社区语言暂缺的词条可省略，界面会显示对应的英文。用词条是否存在来记录覆盖情况，避免用空字符串或复制英文原文凑齐。

### 添加语言

1. 选用规范的 BCP 47 语言代码，例如 `fr-FR`。代码须唯一，保留规范大小写与连字符，`auto` 为保留值。
2. 在 `frontend/src/locales/` 下创建同名目录。添加 `meta.json`，仅包含与目录名完全一致的 `code` 和该语言的自称 `name`。以下为法语示例。

   ```json
   {
     "code": "fr-FR",
     "name": "Français"
   }
   ```

3. 在新目录中创建「定位词典」所列的 7 个命名空间文件。参照 `en-US` 翻译，暂缺词条可省略，整份词典暂无译文时填写 `{}`。

[语言加载模块](../frontend/src/i18n/languages.ts)会自动发现这些资源，语言选项使用 `meta.json` 中的自称。新增语言只需添加资源文件。

### 新增 UI 词条

- 同步维护 `en-US` 和 `zh-CN`。固定文案、通知、Tooltip 和无障碍标签沿用 `react-i18next`，在展示时根据键和参数取译文。
- 新增规则名称和说明时使用 `rules:types.<type>.name` 和 `rules:types.<type>.description`。
- 新增存储服务时使用 `providers:<provider_type>.name`、`providers:<provider_type>.accountLabel` 和 `providers:<provider_type>.fields.<key>.label`。字段在相应界面确有需要时，可补充 `createLabel`、`help`、`createHelp` 和 `savedHelp`。
- 以规则类型、`provider_type` 和字段 `key` 等稳定标识关联词条。前端连接界面继续按已有的 Provider 元数据和能力渲染。

## 检查译文

- 保持 JSON 合法。词典使用对象与字符串，键名与 `en-US` 一致。检查重复键、键名中的 `.` 或 `:`，以及空字符串、纯空白字符串、数组、数字和 `null`。
- 保留 `{{count}}`、`{{name}}`、`{{message}}` 等占位符及各自出现次数。可按目标语言语序调整位置，保留格式指令。
- 保留官方品牌名和用户数据原值，包括文件名、路径、账号、文件来源名称和配置键值。译文使用纯文本。
- 沿用目标词典中的术语。简体中文将界面中配置的 `file source` 称为「文件来源」，将 `storage service` 称为「存储服务」。规则、预览、执行和任务等用语参照现有译文和实际界面。
- 纯翻译改动限于相关语言资源。AI Agent 静态核对文件范围、键结构、占位符和英文回退，按 `en-US` 的叶子键报告社区语言缺词数量。

## 用户验证与交付

用户按[开发环境说明](DEVELOPMENT.md#环境与开发启动)准备依赖并启动应用。在 Windows PowerShell 中进入仓库的 `frontend/` 目录，纯翻译改动运行 `npm run i18n:check`。涉及新增 UI 键或功能时，按[前端测试与验收](frontend/TEST.md#测试定位与验证)运行 `npm run check`，其中已包含翻译检查。

在「设置」的「语言」中切换目标语言，确认受影响的文件来源、文件工作区、规则、存储服务表单和通知文案。添加社区语言时核对菜单中的语言自称和缺词的英文回退。检查长译文和窄窗口布局，以及本次变更涉及的动态键和 MUI 自带文案。

交付时列出目标语言、修改文件、翻译范围、缺词数量、实际静态检查结果和待用户执行的检查。按[项目协作规则](../AGENTS.md#验证与交付)说明哪些检查未运行，并附建议的 Commit 信息。Commit 与 Push 权限见[Git 权限](../AGENTS.md#git-权限)。
