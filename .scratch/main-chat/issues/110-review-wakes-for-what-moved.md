# 110 巡看只为上次巡看以来动过的事醒；交出去的东西用户没回话，下一步在用户手里

Status: needs-dogfood（2026-10-29 10:55 快进合入 `253ce54a`…`c1c5b668`，touch `core/src/assistant_manual.rs` 让 dev 重编 Core；合入前 10:15 已查库记下 08:51 那次巡看（裁决 155 第 5 条「对照结果」）。主会话验收：第一轮交回的判据对窗口外刚改过的待办也叫醒（`moved || 新进窗口` 没限定在票 81 的范围里），与它自己的注释和裁决 128 第 4 条不符，交回改成先在票 81 的范围里再看动没动（`c1094cdf`，补三条不叫醒的测试）；rebase 到 `f687ae5e` 后 `cargo test --workspace` 1262 条全过，新 vitest 2 条过，文档链接、`git diff --check` 过，新增行本机路径 0 处（模型名与评测夹具里的 `claude-code` 标签 main 上已有）。代理报的评测：新用例 4 条 × 3 遍全过（交出去没回话不动；做过没写补一行不开口；最新一行是用户的消息照常推进；要隔几天再看的挂提醒不开口），旧手册对照 2/3、3/3、1/1、0/1，反向检查只在用例 4 上不过（用例 1、2 拿掉新那条也过：模型自己倾向不重做，补行靠票 108 的规则）；回归 12/13，掉的 `news-budget` 用最终手册补跑 3/3；第一段措辞改后四条新用例没重跑；共 57 次运行、261 次模型调用。用例 5：只有 `todo update` 加 `<no-reply/>` 的叫醒轮判静默，对话里什么都不画（vitest 固定）。代理自己定的：`wake.md` 给 `reminders.md` 的「Never set one without saying so」开了例外，巡看里挂的提醒不用说（评测第一轮用例 4 三遍都因这句开口，0/3），`reminders.md` 本身没改；`schedule run` 不走判据、一定会醒，但照样写 `last_fired_at`。没验证到：真机合入后第一个早上醒不醒；用例 4 真去查网页；巡看挂的提醒到点、查下来仍没变化时会不会开口。2026-10-29 裁决 155，JC：「按你推荐推进」）

来源：[主聊天 PRD](../PRD.md) 裁决 155（2026-10-29）。改写裁决 128 第 4 条的判据；deferred「待办上的进展」方案 4 的轻版。只在内置运行时；外置运行时没有巡看，零变化。

## 为什么

- **天天醒**：`core/src/assistant_todo.rs:180` 没日子的「你的事」一律让巡看醒（`None => true`），不看上次巡看以来动没动。JC 库里希尔顿没日子，不勾掉巡看就天天醒；醒了什么都不做也要几步（10-27 那次 4 步后 `<no-reply/>`）。
- **重做**：巡看常开新段，新段只带上一轮（裁决 50、125 第 2 条），第三天前一天做的就出了视野，只剩备注与翻历史；10-22 重做 NBA 是同一个机制。票 108 让它把做成的写进备注最前面，但手册没说下次巡看看到那一行该怎么办。
- **一天加一份**：`wake.md:63` 每天问「can you move it forward now?」，没有「交出去的东西用户还没回话，下一步在用户手里」。

## 要做的

### 乙：Core 的判据

1. `review_has_something_to_look_at`（`core/src/assistant_todo.rs:177`）与它在 `fire_review`（`core/src/scheduler.rs:459`）里的调用：有上一次巡看时（`task.last_fired_at`，醒了与跳过都会写它，备忘窗口用的是同一个，`core/src/api/memo.rs:316`），只算这几样：
   - 你的事里，上一次巡看之后新记的或改过的（`todos.created_at` / `updated_at` 晚于 `last_fired_at`）；
   - 截止日在上一次巡看那天（本机时区）加 3 天之后、今天加 3 天之内的，也就是这次才进窗口的；
   - 没结束的子任务里，上一次巡看之后有动静的（`TodoItem.at` 是子任务的最近动静，核对它的含义再用）；
   - 新备忘照旧（票 95 那一半不动）。
   没动过的不算，逾期的同理。从没巡看过（`last_fired_at` 为空）照旧按现在的判据。醒了以后照旧过一遍全部在办的事，改的只是醒不醒。
