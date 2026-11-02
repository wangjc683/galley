# 117 诊断：发票那轮整理完以后，又花 2 分 10 秒写 GA 记忆才回用户

Status: ready-for-human（2026-11-02 诊断完成，主会话核过关键引文：`tools_schema.json:69`、`memo.md:73-74`、`ga.py:544`、`managed_prompt.rs:452-461`；修不修等 JC 定）

来源：[主对话 PRD](../PRD.md) 裁决 160 第 6 条。用户在等结果，它已经说「整理完成并核验无误」，还要再等两分多钟。

## 发生了什么（`workbench.db`，时间是库里的 UTC，本地 +08:00）

- 主对话 `s-mvfzje17-ds10bbno`，用户消息在 `turn_index` 210（2026-10-28T08:08:26Z）：「今天下午五点前把发票整理好」。这一轮 11 步，最后一步 `telemetry_json.elapsedMs` 约 623 秒。
- 最后几步（`summary` 字段）：
  - 216 · 08:16:41 「发票整理完成并核验无误；我按规范读 memo.md，记下发票文件夹规则后向你汇报。」
  - 217 · 08:17:05 「发票整理已完成；按 memo.md 指引，路径类经验应写入自有记忆，我先读 META-SOP 再落一条。」
  - 218 · 08:17:48 「META-SOP已读：发票目录属非标路径→L2，仅patch；我先存关键点并读L2找插入位置。」
  - 219 · 08:18:26 「L2结构已确认；我把发票目录规则patch进L2并同步L1触发词，然后汇报。」
  - 220 · 08:18:51 最终回复。

## 要查清

1. **是哪几句指令让它在回复之前写记忆**：Galley 助理手册的 `memo.md`（`docs/managed-ga-runtime/galley-assistant-manual/memo.md`，Core 运行时写进状态根）说了什么；GA 自己的系统提示词、记忆管理 SOP（内置状态根 `memory/` 下）对「任务结束前更新记忆」怎么说；入口层（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）有没有相关的句子。逐句引原文与 `file:line`，说清是哪一句把它推到了「先记再回」。
2. **频率与耗时**：10-20 以来主对话每一轮里，在活干完之后、最终回复之前读写记忆文件（读 META-SOP / 记忆管理 SOP、`file_write` / `file_patch` 到 `memory/` 下）的有几轮，每轮多花多少秒，合计多少。工作台会话和子任务里同样的情况也数一下，分开列。工具名在 `messages.tool_calls` 的 `toolName` 字段；一轮的边界按 user / system 消息切（`turn_index` 是按步编号的）。
3. **写进去的东西值不值**：这几次写进 GA 记忆的是什么（摘要即可），有没有与备忘（`galley memo`）里的内容重复，按主对话 PRD 裁决 140–142 它本该进备忘还是进 GA 记忆。
4. **能不能先回再记**：GA 一轮在最终回复后就结束，读 `managed-ga/code` 的 agent 循环，确认有没有「回复之后还能接着做一步」的路子；Galley 这边有没有现成的时机能放这一步（下一轮开头、叫醒、子任务）。

## 交回

- 原因：一句话结论，加证据链（`file:line`、库里字段值）。查不实的写「没查实」和缺什么证据。
- 第 2 条的统计表。
- 2–4 个修法选项，带一个推荐；每个写清：harness 重量（大概改哪些文件、多少行）、会不会在用户没要求时多花 token、上游 GA 有没有现成的、外置运行时的影响（外置 GA 的记忆行为是用户自己的 GA，Galley 不能改它的文件或注入提示词，宪法第 1 条）。修不修由主会话和 JC 定。

## 边界

- **只读**：数据库用 `sqlite3 -readonly`；不写 Galley 数据库，不写内置或外置 GA 的任何文件（`memory/`、SOP、日志都不碰），不动代码，不跑会用到浏览器或模型的东西。
- 不建 worktree；只改本文件的「## 报告」一节，不提交（主会话验收后提交）。临时脚本放 scratchpad，用 `t117-` 前缀命名。
- 引用匹配行时用 `grep`，不要用 `rg`（这台机器上 rg 的输出会替换搜索词）。
- 本文件在开源仓库里：路径写成 `~/…`，不写本机用户名；不写服务商名、接口主机、密钥；记忆内容里有用户私人信息的，只写类别（「一条发票文件夹路径规则」），不抄原文。
- 中文用全角标点。

## 报告

