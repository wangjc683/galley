# 挂起的想法（Deferred）

想清楚了、留了方案、但决定暂不实施的想法都记在这里 —— 一想法一节，等启动信号再开工。

与时间线的分工：[时间线](./README.md) 记「已发生的历史」（不可变）；本台账记「想做但还没做的事」（会增删）。真正开工时，把对应小节从这里拎出来、落成一篇正式 devlog entry，并从本台账删掉。

每节固定字段：**状态 / 提出 / 启动信号 / 方案 / 实施要点 / 待定 / 关联**。

---

## IM 私聊并入主对话（原「IM 渠道并入主聊天」）

- **状态**：暂缓（2026-10-21 JC：「敲定了，就按自己养 Agent 来推进」，[devlog](./2026-10-20-im-a-line-to-the-same-assistant.md)「2026-10-21 改向」）。
  沿革：2026-10-09 起以「IM 渠道并入主聊天」暂缓在本台账（10-12 细化为三级 L0 / L1 / L2，10-13 L0 随事项账本撤掉，10-15 [助理 PRD](../../.scratch/assistant/PRD.md) 裁决 6 定「一个人」的原则）；2026-10-20 落成 [IM 并入 PRD](../../.scratch/im-one-assistant/PRD.md)（裁决 1–18：私聊并入主对话，它主动发的消息发到「手机上找我」的渠道），从本台账撤下；10-21 改向后该 PRD 搁置，回到这里。
- **提出**：2026-10-09 iOS 客户端与主聊天讨论（[devlog](./2026-10-09-ios-client-and-main-chat-direction.md)）。今天每个 IM 渠道各养一个 agent、各一条长期对话，不在 Galley 库里，也不是助理本人：IM 里的它没有提醒与派活的手，不知道主对话里说过什么。
- **启动信号**（任一条）：你或社区用户真的开始在 IM 里干活；上游基线升级时 IM 对话层补丁（`0023`、`0024`、`0026`）重放出冲突；想在桌面上看 IM 对话；IM 需要真正看懂图片；以及本方向独有的一条：想在手机上让助理来找你（到点提醒、派出去的活回来交代），而 iOS App 覆盖不到那个人（安卓、不装 App），比如你出门时想在微信里设提醒，或有安卓用户要提醒。
- **方案**：见 [IM 并入 PRD](../../.scratch/im-one-assistant/PRD.md)（对表、裁决、主对话语法到 IM 的映射、「一天的样子」、票 02–07 的拆法）。传话层与下一节「IM 迁到工作台会话」共用，两个方向只差私聊转到哪里。
- **实施要点**：宪法 Rule 4 要补解释（措辞稿在 PRD）；它主动发的消息要能隔很久送到，微信隔十天不带 token 主动发会被拒（`ret -2`），窗口没量完（PRD 票 01 Comments）。只在内置内核，外置零变化。
- **待定**：PRD「待定」一节。
- **关联**：`runner/im_reporter.py`、`runner/im_resume.py`、`core/src/im_supervisor/`、`core/src/managed_prompt.rs` `im_supervisor_prompt`。

---

## IM 迁到工作台会话

- **状态**：暂缓（2026-10-21 JC 敲定维持 IM 自己养 agent，[devlog](./2026-10-20-im-a-line-to-the-same-assistant.md)「2026-10-21 改向」）。
- **提出**：2026-10-21 JC：「可能之前 IM 设计是不是回归简单，就是工作台的延伸，这样最简单最好理解，工程量是不是也最小？每个 IM 都是工作台里面的普通会话？」
- **启动信号**（任一条）：你或社区用户真的开始在 IM 里干活；上游基线升级时 IM 对话层补丁（`0023`、`0024`、`0026`）重放出冲突；想在桌面上看 IM 对话；IM 需要真正看懂图片。
- **方案**：IM 进程只做平台收发，消息经 `session send --ensure-runner` 进 Core 的一个工作台会话，回复与在跑状态从 `session follow` 拿。一个 IM 聊天对应一个会话，`/new` 开新会话，`/llm` 换这个会话的模型；过程留在桌面那个会话里，IM 里可以撤；IM 入口层改成如实说（共用长期记忆，提醒要在电脑上跟 Galley 说）。
- **实施要点**：**全部聊天一起迁**（私聊、群聊、Discord 服务器频道），「IM 自己养 agent」的老路整条退掉，连带 `im_resume`、`im_reporter` 与对话层补丁；只迁私聊会变成两条路一起养，比哪一条单独都重。群聊进库意味着别人在群里说的话永久存进 Galley 的库，宪法 Rule 4 要单独议。runner 被 LRU 上限（20 个，`core/src/runner_manager/manager.rs`）挤掉时，下一句冷启动几秒。只在内置内核，外置零变化。
- **显式代价**：手机上没有「它来找你」；在微信里说「提醒我」，只能让你去电脑上说。今天自己养的 agent 派出长活后还能接着聊、做完由 `im_reporter` 送回交代，迁过去要另想。
- **待定**：在桌面上往 IM 会话里打字时回复发不发回 IM（倾向不发，只回从 IM 来的话）；派出去的长活怎么回报；一个会话长期不切段时上下文怎么收。
- **关联**：[devlog](./2026-10-20-im-a-line-to-the-same-assistant.md)「2026-10-21 改向」（工作台方案对 C、对自己养 agent 两张对比的读法）；上一节「IM 私聊并入主对话」（传话层共用）。

---

## 主对话的跨段连续性（事项账本撤掉之后）

- **状态**：暂缓（2026-10-13 主聊天 PRD 裁决 49，JC 选 A：撤掉事项账本，[devlog](./2026-10-13-drop-affairs-ledger.md)）。
- **提出**：账本原本负责「没人提起时也想得到」：每天后台整理用户说过的话，把进行中的事项清单放进主对话每一段的开头。撤掉后，跨段的连续性只剩切段（03a）、查历史（03b）和 GA 自己的长期记忆。
  GA 自己的记忆整理（`start_long_term_update`）只在 10 轮以上的长任务后才允许调用（`managed-ga/code/ga.py:559`），日常闲聊几乎不会触发（`docs/ga-baseline.md`：140 个会话 3 次）。
- **启动信号**：主对话真用两周后，JC 多次碰到「昨天的事它接不上、要我重新交代」。剩下的只有第 3 级。
- **方案**：按代价从低到高逐级补，前一级不够才上下一级：
  1. ~~新段开头带上一段最后几轮（Core 确定式，不加模型调用，只多一点首轮输入）。~~
     2026-10-13 提前做，不等信号（主聊天 PRD 裁决 50，JC：用户发一条，4 小时后接着发，助理却忘了上一次，体验非常不好）：最近 3 轮、不超过 6,000 字，票 [11](../../.scratch/main-chat/issues/11-carry-last-turns-into-new-segment.md)。
  2. ~~主聊天入口层提示词（03d）写明：用户像是在接着前面的事时，先用 CLI 查历史（03b 已有）。查不查由模型判断，只在相关时花钱。~~
     实际已在：主对话状态块（03b，`core/src/managed_prompt.rs` 的 `## Main Chat`）每轮都写着「更早的不在上下文里，用户提到时用 Galley CLI 查（search，再 `session show <id> --around=<messageId>`）」；03d 入口层没再重复（2026-10-13 核对）。
  3. 段末触发一次 GA 自己的记忆整理（03c）：按段跟着用户的使用走，不在后台每天跑，不另起格式和页面，写进 GA 的 L2 / L3。
- **实施要点**：第 3 级要绕开 `ga.py:559` 的 10 轮门槛（托管补丁，或在隐藏会话里跑），先读 03 票 Comments。
  不再做账本式的第二套记忆：主动提醒（票 05）若重启，从 GA 的记忆和查历史出发重新定范围。
- **待定**：第 3 级的整理结果要不要让用户看见（上游不显示 GA 记忆）。
- **2026-10-15 补**：[助手 PRD](../../.scratch/assistant/PRD.md) 裁决 5（D4）给「没人提起时也想得到」另补了一条路：每段开头由 Core 从库里确定式地拼几行「在办的事」（子任务、项目、提醒、定时任务），不调模型、不另起记忆，排在次序第 2 步；只覆盖落成了记录的事，只说过一嘴的仍靠本节的三级。
- **关联**：主聊天 PRD 裁决 18、49，票 [03](../../.scratch/main-chat/issues/03-segments-and-injection.md)、[05](../../.scratch/main-chat/issues/05-proactive-cards.md)、[10](../../.scratch/main-chat/issues/10-remove-affairs-ledger.md)；
  账本代码在 git 历史里（`82e1d674` 起，到 04d 的 `d8df038b`）。

---

## 待办上的进展