2. 跳过时的日志那句（`scheduler.rs:519` 附近「nothing to look at (no to-do any time or due within …)」）照新判据改。判据的文档注释（`assistant_todo.rs:94`、`:160` 起，`scheduler.rs:438` 起）照新判据改，写明出处（主聊天票 110，裁决 155）。
3. 不加迁移、不加表、不加列；`todo list` / `todo show` 的 CLI JSON 与 Agent API 一个字段都不变（`TodoItem` 是序列化的：要带 `updated_at` 就不进序列化，或在调度器里另读）。需要加迁移或改接口才做得成，先停下来问。
4. 查 `galley schedule run <id>` 对巡看走不走这个判据：走的话，同一天手动再跑一次会因「没动过」跳过。不改它的行为，在回报里写清楚；主会话以后手动试跑要靠先让一件事动一下。

### 甲：手册

5. **`wake.md` 晨间巡看一节**（`docs/managed-ga-runtime/galley-assistant-manual/wake.md`），起点措辞如下，评测里可以改，改了在回报里写原因：
   - 第 57 行起那句「skips the morning when there is nothing to look at … and no memo is new since the last review」改成新判据：只为上次巡看以来动过的事醒（新记的或改过的待办、这几天才临近截止的、有新动静的子任务、新备忘）；保留「when it wakes you, go over everything in hand」。
   - 「Take each thing in turn」那条之后加一条：
     > - Read a to-do (`todo show`) before you do anything for it. When its notes start with something you got done for it and the user has said nothing of it since, it is in their hands: leave it until they do. When the conversation shows you got something done for it that its notes do not say yet, add that line first (`todos-change.md`). When something is worth another look on a later day (a status that changes), set yourself a reminder for then (`reminders.md`) rather than waiting for the review.
6. **Core 的手册测试**：手册 `include_str!` 进 Core（`core/src/assistant_manual.rs`），片段、引用计数、预算的测试全过；预算按本机加 18 字节留 Windows CRLF 的余量。
7. **别处的事实同步**：grep 描写巡看叫醒判据的散文（`docs/design/`、`docs/managed-ga-runtime/`、`docs/agent-api/`、`.scratch/assistant/PRD.md` 裁决 10「确定式的部分」、`docs/devlog/2026-10-22-todo-from-first-principles.md`），说法与新判据冲突的改，devlog 只在末尾补一句指向裁决 155，不改历史正文。

## 评测

评测在 `.scratch/main-chat/entry-layer-eval/`（先读 `README.md` 的「怎么跑」「待办评测（票 41）」「主动的第一阶段（票 73）」「进展写进备注（票 108）」）。模型用默认的 `mm_1792576875658`；先 `--dry-test` 零额度验拦截。脚本读的手册要是你 worktree 里改过的那份，先核对它从哪读。

新用例（每条跑 3 遍，WITH 新手册；1、2 再各跑一遍 WITHOUT 旧手册当对照）：