（2026-11-02，诊断代理，只读。库里时间是 UTC，下面只写日期。）

### 一句话结论

没有哪句提示词要求「先记再回」。要不要记，是上游 `start_long_term_update` 的工具说明种下的（「发现值得记的环境事实就调」），入口层「把了解到的关于用户的事记成备忘」和「think a step ahead」被它当成了不用问就记的许可；memo.md 第 73–74 行把「路径」从备忘指回 GA 自己的记忆，GA 宪法第 5 条和 L0 又把一条记录拉成读 L0、存工作记忆、读 L2、补 L2 与 L1 共 4 步。时机落在回复前是结构性的：GA 一轮在第一条不调工具的回复处就结束，回复之后没有下一步；入口层「本轮写过才说『记下了』」的底线也要求先写后说。

### 第 1 问：证据链

按步对照模型自己的 thinking（`messages.thinking`）和它引用的原文：

1. **216 步起意**：thinking 先按上游规则自查「No long-term memory update needed? Task took ~6 turns, not 15+」，接着引用「Call when discovering info worth remembering (env facts/user prefs/lessons learned)」。这是上游工具说明 `managed-ga/code/assets/tools_schema.json:69`（`start_long_term_update` 的 description），它把出处说成了 working memory。它没调这个工具（嫌不到 15 步；真调了也会被 `managed-ga/code/ga.py:544` 以 `current_turn < 10` 挡回），转而把入口层两句当许可：原样引用的「Note what you learn about the user that you will need later as a memo;」（`core/src/managed_prompt.rs:452-454`），以及「noting the convention unasked is 'think a step ahead' and explicitly sanctioned」，指的是 `:459-461` 的「When you note something, think a step ahead」。这句原意是记下一件事以后替它多做一步，不是授权多记。然后按 `:465-469`「Before a Galley CLI write … read … `memo.md` to note or change what you know about the user」去读手册。
2. **217 步改道**：thinking 原样引用 `docs/managed-ga-runtime/galley-assistant-manual/memo.md:73-74`「What is about the user goes here; how to do things (their setup, paths, what went wrong before) stays in your own memory, as before.」，判定发票文件夹规则属于「setup, paths」，改写 GA 记忆；又引「requires reading META-SOP (L0) first per constitution rule 5」，即 `managed-ga/code/assets/insight_fixed_structure.txt:2`、`:9`（英文版 `insight_fixed_structure_en.txt` 同两行），由 `ga.py:605-616` 的 `get_global_memory()` 每轮放进系统提示。这一步它自问过「Is it worth the whole META-SOP flow for one line?」，答的是「Genuinely useful, recurring」。
3. **218 步加长**：读 L0 触发 `ga.py:467-468` 的「[SYSTEM TIPS] 正在读取记忆或SOP文件，若决定按sop执行请提取sop中的关键点……update working memory」，它先存工作记忆（thinking 原样引了这句）；L0 决策树「环境特异性事实（非标路径）→ L2，然后按频率归入 L1」（`~/Library/Application Support/app.galley/managed-ga-state/memory/memory_management_sop.md:80-82`）让它去读 L2 找插入位置。
4. **219 步写两处**：按 L0 的同步规则（同文件 `:39`、`:47`、`:61-69`），L2 补一节、L1 索引行补一处，两个 `file_patch`。
5. **220 步回复**：「你的发票目录规则我也记下了」，对上入口层底线「Say 「记下了」 or the like only after you wrote it down this turn」（`managed_prompt.rs:455-457`）。

查过、没有相关句子的：GA 系统提示词 `assets/sys_prompt.txt`、`sys_prompt_en.txt` 只有「失败时关键信息存入工作记忆」和「结束前检查重大残差」，不提长期记忆；Galley 运行时静态规则（`managed_prompt.rs` 的 `RUNTIME_PROMPT_STATIC`）只提 `sche_tasks` 和 L4；助理手册其余 9 个文件不提记忆（`grep -i memory` 只命中 memo.md:74）；L0 只说怎么记、记哪层，不说何时记。上游的设计本来就是先记后报：`start_long_term_update` 的返回提示写着「记忆整理仅是内部收尾；完成或跳过后，仍须向用户报告原任务结果」（`ga.py:538`）。

那一轮用的就是现在的文字：`main_chat_entry_layer` 在 `6acb1cfb`（10-28 16:07 +08:00，这一轮之前的最后一次提交）与 HEAD 逐字相同；216 步 `file_read` 读到的 memo.md 95 行与仓库现版相同。