- **状态**：暂缓（2026-10-22 [主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 128 第 6 条，JC：「按你的推荐推进」）。
- **提出**：2026-10-22 从底层捋待办（[devlog](./2026-10-22-todo-from-first-principles.md)）。「以待办为根，主动的是动作」做出来的东西只留在对话里：派子任务的记录里没有待办 id（`subtask_dispatches` 只记主对话的哪一轮），面板上那一行从记下到截止长得一模一样，回答不了「这件事推进到哪了」。
- **启动信号**：试用到 2026-10-28 期间，它第一次真为某件待办做成了东西（查好的资料、起草的文件、等你拍板的准备；不是补答问题），JC 看面板觉得缺这一行。
- **方案**（从轻到重）：
  1. **进展写进备注**：手册加一句「替这件事做成了东西，就用 `todo update --notes` 补一句做到哪了」。裁决 128 第 5 条起面板已显示备注，这一步只改手册，加评测用例。
  2. **子任务挂到待办上**（裁决 128 第 5 条没选的 C）：派活标签带上待办 id（如 `<subtask todo="…">`），`subtask_dispatches` 加一列，面板里子任务缩进在那件事下面，不再单列在「Galley 在办」。
  3. **巡看记「上次看过」**（裁决 128 第 4 条没选的 C）：每件事记下巡看上次看它的时刻与当时的样子，没变化的隔几天再看。等 3 天窗口的门槛不够用再说。
- **实施要点**：1 只动手册与评测；2 要改派活标签格式（入口层与 `core/src/subtask.rs` 的解析）、加迁移（记得六处手写迁移列表）、改 Agent API 的 `todo show` 输出（`schemaVersion 3` 内加法）；只在内置内核，外置零变化。
- **待定**：备注是「到时要用的东西」与「做到哪了」两用，还是另开一个字段；一件事做了几次的进展留最新一句还是累积。
- **关联**：主聊天 PRD 裁决 91、112、124、128；助手 PRD 裁决 5（D4：记录是做事的副产品）、10。

---

## 待办的回执卡

- **状态**：暂缓（2026-10-22 [主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 131 第 6 条，JC：「按建议推进」）。
- **提出**：2026-10-22 讨论待办面板的开与关（[devlog](./2026-10-22-todo-from-first-principles.md)「开与关」一节）。JC 问它动了待办之后能不能自动打开面板；拆开看，背后的需求是「看见它动了什么」。它记下你的待办、设自己的提醒、派子任务，回复下都有卡片；它改时间、改说法、替你勾掉、取消，只有回复里一句话，那件事的卡片挂在当初记下它的回复下面，可能在很上面。卡片只按 `createdIn` 挂（`gui/src/lib/todo-panel.ts` 的 `todosByMessage`），后来在哪一轮改的没有记录。
- **启动信号**：试用到 2026-10-28 期间，JC 在对话里让它改过或替他勾过一件，回头想确认改成什么样时找不到。
- **方案**：在哪条回复里改的、勾的、取消的，那条回复下也挂这件的卡片，同一张卡片、显示这件现在的样子（与当初那张一起勾、一起变）。面板开着时裁决 131 第 5 条的亮行已经覆盖一半，这一步补面板关着的人。
- **实施要点**：Core 记「这一轮动过哪几件」（新表，如 `todo_touches(todo_id, session_id, turn_index, kind)`，在 `todo update` / `done` / `cancel` 带会话与轮次时写；记得六处手写迁移列表）；`list_noted_todos` 带上这些挂处；GUI 的 `todosByMessage` 按挂处分；同一轮里记下又改的只挂一张。只在内置内核，外置零变化。
- **待定**：取消的那张写「已取消」（同当初那张）还是不挂；一轮动了很多件（「把这周的都推到下周」）时是否收成一行。
- **关联**：主聊天 PRD 裁决 91 第 1 条（当场记、当场说、回复下挂卡片）、131；票 42、43。

---

## Galley 记待办更快

- **状态**：暂缓（2026-10-22 [主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 133 第 4 条，JC：「按你推荐推进」）。
- **提出**：2026-10-22 JC 问要不要在面板里加手动新建。裁决 133 定新建仍靠说（新建要判断日期、提醒、是不是同一件），真正的摩擦是等：票 87 走查里记一件从发出到回复落定 28–37 秒（六次，gpt-6.1-sol、high），每次三步，先查日期与清单、再记、再回一句；苹果「提醒事项」是即点即有。
- **启动信号**：试用里 JC 嫌它记得慢，或者记一件时它正忙、这句要排队。
- **方案**（从轻到重）：
  1. **手册合一步**：明说「记一下」「提醒我」时，查清单与记下放进同一次 `code_run`（先 `todo list` 看有没有同一件，再 `todo add`），少一轮模型调用；日期本来就在上下文里，不另查。
  2. **记待办不走高推理强度**：只在这一类句子上降一档（要看入口层能不能按句子分流，可能比 1 重得多）。
- **实施要点**：1 只改手册（`docs/managed-ga-runtime/galley-assistant-manual/todos.md` 一带）与评测用例，量前后用时；不改 Core、不改面板。查重不能丢：「交周报」那次就是靠先查清单问出来的。
- **待定**：合成一步后，同一件的判断要不要改在记下之后（先记再问「和交报告是同一件吗」，答「是」就删掉新的）。
- **关联**：主聊天 PRD 裁决 91 第 6 条、92、133；票 87 的走查记录。

---

## 已完成变长以后

- **状态**：暂缓（2026-10-22 [主聊天 PRD](../../.scratch/main-chat/PRD.md) 裁决 129 第 4 条，JC：「按你的推荐推进」）。
- **提出**：2026-10-22 JC 问已完成越来越多以后怎么显示、要不要只显示前 30 或 50 条。裁决 129 维持近 7 天加最多 50 件，不按条数截、不加「显示更多」（[devlog](./2026-10-22-todo-from-first-principles.md)「已完成」一节）。
- **启动信号**：
  1. **按天分小标题**：面板「已完成」7 天内超过 15 件（看 `list_assistant_todo` 的 `done` 长度，或 JC 说展开后不好找）。
  2. **超过 7 天的去哪找**：JC 在面板里找过一件 7 天前做完的事、没找到。
- **方案**：
  1. 展开后按天分小标题（今天 / 昨天 / 周几 / 日期），小标题照组名下一档；行上的时间只写钟点。少于门槛时照旧平铺，或者一直分（真机比）。
  2. 一个专门放已完成事项的地方（参照 Things 的 Logbook）：按天倒序、可搜，入口放在「已完成」组名那一行的末尾，或 ⌘K。现在的退路：回复下的待办卡片一直留着（票 43），查找聊天记录也搜得到。
- **实施要点**：1 只改 GUI；2 要 Core 加一个分页读法（`RECENT_WINDOW_DAYS` 之外的已完成），只在内置内核，外置零变化。按钮后面别再套折叠（「按天」不能做成可折叠的小组）。
- **待定**：门槛 15 是主会话定的数；第 2 条要不要连子任务、提醒一起收。
- **关联**：主聊天 PRD 裁决 86 第 2 条（近 7 天、默认收起）、93、129；`core/src/assistant_todo.rs` 的 `RECENT_WINDOW_DAYS`、`RECENT_LIMIT`。

---

## 主动的第二阶段：眼睛与按事项状态触发

- **状态**：暂缓（2026-10-21 [助手 PRD](../../.scratch/assistant/PRD.md) 裁决 10：第一阶段以待办为根，眼睛先接哪里 JC 还没想好）。
- **提出**：2026-10-21 JC 读 Today AI 一个月使用体验的文章（公众号「AI产品阿颖」《很多人压根没看懂 Personal Agent。》）。文章里那次 Aha 靠的是「看得见」：作者没对它说过一句，它从群聊和旧文档里知道作者在查什么。Galley 的助理只看得见用户在主对话里打的字（[devlog](./2026-10-21-proactive-first-stage-todo-rooted.md)）。
- **启动信号**（任一条）：第一阶段试用（到 2026-10-28）里巡看大多是跳过或 `<no-reply/>`，原因是清单上没东西；JC 说出「它要是能看到 X 就好了」；JC 想好先接哪个来源。
- **方案**：
  1. **眼睛**：用户逐个授权的来源，先按需读（接活前、巡看时翻一下），再考虑在巡看里看新东西。候选按先后：日历、邮箱，其次飞书（用户身份读群聊与文档，本机有 `lark-cli`）、下载文件夹、GitHub issue、服务器账单。看到的东西先落成一条待办再推进，待办是所有眼睛的汇合处。
     - **日历、邮箱排前面**（2026-10-22，Claude Duet 的数据点）：Anthropic 10-21 发布的 Claude Duet（[发布文](https://claude.com/resources/articles/claude-duet)）每天早上的简报、每隔几小时的检查读的就是这两样，它们是最先值钱的眼睛。
     - **走本机，不走 OAuth 连接器**：Duet 住在云端虚拟机，靠连接器读账户，你合上电脑它照跑；代价是它看不到你本机的文件和项目，它的浏览器你看不到也接不过来，登录要另填表（[上手页](https://support.claude.com/en/articles/17631495-get-started-with-claude-duet)）。Galley 反过来：macOS 日历在本机读，网页邮箱、飞书用用户已经登录的真实浏览器看。Duet 的短板就是这条路的入口。
  2. **按事项状态触发**（裁决 10 没选的 C）：Core 在临近截止、几天没动时叫醒，不再只靠每天 9:00。
- **先接眼睛还是先接嘴**：Duet 首先是手机 App，做完了、要你过目时都推通知；Today AI 那次 Aha 也是推到手机。Galley 主动做成的事落在桌面主对话，人不在桌前要回来才看到；iOS 端卡在开发者账号主体（`.scratch/ios-client/PRD.md` `needs-info`）。第一阶段试用里留意：它开口那几次，JC 是不是多半不在桌前、隔了很久才看到。多半是，就先做嘴（iOS 端）；否则先做眼睛。10-28 复盘时一起看。
- **Duet 对照里不改的**：每天早上发简报（没眼睛时只能复述用户看得到的清单，违背「你已经看得到的不说」，接上眼睛再议）；Duet「可以提出某件事看起来做完了，但只有你能标成完成」，Galley 手册允许助理勾掉它替你做完的事（`todos-change.md:23-26`），勾掉会说一句、能撤回，试用里出现勾错再改。
- **实施要点**：别人在群里说的话会发给模型服务商，每个来源要用户单独开、Galley 不落库（宪法 Rule 4）；个人微信群没有官方读取接口，这条走不通。后台只做不花 token 的检查，有新东西才叫醒（上游 GA 反射模式 `check()` 的思路，`managed-ga/code/agentmain.py:332-361`）。只在内置内核，外置零变化。
- **关联**：助手 PRD 裁决 10；主聊天 PRD 裁决 124；[devlog](./2026-10-21-proactive-first-stage-todo-rooted.md)「Claude Duet 对照」。

---

## 主对话先应一声、办完另起一条

- **状态**：暂缓（2026-10-21 [助手 PRD](../../.scratch/assistant/PRD.md) 裁决 10「IM 体验两处」的第二处）。
- **提出**：Today AI 动手前先发一条「好，我把这份计划做成……」，办完另发一条「文档建进飞书了……」，像同事在 IM 里先应、后交代。Galley 主对话动手前那句旁白进顶栏、被下一句替掉（主聊天 PRD 裁决 107、110），对话里只留最后一个气泡；两条消息的节奏只在派子任务时才有（「好，我让人去查」→ 叫醒交代），2026-10-16 以来一件也没派过。
- **启动信号**：JC 在主对话里碰到一轮跑了半分钟以上、中间对话里什么都没留，觉得像没人应；或第一阶段里它主动做事的轮次变长。
- **方案**：一轮里模型在第一次调工具前写的话（旁白）若是对用户说的应答，落成一条独立的气泡，留在对话里；最后的回复另起一条。要先量：主对话一轮里第一次调工具前有旁白的比例，和这些旁白是不是对用户说的话（多是工作记录口吻时，要先改入口层让它先应一声）。
- **实施要点**：动的是裁决 107、110 的分工（顶栏写那一步的那句话），要上切换器真机比；只在主对话，外置零变化。
- **关联**：主聊天 PRD 裁决 103、107、110、124。

---

## 回复里的可视化卡片（富 UI 回复）

- **状态**：暂缓（2026-10-16 JC：方向很好，进暂缓计划；等主对话 / 助理打磨得差不多了再来讨论，目前主对话优先）。
- **提出**：2026-10-16，JC 问 thesysdev/openui 是什么，接着提出想让助理的回复不只是 Markdown 文字，而是更生动、更漂亮、甚至可交互的 UI。三路调研与方案在 [.scratch/rich-reply/](../../.scratch/rich-reply/PRD.md)。
- **启动信号**：主对话 / 助理打磨得差不多时由 JC 重开（[助手 PRD](../../.scratch/assistant/PRD.md) 的次序：闭环 → 承诺 → 授权补全 → 一个人）。重开后第一步是探针，不动代码：8 个真实问题、两个模型、一页本地对照。
- **方案**：模型在回复末尾按需写 `<visual>` 标签包住一段 HTML / SVG，GUI 剥掉标签，在沙箱 iframe 里画成卡片，挂在助理的气泡下（形态借子任务卡片）；正文照旧是 Markdown、不看卡片也读得通。画图指南进助理手册按需读，系统提示只加一行指针。
- **实施要点**：只在助理的对话（内置），外置零变化。iframe 不给 `allow-same-origin`、CSP 禁外联。交互 v1 只做卡片内部的交互，加上点选项填进输入框，不自动发送。已知代价：主对话不流式，一张卡多等约 10–40 秒；HTML 留在历史里占上下文。
- **待定**：重开 10-06「告诉模型界面能渲染什么」的否决（这次是产品驱动，算准入测试的一个例外）；交互范围；探针怎么跑；Tauri 的 IPC 会不会注入沙箱 iframe（没核实）。
- **关联**：[10-06 预算 devlog](./2026-10-06-runtime-prompt-budget.md)（加法候选被否）；[prompt-composition](../managed-ga-runtime/prompt-composition.md) 准入测试；本台账「Artifacts」「Galley 使用指南」。
  不选：OpenUI 等组件白名单（每轮固定 prompt、没有文本降级与 Swift 渲染器、上游一家在改）、只扩 mermaid / svg 渲染（不能交互），理由见 PRD「不选的路」。

---

## 主对话里删单条消息

- **状态**：已出列（2026-10-16 主聊天 PRD 裁决 83 推翻 59，JC：「整体方案我认可你推荐的 C」，票 [32](../../.scratch/main-chat/issues/32-delete-single-message.md)）。不切段，改为删库后退掉在跑的 runner、重放不含它；你的话与它的回复各删各的。下文是 10-14 的原记录。
- **原状态**：不做（2026-10-14 主聊天 PRD 裁决 59，JC：删单条「可以不要」；同轮定了设置深处的「重置主对话」，票 [15](../../.scratch/main-chat/issues/15-reset-main-chat.md)）。
- **提出**：2026-10-14 JC 讨论主对话的删除与重置：主对话长久存在，用户可能想删掉其中某条信息。
- **启动信号**：有用户要删掉主对话里的某一条，最可能是误发了密码、证件号、密钥这类东西。
- **方案**：用户消息的右键菜单加「删除这条」：删掉数据库里这一条（连同附件文件与全文索引），并让主对话从下一句起换新段，免得当前这一段的上下文里还留着它。确认弹窗写明：已经发给模型服务商的收不回来；如果它已经记进长期记忆，要在对话里让它忘掉。
- **实施要点**：删记录不等于让它忘。当前这一段的上下文在 runner 内存里，长期记忆在 `managed-ga-state/memory/`，模型服务商那边收不回；不换段的话，下一句回复照样可能提到它。新段开头带的最近 3 轮（票 11）与查历史（03b）都读数据库，删掉之后就读不到了。
- **待定**：AI 的回复要不要也能删（它误回了敏感内容）；删掉一条用户消息后，那一轮的回复怎么处理。
- **关联**：主聊天 PRD 裁决 14、49、59；票 11、03b。

---

## 工作台会话删单条消息

- **状态**：暂缓（2026-10-16，主聊天 PRD 裁决 83 定主对话可以删单条时 JC 问工作台要不要一起做；JC：「按你推荐」）。
- **提出**：2026-10-16，主对话删单条（票 [32](../../.scratch/main-chat/issues/32-delete-single-message.md)）之后，两边气泡同一套语法，主对话能右键删、工作台不能。
- **不急的理由**：主对话要单条删，是因为它长久存在、唯一出口是连长期记忆一起清空的重置；工作台的会话本身就是删除的单位，而且很短：9 月以来 78 个工作台会话，最长 8 句你的话，54 个不超过 2 句，误贴一条删整个会话只丢几轮。
- **启动信号**：有人在长会话里误发敏感内容、又不想丢掉整个会话；或工作台出现超过 20 句的会话成为常态。
- **方案**：沿用票 32 的删除命令、右键菜单与只有标题的确认框，去掉「只认主对话」的限制；各删各的，一轮的回复连同它的步骤算一条。
- **实施要点**：
  - 工作台会话不只你在读：同期 30 个是 CLI、Supervisor 或系统建的，Supervisor 用 `session read` 与 `--after-turn` 读记录，助手的子任务卡片读子任务的最后一句；在别人读着的会话里删消息，打破「记录就是发生过的事」。
  - 结构比主对话多：一轮的步骤列表、折叠头（「N 步 · 用时」）、提问与回答；删掉一轮的那句你的话，这一轮怎么画、跟谁成组要定。
  - 外置运行时也有工作台：重放同样从库里来，但引擎日志与记忆在用户自己的 GA 目录里，宪法 Rule 1 不碰，「它之后看不到」只对 Galley 的库成立；两种运行时各验一遍。
- **待定**：Supervisor 或 CLI 正在驱动的会话里能不能删；子任务会话里删了，助手那边的卡片与叫醒怎么办。
- **关联**：主聊天 PRD 裁决 83；票 32；本台账「主对话里删单条消息」。

---

## 外置用户搬到内置（只读导入模型与记忆）

- **状态**：暂缓（2026-10-16，JC 定助理维持只在内置时一起记下，[devlog](./2026-10-16-assistant-stays-managed-only.md)）。
- **提出**：助理（主对话）只在内置内核；外置用户要用它只能切到内置。设置里已有「切换到内置内核」，但切过去要在「模型」里重新配 Key，GA 的长期记忆与 SOP 也从种子开始：助理不认识你。真正挡住外置用户的是这份切换成本，不是「外置能不能有助理」。
- **启动信号**：社区里出现外置用户要助理、或问怎么从外置迁到内置的反馈。今天没有数据：Galley 没有遥测，本机 9 月以来外置会话 3 个，都是 JC 自测。
- **方案**：一次性的「从外置 GA 搬过来」：只读外置 GA 的 `mykey.py`（模型与 Key）与 `memory/`（长期记忆、SOP），写进内置的模型配置与内置状态目录；外置一个字不改，搬完照常能用。
- **实施要点**：Rule 1 允许（读外置只读、写的是内置自己的状态，宪法「Reading GA internals is allowed only when read-only and documented」要把读的文件记成耦合点）；Key 写进凭据存储，不进明文；外置记忆里可能有指向外置目录的路径、为外置环境写的 SOP，搬之前给用户看清单、可取消勾选；不覆盖内置已有的记忆（合并还是只在内置还是种子时才搬，开工时定）。
- **待定**：只搬模型、还是连记忆一起搬；放在切换内核的那一步里，还是设置里单独一个入口。
- **关联**：主对话 PRD 裁决 3；宪法 Rule 1；`core/src/managed_model_config.rs`；`core/src/managed_runtime.rs`（内置状态目录与记忆种子）。

---

## 派活说明的颜色（工作台右侧那些不是你写的消息）

- **状态**：暂缓（2026-10-16，[工作台对话 PRD](../../.scratch/workbench-conversation/PRD.md) 裁决 4；JC：「这条我也还没想好」，随后按推荐暂缓）。
- **提出**：2026-10-16 工作台你的话挪到右边时（裁决 2，[devlog](./2026-10-16-workbench-conversation-grammar.md)）。子任务的派活说明与打回是助手写的，Supervisor 来源的消息是外部 agent 写的，今天都穿杏沙，只靠气泡上方一个小图标（「来自主对话」、Supervisor）分来源。挪到右边后，IM 的直觉是「右边杏沙是我说的」；设计文档也把杏沙定为「人的声音」（`conversation.md`「杏沙气泡」：「人的声音不穿机器外衣」）。
- **启动信号**：闭环试用期（[助手 PRD](../../.scratch/assistant/PRD.md)「次序」A）里 JC 点进子任务会话，有一次把派活说明认成自己写的，或接手后分不清哪句是自己说的。当时子任务是 0 个，没有真会话可看。
- **方案**：位置按角色、颜色按身份。发话的一方在右；只有你写的是杏沙，助手与外部 agent 写的用中性底（`bg-assistant-tint`，与助手气泡同色：同一个说话人同一个颜色）；来源图标行照旧。接手的那一刻在画面上看得出：中性底变成杏沙。
- **实施要点**：`MessageUser` 按 `origin.via`（`subtask`、`supervisor`）选底色，一行样式；助手对话里没有右侧的非你消息（叫醒行不画），不受影响；设计文档「杏沙气泡」加一句。只改 GUI。
- **待定**：中性底在右边会不会读成「它在跟它自己说话」；外部 agent 与助手要不要再分颜色（倾向不分，靠图标）。
- **关联**：工作台对话 PRD 裁决 2、4；助手 PRD「反方」第 3 条（两个操作者撞车：它只往自己派的会话里写，你开的除非你开口）。

---

## 回复正文的拉丁字体（Newsreader 没生效）

- **状态**：暂缓（2026-10-15 主聊天 PRD 裁决 67 第 5 条，JC 按推荐：先不动，免得字体混进 IM 画法的比较）。
- **提出**：2026-10-15 票 19 子代理在 harness 里量到，主会话在 JC 正在跑的 dev 的 CSS 里核实。`MarkdownView.tsx` 里有 8 处 `font-[var(--galley-prose-serif)]`（`caf1c1a4`，2026-06-09 起）。Tailwind v4 推断不出任意值的类型时默认当字重，于是编译成 `font-weight: var(--galley-prose-serif)`，字体族没设，继承父级的 Inter。设计文档写的是 Newsreader（`docs/design/foundations.md` 的 Serif 一行、`conversation.md` 的回复字体与 markdown 字表）。
- **影响**：回复正文、markdown 标题与引用、思考预览，以及其他走 MarkdownView 的地方。中文不受影响：`--font-serif` 有意让中文落到苹方 / 雅黑（foundations.md 2026-06-20 注记）。受影响的是拉丁字母和数字；英文界面的回复整段都是无衬线。06-09 以来 JC 的视觉裁决都是在 Inter 上做的。
- **启动信号**：主区的 IM 画法定稿（主聊天票 20）合入，JC 用过几天之后。
- **方案**：二选一，真机比。
  1. 修好：8 处一起改成 `font-[family-name:var(--galley-prose-serif)]`，或者 `[font-family:var(--galley-prose-serif)]`。做一个临时切换器比「现状 Inter」与「修好 Newsreader」，工作台的回复和助手的气泡都看，中英文各一组。
  2. 认现状：把设计文档里回复、markdown、思考预览的字体改成 Inter。
- **实施要点**：
  - 修好会动所有对话的拉丁字形、字宽和行长。字号档、行高、`tracking-[0.005em]`、h1–h4 的 medium、引用的 italic 都是照 Newsreader 写的，要一起看。中文段落里的数字和英文词会变成衬线，混排也要看。
  - 动手前先查别处有没有同样的写法（`font-[var(…)]`、`font-(--…)`）。2026-10-15 只在 MarkdownView 里找到。
- **待定**：思考预览（italic）跟不跟。
- **关联**：主聊天 PRD 裁决 66、67；票 [19](../../.scratch/main-chat/issues/19-assistant-im-rendering-trial.md)、[20](../../.scratch/main-chat/issues/20-assistant-im-rendering-final.md)；`gui/src/components/conversation/MarkdownView.tsx`。

---

## 项目整体归档

- **状态**：暂缓（2026-10-08 JC 按推荐：这次只在删除确认框里加「同时归档」）。
- **提出**：2026-10-08，项目菜单「归档全部对话」与「删除项目」的困惑讨论（[devlog](./2026-10-08-sidebar-project-groups.md)、[PRD](../../.scratch/project-archive/PRD.md)）。
- **启动信号**：Supervisor 拆出来的项目开始堆积、分区里常年挂着做完的项目；或有人从「已归档」恢复对话时想要它回到原项目。
- **方案**：项目加归档态，归档时一并归档组内对话且保留 `project_id`；分区（含「更多项目」）不列已归档项目；「已归档」对话框按项目分组、整组恢复。CLI / Agent API 只增不改（`project archive` / `project restore`）。
- **实施要点**：Core 迁移（`core/tests` 与 `cli/tests` 里手写的迁移列表要一起补）；外置 / 内置两种运行时无差别，只动 Galley 自己的库。
- **待定**：置顶的项目会话随不随项目归档；单条恢复遇到已归档项目怎么处理；有了整体归档后删除确认框的「同时归档」是否保留。
- **关联**：`core/src/db/project.rs` · `gui/src/components/screens/archived/ArchivedDialog.tsx` · [layout-and-chrome「删除项目」](../design/layout-and-chrome.md)

---

## 项目分区的数量上限

- **状态**：暂缓（2026-10-09 JC 问项目多了是否只显示一部分；组内只显示最近 5 条已做，分区这一层按推荐不做——活跃项目按活动排序本来就在最前）。本节当日漏建，同日项目打磨一轮补上。
- **提出**：2026-10-09（[devlog](./2026-10-09-sidebar-recent-five-and-new-project-icon.md)）。
- **启动信号**：分区里同时列出的组行多到把「今天」挤出小屏首屏（约 6 个以上），或有人反馈项目区太长。
- **方案**：分区只列前 N 个（置顶在前，再按内容活跃度），其余并进分区末尾的「更多项目」行——那一行 10-09 起就是溢出行（同日下午之前叫「其他项目」），挂出规则不变。
- **实施要点**：只改 `buildSidebarSections` 里 `otherProjects` 的划分（`gui/src/lib/sidebar-timeline.ts`），加条数条件；vitest 补边界。
- **待定**：N 取几；置顶项目算不算在 N 里。
- **关联**：05-13 做过「≤ 8 全显示、≥ 9 显示前 8 个 +『查看全部』」，05-22 嫌它「扩不上去」换成 Project Review——当时项目也少，不算测过之后被否。

---

## 命令面板列出项目

- **状态**：暂缓（2026-10-09 项目打磨一轮，JC 按推荐）。
- **提出**：2026-10-09（[devlog](./2026-10-09-project-ux-polish-pass.md)）。
- **启动信号**：项目数到 5 个以上，或有人反馈找不到沉底（「更多项目」里）的项目。
- **方案**：⌘K 输入项目名时列出项目，选中 = 在侧栏展开该组并滚进视野（`openProjectInSidebar`）；可加次动作「在项目里新建对话」（`startProjectConversation`）。
- **现状**：⌘K 只有「新建项目」；书眉项目菜单 10-09 换成了新建按钮，沉底项目的入口是分区末尾「更多项目」。
- **关联**：`gui/src/components/overlay/CommandPalette.tsx` · `gui/src/hooks/useProjectNavigation.ts`

---

## 拖会话到项目行

- **状态**：暂缓（2026-10-09 项目打磨一轮，JC 按推荐）。
- **提出**：2026-10-09（[devlog](./2026-10-09-project-ux-polish-pass.md)）。
- **启动信号**：有人反馈「加入项目 / 移到项目」藏得深，或 Supervisor 之外的手动归类变多。
- **方案**：会话行拖到项目组行上 = 移进该项目；拖到时间桶区域 = 移出。拖动中目标组行高亮。
- **实施要点**：鼠标优先（2026-07-05）下顺手，但侧栏行在 pointerdown 就激活（10-03），要加拖动阈值，否则一拖就打开会话；折叠组的挂出行、展开组「显示更多」上方的借位、「更多项目」收着时借位露出的项目行都要想好落点；置顶会话不进组（置顶优先于日期），拖置顶行到组上要么只改归属不改位置，要么禁拖。
- **关联**：`gui/src/components/layout/sidebar/SidebarSessionRow.tsx` · `SidebarProjectGroup.tsx` · [layout-and-chrome「Project 组行」](../design/layout-and-chrome.md)

---

## macOS 菜单栏与托盘菜单本地化

- **状态**：暂缓（2026-10-08 Settings 逐页第五批，JC 按推荐：补进台账，这次不做）。
- **提出**：2026-07-15 桌面打磨轮把它列为 Open「菜单栏本地化」（[devlog](./2026-07-15-desktop-craft-polish-round.md)），一直没进台账；2026-10-08 第五批审计翻出：中文用户在设置 → 通用的说明里两次读到「菜单栏 / 托盘」，菜单和托盘本身却全是英文（托盘「Settings...」还是三个半角点）。
- **启动信号**：中文用户反馈菜单 / 托盘是英文，或做 Windows 托盘相关改动时顺带。
- **方案**：Rust 侧菜单项按界面语言 `set_text`，复用已有的语言推送通道（字号、宽度的菜单勾选已经走这条路）；先按文案规范定菜单中文术语，含 `Compact (760px)` 这类文案是否保留像素值。
- **实施要点**：菜单项 id 不变（GUI 监听的 `menu:*` 事件名不变）；macOS 应用菜单里系统自带的项（Hide / Quit 等）由系统本地化，只改 Galley 自己加的项。同一轮可以顺带决定 07-15 另一条 Open「⌘K 缺菜单栏入口」。
- **关联**：`core/src/app_menu.rs` · `core/src/tray.rs` · [第五批 devlog](./2026-10-08-settings-general-shortcuts-feedback-about-pass.md)

## 微信引用消息

- **状态**：暂缓（2026-10-10 微信对话体验对齐桌面端时裁决不做，范围之外）。
- **提出**：2026-10-10 读腾讯官方 iLink 插件源码（`@tencent-weixin/openclaw-weixin` 2.4.9）：用户在微信里引用一条消息回复时，消息带 `ref_msg`；Galley 的微信对话（`runner/im_wechat.py`）只读文字与语音转写，引用的内容到不了模型。
- **显式代价**：用户引用机器人之前的某条回答说「这个再展开一下」，模型只看到「这个再展开一下」，要靠上下文猜指的是哪条。
- **为什么不做**：新版微信的引用往往只带一个 `svr_id`，不带原文；官方插件 2.4.9 是在本地 SQLite 里存下收发消息的原文，再按 id 还原。Galley 存 IM 原文与 Rule 4（Galley 不存 IM 对话）冲突。
- **启动信号**：JC 或用户在微信里用引用回复、并抱怨它没看懂指的是哪条。
- **2026-10-21 更新**：10-20 写的「Rule 4 阻碍随并入消失」随 IM 改向作废（[devlog](./2026-10-20-im-a-line-to-the-same-assistant.md)「2026-10-21 改向」）：IM 对话照旧不进 Galley 的库，「为什么不做」原样成立。走了「IM 私聊并入主对话」或「IM 迁到工作台会话」，阻碍才会消失。
- **方案**：①先只用随消息带来的引用内容（`ref_msg.title` / `ref_msg.message_item` 的文字），作为「引用：…」前缀交给模型；②只带 `svr_id` 的引用告诉模型「用户引用了一条消息，内容没随消息带来」；③要完整还原就得存原文，须先重新解释 Rule 4（先例：2026-08-13 对引擎日志的解释）。
- **关联**：`runner/im_wechat.py` · [微信对齐 devlog](./2026-10-10-wechat-conversation-ux.md)

## Windows 上一键安装 `galley` 命令（用户级 PATH）

- **状态**：暂缓（2026-10-08 Settings 逐页第二批 D5，JC 按推荐：先补台账 + 文案给手动办法）。
- **提出**：2026-05-15 愿景转向时计划过「Windows 写用户级 PATH，不需管理员」（[devlog](./2026-05-15-vision-pivot-to-orchestrator.md)），一直没进台账；2026-10-08 运行环境 / 智能体接入审计 C13 翻出。
- **启动信号**：Windows 用户要求在终端里直接用 `galley`，或社区 #30 一类「CLI 版本滞后 / 找不到命令」在 Windows 复现。
- **方案**：Core 在 Windows 上把 CLI 所在目录写进 `HKCU\Environment` 的 `Path`（用户级，不需管理员），广播 `WM_SETTINGCHANGE`；移除时删同一段。界面与 macOS 同一个「安装 / 移除」按钮。
- **实施要点**：只追加、不重排用户 PATH；已存在同目录时不重复写；Supervisor SOP 不依赖 PATH（05-21 定），这仍是给人的可选出口。现状：Windows 上显示「可以把这个目录加入 PATH」+ CLI 所在目录（2026-10-08 起，此前只有一句「稍后支持」）。
- **关联**：`core/src/path_install.rs` · `SettingsIntegration.tsx` · [第二批 devlog](./2026-10-08-settings-runtime-agent-tab-pass.md)

## 智能体接入：复制 SOP 之后显示「接上了没有」

- **状态**：暂缓（2026-10-08 Settings 逐页第二批 D7，JC 按推荐不做）。
- **提出**：2026-10-08 审计 C5：复制 SOP 后页面只说「可以发给 Agent 了」，新用户无从确认链路通了；JC 库里由 Agent 创建的对话 20 个、CLI 22 个，这页都看不到。
- **启动信号**：有用户说「贴了 SOP 不知道成没成」，或 Supervisor 接入类问题出现第二起。
- **方案**：页内一行「最近 7 天有 N 个对话由 Agent 创建」，数据经 Core 查 `sessions.created_via` / `created_by_supervisor`（GUI 不直读 SQLite，05-21 定）。
- **待定**：只显示计数还是列最近一个对话（可点开）；05-27 定过这页保持稀疏，加一行要守住这条。
- **关联**：`SettingsIntegration.tsx` · [第二批 devlog](./2026-10-08-settings-runtime-agent-tab-pass.md)

## 模型显示名入口太深（Settings → 模型）

- **状态**：暂缓（2026-10-08 Settings 逐页第二段·模型批，JC 按推荐暂缓）。
- **提出**：2026-10-08，模型页代码审计 C5：显示名只能点「我的模型」行进编辑器改；从「可添加模型」点「+ 添加」与新建服务商都写空显示名。JC 实库 7 个模型显示名全等于 id，Composer、命令面板、行标题都显示原始 id。
- **启动信号**：有用户（或 JC）说模型名难认，或 Composer 里的模型名被吐槽像 API 标识符。
- **方案**：「⋯」菜单加「重命名」，行内直接改显示名（不放编辑图标，07-17 裁过「编辑 = 点行」）；或编辑器里把显示名放到模型名之前并给示例 placeholder。
- **实施要点**：10-03 已否「模型名自动美化」（显示名在设置里可改），本条只降低手动改的成本，不做自动推断。
- **关联**：[模型页逐页对表](./2026-10-08-settings-models-tab-pass.md) · `use-provider-model-controller.ts`（`displayName: ""`）· `ModelDraftEditor.tsx`

## Settings 关闭 / 切 tab 时的未保存确认

- **状态**：暂缓（2026-10-08 模型批 D2 裁 A：只修页内覆盖，离开确认不做）。
- **提出**：2026-10-08，模型页审计 C10：切 tab、关设置、按 Esc 时，模型编辑器与服务商编辑器里没保存的内容静默丢失（`Settings.tsx` 条件渲染卸载、Dialog 无 `onEscapeKeyDown` 守卫）。
- **启动信号**：JC 或用户真的因此丢过一次输入（典型是粘贴好的 API Key）。
- **方案**：Settings 外壳在关闭 / 切 tab 前询问当前 tab 是否有脏编辑器（各 tab 注册一个 `isDirty` 回调），有则弹轻确认「放弃未保存的修改？」。
- **待定**：只做模型页还是做成 Settings 通用机制。（「Esc 在输入框内时是否只关编辑器不关设置」2026-10-08 第二批 D3 已定：焦点在输入框时第一下 Esc 只离开输入框，第二下才关设置，全设置页生效。）与「Channels 展开态跨进出 Settings 记忆」同属「组件态离开即丢」，可同批评估。
- **关联**：[模型页逐页对表](./2026-10-08-settings-models-tab-pass.md) · `gui/src/components/screens/settings/Settings.tsx`

---

## 浏览器操作抢走前台

- **状态**：暂缓（2026-10-07 JC 裁决：Chrome 用户基本不受影响，保持现状）。
- **提出**：2026-10-07，JC 提议「锁定前台显示」按钮：智能体每次调用浏览器，浏览器就跳到前台盖住 Galley。
- **启动信号**：任一即可。① JC 在 Vivaldi 里被抢得受不了（这是他的主力浏览器，每次运行第一步新开标签页都会抢）；
  ② 有 Edge / Brave / Arc 或 Windows 用户报同类问题，或用探针测出 Edge 也抢；③ Vivaldi 修了 VB-111875，那就删掉这一条。
- **方案**：实测的抢前台来源是浏览器自身行为，不在 Galley。Chrome 155 新开标签页（前台、后台）都不抢，只有
  `tabs switch` 和 `Page.bringToFront` 抢，而这两个真实用量都是 0 次。Vivaldi 8.2 只要新建标签页或窗口就激活整个应用
  （`focused:false` 也无视），扩展层面修不了。首选方案 B「抢了再还」：在 Galley 自己的常驻桥
  `runner/managed_browser_bridge.py` 里包一层 master 转发，命令期间浏览器变成前台而原先不是，就按 pid 把前台还给原先的
  应用。原型实测浏览器在前台停留 257～334 ms。置顶按钮、改扩展（方案 A）、改用 Chrome、让模型少开标签页都已否决，
  理由见 PRD。
- **实施要点**：用 `lsappinfo` 读前台（约 8 ms）；按 pid 激活，不能按 bundle id，否则 dev 构建会拉起已安装的
  Galley.app；命令发出时就并行盯，进程内激活，把闪烁压到 100 ms 以内（未验证）；命令开始后有键鼠输入就不还；
  `Page.bringToFront` 不还；只在 macOS、内置模式、桥是 master 时生效，外置模式没有变化。
- **待定**：前台还给任何之前在前台的应用（推荐）还是只还给 Galley；闪烁能否接受要在 `tauri dev` 真机看；Edge 和
  Windows 都没测。
- **关联**：`.scratch/browser-focus-steal/PRD.md`（实测表、源码出处、原型数据、探针做法和坑）；
  [浏览器控制](../managed-ga-runtime/browser-control.md)；本台账「Galley 专属浏览器」（默认路径改走专属浏览器后，
  本条只剩选「连我自己的浏览器」的 Vivaldi 用户需要）。

## Galley 使用指南（按需读取，系统提示词方向一第二步）

- **状态**：暂缓（2026-10-06，JC「按建议推进」：先只做常驻部分）。
- **提出**：2026-10-06，系统提示词打磨讨论（`.scratch/runtime-prompt-polish/`）。
- **启动信号**：任一即可。① 真机或社区里出现模型答不上、或答错的「怎么做某事」提问（怎么连渠道、空 API Key 怎么填、
  定时怎么设），而常驻提示词里的功能地图指路不够用；② 预算闸（`static_prompt_stays_within_budget`）卡住一条新条款：
  把 About 的功能地图挪进指南，常驻可再省约 350 tok，指南因此也是减法工具。
- **方案**：一份面向用户的使用指南，单一来源放仓库（README 链接它），打包时带进 App；模型被问到操作细节时去读，
  常驻提示词只加两三行指向它。
- **实施要点**：倾向由 Core 在会话启动时写到内置状态目录里 Galley 自己的子目录（随版本覆盖）。已有先例：IM 启动时
  Core 把 Supervisor SOP 写到 `im/reference/galley-supervisor-sop.md`（`core/src/im_supervisor/mod.rs`
  `materialize_sop_reference`），入口层再把这个路径交给模型。备选 `galley guide`
  CLI 命令（动 Agent API，等 Supervisor 侧有需求）。项目模式下工作目录会变，相对路径要先验证；状态块不能注入路径。
- **待定**：只写中文还是中英两份；发版 SOP 加同步检查还是做漂移门禁。
- **关联**：`.scratch/runtime-prompt-polish/issues/02-on-demand-user-guide.md`；
  [prompt-composition](../managed-ga-runtime/prompt-composition.md) 准入测试第 2 条（能从工具拿到就别写散文）。

## IM 渠道的浏览器步骤带上网站

- **状态**：暂缓（2026-10-04 JC 裁定「先不跟」）。显式代价：GUI 对话里的浏览器步骤显示网站（`db2dde5e`），
  IM 渠道仍是「调用了读取网页」，两边在这一点上暂时不一致。
- **2026-10-21 恢复**：10-20 随 IM 私聊并入主对话撤下，10-21 改向维持 IM 自己养 agent 后恢复原文（[devlog](./2026-10-20-im-a-line-to-the-same-assistant.md)「2026-10-21 改向」）。
- **提出**：2026-10-04，浏览器控制 UX 票 01（`.scratch/browser-control-ux/PRD.md`）。
- **启动信号**：IM 里有人追问 Agent 刚才去了哪个网站；或 IM 显示层因别的需求要接工具结果（届时顺手做）。
- **方案**：在两个渠道已为 ask_user 挂的 `_turn_end_hooks` 里，从 ctx 的 `tool_results` 按轮次记下网站，交给 asyncio
  侧的运行状态（照 ask 事件按 `_current_queue` 打标）；每个聊天维护一份跨轮次的标签页记忆；把
  `gui/src/lib/browser-site.ts` 的解析与查找规则用 Python 重写并配测试。
- **实施要点**：显示层今天拿不到网站——Telegram / Discord 以 `verbose = False` 运行（`tgapp.py:47`、`dcapp.py:26`），
  `agent_loop.py:79-85` 只留 `🛠️ web_scan(参数)` 一行。要重导补丁 0024（tg + `galley_im_display`）、0023（dcapp）
  及叠在其上的 0026（09-30 出过行号偏移），做 replay 逐字节比对。估计半天到一天。
- **待定**：价值取决于 IM 显示设计：「调用了读取网页」只在步骤既无 summary 也无旁白时出现（真实数据 735 个浏览器步骤
  仅 7 个），真要有用需给每条浏览器步骤行挂站名，这是新的 IM 显示设计，需先裁。
- **关联**：[tools-and-approvals 浏览器步骤预览](../design/tools-and-approvals.md)；渠道改动默认全覆盖，「某渠道不跟」须写明代价（即本节状态行）。

## 浏览器插件上架 Chrome 应用商店 / Edge 加载项

- **状态**：暂缓（2026-10-04 JC 裁定）
- **提出**：2026-10-04，浏览器控制 UX 讨论（`.scratch/browser-control-ux/PRD.md`）。设置三步
  （开开发者模式、拖入未打包文件夹、测试）里剩下的摩擦是 Chrome 对未上架扩展的硬限制，UI 层已压到底；
  上架后用户点「添加至 Chrome」即装好、自动更新，是唯一还能大幅省步骤的杠杆。
- **启动信号**：社区或 dogfood 里出现「装插件卡住 / 放弃」的反馈；或开发者模式扩展被 Chrome 进一步限制
  （例如启动时弹停用提示）。
- **方案**：先做一张调研票，只查两件事：商店审核政策对现有权限的态度、改造量；调研结论再决定是否上架。
- **实施要点**：权限很重（`debugger`、`cookies`、`management`、`contentSettings`、`<all_urls>`、
  全页面 MAIN world 的 `disable_dialogs.js`），审核可能卡；`config.js` 里每装一份生成的 TID
  （`core/src/browser_control.rs` `ensure_config_js`）要改成运行时生成；商店自动更新与内置 GA 桥协议
  的版本要对齐管理；外置 GA 用户的兼容（协议同源，07-20 结论）要复核。GA 为 MIT 许可，授权无碍。
- **待定**：商店版与内置文件夹版是否并存（修复入口仍需要文件夹版）。
- **关联**：[managed-ga-runtime/browser-control](../managed-ga-runtime/browser-control.md)、
  [插件去侵入化](./2026-07-20-extension-badge-deintrusive.md)；本台账「Galley 专属浏览器」（默认路径改走专属浏览器后，
  上架只剩「连我自己的浏览器」这条高级路径受益）。

## Galley 专属浏览器

- **状态**：暂缓（2026-10-22 JC：「我也倾向于你的方案，不过现在也不开始做，只记录落文档吧」）。
- **提出**：2026-10-22，JC 提出浏览器控制的三个痛点：真实浏览器被抢占、用户的安全担忧、装扩展要开发者模式且没上架商店；
  设想给 Galley 一个自己的浏览器，预装扩展，用户也能像普通 Chrome 一样使用、登录、手动打开网页给它看。
- **启动信号**：任一即可。① 社区或 dogfood 里出现「装插件卡住 / 放弃」，或「不敢装、怕它看到我所有网站」的反馈；② Chrome
  进一步限制开发者模式扩展；③ JC 在 Vivaldi 里被抢前台、抢标签页烦到要动手（这时优先走本条，而不是「浏览器操作抢走前台」的
  方案 B）；④ 准备面向非技术用户推广，浏览器控制的新手开通率成为瓶颈。
- **方案**：C，不自带浏览器内核，借用户已装的 Chrome / Edge 起专属配置：Core 以 `app.galley` 数据目录下独立的
  `--user-data-dir` 启动它，经 CDP `Extensions.loadUnpacked` 自动装扩展。用户看到一个独立窗口，正常使用和登录，登录态存在
  Galley 这边；Galley 只在这个窗口里干活。三个痛点一起解：使用权天然分开、安全边界变成物理的（「Galley 只看得到 Galley
  浏览器里的东西」）、没有开发者模式。已否：A 在 Galley 窗口里嵌网页视图（WKWebView 不支持 Chrome 扩展，Google 封锁内嵌
  网页视图登录）；B 自带 Chromium（安装包体积数倍于 Galley，安全补丁要自己追，和「轻量」冲突），只留作探针不过时的退路。
- **实施要点**：开工第一步跑四项探针（临时配置目录，约半小时）：Google 账号能否在这种启动方式下手动登录（Google 要求浏览器
  不提供自动化功能，第一优先）；`loadUnpacked` 装的扩展重启后是否还在；有没有命令行参数或自动化提示条；Galley 退出后浏览器
  的去留与 Dock 图标辨识。两个扩展不能连同一个 TMWebDriver master，所以与「连我自己的浏览器」二选一。CDP 走管道不开端口
  （宪法第 2 条）；外置模式零变化；不花 token，上游 GA 没有启动浏览器的代码。
- **待定**：专属浏览器作默认、「连我自己的浏览器」降为高级选项（讨论时的推荐），还是完全替换；卖点从「用你已登录的浏览器」
  改成「Galley 自己的浏览器，你登录一次它一直记得」，邀请横幅与设置页范围说明随之改写；装了 Chrome 和 Edge 时用哪个；
  智能体第一次要用时自动启动，还是只由用户点开。
- **关联**：`.scratch/dedicated-browser/PRD.md`（三种做法对表、代价、探针清单、出处链接）；本台账「浏览器操作抢走前台」
  「浏览器插件上架 Chrome 应用商店 / Edge 加载项」；[浏览器控制](../managed-ga-runtime/browser-control.md)。

## Composer `/` 快路：就地调出常用提示词

- **状态**：暂缓（2026-10-03 JC 选方案 B，＋ 菜单不带快路）
- **提出**：2026-10-03，[Composer ＋ 菜单](./2026-10-03-composer-plus-menu.md)讨论里的方案 C。
- **启动信号**：有用户攒到 3 条以上自定义提示词；或社区要求用键盘调用提示词。本机当时自定义
  提示词 0 条、预设正文 0 次使用，受益者尚不存在。
- **方案**：输入框为空时首字符打 `/`，就地向上弹一个短列表：自定义在前、预设在后，继续打字
  按标题过滤，↑↓ 选、Enter 填入（沿用填空选中），末行「管理提示词…」打开现有 dialog。
  ＋ 菜单「常用提示词…」行尾标等宽的 `/`，像 macOS 菜单标快捷键，菜单本身就教会快捷键。
  运行中列表首行放 `/btw`，给它一个 placeholder 之外的发现面。
- **实施要点**：中文输入法下 `/` 键打出「、」，行首「、」也要触发；只在空草稿触发，所以不需要
  覆盖确认；过滤无结果（如打 `/Users/…`）时列表静默关闭、文字不动；Esc 关闭保留已打的 `/`。
  与 conversation.md「不放 quick prompt 建议」不冲突：那条禁的是空状态常驻铺开，这是召唤式。
- **待定**：`/btw` 是否也认「、btw」——要与 `lib/side-question.ts` 和桥的判定一起改。
- **关联**：[conversation §4.4 ＋ 菜单](../design/conversation.md)。

## 上游 issue：计划模式撞 100 步上限前没有任何提醒

- **状态**：不提交（2026-10-01 JC 定下默认不向上游提 PR / issue，专门提到才发；背景与草稿留作对照）
- **提出**：2026-10-01，[galley#29 跑满步数上限后卡死](./2026-10-01-max-turns-run-end.md)核对时发现。
- **启动信号**：JC 专门提到要提交；或上游自己修了计划模式的警告阈值（升级审计时顺带看一眼 `ga.py` 的 `turn >= 190`）。
- **背景**（已核实，上游 `2538ad9`）：`enter_plan_mode()` 把上限降到 `self.max_turns = 100`（`ga.py:453`），计划模式的「已达上限，必须
  ask_user」警告却要 `turn >= 190` 才触发（`ga.py:593`），第 175 步的 ask_user 提醒又对计划模式跳过（`not _plan`，`ga.py:583`）。结果计划模式
  跑到第 100 步时一句提醒都没有，循环直接退出。是改数字时漏改：`a5aca59`（04-23）上限 100、警告 90，对得上；`df025ab`（06-19）把默认上限
  80→180、计划模式警告挪到 190，计划模式上限没动。
- **方案**：若要提，只提 issue 不提 PR（警告改回 90 还是计划模式上限跟着抬，是上游的取舍）。我们不打补丁：撞上限后卡死已在桥里修好、两种模式都覆盖，
  缺提醒只让计划模式更早停，不再卡住。issue 里**不提** `agent_loop.py:104` 不回调 `MAX_TURNS_EXCEEDED` 的事：上游若按「循环后补一次回调」的
  形状修，同一轮会回调两次，桥要另做去重（见 [GA baseline](../ga-baseline.md) 契约面第 17 条）。
- **issue 草稿**：
  - 标题：`Plan mode: the turn-190 "已达上限" warning can never fire under the 100-turn cap`
  - 正文：

    > `enter_plan_mode()` sets `self.max_turns = 100` (`ga.py:453`), but the plan-mode warning that tells the model to
    > ask_user only fires at `turn >= 190` (`ga.py:593`), and the turn-175 ask_user nudge is skipped in plan mode
    > (`not _plan`, `ga.py:583`). So a plan-mode run reaches the 100-turn cap without any warning and the loop just ends.
    > Looks like drift: `a5aca59` had cap 100 / warning at 90; `df025ab` raised the default cap 80→180 and moved the plan
    > warning to 190, but left the plan cap at 100. Either moving the warning back under the cap (e.g. `turn >= 90`) or
    > raising the plan cap would fix it.
- **关联**：[galley#29](https://github.com/wangjc683/galley/issues/29)；本台账「单次运行步数上限可配」一节。

---

## 上游 PR：`auto_make_url` 认 `v1beta` 这类版本段（删 0027）

- **状态**：不提交（2026-10-01 JC 定下默认不向上游提 PR，专门提到才发；草稿留作上游修好时删 `0027` 的对照）
- **提出**：2026-10-01，[自定义入口](./2026-10-01-custom-provider-entry.md)（galley#32）核对时发现。
- **启动信号**：JC 专门提到要提交；或上游自己改了 `auto_make_url`（升级审计对照契约面第 18 条，上游修好就删 `0027`）。外置 GA 用户报 `v1beta` 端点连不上时，先给 `$` 钉死地址的绕法。
- **方案**：向 `lsdefine/GenericAgent` 提 PR，只改 `llmcore.py` `auto_make_url` 的一行正则（同 `0027`）。合入后按宪法第 1 条删 `0027`，
  `runner/tests/test_managed_ga_url.py` 应保持绿（它校验的是规则，不是补丁）。
- **PR 草稿**：
  - 标题：`fix(llmcore): treat /v1beta-style path segments as API versions in auto_make_url`
  - 正文：

    > `auto_make_url` only recognises all-digit version segments (`re.search(r'/v\d+(/|$)', b)`, `llmcore.py:137`), so
    > Gemini's documented OpenAI-compatible base `https://generativelanguage.googleapis.com/v1beta/openai/` becomes
    > `…/v1beta/openai/v1/chat/completions` and every request 404s. Allowing an alphanumeric qualifier after the digits —
    > `/v\d+[a-z0-9]*(/|$)` — accepts `v1beta`, `v1beta1`, `v2alpha` while still rejecting `/vendor`, `/video`, `/v1.5`
    > and hosts like `v1.relay.example`. Plain `/v1`, the no-version `/v1/` insertion, `$` pinning and full-path bases are
    > unchanged.
- **关联**：`managed-ga/patches/0027-managed-url-version-qualifier.patch`；[GA baseline](../ga-baseline.md) 契约面第 18 条。

---

## 上游 PR：`abort()` 只在 Windows 上 `_real_close`（删 0025）

- **状态**：暂缓（2026-09-30 JC 过目后裁「暂时不进行上游 PR」；草稿保留）
- **提出**：2026-09-30，[macOS 停止打不断等响应头的请求](./2026-09-30-macos-abort-wake.md)。
- **启动信号**：JC 决定提交；外置 GA 用户反馈「停止要等很久才生效」（外置模式只能靠上游修）；或上游自己改了 `abort()` 的
  socket 段（升级审计时对照 `0025` 台账行，上游修好就删 `0025`）。
- **方案**：向 `lsdefine/GenericAgent` 提 PR，只改 `agentmain.py` `abort()` 的两行（同 `0025`）。合入后按宪法第 1 条删 `0025`
  与 `runner/tests/test_managed_ga_abort.py`，外置 GA 用户随上游一起受益。
- **PR 草稿**：
  - 标题：`fix(abort): only force-close the in-flight socket on Windows`
  - 正文：

    > On macOS, `abort()` often fails to wake a request that is still waiting for response headers: the `_real_close()`
    > right after `shutdown(SHUT_RDWR)` races the shutdown's wake-up, and the blocked `recv()` stays in `poll()` until
    > `read_timeout`. Repro: a local HTTPS server that accepts the request and never answers, abort at 2 s — the current
    > code hung until the read timeout in 6 of 13 trials; shutdown alone woke 22 of 22 at once. Mid-stream stalls wake
    > either way. `3d62523` notes that on Windows only `_real_close()` wakes the recv, so this keeps it there:
    > `if os.name == 'nt':` around the `_real_close()` / `close()` fallback.
- **关联**：`managed-ga/patches/0025-managed-abort-wakes-on-macos.patch`；[GA baseline](../ga-baseline.md) `1b6442f` 审计节的更正。

---

## 上游 PR：让 GA `run()` 消费 `put_task(images=)`（删 0008 + attach wrapper）

- **状态**：暂存（2026-09-18 外置 GA 图片输入落地时拆出）
- **提出**：2026-09-18，[外置 GA 图片输入 devlog](./2026-09-18-external-ga-image-input.md)。
- **启动信号**：上游维护者对引擎层多模态表态；或上游 desktop_bridge 放弃 `_patch_chat_for_images` 改由 `run()` 处理；或 0008 / wrapper 在某次基线升级里 rebase 出真冲突。
- **方案**：把补丁 0008 的消费端（`run()` 读 `task["images"]` → `image_content_blocks` → `agent_runner_loop(initial_user_content=)`，外加 `NativeToolClient.chat` 的空白过滤放过非文本块）作为上游 PR 提交。合入后按 Rule 1「上游有了就删补丁」同时删 0008 和 `GaSession.arm_image_delivery`。
- **实施要点**：wrapper 已对「消息里已有图片块」跳过，所以上游先合、Galley 后删的过渡期不会双份；删除时同步收 `imagesSupported` 的判据（改为按上游能力探测或恒 `true`）。
- **待定**：上游是否愿意在引擎层接多模态——它自家桌面前端选的是前端包 `ask`，暗示未必。
- **关联**：[managed 补丁清单 0008](../../managed-ga/patches/manifest.md) · [GA baseline 契约面第 11 项](../ga-baseline.md#contract-surface)。

---

## 用户消息排印微调（气泡之后的独立重审）

- **状态**：暂存（2026-09-17 气泡定案时拆出，明确不与形态捆绑）
- **提出**：2026-08-21 质感实验后记「后续方向」的第二条；2026-09-17 用户消息改为杏沙气泡（[devlog](./2026-09-17-user-message-bubble.md)）后单独立项。
- **启动信号**：气泡形态跑一段时间后仍觉得用户消息「平」；或真机里觉得 Inter medium + 容器是双重信号、字重显得多余。
- **背景**：用户消息与 agent 正文字号 / 行高 / 墨色相同，只差 Inter 500 vs Newsreader 400 与底色。08-06 前底色承担了全部区分职能，所以排印统一（2026-06-20）成立；容器加上后字这条通道可能已经不需要再出力。
- **方案**：字重 `medium → regular`，或字距放松一档；二选一，真机切换器对比。注意 08-06 Round 1 输掉的「访谈体」是**去掉底色**的极端方案，不能用来否定「保留容器 + 微调排印」；但这条明确会碰 2026-06-20 的排印统一裁决，**必须作为重审来做**。
- **不推荐**：调 `my-5` 的竖向节奏——那是全局问题，不值得为单个组件动。
- **已关闭的前置项**：「落笔」入场动效（2026-08-21 提出，笔触从左向右展开）——它的隐喻是「被划过的句子」，2026-09-17 用户消息改气泡后隐喻不再成立，方案随之作废；若日后想给用户消息补入场动效，应从「块级软淡入与 agent 侧对称」重新起草，不要复活笔触展开。
- **关联**：[气泡定案](./2026-09-17-user-message-bubble.md) · [质感实验](./2026-08-21-user-message-texture-experiment.md) · [高亮笔重设计](./2026-08-06-user-message-highlighter.md)。

---

## 长任务续跑：Goal 移除后若要回来（原 Goal「用满时间」use_budget）

- **状态**：暂存，2026-10-13 改写（Goal 整体移除，见 [devlog](./2026-10-13-remove-goal.md)；原 `use_budget`
  方案依附的 Core 引擎已删，「同一引擎加 `goals.mode`」不再成立）。
- **提出**：2026-09-16，[goal v2 devlog](./2026-09-16-goal-v2-codex-shape.md) 后记四（JC 的主场景是「离桌扔长任务 /
  把 quota 用满」）；2026-10-13 随 Goal 移除改写为回归路径。
- **启动信号**：一个月内 ≥3 次「长任务中途手动发『继续』」（`workbench.db` 的 user 行可查），或社区有人要回
  Goal / 「把时间用满」。
- **方案（按序，前一步够用就停）**：
  1. 改 GA 每次 `put_task` 的 180 步上限（`managed-ga/code/agentmain.py:218`，一行内置补丁）；
  2. 接上游 `reflect/goal_mode.py` + `memory/goal_mode_sop.md`（已是「用满预算」语义；但它起独立进程，
     要先解决 Galley 看得见、停得掉）；
  3. 最后才考虑在 Core 自建续跑循环。v2 实现见 git 历史（移除前最后版本 `e1125549`），`use_budget` 的
     审计式续跑协议见 goal v2 devlog 后记四。
- **背景**（2026-10-13 核实）：本机 5 个 v2 goal 续跑 0 次；478 个用户任务单任务最多 52 步，≥80 步 0 个。
- **关联**：[remove-goal devlog](./2026-10-13-remove-goal.md)、`.scratch/remove-goal/PRD.md`、
  [goal v2 devlog](./2026-09-16-goal-v2-codex-shape.md)。

---

## 过程区密度：更大的刀（单行合并 / rail 重塑 / 横向利用率）

- **状态**：暂存（2026-08-23 密度 pass 探讨中裁决：A 刀落地，B/C/横向案暂缓——见 [密度 pass](./2026-08-23-step-density-pass.md)）
- **提出**：2026-08-23，JC 指多步 run 过程区空间利用率低、层级应低于 final answer。当日已落的 A 刀：run 内 `mt-3` 两档间距 + 裸步合并（详见 devlog）。以下是当时评估过、刻意没动的三把更大的刀。
- **B. 全面单行合并**（每步 marker+pill 合一行）：**2026-09-16 真机试过并否决**——`flex-wrap` 变体（summary 装得下时 pill 跟在句尾、装不下折行，一行步 31）落地一轮（`0270ff56`，已 revert），JC：「太密集后，单个步骤的阅读体验其实变得更差了」。否决理由记入 [步号淡一档 devlog](./2026-09-16-step-marker-recede-and-reference-audit.md) 后记九：密度与阅读体验在同一套静态排版里无解，空间问题改按状态分流（完成即折、live 封顶另议）。**不再作为密度手段重提**；若将来重开，只能以「阅读形态本身更好」为由，且要同时解决同行两个披露 caret 的问题。
  - **2026-10-16 以另一形态重开**（[工作台对话 PRD](../../.scratch/workbench-conversation/PRD.md) 裁决 6、票 02，[devlog](./2026-10-16-workbench-conversation-grammar.md)）：工作台折叠头后面换成助手过程卡片的一行一步。不是本条的 B：B 把工具标签挤进 summary 那一行；那里一行只有一句话与对象，工具标签收进点开，整行是唯一的点击目标、没有 caret，单步点开后是原来的阅读形态；该形态 JC 已在助手里真机验收（主对话票 22）。重开理由是两个空间的语法统一，不是密度。本条 B 的否决对「标签与 summary 挤在一行」照旧有效。
- **C. timeline / rail 重塑**（左侧竖轨连接步骤的日志形态）：
  - 启动信号：过程区的角色从「瞬态过程日志」变成「需要长期回看的执行轨迹」（例如需要跨 run 审计的长任务）。在 settled run 会折进 RunFoldHeader 的现状下，为瞬态区域做重皮肤不值。
- **横向利用率 / 列宽**：inline pill 右对齐 mono 工具名在宽窗口下拉出大片死区；conversation 列没有 max-width，是否该有 measure 是独立且更大的排印题（会牵动正文行长）。
  - 启动信号：JC 在宽屏 dogfood 中对行长或死区有实感；或做阅读排印批次时一并。
- **关联**：[密度 pass](./2026-08-23-step-density-pass.md)；「第 1 步前缀收敛」（B 的规范近亲；2026-10-16 随工作台对话 PRD 裁决 7 撤下，见 [devlog](./2026-10-16-workbench-conversation-grammar.md)）；`conversation.md` §4.3 间距演化史第 6 条。

---

## Ollama / 本地端点预设（Settings → Models 预设表）

- **状态**：暂存（2026-08-31 无鉴权 Provider 落地时 JC 裁决本轮不加；2026-10-01「自定义」卡上线后降为纯便利项）
- **提出**：2026-08-31，[无鉴权 Provider](./2026-08-31-no-auth-provider-empty-apikey.md) 的连带候选——预设表至今没有任何本地条目。
- **启动信号**：本地端点用户反馈「配置 Ollama 要摸索」（自定义卡之后仍有）；或社区再出现 ollama / 本地模型相关 issue。
- **背景**：无鉴权能力（`authKind: "none"`、key 可留空）已落地。2026-10-01 起（[自定义入口](./2026-10-01-custom-provider-entry.md)，galley#32）本地服务走「自定义」：选 OpenAI 兼容、填 `http://localhost:11434/v1`、key 留空、模型从列表选，显示名称自动取 `localhost:11434`。具名预设省下的只是一次地址输入。
- **方案**：`managed-model-presets.ts` 加 ollama 条目：apibase 预填 `http://localhost:11434/v1`、协议 openai、key 留空。要一并定的：显示名 / 图标；`recommendedModel` 给什么（本地模型名因人而异，可能留空走「读取模型列表」）；是否顺带覆盖 LM Studio（`localhost:1234/v1`）等近亲。
- **待定**：一张卡还是「本地端点」一类；`apiKeyPlaceholder` 文案（应显式写「无需填写」）。
- **关联**：[无鉴权 Provider devlog](./2026-08-31-no-auth-provider-empty-apikey.md)；下一节「`api_key_header` 的 GUI 入口」（同为该面的暂缓项，启动时可同批评估）。

---

## `api_key_header` 的 GUI 入口（Anthropic 协议中转的鉴权头覆盖）

- **状态**：暂存（2026-08-21 GA baseline 升级时发现，本次有意不做）
- **提出**：2026-08-21，`f06d550` -> `30b24ad` 外审读到上游 `c9cb4b5`（社区 PR #751）。
- **启动信号**：有用户（或 JC 自己）配置「说 Anthropic `/v1/messages` 协议、但 key 不带 `sk-ant-` 前缀」的中转端点时撞 401。（原有的「或下一次动高级面板时顺手」2026-10-08 删掉：模型批必然动高级面板，字面触发但与本条「等真实信号更划算」矛盾；JC 确认库里两个 0 模型的 Anthropic 中转是弃用而非撞 401。）
- **背景**：上游给 `NativeClaudeSession` 加了可选 cfg 键 `api_key_header`，取值 `auto`（默认，旧的 `sk-ant-` 前缀启发式）/ `x-api-key` / `bearer`。那类中转（上游举例 opencode.ai）只认 `x-api-key`，而 `auto` 对非 `sk-ant-` key 发 `Bearer`，结果 401 Missing API key。**Galley 的 runner 侧已经通了**：`managed_runtime.managed_model_config_from_env` 是 `cfg.update(advanced)`，模型的 `advancedOptions` 原样透传进 GA session cfg，不需要任何代码改动。差的只是入口——`AdvancedModelOptions` 编辑的是一组策展字段（`max_retries` / `read_timeout` 等），这个键不在其中，用户没法敲进去。
- **方案**：两条路。① 在高级面板加一个三选一（`auto` / `x-api-key` / `bearer`），只对 `protocol === "anthropic"` 显示；② 不加字段，只在某个中转预设的 `recommendedAdvancedOptions` 里带上——成本更低但只覆盖预设过的端点。
- **待定**：这是不是一个真需求。目前**没有任何用户报告**撞过这个 401，纯属读上游 diff 读出来的能力。①的成本是给一个策展面板加一个多数人用不到的字段，与「一屏配好模型」的产品方向有张力。等真实信号比现在动手更划算。
- **第二信号（2026-09-08）**：issue #26 提出「高级参数键值编辑区」作为退路。但它要的是策展字段（推理强度 / fast），不是自由 KV；推理强度当日已提为一级字段解决，本条状态不变。
- **关联**：[GA 上游升级 f06d550 -> 30b24ad](./2026-08-21-ga-upstream-upgrade-f06d550-to-30b24ad.md) · `runner/managed_runtime.py` `managed_model_config_from_env` · `gui/src/components/screens/settings/models/AdvancedModelOptions.tsx`

---

## OpenAI `service_tier`（fast / priority 档）进高级面板

- **状态**：暂存（2026-09-08 JC 裁决「fast 先不做」）
- **提出**：2026-09-08，issue #26 第二步「fast 开关，更快但更贵」。
- **启动信号**：有用户明确说在用 priority tier；或上游给 Claude 加 fast（`speed`）时一并做。
- **背景**：内核 `_enum('service_tier', {auto, default, priority, flex})` 已支持，只在 OpenAI payload 发送；GUI 没暴露，属于「有能力没入口」。Claude 的 fast 内核根本没有，按管理运行时纪律等上游，不自己 patch llmcore。
- **方案**：高级面板加三选一 `auto` / `priority` / `flex`，只对 `protocol === "openai"` 显示，文案标注「更快、计费更高」。不进 Composer。
- **待定**：ChatGPT 订阅后端（内核的 `codex_backend`）是否透传该字段，做之前查 `_openai_stream` 的 codex 分支。
- **关联**：[issue #26 model config UX](./2026-09-08-issue-26-model-config-ux.md) · `gui/src/components/screens/settings/models/AdvancedModelOptions.tsx`

## 会话内查找（Ctrl+F）

- **状态**：已做（2026-10-15，主聊天 PRD 裁决 77、票 28）。做法与下面的「方案」不同：没做查找条，⌘F（Ctrl+F）打开 ⌘K 面板、带「在这个对话里」的范围，走 Core 的全文搜索（分页历史也搜得到），结果带日期，回车按现成的定位跳过去；对话的顶栏菜单也有「查找聊天记录」。查找条落选的理由见裁决 77 第 1 条。遗留：Windows 上 `preventDefault` 能否挡住 WebView2 自带的查找栏，留给 Windows 冒烟。下面保留原记录。
- **原状态**：暂存（2026-09-08 JC 裁决先不做）
- **提出**：2026-09-08，issue #27「如果能顺带支持当前会话内查找，长会话里定位更方便」。
- **启动信号**：有用户在跨会话定位落地后仍抱怨长会话内找不到；或 JC 自己在几千字回答里回找时觉得 ⌥↑↓ 不够。
- **背景**：Tauri 的 webview 不带浏览器那条原生查找栏（WKWebView / WebView2 都没有），Ctrl+F 现在是空操作。跨会话的 FTS 命中已经能定位到消息（见 issue #27 devlog），会话内查找是同一根锚线上的另一种入口。
- **方案**：Composer 上方或对话区右上角一条紧凑查找条，输入即在当前 `turns` 的文本里做子串匹配（不走 SQLite，数据都在内存），命中计数 + 上一个/下一个，定位复用 `USER_MSG_ANCHOR_TOP_PX` 锚线与 `message-locate-flash` 洗染；Esc 关闭。Markdown 渲染后的 DOM 高亮（`<mark>`）是第二步，第一步先做块级定位。
- **待定**：快捷键归属——Ctrl/⌘F 在 Composer 聚焦时是否让给文本框；rail 的 question index 与查找条是否会在右缘打架。
- **关联**：[issue #27 devlog](./2026-09-08-issue-27-message-search-locate.md) · `gui/src/hooks/useStickyScroll.ts` 的 locate 效果 · `docs/design/conversation.md` rail 一节

## `shadow-*` utility 在 dark 下静默使用 light 阴影值

- **状态**：暂存（2026-08-21 落选中行抬升时撞见，JC 尚未裁决是否开工）
- **提出**：2026-08-21，给 `--shadow-selected` 建 token 后核对产物时发现。
- **启动信号**：dogfood 中觉得 dark 下卡片 / dialog / 浮层「贴在背景上、浮不起来」或层次感弱；或下一次要动 dark 阴影时。
- **背景**：Tailwind v4 为 `@theme` 里的 `--shadow-*` 生成 utility 时**把值内联**进 `--tw-shadow`，不生成 `var()` 引用。产物实测：`.shadow-card{--tw-shadow:0 1px 2px var(--tw-shadow-color,#1f1b170a)}` —— 写死的是 light 的 `rgba(31,27,23,0.04)`。于是 `html[data-theme="dark"]` 块里那一整批 `--shadow-*` 重定义**对直写 utility 的调用点完全不生效**，dark 下拿到的是 light 的淡暖黑（4%）而不是设计意图的纯黑（18%–42%）。
- **同族先例（2026-09-08）**：`--opacity-*` token 写成无单位小数、被 `color-mix` 整条丢弃，77 处填充静默透明，已修（改成百分比）。这条 shadow 的病因不同（内联值）但症状同类：token 建了、产物里不生效、没人看得出来。修本条时照 09-08 的办法先在产物里 grep 验证。
- **影响面**（2026-08-21 实测）：**52 处直写受影响**（dialog / card / menu / tooltip 为主），**36 处用 `shadow-[var(--shadow-*)]` 写法不受影响**（button、composer、MessageUser 等——07-16 native-feel 那轮显然已经知道这个坑）。
- **方案**：把 52 处直写统一改成 `shadow-[var(--shadow-*)]` 形式。机械替换，可脚本化；风险在于改完 dark 阴影会**第一次真正生效**，观感会明显变化（变重），需要连带复核 dark 下各浮层的阴影值是否还合适——很可能当年调 dark 阴影值时就是照着「看不见」调的。
- **待定**：是否顺带把 `--shadow-*` 改成不进 `@theme`、只做普通 CSS 变量（那样 utility 就不存在，强制所有调用点走 var 写法，杜绝重演）。
- **关联**：[选中行三通道](./2026-08-21-sidebar-selected-row-three-channels.md) 落地时发现；`docs/design/foundations.md` shadow token 段。

---

## IM 里的下一步建议按钮化（next-suggestion 的 IM 消费端）

- **状态**：暂缓（漏出 bug 已由反方向修复：mandate 移出 IM 提示词）
- **2026-10-21 恢复**：10-20 随 IM 私聊并入主对话撤下，10-21 改向维持 IM 自己养 agent 后恢复原文（[devlog](./2026-10-20-im-a-line-to-the-same-assistant.md)「2026-10-21 改向」）。
- **提出**：2026-08-13（Discord dogfood 发现 `<next-suggestion>` 裸漏进
  所有 IM 渠道回复，裁决记录见
  [当日 devlog](./2026-08-13-im-suggestion-leak.md)）
- **启动信号**：JC 在 IM 里实际产生「这条建议我想一键发出去」的实感，
  或用户反馈希望 IM 端也有下一步引导。
- **方案**：建议语义在 IM 端其实成立且各平台有现成基建——飞书卡片可
  渲染成可点按钮（0009 卡片补丁）、Telegram 有 `InlineKeyboardButton`
  （tgapp 已 import）、Discord 退化为文末「💡 下一步」行或 View 按钮。
  点击 = 把建议文本当用户消息发送。
- **实施要点**：**与已落地的根修互斥**——根修把 suggestion mandate 从
  IM 提示词组合里拿掉了（`compose_im_runtime_prompt`），做本项需有条件
  地带回 mandate（仅对接了消费端的渠道），并撤销 0019 的对应剥离；
  每平台要接按钮回调，是 feature 量级不是修补量级。
- **待定**：是否只在部分渠道做（飞书卡片体验最顺）；建议长度与按钮
  文案的截断策略。
- **关联**：workbench 幽灵文字功能（`fa6241ac`，2026-08-04）；
  0019 补丁的移除条件已指向本项。
- **注**（2026-09-30）：Discord 的 ask_user 按钮（补丁 `0023`）落地后，
  Discord 端的按钮基建（`discord.ui.View`、owner 校验、点选即发送）已现成，
  本项在 Discord 上的实施量降为「带回 mandate + 渲染一排建议按钮」。

---

## Discord 原生斜杠命令（app commands）

- **状态**：暂缓（2026-09-30 同上裁决）
- **2026-10-21 恢复**：10-20 随 IM 私聊并入主对话撤下，10-21 改向维持 IM 自己养 agent 后恢复原文（[devlog](./2026-10-20-im-a-line-to-the-same-assistant.md)「2026-10-21 改向」）。Discord 的「冻结只修 bug」（10-20 裁决 5）是在并入的前提下定的，同日 IM 打磨讨论已解冻（[IM 打磨 PRD](../../.scratch/im-polish/PRD.md) 裁决 2），私信照旧关着。
- **提出**：2026-09-30，Discord 对话体验讨论方向 D。
- **启动信号**：JC 或用户开始在 Discord 里频繁用命令（`discord.log` 的
  `command=True` 占比明显上升）；或有人反馈「不知道有哪些命令」。当时 7 条消息
  全部 `command=False`。
- **信号记录**：2026-09-30 真机验收当天，JC 以为 Discord 里没有 `/new`——敲 `/`
  时 Discord 弹出的是它自己的斜杠命令面板，没注册原生命令就列不出我们的文本
  命令。解释后 JC 满意（直接当普通消息发即可），未要求开工；算半个「不知道有
  哪些命令」信号，再出现一次即可考虑启动。
- **信号记录**（2026-09-30，同日）：状态消息上的停止按钮去掉后（`.scratch/discord-ux/issues/05`），文本 `/stop`
  成了 Discord 里唯一的停止入口，本项的可发现性价值随之上升。
- **方案**：用 discord.py `app_commands.CommandTree` 注册 `/stop` `/status` `/new`
  `/llm` `/btw` `/review` `/help`，输入 `/` 时有原生补全；文本命令保留兼容。
- **实施要点**：命令树同步时机（启动时 guild 级同步最快生效）；邀请链接是否需要
  `applications.commands` scope 要先核实，setup guide 文案随之改；DiscordCard
  命令参考表同步。
- **关联**：`frontends/dcapp.py` `handle_command`；[§9 Channels](../design/overlays-and-settings.md)。

---

## IM 渠道外壳多语言（跟随 Galley 界面语言）

- **状态**：暂缓（2026-09-30 JC 裁决：Discord / Telegram 对话体验打磨收尾后最后做）
- **提出**：2026-09-30，讨论 Discord 停止按钮时 JC 指出按钮是中文、英语用户会很奇怪；读码确认状态消息、回答小字、
  提问回显、报告 footer 整层外壳都是中文，模型回复却跟随用户语言。
- **启动信号**：Discord / Telegram 打磨告一段落（外壳文字定稿）；或更早出现英语用户对 IM 外壳的反馈。
- **方案**：Discord / Telegram 只认配对绑定的 owner，频道对面就是 Galley 桌面主人，所以跟随 Galley 界面语言：Core 启动渠道时
  注入解析后的语言，Galley 自己写的外壳（`0023`、`0024`、reporter）做中英两张表放进 `galley_im_display.py`。否决按每条消息
  检测语言（混用时外壳会跳）。
- **实施要点**：前置是把 `galley_im_display.py` 拆成独立补丁排到 `0023` 前面、dcapp 改用它（后续补丁改编号）；「跟随系统」
  目前只在 GUI 解析（`gui/src/lib/language.ts`），Core 要补一次。
- **待定**：上游原有中文（`/help`、Telegram 菜单、飞书 / 微信）覆盖与否；改语言时是否自动重启 Channels。
- **关联**：`.scratch/im-chrome-i18n/PRD.md`（详细清单与依据）；[Discord 对齐](./2026-09-30-discord-conversation-ux.md)。

---

## IM 渠道的图片输入：相册合并与视觉输入

- **状态**：暂缓（2026-09-30 Telegram 对话体验对齐桌面端时裁决不做，范围 D）
- **2026-10-21 恢复**：10-20 并进 IM 并入 PRD 的票 04，10-21 改向维持 IM 自己养 agent、该 PRD 搁置后恢复原文（[devlog](./2026-10-20-im-a-line-to-the-same-assistant.md)「2026-10-21 改向」）。
- **提出**：2026-09-30，`.scratch/telegram-ux/PRD.md` 问题 6。
- **现状**：Telegram 每张图单独起一个任务，提示词「[TIPS] 收到图片temp/…，请等待下一步指令」，
  模型也会回一轮；相册 N 张 = N 轮 N 条回答（`tgapp.py` `handle_photo`）。图片只以路径进提示词，
  不是视觉输入；Discord 同样只给路径（`dcapp.py` `_download_attachments`）。
- **启动信号**：JC 或用户在 IM 里实际发图（`telegram.log` / `discord.log` 出现收图记录），
  或抱怨「发了几张图它回了几遍」「它看不见我发的图」。
- **方案**：①相册按 `media_group_id` 攒一小段时间（约 1 秒）合成一个任务；②managed runtime 的
  `run()` 已消费 `put_task(images=)`（补丁 `0008`），图片路径直接传 `images=` 走视觉输入，
  caption 当正文；③只有图没有文字时不再让模型「等待下一步指令」空回一轮——候选做法是收图后
  只回一句确认、等下一条文字一起入队。
- **待定**：③的交互（静默等文字 vs 回一句确认）；非图片文件是否同样合并。
- **关联**：[上游 PR：让 GA `run()` 消费 `put_task(images=)`](#上游-pr让-ga-run-消费-put_taskimages删-0008--attach-wrapper)；
  补丁 `0014` / `0024`（Telegram）、`0018` / `0023`（Discord）。

---

## 消息级 Retry（丢弃失败轮重跑，galley#14）

- **状态**：暂存（Continue 按钮已彻底否决，不在此列）
- **提出**：2026-08-10（社区 issue #14 triage，见
  [issue 分批落地](./2026-08-10-community-issues-triage-and-settings-polish.md)）
- **启动信号**：用户反馈里反复出现「bridge 硬死后要手动重贴原请求」——
  打字近似替代只在轮次完成场景成立；硬失败时 history replay 会丢弃末尾
  无回复的 user 行，重开会话的 agent 上下文里没有那个失败的请求。
- **方案**：路线 A（重启 + replay 复用）：新 Core 命令删
  `turn_index >= N` 的消息行（Rule 5，含 FTS 同步与 turnCount 重算）→
  GUI 失效 replay 缓存 → bridge 重启 → 现有 `load_history` 注回截断
  历史 → 原文+附件走正常 submit 重发（user 行删除重发，非保留特殊重发）。
  已否路线 B（runner 原地 truncate `backend.history`）：GA history 是
  thinking/tool_use/工具定义混排 blocks，轮边界簿记脆弱，且最需要重试
  的场景恰是 bridge 状态不可信的场景。
- **实施要点**：入口 = MessageActions 第三个 chip（仅最后一条 agent 回复
  显示、运行中禁用）+ 错误气泡上的重试入口（硬失败场景无 agent 回复可
  挂）；v1 不进 CLI/Agent API。
- **待定**：错误气泡入口形态；CLI/Supervisor 发起的轮次是否允许 GUI 重试。
- **关联**：不撤销已执行工具的世界副作用，文案交代即可。

---

## OpenAI 接口的回复被截断时没有提示

- **状态**：暂存
- **提出**：2026-10-16（JC 发现主对话一条回复不完整；查明是引擎收到的就是半截，JC：「如果不是 Galley 问题，那先不改」）
- **启动信号**：再遇到一次没有任何提示的半截回复。
- **现状**：内置引擎走 OpenAI `chat_completions` 时，解析流式回复（`managed-ga/code/llmcore.py` `_parse_openai_sse`）不看 `finish_reason`，也不检查流是否正常结束：撞长度上限、被内容过滤截掉、连接被提前关掉，都当成写完。`responses` 接口只在一个字都没收到时才标截断。上游对 Anthropic 接口是处理的（同文件：流中途断、撞 max_tokens、拒答都在回复末尾追加一行提示）。2026-10-16 那条（输出 225 个 token，排除撞上限）具体原因查不到：引擎没记 `finish_reason`。9 月以来 369 条最终回复里只此一条。
- **方案**：内置引擎补丁，OpenAI 两种接口照上游 Anthropic 那套：`length` / `content_filter` / 流未正常结束时在回复末尾追加一行带原因的提示，并把 `finish_reason` 写进模型响应日志。加进补丁栈，写明上游补上就删。外置 GA 照旧。
- **待定**：提示文案（照上游的英文还是走 Galley 文案规范）；不做自动续写（多套一层，被过滤截掉的再请求多半照样截）。
- **关联**：[telegram-details devlog](./2026-10-16-telegram-details.md)。

---

## 滚动时浮动日期（主对话往回翻）

- **状态**：暂存
- **提出**：2026-10-16（向 Telegram 学对话细节，[PRD](../../.scratch/telegram-details/PRD.md) 裁决 7，JC：「按推荐」）
- **启动信号**：往回翻主对话时，要找到时间条才知道翻到了哪天。
- **现状**：时间只在断点画成两条消息之间居中的一行（会话第一条、距上一条超过 60 分钟、跨日、Supervisor 来源），跨日本身就是断点，没有独立的日期条，滚动时也没有吸顶的日期。主对话是一条没有尽头的对话，几个月后往回翻会失去「这是哪天」；但 2026-10-16 主对话只有 8 轮，没有内容可翻，也没法真机比。
- **方案**：照 Telegram Web A（`src/components/middle/hooks/useStickyDates.ts`，GPL-3.0，只学做法）：滚动时把当前所在那天的日期以小胶囊吸在对话区顶部，停手 1000ms 后 0.3s 淡出；首次打开不出现（第一次滚动后才启用）。文案用 `message-time.ts` 已有的日期格式（今天 / 昨天 / 9月21日 / 跨年带年份）。
- **实施要点**：只主对话要（工作台会话短、有问题轨）；减少动态效果时不淡入淡出、直接显隐；不和顶栏、问题轨抢位置。
- **待定**：工作台要不要跟；胶囊样式（照时间条的字号与墨色，还是加一层底）。
- **关联**：[主对话 PRD](../../.scratch/main-chat/PRD.md) 裁决 66 第 3 条（日期条落成居中时间）；`conversation.md:89`（悬停时间被否，与本条不同：本条只在滚动时出现）。

---

## 轮间距层级（answer → 下一问 的留白小于对内间距）

- **状态**：观察中
- **提出**：2026-08-06（折叠 run 垂直节奏讨论的连带观察，见
  [run-fold header spacing](./2026-08-06-run-fold-header-spacing.md)）
- **启动信号**：dogfood 中觉得相邻问答对之间「挤」、边界不清。
- **现状**（2026-10-16 按[工作台对话](../../.scratch/workbench-conversation/PRD.md)票 01、02
  之后的代码重量，见下「量法」）：**已不倒挂**。轮与轮之间（上一回答 → 下一条你的消息）
  50px：回答的行动条隐藏时照旧占 30px（`mt-1.5` + 24px chip），再加你这一行的
  `mt-5` 20px；隔着时间断点是 60.5px（回答 → 时间条 30、时间条 10.5、时间条 →
  气泡 20）。对内（你的消息 → 折叠头）30px：气泡下面悬停复制那一行挂在 `mb-7.5`
  里，就是这段间距；你的消息 → 一步就答完的回答正文也是 30px；折叠头 → 回答
  10px。所以是「对间 50 / 60.5 > 对内 30 > 头到回答 10」，邻近性层级是对的。
  原来写的「轮间 20px（用户块 `my-5`）< 对内 24px」是 2026-08-06 的值；工作台票 01
  改前量的轮间已经是 50px（票 01 Comments），对内的 24px 由票 01 改成 30px。
- **量法**：Chrome 临时 harness（不进仓库），在工作台的滚动容器类名（`px-8 py-6`、
  `@container/conversation`、760 栏）里渲染真实的 `Conversation`，主区 1220 宽、标准
  字号、浅色；四轮对话（两步运行、两步运行、隔 3 小时的一步回答、两步运行），用
  `getBoundingClientRect` 量元素盒：回答最后一个段落盒的底、时间条盒、气泡盒、折叠头
  整行盒（32px 高）、回答第一个段落盒的顶。四轮的值一致，取整到 0.1px。
- **方案**（倒挂时的旧方案，现在不需要）：把 `MessageUser` 外层 wrapper 的上边距升到
  `mt-7` / `mt-8`，使轮间 > 对内。
- **待定**：这一条可以关掉（层级已对），由 JC 定。dogfood 里嫌轮间 50px 太松或太紧
  是另一个问题。（原「`GoalCommissionMarker` 前的间距是否同步」随 2026-10-13 Goal 移除作废。）
- **关联**：[run-fold header spacing](./2026-08-06-run-fold-header-spacing.md)、
  [user message highlighter](./2026-08-06-user-message-highlighter.md)。

---

## 已有对话 cwd live-sync（IPC `set_cwd`）

- **状态**：暂存
- **提出**：2026-05-13
- **背景**：Project 的 rootPath / cwd 绑定已于 2026-05-14 回收（见 [rootPath 回收](./2026-05-14-project-rootpath-rollback-ga-memory-coupling.md)）。DB column 与类型字段保留作 forward-compat —— 将来若重启 cwd 绑定，正解是这条 live-sync，而不是让用户重启 app。
- **启动信号**：beta / 公测有人反馈「改完项目路径要重启 app 才生效」是高频痛点。
- **方案**：bridge 加 IPC 命令 `set_cwd { path }` → 收到后调 `os.chdir(path)`（OS 级 API，真改进程 cwd）→ 之后 GA 的 `file_read` / `code_run` 相对路径解析与 subprocess 继承自动用新路径，无需重 spawn。desktop 端在保存 project rootPath 时，自动给该 project 下所有 alive bridge 派发 `set_cwd`。约 200-300 行。
- **实施要点**：bridge `set_cwd` handler + `ipc.py` dataclass + `ipc-protocol.md` 文档 + bridge 测试 + desktop `updateProject` 里自动派发。
- **待定**：GA 内部工具是否 cache 启动时 cwd（需 audit `ga.py`）；`os.chdir` 失败（路径不存在 / 无权限）的错误回滚链路；派发时机应在 save 按下时而非每次输入。
- **关联**：[Project rootPath 回收](./2026-05-14-project-rootpath-rollback-ga-memory-coupling.md)。原讨论已并入本节（原 `2026-05-13-project-cwd-copy-and-live-sync-deferred` entry 已收编删除）。

---

## workbench_bridge.py 类分解（Bridge god-class 拆分）

- **状态**：暂存
- **提出**：2026-07-23（Rust/GUI 大文件拆分两轮收尾时的排查结论，见 [拆分两轮 devlog](./2026-07-23-rust-and-gui-large-file-split-rounds.md)）
- **启动信号**：下次需要在 bridge 里做实质性新功能（新命令域 / 新遥测），或它再次成为理解/review 瓶颈。
- **背景**：`runner/workbench_bridge.py` 1828 行，`Bridge` 一个类 50 个方法，混了 GA setup、managed 注入、usage/遥测、workspace 激活、审批 handler（已于 2026-10-05 移除）、事件发射、turn-end 序列化、命令分发、stdio 循环。是全仓最该拆的文件，但性质与 Rust 那五个不同：类方法共享 `self` 状态，是**类分解**不是自由函数搬家。
- **方案**：按域委托出协作对象（telemetry / command-dispatch / emit），`Bridge` 保留编排。不要一次全拆，按"下次要动哪个域就先拆哪个域"推进。
- **实施要点**：动手前对照 CLAUDE.md Rule 1 —— 该文件正是 attach 模式集成点（`GenericAgentHandler` 子类、`_turn_end_hooks`、history 注入）的实现处，拆分不得改变 GA 边界行为；`tests/test_workbench_bridge.py`（1017 行）是护航基础，先跑通再动。
- **待定**：协作对象之间共享 `SessionState` 的方式（传引用 vs 事件）；`_FenceFilter` 等已独立的类是否先行搬到单独模块作为低风险第一步。
- **关联**：[Rust/GUI 大文件拆分两轮](./2026-07-23-rust-and-gui-large-file-split-rounds.md)。

---

## 架构审查第二轮剩余候选（GaSession gate / quick wins）

- **状态**:暂存
- **提出**:2026-07-28(架构审查第二轮收尾,见 [审查 devlog](./2026-07-28-architecture-review-deepening-round.md);四个 Strong 候选已落地,以下为 Worth exploring 档)
- **启动信号**:下次动到对应模块时顺手做,或再跑一轮架构审查时按新鲜度重估。
- **候选 5**（hive Goal controller helpers 收窄）随 2026-09-16 goal v2 退役 `cli/src/goal/` 一并消失。
- **候选 6**（useComposerGoal 出参收成 goalView）随 2026-10-13 Goal 移除一并消失。
- **候选 7 · GaSession seam grep gate**:seam 本身干净(bridge 11 处调用零 reach-in),但"re-audit 面 = 一个文件"的承诺无 CI 强制,且 `managed_im_supervisor.py:346` 的 `_galley_im_prompt_installed` 写入是结构性旁路(该路径无 Bridge)。做法:grep gate(同 `check-supervisor-sop-drift.mjs` 文风)+ docstring 补旁路,或让 supervisor 路径也构造 `GaSession(agent)`。
- **Quick wins**:`hasRunningSessions` 收成 messages store selector(三处重推导:App.tsx / MainHeaderHost / app-update.ts);`lib/ipc/ga-output-cleaning.ts` 补测试(纯函数、流式热路径、零覆盖);`socket_listener/` 的 `use super::*` 互 glob 改具名 re-export(照 `chatgpt_siwc/mod.rs`);`spawn_args_for_session_new` 7 参改 `&SessionBrief`+2;runtime store 补 slice-merge shape 守卫(照 `sessions.shape.test.ts`)。
- **关联**:[架构审查第二轮](./2026-07-28-architecture-review-deepening-round.md) · ADR-0002。

---

## 手动重新生成标题（regenerate title）

- **状态**：暂存（2026-08-04 JC 裁决先不加）
- **提出**：2026-08-04，自动标题（migration 038 / `generate_title`）发运后的讨论。
- **启动信号**：dogfood 中「想重新生成标题」的冲动实际出现——JC 自己留意频次，出现即证据。
- **背景**：自动标题是一次性（CAS 后 `title_source='auto'` 不再有资格）。隐藏出口已存在：**清空标题** 会重置回 seed，下次 `run_complete` 自动重生成（rename 空串路径的副产品，无 UI 提示）。
- **方案**：不是一个按钮，是三个决策——① 上下文取什么（重生成动机多为话题漂移，应取**最近**交换而非首轮，是另一套上下文策略）；② 锁定语义旁路（`user` 态被显式点按时该被绕过，一次性 CAS 要开洞）；③ 入口放哪（会话行右键菜单 / 标题栏悬停）。runner 的 `generate_title` 通路原样复用。
- **待定**：见方案三点。
- **关联**：[自动标题 + 下一步建议](./2026-08-04-auto-title-and-next-suggestion.md)、`.scratch/session-auto-title/PRD.md`。

---

## 多建议 chips（next-suggestion 升级）

- **状态**：暂存
- **提出**：2026-08-04（ghost text 设计时即预留，准入判据讨论中确认排队）。
- **启动信号**：ghost text dogfood 证明建议**采纳率**可观——它是同一假设的加注，不是新假设，证据先行。
- **方案**：A2 标签频道白送——managed prompt 允许模型输出 2-3 条备选（标签格式扩展或多标签），`turn_end.nextSuggestion` 扩为数组（增量字段），渲染复用 `ask_user` candidates 的 chips 组件；主建议仍走 ghost text + →，备选点击填入。
- **待定**：多条时 ghost 与 chips 的并存形态；标签合同是多标签还是分隔符。
- **关联**：[自动标题 + 下一步建议](./2026-08-04-auto-title-and-next-suggestion.md)、`.scratch/composer-next-suggestion/PRD.md`。

---

## ask_user candidates 补全（prompt 调优）

- **状态**：暂存
- **提出**：2026-08-04 准入判据讨论，唯二过筛的候选之一。
- **启动信号**：dogfood 观察到 GA 提问常不带候选、用户要打字回答本可点选的问题。
- **方案**：`RUNTIME_PROMPT_STATIC` 加一条「调用 ask_user 提问时尽量附带 candidates」——零成本纯 prompt 调优，现有 chips 渲染（`AskUserBubble`）立刻变勤快。managed 独占（attach 不碰 GA prompt）。
- **待定**：措辞对不同模型的遵从率；candidates 数量上限建议。
- **关联**：[自动标题 + 下一步建议](./2026-08-04-auto-title-and-next-suggestion.md)。

---

## ask_user 候选项携带说明（option-desc，`{label, desc}` / tooltip）

- **状态**：取消（2026-09-14 JC 裁决，数据依据见
  [devlog](./2026-09-14-ask-user-option-desc-cancelled.md)；PRD 与三张票置
  `wontfix` 留在 [.scratch/ask-user-option-desc](../../.scratch/ask-user-option-desc/PRD.md)）
- **提出**：2026-08-11，社区 [galley#21](https://github.com/wangjc683/galley/issues/21)。
- **为何不做**：本机四个月 55 条真实候选项里零次出现「标签短到看不出后果」；
  模型自己把后果写进标签，短标签均为无需解释的词。同日 D2 的 row / list
  排布已解决候选侧真实出现过的问题。
- **启动信号**：dogfood 或社区再出现「裸短标签且用户因此追问一轮」的具体
  实例（要有截图或会话记录，不是描述）；或上游 GA 自己给 candidates 加了
  说明字段（那时只需 GUI 消费，无需补丁）。
- **若重启**：先读 devlog 里的「PRD 过期点」——形状倾向并行参数
  `candidate_descs` 而非对象；补丁点在 `assets/tools_schema*.json`；schema
  先于视觉实测；有 desc 直接归 list + 小字副行。
- **待定**：#21 的回帖（JC 2026-09-14 决定暂不回）。

---

## Session Workspace（会话产出的落点与可达性）

- **状态**：暂缓实现（2026-08-13 JC 裁决：设计定案，先不动手）
- **提出**：2026-08-13（读 deepseek-harness 的产物行实现 → 三轮实测 →
  设计定案，全文在
  [.scratch/session-workspace/PRD.md](../../.scratch/session-workspace/PRD.md)）
- **启动信号**：JC 再次遇到「找不到刚才生成的那份东西」并认为该动手；或
  Artifacts PRD 重启（本项是它点名的前置）；或
  `managed-ga-state/temp` 文件数从当前 **62** 继续增长到「打开工作区」也无法
  自救的程度。
- **方案**：核心事实是**非项目会话的产出全部落在
  `~/Library/Application Support/.../managed-ga-state/temp` 这一个平面目录**
  （实测 62 个文件，跨度 6–8 月，与 234 个引擎日志同级）。改为每 session 一个
  用户可见目录，命名 `YYYY-MM-DD-<短ID>`（标题在 session 开始时还不存在，
  且 Windows 非法字符 / MAX_PATH / 保留名三条都反对标题命名）。机制走
  **「软链 + `handler.cwd`」而非改进程 cwd**，配一个 managed patch 改
  `get_global_memory()` 写死的两句提示词；attach 模式降级为「只建软链 + 提示词
  引导」。
- **2026-09-17 部分落地**：「工具调用的绝对路径在 bridge 现场解析、存进
  `messages.tool_calls`」这一条已单独实现（`toolCalls[].resolvedPath`，只覆盖
  `file_write` / `file_patch`），并接了 GUI 的写入步骤入口与正文按名解析，见
  [written-file references](./2026-09-17-written-file-references.md)。本项其余
  部分（每 session 目录、软链 + `handler.cwd`、`code_run` 产物）仍暂缓。
- **实施要点**：`workspace_path` 存 `sessions` 表首次定死（照 v1 Goal 的
  `goals.workspace_path`，代码已随 Goal 退役，做法见 git 历史），改设置只影响新 session；空目录 session 结束时回收，
  **不写标记文件**（会废掉回收）；工具调用的绝对路径**在 bridge 现场解析**
  （事后推导会在项目模式和 agent 自行 chdir 时猜错，而错的绝对路径比相对路径
  更坏），存进 `messages.tool_calls` 而**不复活 `tool_events`**（那是审批审计表，
  线上 0 行是因为跑 YOLO，改用它要付语义扩张 + 写入路径搬家 + 写放大三笔）。
- **待定**：**根的选址与 artifacts PRD 冲突**——本轮定的是 `~/Documents/Galley`，
  但 artifacts PRD 早已因 macOS TCC（文稿/桌面/下载在保护区）选了 `~/Galley`，
  该理由本轮没被提出，需复裁且会影响其余全部路径决策；另有短 ID 取值、空目录
  回收触发点、IM 渠道 session 是否供给工作区等五条，见 PRD。
- **关联**：[artifacts PRD](../../.scratch/artifacts/PRD.md) 定案第 1 条点名的
  前置就是本项，本项落地即满足那一条。已否并留痕：**轮尾「本轮产物」清单行**
  （dsh 形态——我们 `file_write`/`file_patch` 只 16 次而实际产出 62 个，
  绝大多数走 `code_run`，一份漏掉大半的清单比没有清单更坏）、正文路径提及做成
  可点链接（要往 Persona 加提示词，且 dsh 那套成立的前提是提示词与渲染器同包
  同生死）、检测 agent 自行 `chdir` 后的产出（同一条理由：检测不全比不检测更坏）。

---

## Artifacts（会话交付物：scratch 工作区 + API + GUI 面板）

- **状态**：搁置（2026-08-07 裁决，核心设计 1–4 已定案；2026-08-12 补了一个
  可独立发运的最小切片与路径事实校正）
- **提出**：2026-08-07（OpenWorker 两轮精读后成 PRD）
- **启动信号**：主 feature ——「拿到交付清单而不是聊天记录」的需求实际出现
  （supervisor 侧要结构化产出，或用户反复抱怨找不到 agent 写的文件）。
  最小切片 ——**一个可测判据**：展开若干真实会话的 `file_patch` / `file_write`
  tool callout，若 `args.path` 绝对路径占多数，则「打开 / 在 Finder 中显示」
  按钮值得单做；若相对占多数，说明真问题是产物落点，直接回主 PRD。
- **方案**：全文在 [.scratch/artifacts/PRD.md](../../.scratch/artifacts/PRD.md)
  （含 OpenWorker 参考笔记、安全红线、5 个未决问题、UX 走查发现 A/B）。
  核心洞察：**artifact 不是存储系统，是工作区上的一层透镜**——不建库、
  不做版本、文件系统是唯一真相源。
- **实施要点**：scratch 工作区机制必须先行（没有确定落点，面板只能扫用户项目
  目录，信噪比崩坏）；HTML 预览的 iframe **禁止 `allow-same-origin`**
  （OpenWorker 在此有真实漏洞）；目录遍历先剪后走（engineering-workflow I12
  的 macOS TCC 教训）。
- **待定**：scratch base 终值与目录布局；哪些会话显示面板；`artifact:` 契约
  注入位置（倾向 Persona）；API 命名与字段。面板形态**不再是待定项**：
  2026-09-08 起右侧阅读面板已存在（Markdown / 文件预览 + Git 审阅），
  PRD 里「Galley 无右栏」的前提失效，重启时直接沿用该面板。
- **关联**：PRD §6.3 的「Artifacts 一等公民」非目标仍然成立——本 feature 若启动
  需先改那条。已否：按扩展名过滤（`.md` 在 coding 仓库里绝大多数是源码，
  区分不了「仓库文档」和「交付物」）、在 Galley 内重造 app 选择器
  （Finder 右键「打开方式」更好）、GUI 侧自行解析相对路径
  （基准在 GA 内部，等于重新实现 GA 逻辑）。

---

## LiveDots 剩余两站点的工作指示语言统一

- **状态**：暂缓（2026-08-12 shimmer 裁决时的自觉遗留；同日 RunElapsedHud
  已出列——启动信号当日触发，三点删除 + 时长改会话方言，见 entry 后记）
- **提出**：2026-08-12（[thinking 计时器与 shimmer 裁决](./2026-08-12-thinking-timer-and-shimmer-verdict.md)）
- **启动信号**：dogfood 中实际感到「两种 working 语言并存」刺眼——比如
  thinking 行扫光与 ToolCallout 三点在同屏同时可见时读作两个产品；或任一
  站点因别的原因重做时顺带评估。
- **方案**：thinking 行已改状态文字扫光（§2.7 唯一豁免），RunElapsedHud
  已改「计数器即活性」的无动效形态，LiveDots 仍服役于 ToolCallout
  （运行中工具）；goal 运行尾标已随 Goal 退役（2026-10-13 整体移除）。暂不统一的论证：工具级忙碌不是「LLM
  正在思考」，三点作为通用 working 指示语义成立；且 §2.7 豁免边界写明
  「一视图至多一处 shimmer」，全量迁移会直接违反刚立的边界。
- **实施要点**：若启动，方向不是「都改 shimmer」而是逐站点问「这里的
  liveness 是否已有别的承担者」——RunElapsedHud 的先例是删除而非替换
  （ToolCallout 行内已有 spinner + 计数器，三点同样可能直接删）。
- **待定**：「一视图至多一处」边界与多站点迁移的相容方案。
- **关联**：[foundations.md §2.7](../design/foundations.md) 豁免条款；
  `LiveIndicators.tsx`。

---

## 已暂停渠道的折叠头「启动」按钮

- **状态**：暂缓（自动展开收窄的已知代价，先观察实感）
- **提出**：2026-08-13（[自动展开谓词收窄](./2026-08-13-channels-auto-expand-predicate.md)）
- **启动信号**：dogfood 或用户反馈里出现「重启一个渠道还要先点开卡片」的
  实感。频率低就不动。
- **方案**：`stopped` 不再自动展开后，「启动」按钮只在卡体内，重启已配置
  渠道多一次点击。补救是在折叠头右侧 actions 区（`ChannelActionsMenu` 所在
  位置）给 `stopped` 状态加一个 ghost「启动」，那块地方本就常驻控件。
- **实施要点**：四张卡的启动动作签名不同（WeChat 走 `SettingsIM` 的
  `runAction`，另外三张走卡内 `run("connect")`），补按钮要么各自接、要么先
  把启动动作提到 `ChannelCard` 的 header 插槽上；别为此把状态推导再复杂化。
- **待定**：只给 `stopped` 加，还是 `not_connected` 也给（后者点了没用——
  凭证还没填，会把人送进一个立刻报错的动作）。倾向只给 `stopped`。
- **关联**：改模型后的批量重启已有 `staleConfig` 横幅那条路，本项只覆盖
  单渠道手动暂停后的重启。

---

## Channels 展开态跨进出 Settings 记忆

- **状态**：暂缓
- **提出**：2026-08-13（[自动展开谓词收窄](./2026-08-13-channels-auto-expand-predicate.md)）
- **启动信号**：配置渠道时实际被打断（去 Models 查个模型再回来）并感到
  「又要重点一次」。
- **方案**：`expandedOverride` 是组件态，离开 Settings 即丢。自动展开变稀疏
  后，配到一半切走再回来要重新点开。照 `FeishuCard` 的 `cachedFeishuConfig`
  模块级缓存的路子，记住手动展开过的渠道。
- **实施要点**：只记**手动**展开（`expandedOverride !== null`），别把自动
  展开的结果写进缓存——否则一次报错会让那张卡此后一直展开，等于把刚删掉的
  「永久展开」从后门放回来。
- **待定**：进程内缓存够不够，还是要落 UI 偏好（倾向进程内，跟 config 缓存
  同级，重启归零是可接受的）。
- **关联**：`SettingsIM.tsx` 四张卡各自持有 `expandedOverride`。

---

## 原生 About 面板改为通往 Settings → About（品牌门面收口）

- **状态**：暂缓
- **提出**：2026-08-14（JC 贴出 About 截图问要不要优化；同场排查澄清了两件
  事：dev 模式下那个蓝色文件夹是**裸二进制没有 bundle**、不是缺陷，装好的
  App 图标正常；`website` / `website_label` 两行死配置已当场删除）
- **启动信号**：JC 真的要动品牌门面时——这条和「sidebar wordmark 可交互」
  是同一件事的两面，别单独启动。或者用户反馈找不到版本/更新入口。
- **方案**：把 `app_menu.rs` 里的 `PredefinedMenuItem::about` 换成自定义
  `MenuItemBuilder`，点击直接开 Settings → About（复用现有的 settings
  菜单项路径）。VS Code / Figma 都是自定义 About 窗口，惯例成本可接受。
- **实施要点**：落差不在面板本身而在**它是个死胡同**——`SettingsAbout.tsx`
  有出身故事（「Why Galley?」彩蛋）、版本 + 发布日期 colophon、更新控件、
  内核 baseline 日期，而走 macOS 惯例路径的人落在一张三行卡片上，没有出口
  通向那些东西。改完是「一扇门通向好房间」，不是「两个房间各自为政」。
  注意 `app_menu.rs` 里「Check for Updates…」是 About 下面的独立项，收口后
  它和 Settings → About 里的更新控件会重复，要一并想。
- **待定**：原生面板本身其实是对的（正确、符合惯例、图标正常），换掉它换来
  的是内容深度、付出的是 macOS 惯例——这笔交易划不划算没定论；「Version
  0.4.7 (0.4.7)」的口吃**不在本项范围**（AppKit 从 `CFBundleVersion` 填括号，
  Tauri 把它设成和版本号同值，要消掉得引入真实 build number，不值）。
- **关联**：`core/src/app_menu.rs`（六个字段的注释已写明 macOS 只认哪些）；
  `gui/src/components/screens/settings/SettingsAbout.tsx`；sidebar wordmark
  交互讨论（2026-08-14，未落 devlog——被 About 话题打断，结论止于「拖拽把手
  是硬约束、题词先例判死了开新 session、彩蛋是唯一误触无害的选项」）；
  2026-10-03 侧栏顶部讨论里的「落款」方向（字标移到底部「已归档」行，离开顶行即
  不再是拖窗把手，可做成通往 Settings → About 的门）是本条启动时的现成候选，当时
  未采纳，见 [书眉 devlog](./2026-10-03-sidebar-header-masthead.md)。

## 定时任务当天补跑触发失败（scheduler catch-up fire 无会话产生）

- **状态**：大概率已修（`6124cc16`，2026-10-07），未用真实定时任务确认
- **提出**：2026-09-09，README 截图 v2 实拍中两次观察到
- **2026-10-07 更新**：v0.6.1 回归里查出 GUI hydrate 的 `delete_empty_new_sessions` 只看「默认标题 +
  `turn_count = 0`」，会删掉首轮还没跑完的 `session.new` 会话。补跑走的正是 `session.new`（标题「新对话」），
  调度器在 setup 阶段启动、首个 tick 立即补跑，页面随后 hydrate 就把它删了；`last_run_session_id` 是
  `ON DELETE SET NULL`，于是留下「`last_fired_at` 已写、`last_run_session_id` 为 NULL」，与 09-09 的现象一致。
  下面「方案」怀疑的派发失败因此不太可能。`6124cc16` 改为只删一条消息都没有的会话
  （[devlog](./2026-10-07-core-owned-turn-persistence.md)）。确认办法不变：按下面的复现路径种一条任务，启动后看
  补跑会话是否留下、`last_run_session_id` 是否有值。
- **启动信号**：任何用户报告「上次触发失败」；或下次碰 `core/src/scheduler.rs`
- **方案**：复现路径已知——种一条 `last_fired_at` 早于今天时段的每日任务，
  启动 dev，Core 在一个 tick 内发起补跑，`last_fired_at` 被盖成触发时刻、
  `last_run_session_id` 为 NULL。要看 `dispatch_line_with` 返回的错误：怀疑
  方向是 dev 环境下 `session.new` 因 `llm_name` 为空 / 无默认模型被拒，或
  runner 启动失败。
- **实施要点**：先在 `scheduler.rs` 的失败分支把响应体打进日志，再决定是
  修派发参数还是修错误提示（面板只说「失败」，用户无从下手）。
- **待定**：是否只在 dev 复现（截图库是 onboarding 后立即种入，模型配置齐全，
  倾向不是环境问题）。
- **关联**：`docs/devlog/2026-09-09-screenshot-set-v2-plan.md`；
  `scripts/seed-screenshots.py` 的 `minutes_since_local`。

## 长工具输出在右侧阅读面板全文阅读

- **状态**：暂缓（2026-09-09 JC 裁决：右侧面板三个候选中，可读文件预览与
  Git 基线选择本轮做，本项先挂）
- **提出**：2026-09-09，右侧面板「还能装什么」讨论的第三候选
- **启动信号**：JC 真机复核 Agent 工作时遇到「过程区里一段 `code_run` 输出
  或整页 fetch 结果只看得到头尾、想看全却看不到」；或用户报告同类抱怨。
- **方案**：`ToolCallout` 加「在阅读面板打开」，把该次工具调用的完整输出
  （已在内存的 turn 数据，零后端改动）送进右栏，用 `PlainFileLines` 同一
  寄存器全文、可滚动、软换行显示；header 标题为工具名 + 步号，副标题为
  会话标题。与文件预览同一宿主（`LocalFileWorkspace`），会话级生命周期。
- **实施要点**：过程区现有折叠 + 尾部截断（#22 那轮定的）保持不动，本项
  只加出口不改过程区密度；输出超大时沿用 2 MiB 上限的截断说明。
- **待定**：入口放在 callout 的 hover 动作还是折叠头右侧；是否顺带支持
  `file_read` 结果（与文件预览重叠，倾向不做）。
- **关联**：[2026-09-09 阅读面板扩展 devlog](./2026-09-09-reading-panel-files-and-git-baseline.md)
  （候选比较与裁决）；`gui/src/components/conversation/ToolCallout.tsx`。

---

## 重试等待期间的 GUI 反馈

- **状态**：暂存（2026-09-14 开放 `max_retry_after` 时浮出，有意不并入）
- **提出**：2026-09-14，[高级配置开放 max_retry_after](./2026-09-14-max-retry-after-advanced-option.md) 的余量项。
- **启动信号**：有人把重试等待上限调大后抱怨「像卡死」；或无人值守（定时任务 / Supervisor）任务因可重试错误直接死掉的投诉——后者同时是「Retry-After 超上限时睡到上限再重试」这条语义改动的启动信号，两条一起做。
- **背景**：内核 `_stream_with_retry` 退避期间只 `print` 一行 `[LLM Retry] HTTP 524, retry in 90.0s (1/4)`，core / runner / gui 无人消费，用户看到的是转圈。停止按钮能打断这段睡眠（`agentmain.py` 把 `should_stop` 接进了可中断 sleep），所以不是死锁，是静默等待。上限默认 60 秒时静默最长 60 秒；开放旋钮后用户可以把它调到几分钟，静默随之变长。
- **方案**：runner 把 `[LLM Retry]` 行识别成结构化事件（或给内核加一个 emit-only 的 retry hook，走 0007 一类的补丁），经 IPC 以纯增量事件上报，GUI 在会话状态条 / 步序列里显示「服务商要求稍后重试，Ns 后重发（可停止）」。协议纯增量。
- **实施要点**：只做 emit，不改重试决策；IM 端不必显示。
- **待定**：靠解析 stdout 行还是加补丁 hook——前者零补丁但脆，后者多一个补丁。
- **关联**：`managed-ga/code/llmcore.py` `_stream_with_retry` · `runner/workbench_bridge.py` · [高级配置开放 max_retry_after](./2026-09-14-max-retry-after-advanced-option.md)。

---

## Windows 低 DPR 下 chrome 文字字重 / 字号变体

- **状态**：暂存（2026-09-16，JC 裁「先只做图标加粗与字体栈」）
- **提出**：2026-09-16，Windows 社区截图反馈「图标和文字发虚」。图标归因 Phosphor thin 0.5px 在 1x 屏半像素（已修：`@media (max-resolution: 1.5dppx)` 加 stroke，见 foundations §2.3）；字体栈显式加 Microsoft YaHei。文字部分：chrome 13px / 400 的雅黑在 Windows 灰度抗锯齿下笔画细边缘发灰，`-webkit-font-smoothing` 在 Windows 无效，现有「苹方 auto 补偿」机制在 Windows 不存在。
- **启动信号**：图标修复发版后社区仍反馈文字发虚；或 JC 在 Windows 真机 100% / 125% 下自己觉得侧栏标签比对照软件轻一档。
- **方案**：`html[data-platform="windows"]` 作用域内做变体实测：A 字重 400 → 500；B 13 → 14px；C 两者。连同 chrome 最小档（10–11.5px）在雅黑 1x 下的可读性一起看。临时变体切换器进 tauri dev（Windows 机）。
- **待定**：是否按 dppx 而非平台挂钩（与图标修法同构，但字重的成因是雅黑不是 DPR，平台更准）。
- **关联**：foundations §2.3（图标低 DPR 兜底）、§2.2 字重表；`globals.css` Windows 作用域块。

---

## session 行 hover 置顶按钮

- **状态**：暂存（2026-09-16 探讨，JC 裁「先把置顶提到 ⋯ 菜单第一项」）
- **提出**：2026-09-16，JC 贴外部 ConversationList 参考组件（行右侧 hover 出现图钉、已置顶常驻实心图钉、`[@media(hover:hover)]` 下才隐藏、`aria-pressed`）问是否引入。
- **不做的理由**：①ground truth：JC 本机 111 个 session 置顶 0 个，功能尚未挣到提升位；②置顶是每 session 一生一两次的动作，正是 ⋯ / 右键菜单为之设计的「对象级低频操作」；③行右侧 hover 位已被 ⋯ 占用，两个精密目标并排、标题 hover 让位 56px，行的 hover 态变吵；④已置顶行常驻图钉与 PINNED 桶头重复（「·1 是噪音」同款）。参考组件的模式成立是因为它的行只有 pin 一个动作。
- **已做的廉价提升**：置顶提到 ⋯ / 右键菜单首项（两入口共享同一组件，排序一致）。
- **启动信号**：JC 开始实际使用置顶（DB `pinned=1` 出现且持续）且仍觉得两次点击是摩擦；或社区反馈找不到置顶。
- **方案**：若启动，先加 ⌘K 命令「置顶 / 取消置顶当前会话」（零视觉成本）；再议行内按钮。行内按钮若做，借参考组件三处写法：`[@media(hover:hover)]` 下才隐藏、`aria-pressed`、已置顶态不随 hover 消失；位置需与 ⋯ 协调（并排或折进 ⋯ 左侧），标题让位量随之调整。
- **关联**：`layout-and-chrome.md` Sidebar 行动作条款（line ~146）与 Session Row 三通道清单；`SidebarSessionMenuItems.tsx`。

## 工具输出面板的 `<pre>` 与正文代码块统一质感

- **状态**：暂缓
- **提出**：2026-09-18，[代码块参考件对表改版](./2026-09-18-code-block-reference-audit.md) 自查第 7 条
- **启动信号**：JC 真机觉得工具结果面板与正文代码块「两种质感」刺眼；或字号档调大后工具面板不跟随被投诉
- **方案**：`ToolCallout` / `MessageAgent` 里的 `<pre>`（审批面板已随审批于 2026-10-05 移除） 目前是 bg-app + `border-line` + 写死 12.5px / 1.6；正文代码块是 code-surface + hairline + `--conversation-code-size` / `leading-code`。要么把工具面板改挂同一组 token（保留其 200px 上限与 ink-soft 的「日志」寄存器），要么明确记录「日志 vs 代码」是有意的两种寄存器
- **待定**：当初是否有意区分——07-05 审计没记

---

## 模型高级配置的页签变体（「默认 | 仅此模型」在模型编辑器内切换）

- **状态**：暂存（2026-09-22 JC 裁先做「链接 + 设为所有模型的默认」）
- **提出**：2026-09-22，JC 提「每个模型的高级配置里一个开关：开=调全局、关=只调这一个模型」，讨论中判为表单模式开关而改形。
- **启动信号**：JC 或用户真机用下来觉得从模型编辑器跳到页尾「默认高级配置」太重；或「设为所有模型的默认」被投诉「改完才能设、不能先选范围」。
- **背景**：无状态版本已落地：模型面板折叠头「跟随默认 / N 项覆盖」+ 底部「全部跟随默认」「设为所有模型的默认」「编辑默认配置」。09-22 裁的「折叠头链接」实现时掉了，2026-10-08 模型批补上，落成底部动作（折叠头本身是按钮，嵌链接是嵌套交互），点了滚到页尾并展开默认卡。页签版在同一折叠头放「默认 | 仅此模型」两个页签，各显示各自记录的值，字段所属一目了然、不会跳变；比开关安全（页签是可见的框不是隐藏状态）。
- **方案**：折叠头分段控件；「默认」页签渲染 `ModelDefaultsPanel` 的字段集（点击即存），「仅此模型」页签渲染现有 `ModelAdvancedOptionsPanel` 内容（随编辑器保存）。代价是一个折叠里两种保存语义，要在页签上写清。
- **待定**：一个折叠两种保存节奏是否可接受；否则要把默认页签也改成随编辑器保存并追踪两条记录的脏状态。
- **关联**：[模型高级配置分层](./2026-09-22-layered-model-advanced-config.md) · `gui/src/components/screens/settings/models/AdvancedModelOptions.tsx`

---

## 预设升级刷新模型的 preset 层

- **状态**：暂存（2026-09-22 分层落地时有意不做）
- **提出**：2026-09-22，[模型高级配置分层](./2026-09-22-layered-model-advanced-config.md) 给 `managed_models.preset_options` 留了缝。
- **启动信号**：下一次改动任何预设的 `advancedOptions`（比如再调 `DEFAULT_CONTEXT_WIN` 或给某中转加 `api_key_header`），或有用户把服务商 URL 改到不再匹配预设后投诉行为不对。
- **背景**：preset 层在创建时由 GUI 从预设写入，之后不动；预设更新只惠及新建的模型，老模型仍是冻结副本（027 / 029 两次 SQL 回填就是这个问题的历史形态）。分层后用户覆盖已单独存放，刷新 preset 层不会再碰用户的值，安全性比以前高得多。
- **方案**：GUI 加载模型列表时按 `managedModelProviderPresetForRecord` 匹配预设，与记录的 `presetOptions` 不同则通过 `save_managed_model` 只带 `presetOptions` 重写（Core「省略即保留」已支持只改这一层）；或 Core 起动时做，但预设知识在 GUI，需要先搬一份 JSON 给两边共读。
- **待定**：服务商 URL 改到自定义端点后 preset 层该保留旧预设还是退回协议默认。
- **关联**：`gui/src/lib/managed-model-presets.ts` · `core/src/managed_model_layers.rs`

---

## 运行中会话热更模型配置（默认配置改动下一轮生效）

- **状态**：暂存（2026-09-22 JC 裁 A「保持简洁」：只在默认配置节提示「改动对新对话生效」）
- **提出**：2026-09-22，[模型高级配置分层](./2026-09-22-layered-model-advanced-config.md) 落地后 JC 提出讨论。
- **启动信号**：有用户改了默认配置后在旧会话里继续聊、发现没生效来问；或 JC 自己在真机上被「设一次全局却要新开会话」绊到。
- **背景**（已核实，别重查）：
  - 「运行中」= 活着的 bridge 集合：每个打开过的会话保留一个 bridge，走 LRU 上限回收（`bridge-slice.ts` `_enforceLRUCap`），归档 / 删除 / 挤出 / 退出才关，多数闲着。
  - 内核自带热更：`llmcore` 在 `load_llm_sessions`（`__init__` / `next_llm` / `list_llms` 调用）检查 `_mykey_path` 的 mtime，变了就用 `_load_mykeys()` 重建全部 client、保留当前历史、按名字重选。内置模式的 marker 路径就是 `managed-models.json`，Core 每次保存都重写（`sync_managed_model_config`），mtime 确实变、内核确实重建，但 `runner/managed_runtime.py` `install_managed_mykey_loader` 装的加载器读的是 spawn 时的环境变量 `GALLEY_MANAGED_MODEL_CONFIG`，重建出来仍是旧配置。**差的是配置源，不是机制。**
  - **2026-10-18 更新**（GA 基线 `5205f40`，[devlog](./2026-10-18-ga-upstream-upgrade-f308ee7-to-5205f40.md)）：上面这条是旧机制。上游把加载挪进 `llmcore.mykeys_store`（`a5979ea`），`run()` 每个任务首尾也会调 `load_llm_sessions`（`2ba5529`）；内置加载器改为替换 `mykeys_store._load`、不报告文件，进程内永不重载，Core 重写 `managed-models.json` 不再触发重建。另外，旧机制下的那次重建会丢掉 bridge 启动时装在 backend 上的内置提示词（`extra_sys_prompt`），这是 v0.6.x 的潜伏问题，已随新加载器消失。
  - 五个网络键与 `reasoning_effort` 都是内核每次请求才读的实例属性（`self.read_timeout` 等），可以像 `set_reasoning_effort` 那样直接写活的 backend；方言键与新增模型必须重建。
  - 现有口径：模型保存后 toast「新对话立即使用最新配置」，Channels 有「重启 Channels」CTA。
- **方案**（B，下一轮生效）：Core 每次重写配置时向所有活着的 bridge 发一条新 IPC 命令（纯增量，载荷 = spawn 时那份模型 JSON 去掉凭证；不在凭证白名单里的模型 runner 过滤掉），runner 换配置源、把 `llmcore._mykey_mtime` 清零，在下一次空闲回合边界（与 `set_llm` 同一 idle 门）调 `agent.load_llm_sessions()` 重建、然后走现成的 `_apply_reasoning_effort` 重放会话覆盖，emit 一条事件让 GUI 刷 pill 的 configured 值。（2026-10-18 起按新机制：换的是 `mykeys_store._load` 的配置源、再 `mykeys_store.reload(force=True)`；重建后还必须重装内置提示词 `install_managed_prompt_profile`，原方案漏了这步。）正在跑的 run 不打扰。Core 扇出与 `set_reasoning_effort` 转发同构。
- **边界**：只热更已有模型的生效配置；新增 / 删除模型、换 Key 仍需新会话（凭证白名单 spawn 时定死）。Channels 先不动。
- **被否**：C「本 run 内立即生效」（直接写属性 + 仍要重建，两套机制换一个小收益）。
- **关联**：`runner/managed_runtime.py` `install_managed_mykey_loader` · `runner/workbench_bridge.py` `_apply_reasoning_effort` · `core/src/commands/managed_model.rs` `sync_managed_model_config` · [IPC §5.14](../ipc-protocol.md)

---

## 思考寄存器排印：中文伪斜体 + 段落 / 列表行高不一致

- **状态**：暂存（2026-09-23 JC：「思考不是正文、不是回答，用斜体没什么问题」）
- **提出**：2026-09-23，[步骤标题：旁白回声步](./2026-09-23-step-heading-narration-echo.md) 那轮的第 2 候选。
- **启动信号**：JC 看到中文思考（GLM / DeepSeek 在中文对话里常用中文推理）的预览或 caret 全文后觉得字「歪」；或社区反馈同类。
- **背景**（已核实，别重查）：thinking 变体是 `italic` + `--font-serif`（Newsreader → PingFang SC / 雅黑）。苹方、雅黑没有斜体字面，WebKit 默认 `font-synthesis` 把直立汉字几何倾斜；英文走 Newsreader 真斜体没问题。回答里的中文引用块（`[&_blockquote]:italic`）早就是同一种伪斜体。第二件是真 bug：`PROSE_BASE` 的 `[&_p]` 给段落 body leading，`--conversation-thinking-leading` 只落在根元素和列表项，思考寄存器里段落与列表行高不一样（DetailPanel 与实时预览都受影响；预览行盒因此按「思考字号 × 正文行高」算）。
- **方案**：思考寄存器加 `font-synthesis-style: none`——中文直立、英文仍斜体，寄存器靠浅色 + 小一号撑；行高统一到 thinking leading 并同步 `ThinkingPreview` 的 `LINE_BOX`。
- **待定**：中文直立后思考与正文的区分度够不够（真机看一眼即可，不必切换器）；引用块是否同改。
- **关联**：`gui/src/components/conversation/MarkdownView.tsx` `PROSE_THINKING` · `gui/src/components/conversation/ThinkingPreview.tsx` `LINE_BOX` · [思考实时预览](./2026-09-23-live-thinking-preview.md)

---

## 短推理的预览一闪而过

- **状态**：观察中（2026-09-23）
- **提出**：2026-09-23，[步骤标题：旁白回声步](./2026-09-23-step-heading-narration-echo.md) 那轮的观察项。
- **启动信号**：JC 在多步 run 里觉得思考预览「一闪一闪」、过程区太忙。
- **背景**：首轮真机落库的 8 条推理平均 175 字、最长 312 字；快模型不到一秒吐完，预览展开即收合。每步另有上一步出场 sweep、新步入场、时钟归零。
- **方案**：推理持续超过约 1 秒才展开预览（与 thinking 计时器「≥ 3 秒才显示读秒」同理）；不满门槛的推理只进 caret。
- **关联**：`gui/src/components/screens/MainView.tsx` `thinkingPreviewVisible` · [思考实时预览](./2026-09-23-live-thinking-preview.md)

---

## GA 拿推理首行合成的 summary

- **状态**：观察中（2026-09-23）
- **提出**：2026-09-23，[步骤标题：旁白回声步](./2026-09-23-step-heading-narration-echo.md) 查数据时发现。
- **启动信号**：推理模型成为常用后这类步明显变多（2026-09-01 起 18 步），或 JC 嫌 marker 上那句截断的英文推理别扭。
- **背景**（已核实）：模型只回推理 + 工具调用、一个正文字都没写时，上游 `llmcore._ensure_text_block` 取推理首行前 60 字拼 `<summary>…...</summary>` 塞进 content，于是 marker 显示「The user wants to know if this weekend is suitable for going …」（中文对话里也常是英文），点开 caret 的推理第一句就是它。不是 81b8cc75 引入的（最早 09-09），但推理进 caret 后重复才露出来。
- **方案候选**：识别「summary = 推理首行截断」的步，marker 改用 `stepCalledTools` 兜底或只留序号 + caret；不改内核（上游行为，且只影响显示）。
- **关联**：`managed-ga/code/llmcore.py` `_ensure_text_block` · `gui/src/components/conversation/Conversation.tsx` `markerSummary`

---

## 长时间运行的完成时刻（助手侧时间）

- **状态**：暂存（2026-09-28 用户消息时间 A + B 定案时拆出）
- **提出**：2026-09-28，[用户消息发送时间](./2026-09-28-user-message-send-time.md)讨论。
- **启动信号**：JC 或社区第一次问「这个几点跑完的」；或出现超过 1 小时的运行（过夜长任务、定时任务）。
- **背景**（已核实，别重查）：v1 只给用户消息显示时间。截至 2026-09-23 的 409 轮运行（提问 → 最后一条助手行）里 281 轮不到 1 分钟、115 轮 1–5 分钟、13 轮 5–30 分钟，最长 28.9 分钟，同一套「超过 1 小时」规则套到回答上 0 处触发；回答操作栏当时是常显的，放进去就等于每条回答都有时间（同日操作栏改为悬停显示，「放进悬停的操作栏」因此成了另一个候选位置）。折叠头的「用时」不含 ask_user 等待，不能拿「提问时刻 + 用时」推完成时刻。
- **方案**：折叠头悬停提示显示「14:32 开始 · 02:14 结束」，对话流不加元素（run-fold PRD 当初给时间戳留的位置）。完成时刻取 run 最后一条助手行的 `created_at`，需要给 `AgentTurn` 补时间字段（`rowsToTurns` 与 live `turn_end` 两条路径）。
- **待定**：运行超过 1 小时是否在折叠头常显完成时刻，而不只是悬停。
- **关联**：`gui/src/components/conversation/RunFoldHeader.tsx` · `gui/src/stores/messages/rowsToTurns.ts` · [用户消息发送时间](./2026-09-28-user-message-send-time.md)

---

## 单次运行步数上限可配（`max_turns`，galley#29 建议 C）

- **状态**：暂缓（2026-10-01 JC 按建议裁不做）
- **提出**：2026-10-01，[galley#29](https://github.com/wangjc683/galley/issues/29) 附带的产品建议：`max_turns` 按会话可配（180 / 500 / 无限），或在提示词里告诉模型本次运行还剩几步。
- **启动信号**：[跑满上限的收尾修复](./2026-10-01-max-turns-run-end.md)发版后仍有人反馈「180 步不够 / 老撞上限」；或 `workbench.db` 里单次运行步数到顶（一次运行内助手行跨满 180 步；退出原因不落库，只能按步数数）的运行明显增多。
- **方案**：内置补丁把 `agentmain.py` 写死的 `max_turns=180` 换成读会话配置，GUI 放进模型高级设置或会话设置。外置模式做不了（宪法第 1 条），只有内置。
- **实施要点**：非计划模式下 GA 每逢第 175 步的倍数注入「必须 ask_user 汇总」（`ga.py:605-606`，`turn % 175 == 0`）：上限调大后它仍按 175、350… 叫停，要么接受、要么再补 `ga.py` 让提醒跟着上限走。「告知剩余步数」同理是改 `turn_end_callback` 的提示注入，也是内核补丁。计划模式另有自己的上限（`ga.py:475`，100），可配时要说清两者的关系。
- **待定**：按会话还是全局；要不要允许「无限」（无人值守时等于没有刹车）。
- **关联**：本台账「上游 issue：计划模式撞 100 步上限前没有任何提醒」一节；`managed-ga/code/agentmain.py:218`。

---

## Supervisor 的队列操作面：查看 / 撤回 / 取代 / 停止并收尾（galley#30 其余建议）

- **状态**：暂缓（2026-10-01 JC 按建议裁先不做）
- **提出**：2026-10-01，[galley#30](https://github.com/wangjc683/galley/issues/30)：supervisor 看不到子会话队列里排了什么（只有 `queuedCount`），撤不回自己发过的消息；建议 `session queue list / remove / jump`、`session send --supersede`（丢掉同会话未投递的排队项）、`session stop --wrap-up="<收尾要求>"`、内存队列落库。
- **启动信号**：[子会话队列冻结的修复](./2026-10-01-ask-pending-supervisor-send.md)发版、`--jump` 写进 SOP 之后，仍有 supervisor 用户反馈「排队的消息撤不回来 / 叫停后还得再发一条收尾」。
- **方案**：CLI 补 `session queue list / remove`，复用 Core 已有的 `session_queue_snapshot` 等 Tauri 命令背后的 manager API（`core/src/commands/queue.rs`），走 socket 新命令，同 schema 内新增；`--supersede` = 先清同会话排队项再按 `--jump` 派发；`stop --wrap-up` 等价于带收尾要求的 `--jump`，可能只需在 SOP 里写成惯用法，不必加参数。
- **实施要点**：新命令属 Agent API 增量变更（宪法第 3 条），文档进 `docs/agent-api/` 的变更记录；队列落库与 [消息队列](./2026-08-12-session-message-queue.md) 决定 1「排队消息的地位等同未发出的草稿」相冲突，要做先重审那一条。
- **待定**：撤回是否需要 supervisor 身份校验（只能撤自己发的）。
- **关联**：`core/src/runner_manager/queue.rs`、`core/src/commands/queue.rs`、`docs/agent-api/session-commands.md` §5.5a。

---

## 导入 GA 的 `sche_tasks` 为 Galley 定时任务

- **状态**：暂缓（2026-10-01 JC 按建议裁先不做）
- **提出**：2026-10-01，[galley#31](https://github.com/wangjc683/galley/issues/31)：从外置 GA 迁到内置的用户想把 `sche_tasks/*.json` 带过来。
- **启动信号**：再有迁移用户提同样的需求；或 `galley schedule` CLI（`.scratch/scheduled-tasks/issues/06`）落地，导入可以做成它的一个子命令。
- **方案**：读外置 GA 的 `sche_tasks/*.json`（只读，宪法第 1 条），逐条映射：`schedule` → `time_of_day`、`enabled` → `enabled`、`prompt` → `prompt`、`daily` → Daily、`weekday` → Weekly 周一到周五；映射不了的列给用户看、不静默丢。
- **实施要点**：映射有损，详见 [GA 调度器在内置模式下](./2026-10-01-ga-scheduler-managed-mode.md)的对照表：GA 的 `weekly` / `monthly` 是 6 / 27 天冷却而非固定星期几 / 几号，导入得替用户挑一天；`once`、`every_Nh`、`every_Nd`、`max_delay_hours` 没有对应；GA 套在 prompt 外的报告路径包装和 `done/` 报告会丢。
- **待定**：导入入口放 GUI（定时任务对话框）还是 CLI。
- **关联**：`core/src/api/schedule.rs`、`managed-ga/code/reflect/scheduler.py`、`.scratch/scheduled-tasks/PRD.md:140`（不桥接 GA 调度器的裁决）。

---

## 不经 LLM 的本地脚本定时任务

- **状态**：暂缓（2026-10-01 JC 按建议裁先不做）
- **提出**：2026-10-01，[galley#31](https://github.com/wangjc683/galley/issues/31)：希望定时任务能直接跑本地脚本（报告者在外置 GA 里用自加的 `handler` 字段直接调 Python 函数；上游截至 `2538ad9` 没有这个字段）。
- **启动信号**：第二个用户提同样的需求；或定时任务的使用数据显示大量 prompt 只是「运行某个脚本」。
- **方案**：定时任务加一种「脚本」类型，到点由 Core 起子进程执行，不开会话、不调模型，结果进定时任务的执行记录。
- **实施要点**：这是 Galley 第一次在没有 agent 参与时执行用户代码，会话里那层把关（上游提示词让模型在不可逆操作前先问用户；Galley 的工具审批已于 2026-10-05 移除）在这里不存在，要先想清楚权限与提示；Windows 上的解释器与工作目录；失败通知复用「定时任务触发失败」。
- **待定**：值不值得做——系统自带的 cron / launchd / 任务计划程序已经能跑脚本，Galley 的增量价值可能只是「在同一个面板里看见」。
- **关联**：`core/src/scheduler.rs`、`.scratch/scheduled-tasks/PRD.md`。

---

## 定时任务徽标数「等你回复」的定时会话

- **状态**：暂存（2026-10-05 我建议先不补，JC 未表态即收尾）
- **提出**：2026-10-05，[去掉审批系统](./2026-10-05-remove-approval.md)：侧栏「定时」入口的徽标原本数两样——定时会话在等审批、启用的任务最近一次触发失败；审批移除后只剩后一半。
- **启动信号**：真机上出现定时会话停在 `ask_user` 提问上、没被注意到的情况。
- **方案**：`useSchedulerActionCount` 加回一半：`origin.supervisor` 为定时调度器、且对话切片里有待答提问的会话（同原审批那一半的写法，未加载切片的会话不计）。
- **不做的理由**：侧栏会话行已有「等你回复」标记，`ask_user` 也会发系统通知，徽标再数一遍是重复信号。
- **关联**：`gui/src/hooks/useSchedulerSignals.ts`、`gui/src/components/layout/sidebar/SidebarNavIcons.tsx`。

---

## 专用机的远程设置

- **状态**：暂缓（2026-10-09 产品定义讨论中提出，JC 未表态，P0 不做）
- **提出**：2026-10-09，[移动端产品定义](../../.scratch/mobile-product/PRD.md)：北极星是用户为 Galley 助理单独买一台 Mac mini 24 小时跑着，人不在那台机器前；
  而 iOS PRD 裁决 8 定「设置只在桌面」（模型供应商、IM 配置、浏览器控制）。
- **启动信号**：JC 或任一用户真的把 Galley 跑在无人值守的机器上；或手机端 P0 上线后发现改模型 / 换 key 要跑回电脑成为高频抱怨。
- **方案**：手机端加最小的远程设置（切换会话模型、看渠道与浏览器桥状态），改 key 一类仍留桌面；或做成「桌面远程桌面」之外的问题不管。
- **待定**：首次配对本身也要在那台机器前完成，专用机的首装流程要不要专门设计。
- **关联**：`.scratch/ios-client/PRD.md` 裁决 8、10、17；本台账「手机端看电脑：跳转第三方远程桌面」（2026-10-16，「桌面远程桌面」那条路的具体做法）。

---

## 手机端看电脑：跳转第三方远程桌面

- **状态**：暂缓（2026-10-16，JC 问手机版 Galley 能不能直接看到、甚至操作装着 Galley 的那台电脑的桌面，给了 `netease-uuyc/uuremote-integration-guide`；主会话推荐记进暂缓、等手机版做出来再接，JC：「A」）。
- **提出**：人在手机上、Galley 在电脑上干活时，总有问答搞不定、得回到电脑前的时刻。
- **启动信号**：手机版主对话上线后，想在手机上看它在电脑上干活（移动端产品定义待定的「手机上看浏览器进度」），或真的出现「得回电脑前」的时刻：滑块、拖拽类验证（10-09 定为非目标、不做手机远程操作浏览器，[移动端 issues/01](../../.scratch/mobile-product/issues/01-browser-intervention.md)），改 Key、登录渠道、解锁浏览器插件这类「只能你来」的事；或本台账「专用机的远程设置」的场景成真。
- **方案**：手机版助理的顶栏或菜单加「看电脑」，一键跳到第三方远程桌面 App 连上这台电脑，不自己做屏幕串流。第一家候选是 UU 远程，它公开了接入协议：
  - 是 URL Scheme 跳转，不是 SDK：`uuremote://external/device/authorize` 绑定一次（用户在 UU 里选电脑，回调带加密的 `anonymous_device_id`，与 UU 账号绑定），之后 `uuremote://external/device/control` 带这个 ID 直接连。
  - **用户看到的是 App 内小窗**（JC 同日补：官方介绍「支持在 App 内以小窗模式观看远端电脑屏幕，也支持在 App 内快速发起远控」；主会话起初写「画面不能嵌进 Galley」，技术上对、体验上说偏了）：`window_type=1` 时 UU 连上后进入系统画中画，画中画真的起来才回调一次（失败、取消、超时也回调一次），回调带你回 Galley，小窗浮在上面，边看边在主对话里说话。小窗只看，点小窗回到 UU 全屏才操作；「快速发起远控」即从 Galley 一键连到绑定的那台。小窗要 iOS 18 以上、设备支持画中画，否则 `pip_unsupported`，改用全屏（`window_type=0`，不回调）重试。「回调后回到 Galley、小窗浮在上面」是按 iOS 画中画与回调机制推断，文档没明写，开工时真机核实。
  - 前提：手机装 UU 远程 4.42 以上并登录；被控只支持 Windows、macOS，要在线、开着「允许被控」，设备列表来自账号（电脑上实际要装 UU、登同一账号，文档没明说）。不要合作方注册、AppKey、签名；文档没写费用与条款（仓库的 MIT 指文档与示例）。
- **实施要点**：只改手机端（检测安装、绑定一次存下设备 ID、一个按钮），Core 零改动。宪法 Rule 2 不受影响：Galley 不监听、不经手画面，只是打开另一个 App，与 IM 渠道同理是用户自选的第三方；但画面走网易的服务、加密方式文档没写，与 Galley 自己端到端加密的远程模块不是一回事，入口处要说清。扫码登录与图形验证码仍走「问题带图」（iOS 票 09），远程桌面只补问答搞不定的。
- **不选**：自己做屏幕串流（等于再做一个远程桌面产品：macOS 屏幕录制与辅助功能两项权限、视频编码与远程输入；画面绕法兰克福中继，国内延迟与带宽不够、中继成本上涨）；不接、只在文档里建议用户自装（每次手动切 App、选电脑）。
- **待定**：JC 平时用哪个远程工具（未答）；向日葵、ToDesk 有没有类似的跳转协议，开工时再查；要不要同时支持几家。
- **关联**：[移动端产品定义](../../.scratch/mobile-product/PRD.md)「浏览器任务要人介入」；`.scratch/ios-client/PRD.md` 票 09；本台账「专用机的远程设置」。


## 安卓原生 App

- **状态**：暂缓（2026-10-20 [IM 并入 PRD](../../.scratch/im-one-assistant/PRD.md) 裁决 17，JC：「按照你推荐的推进」）。在那之前，IM（尤其微信）就是安卓用户的手机体验，投入按这个算，不按「过渡期凑合」算。
- **2026-10-21 更新**：IM 改为维持自己养 agent（[devlog](./2026-10-20-im-a-line-to-the-same-assistant.md)「2026-10-21 改向」），本节「不排期」的结论留用。理由里「IM 是长期的那条线、管它来找你」的定位作废：IM 里的它不是助理，不替助理来找你；国内安卓没有 FCM、唯一开发者、备案与逐家上架这几条照旧。启动信号里原生端与 IM 的比较改回看引擎日志 `model_responses`（IM 对话不进库，同 iOS PRD「P0 要回答的问题」原文）。
- **提出**：2026-10-20 讨论 IM 与 Galley 移动端的关系时，JC：「现在安卓端移动 App 都没有排进计划日程，安卓手机用户目前唯一从手机端使用 Galley 的方式就是这几个 IM 了」。
- **启动信号**：iOS App 上线后，原生端的使用明显多于 IM：`workbench.db` 里 `client = ios` 的用户轮次对比 IM 各渠道的取值（IM 私聊并入后两者在同一张表里可比）。也就是 iOS PRD「P0 要回答的问题」的答案是肯定的。
- **为什么不先做**：IM 是长期的那条线（「它来找你」与「随口一句」），原生 App 是「去它那儿」；国内安卓没有 Google 服务、FCM 用不了，原生 App 要逐家接华为、小米、OPPO、vivo、荣耀的推送通道才能可靠地找到你，微信已经解决了；唯一开发者，另一套代码加上 App 备案、逐家上架。
- **方案**：开工时再定技术路线；iOS 的协议包是 Swift 自写（iOS PRD 裁决 24），「Rust 协议经 UniFFI 编进 App」是当时留的出口，安卓可能正好用上。
- **待定**：推送通道接哪几家；国内 AI 类 App 上架是否另有要求（iOS PRD 也记着「未核实」）。
- **关联**：[移动端产品定义](../../.scratch/mobile-product/PRD.md)；[iOS PRD](../../.scratch/ios-client/PRD.md) 票 07、08；[devlog](./2026-10-20-im-a-line-to-the-same-assistant.md)。

---

## 子任务的提问在别处答掉时，由 Core 替主对话收尾

- **状态**：暂缓（2026-10-19 主聊天 PRD 裁决 102：先做界面锁，票 49）。
- **提出**：2026-10-19 票 48 第二节调查（见 [票 48](../../.scratch/main-chat/issues/48-subtask-question-answered-in-main-chat.md) Comments）。GA 的 `ask_user` 没有取消，下一条消息就是回答；Galley 在主对话里转述子任务的提问后，若提问在别处被答掉，主对话的 `ask_pending`、界面的 `pendingAskUser`、模型历史里那条提问都不动：子任务的交代被 `take_due` 挡下、退成通知，你在主对话说的下一句被当成旧问题的回答。
- **显式代价**：裁决 102 只锁了界面上打开的子任务；别的 supervisor 用 CLI（`session send`，公共契约，不能拒）直接答子任务的提问时，仍会挂住主对话。
- **启动信号**：外部 supervisor 直接答子任务的提问，或真机遇到主对话把下一句当成旧问题的回答。
- **方案**（票 48 调查推荐的 A）：Core 把「这一轮叫醒以提问结束」记成转述关联；子任务的提问被任何路径答掉时（`send_command_via` 加信号，四条路径都经过），绕过提问关卡给主对话送一轮不出声的叫醒，告诉助理「已在子任务里答了，别再等」，助理以 `<no-reply/>` 结束。
- **实施要点**：改 Core 与 GUI（界面把那条提问画成已在别处回答），runner 不动；叫醒文案多一种，在票 30 的评测范围内重跑；需要克隆 `core/target` 的 worktree。外置运行时零变化。
- **待定**：手机端没升级的子任务看不到，叫醒没送到时手机上看不到这个问题（票 48 路径 4），是否一并处理。
- **关联**：`core/src/subtask_report.rs`（`still_due` / `is_still_due`，送达前的重读）· `core/src/session_send.rs` · 主聊天 PRD 裁决 101、102 · 票 48、49

---

## 「关于 Galley」改按需读

- **状态**：暂缓（2026-10-19 主聊天 PRD 裁决 111，JC 按推荐选 C：先拆手册，这一项不做）。
- **提出**：2026-10-19 JC 问各层提示词哪些可以按需获取以节约 token（[devlog](./2026-10-19-prompt-layers-what-to-fetch-on-demand.md)）。Galley 运行时层的「About Galley」一节 2.3 KB（约 580 tokens）随每个内置会话的每次请求发送，用户问到 Galley 本身的频率远低于十次一次。
- **为什么暂缓**：常驻的内容几乎一直在缓存里（缓存读一般按原价的 1/10 计），按 10-17 到 10-19 主对话的用量估，改成按需约省账单的 1%–1.5%；代价是功能清单和作者那段可能被模型不读就答，而那段本来就是防编造加的（`core/src/managed_prompt.rs` 的 `RUNTIME_PROMPT_STATIC` 文档注释：曾把 GitHub 名扩成中文全名）。
- **启动信号**：固定层继续变大（入口层、In Hand 或静态规则又加内容，主对话固定开销超过 5k tokens）；或主力换到缓存折扣小、没有缓存的服务商。
- **方案**：功能清单与作者那段挪进一个由 Core 写进状态根的参考文件（与助理手册同一做法，工作台、IM、子任务都能读）；静态规则里留身份两句、「问到 Galley 的功能、设置在哪、作者是谁时先读它」，以及作者只知道这些、不猜不扩的那句。
- **实施要点**：静态规则变了，`prompt_hash()` 跟着变；`STATIC_PROMPT_BUDGET_BYTES` 往下调。动手前用入口层评测那套比一次「Galley 能做什么 / 某个设置在哪 / 作者是谁」有没有编，WITH / WITHOUT 两组对照。外置运行时零变化（不注入 Galley 提示词）。
- **待定**：参考文件放哪（手册目录旁边，还是 `assistant/` 之外，因为工作台与 IM 也要读）。
- **关联**：`core/src/managed_prompt.rs`「About Galley」· 主聊天 PRD 裁决 111 · 票 59（手册按部分拆开，同一思路）

---

## 顶栏在跑超过 1 分钟接用时

- **状态**：暂缓（2026-10-19 主聊天 PRD 裁决 107、110：定三点气泡时不计时，这条是写明的退路）。
- **提出**：裁决 107 讨论计时时。主会话改推荐不计时（IM 的标题栏不计时；挪到顶栏会在余光里每秒跳；主对话回合短，本机 12 轮最长 31 秒，重活派给子任务；三点在跳、顶栏每做完一步换一句，已经说明在推进；用时在过程卡片第一行），JC 同意；代价是某一步卡很久时分不清慢与卡，裁决 110 第 3 条列为日常使用里留意的翻车点。
- **启动信号**：真机碰到一次某一步卡很久、分不清是慢还是卡住。
- **方案**：主对话在跑超过 60 秒时，顶栏那句话后面接「· 1 分 12 秒」（整秒，与过程卡片的用时同源）；60 秒以内照旧不计时，对话里的三点气泡与侧栏卡片不变。
- **实施要点**：只改 GUI：顶栏身份行（`AssistantIdentity.tsx`）读这一轮的开跑时刻与已答完各段的用时（同工作台右下角计时的取法），每秒更新只在过了 60 秒之后、只重渲染身份行；渲染期不读 `Date.now()`（React 编译器 lint），用计时器写状态。截断时用时不能先被截掉（句子截断、用时留着），悬停全文带上用时。工作台、子任务、外置运行时零变化。
- **待定**：阈值（60 秒是讨论时的数，真机碰到时再定；也可能是「这一步」超过多久而不是整轮）。
- **关联**：[conversation](../design/conversation.md)「助手的对话」的「在跑时：三点气泡」；[layout-and-chrome](../design/layout-and-chrome.md) §4.1「开着助手时是身份行」；`gui/src/components/layout/assistant/AssistantIdentity.tsx`；主聊天 PRD 裁决 107、110，票 58。

## ChatGPT 套餐的额度显示

- **状态**：暂缓（2026-10-20 JC 按推荐：现在只给「管理用量」入口，等 OpenAI 开放数据再做；[SIWC devlog](./2026-10-20-sign-in-with-chatgpt.md) 裁决 10）。
- **提出**：2026-10-20，JC 想在 Galley 里显示 ChatGPT 账号的额度：Plus 有 5 小时与 7 天两个窗口，Pro 只有 7 天。
- **为什么现在做不了**：
  - SIWC 令牌拿不到额度数据。`/v1/responses` 与 `/v1/models` 不返回 `x-codex-primary-*` / `x-codex-secondary-*` 头，流里也没有额度事件（10-20 探针实测）。
  - 用 SIWC 令牌调 `chatgpt.com/backend-api/wham/usage` 返回 401 `rejected_by_access_enforcement`。
  - 上面两条，[openai/codex#54219](https://github.com/openai/codex/issues/54219)（10-15 提，至今未答复）也实测过。
  - 用户在 ChatGPT 设置里给 Galley 设的每周上限是另一层限制，用量同样读不到。
- **启动信号**：#54219 有官方答复；或 `/v1/responses` 开始返回 `x-codex-primary-*` 头或额度事件；或文档出现 SIWC 可用的用量接口。（2026-10-20 已查：`response.metadata` 事件里只有内容审核结果 `openai_chatgpt_moderation_metadata`，完成事件里的 `access_programs` 只有 `{"cyber": "standard"}`，都不含额度。）
- **方案**：数据可读之后：
  - 服务商卡片显示「5 小时窗口 X% · 本周 Y% · 某时重置」，Pro 只有本周一行；
  - 模型菜单里「ChatGPT 套餐」后面跟本周百分比；
  - 任一窗口超过 80% 时在输入框附近提醒一次；
  - 能分开拿到时，区分套餐上限与 Galley 自己的上限。
- **否掉的路**：
  - 借旧的 Codex CLI 登录去查 WHAM：等于留着 A、让用户登录两次，还冒用 Codex CLI 身份，与「删 A」裁决冲突。
  - Galley 自己累计 token：没有分母，换算不成百分比，容易误导。
- **现在的替代**：服务商卡片、模型菜单、额度用尽报错里都有「管理用量」，跳到 `https://chatgpt.com/settings/usage`（SIWC 票 04）。
- **关联**：`managed-ga/patches/0007-managed-codex-backend.patch`（套餐路由的请求头与报错处理）、`core/src/chatgpt_siwc/`。

---

## 主对话常驻不卸载

- **状态**：暂缓（2026-10-20 主聊天 PRD 裁决 123 第 5 条，JC：「按你推荐推进」，推荐的是先做 A、B，C 暂缓；[devlog](./2026-10-20-assistant-card-edge-and-switch-hitch.md)）。
- **提出**：从别的对话回到主对话，主区按 `key={activeSessionId}` 整块重新挂载（`gui/src/App.tsx` 里的 `<MainView key={activeSessionId}>`），dev 实测主线程占住约 0.2 秒。主对话是用户最常回去的地方，如果它的主区常驻、只是隐藏，切回去几乎零成本。
- **启动信号**：票 72（B）合入后，用同一个探针回路量，切到主对话仍明显比切到同长度工作台对话慢；或 JC 真机仍觉得回主对话卡。
- **方案**：主对话的 `MainView` 单独一棵树常驻，开着别的对话时隐藏，不卸载；工作台对话照旧按 key 重挂。
- **实施要点**：
  - 隐藏时它的钩子不能照常跑：贴底、`ResizeObserver`、打字气泡交接、选区工具条、全局快捷键，都要按「是否在屏上」停下或分流。
  - 输入框、草稿、滚动位置的状态要能跨隐藏保留。
  - 侧栏里那张脸的驱动（`AssistantFaceDriver`）是另一棵树，不受影响。
- **待定**：隐藏用 `display: none` 还是 `content-visibility: hidden`（后者保留布局缓存，切回更快，但隐藏时的尺寸读数会变）。
- **关联**：主聊天 PRD 裁决 123，票 [72](../../.scratch/main-chat/issues/72-main-chat-switch-cost.md)；探针做法见那篇 devlog。

---
