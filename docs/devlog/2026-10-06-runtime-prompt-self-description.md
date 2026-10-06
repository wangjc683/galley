# 系统提示词打磨·方向一：让模型答对「Galley 是什么、在哪、能不能」

**日期**：2026-10-06
**上下文**：JC 发起「优化和打磨 Galley 的系统提示词」，第一个方向是能回答用户关于 Galley 的信息、功能和指南。
先讨论，JC 回「认可，按建议推进」。跟踪：`.scratch/runtime-prompt-polish/`。只动 Galley 的 Runtime 层
（`core/src/managed_prompt.rs`），GA 核心提示词与 GA 记忆不动。

## 现状与证据

改之前，Runtime 层讲 Galley 本身的只有 About 一节：一段产品介绍，加上作者与项目主页。workbench.db（只读）里 437 条用户消息中，
问 Galley 本身的约 10 条，多半是 JC 自测，集中在「介绍一下 / 你是谁能干什么 / 什么版本 / 最新版更新了什么」。
「怎么做某事」在本机数据里没有，社区 issue 里有（#24、#27、#31）。

失败形态：

1. **把内核能力当成 Galley 功能，并往多里说。** `s-mqhxgvy8`（06-17）称能「设置定时任务、后台自主运行」；`s-mpw1w1el`（06-02）
   称能「图片生成/编辑」，讲架构那段是编的（「可能的模型选择、运行配置……」）。模型对 Galley 只知道一段话，空白处用 GA 记忆里的
   SOP 和常识补；GA 核心提示词开头「物理级全能执行者……禁止推诿」又把它往夸大的方向推。
2. **照念提示词原文。** `s-mu3rzev1`（09-16）回答 what is galley 时，整句复述「a somewhat mysterious figure… The mystery is part of
   the answer」。这句本是写给模型的指令，写法却像一句现成台词。
3. **过时。** 定位还是「local desktop workspace for AI agents」，没跟上 09-09 的「个人助手 + Less harness. More model.」；
   Goal、定时、项目、阅读面板都没有；渠道和「过去的对话」一节只列微信、飞书。

做得好的：问「最新版更新了什么」时，模型自己去开着的 GitHub Releases 标签页读，答得准。

## 讨论与裁决

方向一拆成四件事：a 身份、b 功能地图与入口、c 能力边界、d 版本与更新。c 是重点：用户会问；模型没法自查自己能不能操作 Galley；
答错就是 galley#31 那一类「说已设置、其实不会执行」的问题。准入测试三条都过。

交付方式三选一：

- A 全写进常驻提示词：2% 的需求让每次请求多付几百词，也违反准入测试第 2 条（能从工具拿到就别写散文）。否。
- **B 常驻精简 + 细节按需读（裁）**：常驻放 a + c + 一张地图 + d 一行；详细使用指南做成随 App 发布的文件，用户问到时再读。
- C 指向线上 README：网络（国内访问 GitHub 不稳）、仓库与安装版本错位、README 偏宣传。只留 Releases 一行用于「更新了什么」。

节奏：先只做常驻部分，指南等启动信号（进 [deferred](./deferred.md)「Galley 使用指南」与 `.scratch/runtime-prompt-polish/issues/02`）。

## 改了什么

- **About Galley 重写。** 「Galley 是跑在用户自己电脑上的个人 AI 助手，你就是这个助手」；引擎称「内核 / engine」，
  只在用户问底层时提一次 GenericAgent（照文案规范的 GA 预算：自我描述说它是什么，不说用什么做的）。
  加一张按界面位置组织的功能地图：侧栏（对话、项目、定时、⌘K 搜索）、输入框（模型与推理强度、Goal、＋ 菜单）、阅读面板、
  Settings 全部九页。标签逐个对过 `gui/src/i18n/locales/zh.ts` / `en.ts`。再加两句：「地图之外的界面不要描述得像亲眼见过，
  说去哪里看」；更新内容指向 Releases。
- **作者条款改成指令写法。** 去掉可整句复述的台词，改为「只知道这些；被追问时用你自己的话说不知道，可以带一点神秘感」。
  闭世界规则不变（07-07 的事故仍是它的根据）。
- **新节「What Only The User Changes In Galley」。** 模型提供商与 API Key、Channels、定时任务、浏览器控制与插件、运行时、
  更新、显示，只能由用户在界面里改。被要求改时不经文件、脚本、浏览器去试，不说「已完成」，指路并备好用户要填的内容。
  另加「问你能做什么时，只说本会话里确认有的能力」。边界只划配置面：IM 入口层本来就让 agent 用 CLI 写操作当 Supervisor
  （`session new`、`project create`、`goal`、`llm set`），这些不在禁止之列，否则会和入口层打架。
- **过去的对话**一节的 IM 列表补上 Telegram、Discord。

体量：静态规则 724 → 1028 词（+304）。讨论时估 +150，偏差来自作者条款重写、边界一节，以及后来把 Settings 九页全列上
（「在哪改 X」的答案多半是某一页，每页只给几个词，划算）。`PROMPT_PROFILE_ID` 不变，照 09-09、10-01 的先例；
哈希随静态规则变化，只作诊断。外置模式零变化（宪法第 1 条不注入这一层）；IM 渠道共用静态规则，一并生效。

## 验证

- `managed_prompt` 新增两条测试：两种表面都带地图、边界、指令式作者条款且不含原台词；列举 IM 平台的两节都含四个渠道
  （按章节切分检查，不数出现次数，免得以后改一处措辞就误报）。`cargo test -p galley-core --lib managed_` 36 passed。
- [prompt-composition](../managed-ga-runtime/prompt-composition.md) 同步：静态章节、条款台账四行、回归清单新增第 10–13 条。
- **未做**：真机回归（清单第 1–13 条，重点 10–13）。要在 `tauri dev` 的内置会话里跑真模型，留给 JC。

## 后续候选方向（未裁）

与 GA 核心提示词对齐（「禁止推诿」与能力边界的张力、`<next-suggestion>` 与 `<summary>` 的叠加）；告诉模型界面能渲染什么；
回归网。见 `.scratch/runtime-prompt-polish/PRD.md`。
