# Galley 文案与语言规范

> 这是 Galley 本地化与 UI 文案的工作草案。目标不是机械翻译，而是让中文和英文各自都像原生产品文案。

## 状态

- Owner review：待确认
- 代码实现：基础语言偏好与 Settings 入口已接入
- 中文 source copy：第一批全局控件和 Settings 入口已清理，继续整理中
- 英文 copy：第一稿见 [English copy draft](./archive/english-copy-draft.md)

## 核心原则

Galley 应该有两套原生文案系统，而不是一套 source string 加一层机械翻译。

- 中文版要像中文产品，不要像英文逐字翻译。
- 英文版要像英文产品，不要像中文版逐字翻译。
- 共享产品概念要一致，但句式、节奏、详略可以按语言习惯重写。

## 语言偏好

语言选择是全局偏好，入口放在 Settings 和 Onboarding。

选项：

| 存储值 | 中文 UI label | 英文 UI label | 行为 |
|---|---|---|---|
| `system` | 跟随系统 | Auto | 根据 OS / WebView 语言偏好显示 |
| `zh-CN` | 中文 | 中文 | 强制使用中文 UI |
| `en-US` | English | English | 强制使用英文 UI |

默认值：`system`。

首次启动规则：

- 没有保存过语言偏好时，使用 `system`。
- `system` 根据 OS / WebView language preference 判断，不根据 IP、地区或时区判断。
- 首选 locale 以 `zh` 开头，显示中文。
- 其他情况显示 English。
- 用户显式选择 `中文` 或 `English` 后持久化；之后不再跟随系统语言变化，除非用户切回 Auto / 跟随系统。

## 语言入口

不要只为语言新建 `General` tab。

Settings 里，语言选择放在左侧栏底部，作为一个轻量全局设置：

```text
Language
跟随系统
```

Onboarding 里，语言选择放在顶部右侧，使用轻量菜单：

```text
[Translate] Auto
```

点击后打开紧凑 menu：

```text
跟随系统
中文
English
```

英文 UI 中显示：

```text
Language
Auto
```

Menu：

```text
Auto
中文
English
```

如果未来增加 theme、telemetry、启动行为等全局偏好，再升级成真正的 Preferences / General 页面。

## 中文版 Settings Tab

中文版 Settings 左侧 tab 使用**中文主标签 + 小号英文副标签**（2026-09-16
翻转；此前是英文主 + 中文小字注释）。中文是用户选定的界面语言，导航必须
中文优先；英文保留为术语锚点，只出现在侧栏副标签里。页头标题和
「设置 → 运行环境」这类跨页引用在中文版一律用中文 tab 名（2026-10-07
JC 裁；此前页头标题和「Settings → Runtime」用英文名，副标签是它们的
对应词）。

```text
通用
General

模型
Models

浏览器控制
Browser Control

聊天软件
Channels

智能体接入
Agent

运行环境
Runtime

快捷键
Shortcuts

报告问题
Feedback

关于
About
```

顺序与分组（三组之间留间距）以 [overlays-and-settings §9](./design/overlays-and-settings.md)
「语言与 Tabs」为准（2026-10-07 按使用频率重排）。

英文版只显示英文主标签：

```text
General
Models
Browser Control
Channels
Agent
Runtime
Shortcuts
Feedback
About
```

视觉规则：

- 中文主标签是视觉主信息：14px、medium weight、正常 tab 文本色（ink-soft，
  active 为 ink）。
- 英文副标签只做术语锚点：`text-ui-tertiary`（11.5px）、normal weight、
  ink-muted；active 态也不抬权重。
- 两行之间保留明确间距，避免像同一行信息的换行。
- 中文版每个 tab 都带英文副标签，不要只给部分 tab 补。
- 不要写成 `运行环境 / Runtime`。斜杠会让 UI 像术语表。
- 双层标签只用于 Settings 左侧导航，不扩散到正文和页头。
- 汉字不用 `text-ui-micro`（10.5px）：该 token 是给拉丁大写 chip 的，
  汉字在这个字号上会丢笔画，且此前的 ink-muted 75% 在浅色下只有 2.5:1。

页头与跨页引用（2026-10-07 JC 裁）：

- 中文版页头标题用中文 tab 名，与侧栏主标签同字：通用、运行环境、模型、
  智能体接入、聊天软件、浏览器控制、快捷键、报告问题。关于页保留 `Galley`
  字标。英文版页头不变，仍是英文 tab 名（报告问题页是 `Report an Issue`）。
- 页头标题取 locale 的 `settings.tabs.*.title`（报告问题页取
  `settings.feedback.title`），不在各页按语言分支。
- 中文文案引用设置页时写「设置 → 模型」「设置 → 运行环境」，与页头同名；
  不写 `Settings → Models`。
- 页头副标题句末不加句号，中英文版都一样。

Section 标签（2026-10-07 JC 裁）：