1. **交出去了、用户没回话**：巡看叫醒；希尔顿那件的备注最前面是它前一天补的一行（「10月28日：资料收集模板做好了：<绝对路径>」），下面是原备注；之后对话里用户没提过它。该：不为它派子任务、不做新文件、备注不动；没有别的事时整条回复 `<no-reply/>`。
2. **做过、备注还没写**（就是 JC 库里今早的样子）：新段带过去的一轮是子任务带着模板回来、它对用户说了两句；希尔顿的备注里还没有那一行。巡看叫醒。该：在备注最前面补那一行（日子、做了什么、文件绝对路径，原备注一字不差在下）；不重做模板、不再派子任务。回复照手册定（新东西没有就 `<no-reply/>`）。
3. **最新一行是用户的新消息**：备注最前面是用户告诉它的（「10月29日：业主发来了项目地址：……」），下面才是它前一天那一行。该：不被第 1 条的规矩挡住（可以为它做事，不要求一定做）；不重做模板。判定写清你怎么算过。
4. **要隔几天再看一眼的**：巡看叫醒，有一件刚记的「等签证审批结果」（备注里有查询入口），查得到的结果是还在审理。该：备注不补（看过没变化不写）、给自己挂一个之后的提醒、整条回复 `<no-reply/>`。评测拦截撑不起「查」这一步就降成你能撑起的样子，回报里写原因。
5. **界面画法**（不调模型）：用例 2 那种「这一轮只有 `todo update` 加 `<no-reply/>`」的叫醒轮，GUI 判不判静默（参考票 76 的静默判定与 `gui/` 里的解析），会不会画出步骤或卡片。只读代码、写 vitest 或在回报里写结论；要改 GUI 才对的，先停下来问。

另外重跑巡看与待办里写备注的旧用例（`review-*`、票 108 的 6 条、`wake-todo`）各一遍，看有没有回退；`review-advance` 那种新记的、什么都没做过的待办，巡看照旧要往前推。

判定写进结果文件：每条该做的、实际做的、算过还是没过。结果里不写服务商名、不写本机路径（`/Users/…`、临时目录）；提交前全量扫一遍。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- 入口层提示词（`managed_prompt.rs`）、runner、GUI 代码、Agent API、迁移。改上面「要做的」以外的东西先停下来问。
- 不加叫醒、不加调用、不加存储（裁决 154 第 5 条）。
- 跑评测用 `PYTHONDONTWRITEBYTECODE=1`，`managed-ga/code/` 下不许出现 `__pycache__`。
- 注释与提交说明照周围写法；`core/` 不是 rustfmt-clean，只用 `rustfmt --check` 核对自己动过的文件。提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。
- 中文全角标点：手册、设计文档、README、结果文件新增的中文行，自写正则扫，脚本放 scratchpad、文件名带 `t110-` 前缀。
- 时间相关的测试：本机跑过，再 `TZ=UTC` 与一个西半球时区（如 `TZ=America/Los_Angeles`）各跑一遍新加的测试。

## 验证

- `cargo test --manifest-path core/Cargo.toml --workspace`（含 `assistant_todo`、`scheduler`、`assistant_manual` 的测试）；新判据的单元测试至少覆盖：没日子的事上次巡看后没动过 → 不醒；新记的、改过的 → 醒；这次才进窗口的 → 醒；逾期没动过 → 不醒；子任务有新动静 / 没有；从没巡看过 → 照旧；新备忘照旧单独叫醒。
- `node scripts/check-docs-links.mjs`、`git diff --check`
- 评测：新用例与回归，结果进 `todo/`（或你新开的套件目录）的 `results.json` / `results.md`，README 加一节「巡看只为动过的事醒（票 110）」
- 反向检查：把 `wake.md` 新加那条临时拿掉，跑用例 1 与 2 各一遍，应当不过（备份文件再改，别用 `git checkout --`）

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. Core 判据改后的代码要点（函数签名、怎么读 `updated_at`、窗口怎么算）；`schedule run` 走不走判据。
3. 手册的最终原文；跟起点措辞比改了什么、为什么。
4. 评测：每条用例过了几遍、没过的原文摘录；回归有没有掉；反向检查结果；用例 5 的结论；花了多少次真调用。
5. 验证命令与结果原样。
6. 票面没写到、你自己定的边界；看到但没改的问题；没验证到的（逐条）。

## 给 JC 的真机步骤

合入前主会话看 `busy:0`，并且 10-29 08:51 那次巡看已经跑完、查库记下；合入后 touch `core/src/assistant_manual.rs`，核二进制与进程。

1. 不用做什么：合入后的第一个早上，主会话查库看巡看醒没醒、为什么醒（调度日志那句），以及醒了有没有为希尔顿再做东西。
2. 想看它动起来：在主对话里告诉它希尔顿的一个新消息（比如「业主说下周给项目地址」），第二天早上巡看应该为它醒一次。

## Comments
