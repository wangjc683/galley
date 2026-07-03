# Galley 文案与语言规范

> 这是 Galley 本地化与 UI 文案的工作草案。目标不是机械翻译，而是让中文和英文各自都像原生产品文案。

## 状态

- Owner review：待确认
- 代码实现：基础语言偏好与 Settings 入口已接入
- 中文 source copy：第一批全局控件和 Settings 入口已清理，继续整理中
- 英文 copy：第一稿见 [English copy draft](./english-copy-draft.md)

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

中文版 Settings 左侧 tab 使用英文主标签 + 小号中文辅助标签。这样既保留产品 / 生态术语，又让完全不懂英文的中文用户能快速理解每个入口。

```text
Runtime
运行环境

Models
模型

Approval
审批

Agent
智能体接入

Channels
聊天软件

Shortcuts
快捷键

About
关于
```

英文版只显示英文主标签：

```text
Runtime
Models
Approval
Agent
Channels
Shortcuts
About
```

视觉规则：

- 英文主标签是视觉主信息：约 14px、medium weight、使用正常 tab 文本色。
- 中文辅助标签只做注释：约 10.5px、normal weight、muted 色；即使 tab
  处于 active 状态，也不要抬到主标签权重。
- 英文和中文之间保留明确间距，避免像同一行信息的换行。
- 中文版每个 tab 都要有辅助标签，不要只给 `Runtime` 这类难词补解释。
- 不要写成 `Runtime / 运行环境`。斜杠会让 UI 像术语表。
- 双层标签只用于 Settings 左侧导航，不扩散到正文。

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
| `Runtime` | 模块名保留；正文可以说「运行环境」 |
| `Channels` | Settings tab / TopBar 入口保留；中文辅助标签用「聊天软件」，正文可说「微信等应用」 |
| `Health Check` | 作为流程 / 组件名保留 |
| `CLI`、`API`、`MCP`、`Socket`、`schemaVersion` | 协议 / 契约词，保留 |
| `Python` | 保留 |
| `API Key` | 字段名可保留；正文可说「密钥」 |
| `YOLO` | 模式名，保留 |
| `LLM` | 紧凑控件可保留；正文优先说「模型」或「大语言模型」 |
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
| Provider | 提供商 |
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

「智能体」只用作中文辅助解释，帮助不懂英文的用户建立概念，例如 Settings tab 辅助标签 `智能体接入`。正文不大面积把 `Agent` 改成「智能体」。

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
| 左侧 tab | 中文 UI 使用英文主标签 + 中文辅助标签 |
| Runtime page title | 保留 `Runtime` |
| Runtime subtitle | `Galley 的运行环境`（2026-07-03 内核规则：managed 语境不出现 GA） |
| Health Check section | 保留 `Health Check` |
| Health Check button | `跑一次 Health Check` |
| Models page title | 保留 `Models` |
| Models subtitle | `为 Galley 配置模型提供商和模型` |
| Approval page title | 保留 `Approval` |
| Approval subtitle | `配置 Agent 操作的审批规则` |
| Agent page title | 保留 `Agent` |
| Agent subtitle | `让 Agent 接管和操作 Galley` |
| Shortcuts page title | 保留 `Shortcuts` |
| Shortcuts subtitle | `快捷键设置` |
| About title | 保留 `Galley` |

### 命令面板

用户可见文案叫「命令面板」。

`Command Palette` 只保留在 search value / alias 里，方便用户用英文搜索。

### 项目与对话

正文、菜单、弹窗里使用「项目」。只有视觉系统有意使用英文 section anchor 时，才保留 `PROJECTS`。

用户可见的 session / chat 概念统一叫「对话」。

### 审批

沿用已有中文框架：

- `允许`
- `拒绝`
- `加入「{projectName}」白名单`
- `加入全局白名单`
- `已通过 · 本次执行`
- `已拒绝 · 已通知 AI`
- `已加入此项目白名单`
- `已加入全局白名单`

按钮动词和操作后的状态要使用同一套概念，不要按钮说「始终允许」、状态说「已加入白名单」。

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
- Approval
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