- 中文版 Settings 的 section 标签（`SettingsSectionLabel`）用中文，不强制
  大写、不加字距。全大写 + 字距的 eyebrow 只是英文版的排印处理：对汉字它
  只会把字拉散，还会把夹在中文里的拉丁词改成大写（「将随 Bug 报告附上」
  曾显示成 BUG）。
- 组件按解析后的界面语言切换这两项，字号、字重、颜色不变；英文版外观不变。
- 装饰性 section header `PROJECTS` 的例外保留，见「项目与对话」。

## 中文版英文词边界

中文版可以保留英文，但只保留专有名词、生态术语、协议 / 命令 / 文件名、模型品牌，或少数有意设计成英文的技术模块名。

普通操作、说明、提示、placeholder、aria label、错误、toast 应该用中文。

### 中文版保留英文

| 词 | 规则 |
|---|---|
| `Galley` | 品牌名，永远保留 |
| `GenericAgent` | 正式说明、首次接触、Onboarding、About、Runtime 中保留全称 |
| `GA` | 紧凑状态、重复标签、路径、短 UI 中使用缩写 |
| `Agent` | 外部操作者 / 生态角色，保留英文；不要翻成「代理」 |
| `Supervisor` | `Supervisor SOP` 或 supervisor 集成语境保留 |
| `SOP` | 保留；必要时用中文短句补语义 |
| `Runtime` | 只作 Settings 侧栏英文副标签；页头标题、「设置 → 运行环境」引用和正文都说「运行环境」（2026-10-07 起页头同侧栏） |
| `Channels` | TopBar 入口与渠道状态文案保留（如「Channels 已连接」）；Settings 侧栏主标签和页头标题用「聊天软件」，`Channels` 只作侧栏英文副标签（2026-10-07 起页头同侧栏）；正文可说「微信等应用」 |
| `Health Check` | 作为流程 / 组件名保留 |
| `CLI`、`API`、`MCP`、`Socket`、`schemaVersion` | 协议 / 契约词，保留 |
| `Python` | 保留 |
| `API Key` | 字段名保留（「API Key」「获取 API Key」「401 未授权：API Key 不正确」）；正文、提示、按钮一律说「密钥」，同一句里不混用「Key」（2026-10-08 起）。「凭证」只用于 ChatGPT / Codex 登录这类没有密钥的鉴权，徽标写「需要登录」 |
| `LLM` | 界面一律说「模型」，紧凑控件也不例外（2026-10-03 JC 裁，此前「紧凑控件可保留」）；只在外置 GA 的技术语境保留，如 Health Check「mykey.py 存在」的副标签「LLM 配置文件」 |
| 模型 / 服务品牌 | OpenAI、Anthropic、Claude、GPT、DeepSeek、Kimi、GLM、MiniMax、OpenRouter、SiliconFlow、Xiaomi MiMo 等保留 |
| `galley` | 命令名，保留并用 inline code |
| 文件 / 目录名 | `agentmain.py`、`mykey.py`、`.venv`、`memory/`、`assets/` 等保留 |
| Tool id | `file_patch`、`code_run`、`start_long_term_update` 等保留，但旁边要有中文解释 |

### 中文版优先中文

| 英文词 | 中文 UI 用词 |
|---|---|
| Settings | 设置 |
| Project | 项目；只有装饰性 section header `PROJECTS` 可以保留英文 |
| Session / Chat | 对话 |
| Provider | 服务商（2026-10-07 JC 裁，此前「提供商」）；编辑器内的按钮去名词只写「保存」，其他按钮与正文不写成「服务」（2026-10-08 起，此前「保存服务」「检查服务」） |
| Add / Remove model | 添加 / 已添加 / 移除，不用「启用 / 已启用」（2026-10-08 起：同一动作两个动词，对立面本来就是「移除」） |
| Tool call | 工具调用 |
| Command Palette | 命令面板；`Command Palette` 只保留为搜索 alias |
| Composer | 输入框，或避免暴露这个词 |
| Sidebar / TopBar / Toast | 避免出现在用户文案中 |
| Send | 发送 |
| Stop | 停止 |
| Back | 返回 |
| Dismiss | 关闭 |

## 内核 / Engine（managed 引擎的用户可见称谓）

2026-07-03 定位决策（Galley = 独立产品，基于 GenericAgent 二次开发）后的
术语规则：

- **managed（内置运行时）语境**的用户可见文案，指到引擎组件时用
  **「内核」**（英文版用 **engine**），不再出现 `GA` / `GenericAgent`。
  例：Health Check 条目「内核入口」「内核资源」；About 的
  `内核 b1e173dc · 2026-06-29`。中文用户对「XX 基于 Chromium 内核」有
  现成心智——独立产品 + 诚实交代引擎。
- **attach 语境**（接入 / 检查用户自己的 GA）保留 `GA` / `GenericAgent`
  ——那条流程的主题就是用户的 GA，改名反而不诚实。「Galley 不修改你的
  GA」承诺留在 attach 流程内。
- **上游 credit**（About origin story、GenericAgent 上游链接）与教程 /
  技术文档保留 `GenericAgent` 全称。
