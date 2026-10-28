# 108 待办上的进展写进备注：它做成了什么、你告诉它的新消息，补一行在备注最前面

Status: 待合入（2026-10-28 裁决 154，JC：「按你推荐推进」。代理当晚交回分支 `t108-progress-in-notes`，rebase 到 `590003d3` 后是 `ead30eb3`、`5d7d407b`；合入要等 10-29 巡看跑完、主会话查库记下它做了什么之后。主会话验收：读过手册三处（`todos-change.md` 那条按「最前面」写；`unasked.md` 一句指向；`todos.md` 的 `--notes` 末尾一句指向是代理加的：第一轮 `news-budget` 有一遍听到新消息只读了 `todos.md` 等、没读 `todos-change.md`，备注没动，加了指向后第二轮 9 遍都读到）与 `assistant_manual.rs` 的片段测试；在 worktree 重跑 `cargo test --workspace` 1257 条全过，文档链接、`git diff --check` 过，新增行扫本机路径与服务商名 0 处；抽看 `progress-review-done` 第 1 遍：最前面一行「10月28日：三家报价已对比，文件：…；待确认搬家日期……尚未预订。」，原备注一字不差在下。代理报的评测：第二轮新用例 6 条 × 3 遍全过；回归 13 条全过、没有一条动了备注；旧手册对照 4 条与反向检查 2 条都不过（旧手册下它自己会把新消息写进备注一半，但接在末尾、没日子、或整段换掉）；共 238 次模型调用。代理报的没解决：巡看补的那一行 139–227 字（假 HOME 路径约占 100 字），手册没限长短，JC 10-28 定先不限（裁决 154 第 9 条）；第一轮有一遍把对比文件写进了状态根的 `temp`，第二轮都在 `~/Downloads`；没测到：子任务带文件回来那次叫醒、要查网页的巡看（希尔顿那种）、最前面已有几行时再补、旧手册对照与反向检查各只一遍、「早上做的」这句话（评测在晚上跑））

来源：[主聊天 PRD](../PRD.md) 裁决 154（2026-10-28）。deferred「待办上的进展」方案 1。只改手册与评测，不动代码。只在内置运行时；外置运行时没有主对话与待办，零变化。

## 为什么

- 它替一件待办做成的东西只留在对话里；面板上那一行从记下到截止一模一样，回答不了「推进到哪了」。票 107 起打开一行能看到备注全文、保留换行，备注就是现成的地方。
- 下次巡看它读 `todo show` 就知道做过什么，不重做（裁决 125 第 2 条：10-22 巡看以为 NBA 没答完，派子任务重做）。
- 用户告诉它一件事的新消息（「业主说预算下周给」），手册只管记下那一刻往备注里写什么（`docs/managed-ga-runtime/galley-assistant-manual/memo.md:54`），没说之后怎么办。

## 要做的

1. **手册 `todos-change.md`**：在第一条（用户让你改）之后加一条。起点措辞如下，评测里可以改，改了在回报里写原因：

   > - How it is going: when you got something done for a to-do (something you found, a file you made, something ready for them to decide on), or the user tells you news of it (「业主说预算下周给」), add one line at the start of its notes, above what is there (newest first), the day first, in the user's language (「10月29日：公开资料整理好了，还缺证照进度和预算」), a file by its absolute path. It is there when they open the to-do, and for you when you next look at it. Read the to-do first (`todo show <todo-id>`) and keep what is there below it, word for word. Not that you looked and nothing changed, nor a line for each step: one line for what came of it. When the news moves the time, move the due date and the reminder too.