没查实的：主对话用英文工具表，是按「`managed-ga/code/agentmain.py:52` 的 `load_tool_schema()` 默认不带后缀」加「模型引的是英文原句」推定的，库里没存发出去的请求体；216 步的 59 秒里有多少是复核结果、多少是犹豫要不要记，分不开。

### 第 2 问：频率与耗时

口径：10-20 00:00（+08:00）起；一轮按 user 消息切。「活干完、回复前碰记忆」指：最终回复之前紧挨着的几步全是记账类工具（读 memo.md、读 L0、读 L1 / L2、`file_patch` / `file_write` 到 `memory/`、`start_long_term_update`、`update_working_checkpoint`），前面有干活的步，且其中至少一样碰的是 GA 记忆。两个耗时：**多花** = 最后一步记账 − 最后一步干活（回复本身要花的时间照算，不计入）；**开始记到回复** = 最终回复 − 第一步记账（票面的「2 分 10 秒」是这个口径，它把回复本身也算了进去，偏大）。`telemetry_json` 只在每轮最后一步，token 分不到步，「多的请求」按步数数。

| 范围 | 10-20 起的轮 | 回复前碰记忆的轮 | 碰的是什么 | 写进 GA 记忆 | 多花 | 开始记到回复 | 多的请求 |
|---|---|---|---|---|---|---|---|
| 主对话 | 63（界面 48、叫醒 12、CLI 2、supervisor 1） | 1（10-28 发票） | 读 memo.md → 读 L0 → 存工作记忆、读 L2 → 补 L2 与 L1 | L2 一节 3 行、L1 一处 | 164 秒 | 130 秒 | 4（全轮 11 次） |
| 工作台 | 48 | 9 | 每轮一次 `start_long_term_update`；其中 2 轮前面还多一步存工作记忆 | 0 | 合计 141 秒（每轮 7–34 秒） | 合计 227 秒 | 11 |
| 子任务 | 3 | 2 | 每轮一次 `start_long_term_update` | 0 | 合计 26 秒（每轮 13 秒） | 合计 155 秒 | 2 |

明细：

- 主对话 `s-mvfzje17-ds10bbno`：用户消息 210（10-28），记账 216–219，全轮 623 秒。按字符比例粗估，这 4 步约占全轮输出 token 的 29%（约 5 千）；输入约 11 万 token（4 次 × 全轮平均每次约 2.9 万，多为缓存读）。
- 工作台 9 轮：10-21 同一个会话 7 轮（用户消息 77、128、156、191、212、230、268，多花 8、34、10、17、28、10、7 秒），10-22、10-23 各 1 轮（10、17 秒）。
- 子任务 2 轮：10-21 的 NBA 预测、10-23 的 NBA 新闻，各多花 13 秒；「开始记到回复」那一栏的 67、88 秒主要是写长报告本身。
- 工作台和子任务这 11 次，就是裁决 140 第 1 条说的「同期 11 次 `start_long_term_update` 一条没写进去」：每次工具返回 L0 全文加「记忆提纯」提示（`ga.py:533-545`），模型读完判无可记，直接回复。触发几乎全来自工具说明末句「Must call when a task that took 15+ turns is completed」（`tools_schema.json:69`）：15 步及以上的 13 轮里 11 轮调了，不到 15 步的轮一次没调。主对话 10-20 以来最长 11 步，从没碰到这一条。

不计入的：

- 主对话 10-20 两轮（用户消息 1、9）：用户自报称呼和背景，写 GA 记忆就是这一轮的活，当时还没有备忘。
- 主对话 10-26 记「一条饮品偏好」那一轮（用户消息 181）：写的是备忘（`galley memo add`），不是 GA 记忆；但 182 步先读了 L0（11 秒），是 GA 宪法第 5 条「写任何记忆前读 META-SOP」把备忘也当成了记忆。另一次记备忘（10-28 办公室地址，用户消息 226）没读 L0。
- 读 L2 查东西的轮（主对话 6 轮、工作台 4 轮）：GA 宪法第 2 条「决策前查记忆」，多和别的工具在同一步，不是记账。
- IM 不在库里，没数。

### 第 3 问：写进去的值不值

