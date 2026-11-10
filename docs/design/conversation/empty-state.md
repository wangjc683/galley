# Empty State 与主对话的问候

> [Conversation 主区与 Composer](./README.md) 的一篇：2026-11-10 从 `docs/design/conversation.md` 拆出，正文原样搬过来。

## 7. Empty State（无 session 时主区）

主界面没 session 时**不放大段欢迎文案**，**Composer 浮在视口中部**（不在底部正常位置）。提交第一条后切入 conversation。

参考 Claude.ai / ChatGPT / Cursor 标准模式，跟"对话工作台"心智一致。

### 视觉

```
             语词的意义，在于它在语言中的用法。       ← 题词：状态绑定的维氏句（serif italic ink-muted）
             Die Bedeutung eines Wortes …             ← 德文原句常驻副行（更轻一档）

            ┌─────────────────────────────┐
            │ Composer (居中，560px max)   │
            │ [Cube] LLM dropdown │ [+]   │
            │                       [↑]   │
            └─────────────────────────────┘
```

- Composer 居中（含 LLM 切换器，跟 in-session 对称），placeholder 是 "交代什么？"（commissioning 语气；en "What should Galley do?"）。与项目内变体 "在 {Project} 里交代什么？" 同构。2026-07-04 收口：此前实现漂移成 21 字的本地文件功能问句，按 austerity 回归纯 affordance；本地文件能力的教学由 saved prompts 预置模板承担（「本地文件整理」等四条含路径提示），不占空状态。
- **Composer hint 槽统一语法**（2026-07-04）：composer 下方的小字提示全应用只有一种长相（主对话的输入框下面没有这一行，见「[会话里的输入框](./composer.md#会话里的输入框2026-10-15)」）——会话内「Enter 发送」hint 的 footer 槽（`mt-1.5 text-[11px] text-ink-muted`；卡片下与卡片左缘齐平，会话里的一行式下左对齐到输入文字的起点、＋ 右边 44px），Composer 以 `staticHint`（ReactNode）对外开放。每条 hint 自带一个**内容级体裁记号**，形式自我说明、不加「tip:」类元标签：键盘 hint 用 mono 键位词，项目态「将创建到 {Project}」用 11px 文件夹小图标（提交后果陈述）；项目绑了文件夹时后面接 ` · ~/…/文件夹名`（2026-10-09，挤压时路径先缩，项目名与 × 不让位）。
- **全局空状态卡片下方刻意全空**：能力 tip 不放这里——2026-06-03「新人能力发现留给非空状态机制」的决策仍然生效。2026-07-04 曾试放一行本地文件 tip，三轮打磨（居中独立行 → 统一 hint 槽 → 拟加体裁记号）仍破坏构图协调，当日删除。与 quick prompt 建议、快捷键 chrome 并列为勿回退项。
- **题词（epigraph）浮在 Composer 正上方**：一行状态绑定的维特根斯坦句（译文跟随软件语言）+ 德文原句常驻副行（更轻一档）。`font-serif italic text-[12.5px] text-ink-muted`，视觉明显次于 Composer——读作安静题铭，不是 header / banner；入场即冻结，不随状态实时变、不轮播（live pulse 归 sidebar status spine）。状态绑定：`silent`（无 session）→ Tractatus 7「凡不可说的，应当沉默」；`quiet`（有 session 但无运行）→ PI §19；`working`（≥1 运行）→ PI §43（也是 Composer 运行态声音所依的同一命题 *meaning is use*）。策展集与逐条理由在 `gui/src/lib/epigraphs.ts` 注释 + 2026-06-03 devlog。
- **题词可静默点击**（2026-07-21）：点击题词把一段解读请求预填进 Composer，用户按 Enter 才发出——空状态的本职是引出第一条消息，装饰自身成为零打字入口；用产品解释产品，而非手写静态注释。预填模板（通用增强版，二轮定稿）：完整出处署名 + 译文 + 德文原文 + 通用三问「在说什么 / 针对什么问题或立场提出 / 与今天的 AI · 大语言模型有什么关联或启发」。三味信息各有功能：署名解决弱模型识别（`epigraphs.ts` 每句带 `citeZh/citeEn` 完整引用——"PI §43" 弱模型展不开）、原文解决译本歧义、三问给答案结构；AI/LLM 关联一问是这些句子入选题词的真实理由，且不依赖产品自指。静止态与纯铭文逐像素一致（无下划线、无边框、无提示文案），hover/focus 才有极轻墨色上浮 + pointer——可发现性靠自选择：会被句子困住的用户恰是盯着它看的用户。守卫：composer 已有用户草稿时点击不覆盖（仅聚焦）；重复点击自身预填幂等。未配模型走 requiresModelConfig 正常降级。对 PI §43 这一交互即命题自身的演示（meaning is use——点击即用法）。Rejected：点击即发送（误点烧会话 + 模型调用，不可反悔）；隐藏上下文注入（明面短句暗里附加——违背"用户所见即所发"的诚实原则）；逐句定制阐述维度（策展负担 ×3 句 ×2 语言，且预填越像 prompt 模板越不像用户自己的话）；一行短问句「这句话是什么意思？」（一轮方案，弱模型识别不稳）；hover 显示人工策展释义（在 AI 工作台手写注释自我否定）；保持纯装饰（晦涩对掠过者是氛围，对驻足者是痒处，而驻足者恰好会 hover 到）。
- 阅读宽度（「显示」popover / Settings → General / View 菜单）同样影响 Empty State：compact = 560px，wide = 1200px。用户在空状态切宽度必须看到变化，否则像坏了。
- **不放 quick prompt 建议**（勿回退）：早期在 Composer 下方放过 4 条 serif italic 引导 prompt，2026-06 与题词打架——两坨安静 serif 夹住 Composer 稀释焦点，且在"沉默"题词下放"快说点什么"自拆其台——整段移除；新人能力发现留给独立的非空状态机制（详见 2026-06-03 devlog）。
- Sidebar 正常显示书眉 Header（字标 + 搜索 / 定时 / 新建项目）/ 新对话行 / timeline；项目会话折在「项目」分区的组行里；没有 session 时只出现一句 muted empty hint。有主对话时书眉没有字标，书眉下是助手卡片，新对话行这时整行亮着（[layout-and-chrome.md](../layout-and-chrome.md)「有主对话时」）。
- **不放快捷键 hint 行**（曾尝试在底部加快捷键提示，但稀释了 placeholder 的聚焦感；完整快捷键列表移到 Settings → Shortcuts tab）。本地文件 hint 行不属此类，见上。

### 主对话的问候（例外，2026-10-12，PRD 裁决 47，票 04c；2026-10-13 裁决 49 只留第一段）

主对话不受上面「不放欢迎文案」的约束：它不是一次性的对话，以后什么事都往这里说，第一句由 AI 说，教用户怎么用它。

- **什么时候**：内置运行时建出主对话的那一刻，Core 在同一个事务里写入一条 AI 消息（`core/src/db/main_chat.rs`）。
  从归档恢复、本来就在的主对话都不写；外置运行时没有主对话，也就没有问候。
- **说什么**：固定文案，中英两版，按界面语言选（桌面调 `get_or_create_main_chat` 时传解析后的界面语言，不传用英文）。
  中文是 JC 定稿的原文，只有一段：「你好，我是你的私人助理。以后有什么事，直接在这里跟我说就行。费时间的活我派出去办，办完回来告诉你。」
  英文：「Hi, I'm your personal assistant. Whatever comes up, just tell me here. Longer jobs I'll hand off, and come back to you when they're done.」
  2026-10-15 改（[助手 PRD](../../../.scratch/assistant/PRD.md) 裁决 7）：开头先说它是谁，侧栏助手卡片第一次打开时第二行就是这句，角色词不进卡片的名字行；末句是「事事给你交代」，用「派出去」不用「安排人」（子任务是 AI 对话，不是真人）。
  此前（10-12 起）：「你好。以后有什么事，直接在这里跟我说就行，不用再想是开新对话还是接着哪个旧的。」已建出的主对话里那一条不变，新建与重置后才是新版。
- **怎么显示**：按普通 AI 回答显示——没有步骤标记、横线、运行折叠、步数和用时，只有回答本身和它的行动条（复制、引用、保存与「⋯」，见「助手的对话」的「行动条」；问候没有过程）。在助手的对话里它是一条左侧气泡，上面一条居中的时间，取这一行的 `created_at`（[助手的对话](./assistant.md#助手的对话2026-10-15)）。
  识别靠消息的来源（`created_via = 'system'`、`supervisor = 'galley-greeting'`），不靠位置。
- **只给人看**：不回放进模型上下文（Core 重启、runner 变冷后的历史回放都跳过它），
  不算一轮问答（`turn_count` 仍是 0，第一条用户消息仍是第 0 轮）。
- 所以主对话从来不是空的；本节以上的空状态规则只管没有会话的主区和其他对话。问候不算一轮，激活时的读回此前只看 `turn_count > 0`，新建与重置后的主对话打开是空的，2026-10-14 起主对话一律读回（票 18）。侧栏助手卡片的第二行第一次就是这句问候（[layout-and-chrome.md](../layout-and-chrome.md)「有主对话时」）。