- **GA 预算**：品牌表面（About、tagline、首启第一屏）上 GenericAgent
  的出现次数控制在「一次有感情的（origin）+ 一次有事实的（引擎行）」；
  产品的一句话自我描述说它**是什么**，不说它**用什么做的**。

## Agent vs AI

`Agent` 和 `AI` 不等价。

当文案指向一个能通过 SOP / CLI / API 检查、创建、管理、自动化 Galley 的外部操作者时，用 `Agent`。

示例：

- `Agent`
- `Agent SOP`
- `Agent API`
- `让 Agent 接管和操作 Galley`

当文案指向用户日常感知里的回复方、被通知方、对话对象时，用 `AI`。

示例：

- `已通知 AI`
- `AI 回复`

「智能体」只用作中文辅助解释，帮助不懂英文的用户建立概念，例如 Settings tab 中文标签与页头标题 `智能体接入`。正文不大面积把 `Agent` 改成「智能体」。

## 中文版待清理区域

这些是实现 i18n 前需要 review 的现有产品文案区域。

### 全局控件

| 当前 | 中文版建议 |
|---|---|
| `Send` | `发送` |
| `Stop` | `停止` |
| `Dismiss` | `关闭` |
| `Back` | `返回` |
| `Open settings` | `打开设置` |
| `Settings · ⌘,` | `设置 · ⌘ + ,` |

快捷键显示规则：

- 作为独立快捷键 hint、tooltip、Settings Shortcuts 页面时，用带空格的按键组合：`⌘ + K`、`⌘ + ,`、`Ctrl + K`。
- 在非常窄的 sidebar 行尾提示里，可以保留紧凑形式：`⌘K`、`⌘N`。
- 不要写 `⌘,` 这种紧凑标点组合给新手看；逗号不像字母键，分开显示更清楚。

### Settings

| 区域 | 方向 |
|---|---|
| 左侧 tab | 中文主标签 + 小号英文副标签（2026-09-16 起） |
| 页头标题 | 中文 tab 名，与侧栏主标签同字（2026-10-07 起）；关于页保留 `Galley` 字标 |
| 页头副标题 | 句末不加句号 |
| Section 标签 | 中文，不强制大写、不加字距（2026-10-07 起） |
| 通用 subtitle | `外观、语言与应用行为` |
| 运行环境 subtitle | `Galley 的运行环境`（2026-07-03 内核规则：managed 语境不出现 GA） |
| 运行环境 section | `运行模式`（此前 `Runtime Mode`） |
| Health Check 字段标签 | 保留 `Health Check` |
| Health Check button | `跑一次 Health Check` |
| 模型 subtitle | `为 Galley 配置模型服务商和模型` |
| 智能体接入 subtitle | `把 Galley 交给本地 Agent 调度` |
| 智能体接入 section | `Supervisor SOP`（此前 `Galley Supervisor SOP`） |
| 聊天软件 subtitle | `在聊天软件里和 Galley 对话` |
| 浏览器控制 subtitle | `让 Galley 读取和操作你的浏览器，并沿用你的登录态` |
| 快捷键 subtitle | `键盘快捷键` |
| 快捷键 section | `导航`、`输入框`、`对话`、`浮层`（此前英文 `Navigation` / `Conversation` / `Overlays`） |
| 报告问题 subtitle | `把 Bug 或建议提交到 GitHub` |
| 关于 subtitle | `极简 harness 的本地全能 AI 助手`（2026-10-07 起与 GitHub 仓库 About 的中文句同字，此前 `开源的本地 Agent 工作台`；`harness` 是品牌 tagline 用语，保留英文）；section `链接`（此前 `Links`） |

### 命令面板

用户可见文案叫「命令面板」。

`Command Palette` 只保留在 search value / alias 里，方便用户用英文搜索。

### 项目与对话

正文、菜单、弹窗里使用「项目」。只有视觉系统有意使用英文 section anchor 时，才保留 `PROJECTS`。

用户可见的 session / chat 概念统一叫「对话」。

## 英文版出稿流程

中文 source copy 确认后，再出英文稿。

1. 按 UI 区域出英文稿，不按代码字符串顺序。
2. 英文版按英文产品语气重写，不逐字翻译中文。
3. Galley 英文语气：local-first、准确、克制、偏操作型。
4. 避免 SaaS marketing 腔。
5. 英文 copy review 通过后，再进入 i18n dictionary 实现。

建议英文 review 区域：

- Sidebar
- TopBar
- Composer
- Settings
- Onboarding
- Errors
- Command palette
- Toasts

## 实现备注

英文 copy review 通过前，不进入完整 i18n dictionary 实现，也不把英文
UI 当作已完成体验。

当前已接入的基础实现：

- 新增 typed language preference：`system | zh-CN | en-US`。
- 在状态 / render 边界解析 `system`，不要每个组件各自判断 locale。
- 命令 / 搜索 alias 可以多语言。
- 中文 aria label 不暴露英文实现术语。

后续进入完整双语实现时：

- i18n key 按 UI 区域组织，不要做一个扁平字符串大表。