- **写了什么**（`~/Library/Application Support/app.galley/managed-ga-state/memory/global_mem.txt` 文件时间是本地 10-28 16:18，现 610 字节；`global_mem_insight.txt` 同时改）：L2 新增「发票报销」一节 3 行：发票文件夹的位置与「已报」归档子目录的约定；文件命名规则；这个文件夹里混有哪一类海外订阅账单（不是增值税发票）、PDF 用哪个库能直接取文本。L1 的 L2 索引行加了「发票报销（整理发票）」触发词。
- **与备忘重复吗**：不重复。备忘现有 2 条（一条饮品偏好、一条办公室地址），都与发票无关。
- **按裁决 140–142 该进哪**：按现行条文是 GA 记忆。裁决 140 第 2 条「关于你这个人的进备忘、怎么做事的照旧进 GA 记忆」，memo.md:73-74 把「setup, paths」明确划给 GA 记忆。模型是照条文走的，没走错地方。
- **值不值**：不值得让人等两分多钟。① 重新找一次很便宜：这一轮第 1 步就找到了文件夹，命名规则是看现有文件推出来的（212 步「按你现有命名规则」）；L0 自己的 L3 条款也写「不记录：……可在几步探测中重新获得的路径或状态信息」（`memory_management_sop.md:55`），模型在 218 步 thinking 里承认过「re-discoverable via a quick find (~5s)」，最后还是按决策树「非标路径 → L2」写了。② 第三行「夹里混有哪类账单」说的是这个文件夹此刻的内容，按 L0 公理 3（`:10-12`）属于易变状态。③ 10-28 以后库里没有再提发票或报销的消息，还没用上。省下的上限是下次整理发票时少一步（约 1 分钟）；代价是这一次多 4 次请求、130–164 秒的等待。
- 顺带：L2 的「USER」一节（称呼、教育、工作、家庭，10-20 写的）按裁决 140 现在属于备忘，备忘里没有。不重复，但不在用户看得见的地方。不在本票范围。

### 第 4 问：能不能先回再记

- **GA 一轮在第一条不调工具的回复处结束**：没有工具调用就记成 `no_tool`（`managed-ga/code/agent_loop.py:69`），`do_no_tool` 返回 `next_prompt=None`（`ga.py:531`），循环记 `CURRENT_TASK_DONE` 并退出（`agent_loop.py:91-92`、`:98-99`）。
- **唯一的「回复后再来一步」是 `handler._done_hooks`**（`ga.py:310` 初始化为空，`agent_loop.py:98-100`）：退出时它不空，就弹出一句当下一步的提示，循环接着跑。上游只在 `managed-ga/state-seed/memory/autonomous_operation_sop.md:26` 用到它（让模型用 `code_run` 的 inline_eval 往里塞「重读自主任务 sop，检查收尾」）。上游没有「回复后再记」的现成功能，`start_long_term_update` 按设计在报告之前。
- **在 Galley 里直接用 `_done_hooks` 会乱**：回复那一步的回调已经带着 `exit_reason`（`agent_loop.py:101`），bridge 随即发 `run_complete` 并清掉 `run_in_progress`（`runner/workbench_bridge.py:1547-1575`）；之后几步的事件没有归属。此间用户发的下一句会被 bridge 收下（`:1664` 只看 `run_in_progress`），在 GA 的 `task_queue` 里排队，隐藏那几步的事件会记到新一轮名下。要用，先得改 bridge 的运行边界。外置运行时往 `_done_hooks` 里塞东西改的是 GA 的循环，不在宪法第 1 条允许的接入点里。
- **Galley 现有的时机**：
  - 隐藏消息：IPC 的 `user_message` 带 `visibility`（bridge `:1679` 照收），GUI 忽略 `internal` 事件（`gui/src/lib/ipc-handlers.ts:586`、`:610`、`:649`），库里有 `messages.visibility` 列。这是 Goal 时代留下的，Core 现在从不发（`core/src/session_send.rs:324`、`:386`，`core/src/message_queue.rs:115` 都是 `visibility: None`），库里 2,910 行消息全是 `visible`。Core 在 `run_complete` 之后补发一条隐藏消息，是最接近「先回再记」的现成通路，但要补上发送方。
  - 下一轮开头：等于把等待挪到下一个问题上，不解决。
  - 叫醒：只为子任务回来、提醒到点、巡看；给自己设一次性提醒去记，会多一张提醒卡片和一次叫醒运行，不合适。
  - 子任务：`<subtask>` 在回复之后才起（`managed_prompt.rs:433-437`），子任务与主对话共用内置状态根的 `memory/`，技术上能写；但多一张子任务卡片，做完还要叫醒主对话再跑一轮，为一条记录太重。
  - 段界：deferred「主对话的跨段连续性」第 3 级（`docs/devlog/deferred.md:48`），10-26 已改成「开新段时补记漏掉的进备忘、不再写 GA 的 L2 / L3」（同文件 `:53`），只是方案，没有代码。