2. **手册 `unasked.md`**：「Tell the user」那一条末尾补半句：做的是为某件待办，也在它的备注里补一行（见 `todos-change.md`）。只加指向，规则只写在 `todos-change.md` 一处。
3. **别处的事实同步**：grep 描写备注里写什么的散文（`docs/design/conversation.md`「待办面板」的备注一节、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`、`docs/agent-api/todo-commands.md`、`todos.md` 的 `--notes` 那条），只在说法与新规则冲突时改；设计文档备注一节补半句「备注最前面也会有它补的进展，最新的在上，一行一个日子（2026-10-28，票 108，裁决 154）」。
   - **为什么在最前面**（派票后改，主会话 10-28 当晚通知过代理）：收起时备注压成一行从头截断（`gui/src/lib/todo-panel.ts:282`，约 21 字），补在末尾的进展在有备注的那件上收起时永远看不见。
4. **Core 的手册测试**：手册 `include_str!` 进 Core（`core/src/assistant_manual.rs`），改了要让它的测试（片段、预算）全过；预算按本机加 18 字节留 Windows CRLF 的余量。

## 评测

评测在 `.scratch/main-chat/entry-layer-eval/`（先读 `README.md` 的「怎么跑」「待办评测（票 41）」「主动的第一阶段（票 73）」「备注写给用户看（票 81）」）。模型用默认的 `mm_1792576875658`（API key 接入的 gpt-6.1-sol）；先 `--dry-test` 零额度验拦截。脚本读的手册要是你 worktree 里改过的那份，先核对它从哪读。

新用例（每条跑 3 遍，WITH 新手册；能对照的给一组旧手册的 WITHOUT）：

1. **你告诉它的新消息**：清单里有「希尔顿酒店项目上下文资料收集」（带它原来那段备注），用户说「业主说筹开预算下周给我」。该：先读这件事，`todo update --notes=` 是一行「<今天>：业主说筹开预算下周给」在上、换行、原备注一字不差在下；不另记备忘。顺带给自己挂一个下周问预算的提醒可以，不算错，记下次数。
2. **新消息挪了时间**：702 那件（11-20 截止、挂着提醒），用户说「装修队说要拖到 12 月 5 号」。该：截止与提醒一起挪，备注补一行原因。
3. **巡看做成了东西**：巡看叫醒，有一件它能推进的待办（参考已有的 `review-advance`），它做完之后，该：备注补一行写做了什么、文件写绝对路径，对用户那条消息照旧。
4. **巡看看过没变化**：该：备注不动，`<no-reply/>`。
5. **用户改过备注**：`todo show` 返回的备注与它当初写的不一样（用户在面板里删了一条要点）。该：新的一行补在用户改后的那份上面，不把删掉的写回来。
6. **和待办无关的一句**：用户说的事不属于清单里任何一件。该：不动任何待办的备注。

另外重跑待办套件里写备注的旧用例（`note-*`、`reno-*`、`wake-todo`、`review-*`）各一遍，看有没有回退。

判定写进结果文件：每条该做的、实际做的、算过还是没过。结果里不写服务商名、不写本机路径（`/Users/…`、临时目录）；提交前全量扫一遍。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。Rust 用克隆的 target（`cp -cR`），补 sidecar 占位文件、python-bundle 与 gen。
- 代码（Core、CLI、GUI、runner）、Agent API、入口层提示词（`managed_prompt.rs`）。改手册以外的东西先停下来问。
- 不加叫醒、不加调用、不做汇总（裁决 154 第 5 条，不变回事项账本）。
- 跑评测用 `PYTHONDONTWRITEBYTECODE=1`，`managed-ga/code/` 下不许出现 `__pycache__`。
- 注释与提交说明照周围写法；提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。
- 中文全角标点：手册、设计文档、README、结果文件新增的中文行，自写正则扫，脚本放 scratchpad、文件名带 `t108-` 前缀。

## 验证

- `cargo test --manifest-path core/Cargo.toml --workspace`（含 `assistant_manual` 的测试）
- `node scripts/check-docs-links.mjs`、`git diff --check`
- 评测：新用例 6 条 × 3 遍与旧用例回归，结果进 `todo/`（或你新开的套件目录）的 `results.json` / `results.md`，README 加一节「进展写进备注（票 108）」
- 反向检查：把手册那条临时拿掉，跑用例 1 与 3 各一遍，应当不补那一行（备份文件再改，别用 `git checkout --`）

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 手册两处的最终原文；跟起点措辞比改了什么、为什么。
3. 评测：每条用例过了几遍、没过的原文摘录；回归有没有掉；反向检查结果；花了多少次真调用。
4. 验证命令与结果原样。
5. 票面没写到、你自己定的边界；看到但没改的问题；没验证到的（逐条）。

## 给 JC 的真机步骤

合入前主会话看 `busy:0`；合入后 touch `core/src/assistant_manual.rs` 让 dev 重编 Core，手册等主对话 runner 下次启动才写进状态根。

1. 打开待办面板，点开希尔顿那件，在备注里删掉一个字，点别处（顺带补走票 107 第 2 步，主会话查库核）。
2. 在主对话里说「业主说筹开预算下周给我」。先看收起的那一行：备注那一行变成「<今天>：业主说筹开预算下周给」开头。再点开：最上面是这一行，下面是你改过的备注，原样。它可能顺带挂一个下周问预算的提醒，不算错。

## Comments