### 修法选项

**甲（推荐）：主对话回复前不写自己的记忆，只改提示词。** 入口层在备忘那句后加一句（或同时改写 memo.md:73-74）：活干完就回；怎么做事的经验（路径、设置、踩过的坑）在主对话里不停下来写进自己的记忆，也不调 `start_long_term_update`，用户说「记住」时才写。

- 重量：`core/src/managed_prompt.rs` 入口层 2–3 行，调 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`（`:1550`）并加一条断言测试，约 20–40 行。只改 memo.md 的话 2 行，不进系统提示，但这次的起意在读 memo.md 之前，只改手册拦不全。评测加 2–3 条：复现发票这一轮（活干完是否直接回）；用户说「记住发票放在哪」时照写。
- token：少花（这一轮省 4 次请求），用户没要求时不多花。
- 上游：没有现成的；只在主对话压住上游工具说明那半句，工作台、子任务不动。
- 外置运行时：零变化（外置没有主对话）。
- 代价：主对话里攒出的「怎么做事」不再进 GA 记忆；10-20 以来只有这 1 条，而且按 L0 自己的 L3 条款本不该记。票 115 改的是同一个函数 `main_chat_entry_layer`，合入时要对一下。

**乙：改道备忘，「你自己的东西放在哪、怎么命名」算关于你的。** memo.md 的「What to note」加一项、`:73-74` 改写，评测加用例；Core 不动。

- 重量：手册 3–5 行，加评测。
- token：回复前仍多 1–2 步（读 memo.md、`memo add`，约 30–50 秒），比现在的 4 步少；记下以后段首常在，下次不用读 L2。
- 上游：无关。外置运行时：零变化。
- 代价：改了裁决 140 第 2 条和 memo.md 的边界；备忘里会出现路径（单条 100 字、总量 2,000 字照卡）；用户会看到「记下了 · ……」卡片。算不算「关于你」是 JC 的判断。

**丙：先回再记（只在内置）。** 回复末尾带一个标记（照 `<subtask>` 的做法），Core 在 `run_complete` 后给主对话补发一条隐藏消息，让它照 L0 写进记忆、只回 `<no-reply/>`，复用上面那条隐藏消息的通路。

- 重量：Core 解析标记并补发、从显示的回复里剥掉标记、这段时间用户发话的排队与「还在忙」的提示、手册与入口层几句、测试；估 400–700 行（测试约占一半）。不选 `_done_hooks`：要改 bridge 的运行边界，更重。
- token：只在标记出现时花；记忆那几步一步不少，再加一次起步请求，但不挡回复。
- 上游：只有 `_done_hooks` 这个缝，没有现成功能。外置运行时：主对话只在内置，零变化；外置里这条路也走不通（宪法第 1 条）。
- 代价：用户看完回复马上追问时，那句要等记忆写完（约 2 分钟），GUI 不显示隐藏运行，看起来像卡住；为两周 1 次的事加一套 harness，撞「Less harness. More model.」。

**丁：维持现状。** 两周 1 次，一次两分多钟。

推荐甲：去掉的正是用户在等的那两分钟；规则确定（「在主对话里，回复前不写自己的记忆」，守没守看得出来）；只动提示词，出口便宜。乙、丙挂信号：JC 碰到主对话把做过的事「又要重新找一遍」、并希望它记住时，属于「你的安排」的先看乙；要它在主对话里攒怎么做事的经验又不让人等，再看丙。

### 顺带（不在本票范围，另议）

- 工作台和子任务那 11 次 `start_long_term_update`：0 次写入，每次在回复前多 1–2 次请求，两周合计工作台 141 秒、子任务 26 秒。内置子任务可以学上游自己给子代理的做法：`--no-user-tools` 时从工具表去掉 `ask_user` 和 `start_long_term_update`（`agentmain.py:46`）。外置工作台是用户自己的 GA，不能动。
- 备忘前读 L0：memo.md 加一句「备忘不是你自己的记忆，不用读 L0」，能省掉 10-26 那种多出来的一步。
