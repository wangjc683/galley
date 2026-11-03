# 142 模型在调工具那一步写给你的话，工具开跑之前就送到你面前

Status: needs-dogfood（2026-11-04 快进合入 `79d42fc6`。量：真实库你发起的轮里没结束的 209 步，`<summary>` 之外有字的只有 1 步（「还要多久」那次，对你说的），评测样本 208 段里 207 段对你说，过八成门槛；真实使用里很少触发，主要在插话之后。主会话验收：读过报告与变异检验；代理验证 workspace 1,334 条、runner 767 条、vitest 2,813 条与门禁过。`tell_user` 说明里「最后回复之前别的话用户看不到」那半句随票 139 改回。没有真模型、没有 dev 走查，139 合入后主会话走）

来源：[主对话 PRD](../PRD.md) 裁决 191。只在内置运行时的主对话；外置零变化（外置没有主对话）。

## 为什么

- 11-03 dev 真机：你让它「每隔 20 秒看一次下载文件夹，看 3 次」，15 秒后插话「还要多久？」。插话在第 1 步后送到（票 136）；模型没调 `tell_user`（票 137），把「还需要约 1 分钟……」写在调工具那一步的正文里（`<summary>` 之外）。那一步要等工具跑完（60 秒）才落库，主对话又不把步骤正文画成气泡，你问完 87 秒后才从最后的回复里知道。
- 票 137 评测「还要多久」那条用例 9 遍里 7 遍同样（`.scratch/main-chat/entry-layer-eval/tell-user/results.md`）。模型天然会边调工具边跟你说话，以为你看得到。
- 裁决 191：让它本来就做的事管用。`tell_user` 留着。

## 第一步：先量（只读），不够格就停

只读查真实库（`~/Library/Application Support/app.galley/workbench.db`，`sqlite3 -readonly`），主对话（`sessions.main_chat = 1`）10-20 起：

1. 你发起的那些轮（一轮的开头是 `sequence = 0` 的 user 行，且不是 `[Galley — not a message from the user]` 开头的叫醒），没结束的步骤（一轮里最后一步以外、带工具调用的 assistant 行）有多少；其中 `<summary>` 之外（也去掉 `<next-suggestion>`、`<subtask>` 这类标签，照回复的清洗规则）还有字的有多少。
2. 有字的那些，逐条判：像是对你说的话（「我来查一下……」「还需要约 1 分钟」「好，只数 PDF」），还是自言自语、给自己记的（「先读手册」「检查语法」「重新发送命令」），还是别的。数各类的条数与占比。
3. **门槛**：对你说的话不到八成，就停在这里，把数字与分类写进报告回给主会话，不实现。

**隐私**：这些是 JC 主对话里的真实文字。票面与报告里不抄原文；只写形状与类别，举例用虚构的、不含人名地名金额路径的句子并标明虚构。会话 id、消息 id 不写进票面。

## 第二步：实现（过了门槛才做）

1. **什么字**：主对话里、你发起的那一轮（你发的话或插话开启的运行）中，模型某一步的回复带工具调用、又在 `<summary>` 之外写了字（照回复的清洗规则洗过后不空），这段字在模型这次回复收完、工具开跑之前，就当作「先说的一句」送到你面前。
2. **不送的**：
   - Galley 自己醒来的那几轮（子任务叫醒、到点提醒、巡看）：那几轮可能以 `<no-reply/>` 收尾，不能中途漏话。Core 知道这一轮是谁开的。
   - 这一轮最后的回复那一步：照现在的回复画法。
   - 同一步里又调了 `tell_user` 的：只送 `tell_user` 那句，不重复。
3. **落库与画法**：沿用票 137「先说的一句」：同一个 `turn_index`、`sequence` ≥ 2 的 assistant 行，画成左侧气泡，点点与进展小字在它下面接着跑；不单发通知、不算「回复完成」。手机照样收到。
4. **回放**：冷启动回放时模型看到的仍是它当时写的那一遍，不能因为多了一行而看到两遍（那段字已经在那一步的内容里）。怎么做由你定（比如这一行回放时跳过，或那一步回放时去掉这段），写进设计。
5. **在哪接**：最早拿到「这次回复收完、工具还没跑」的地方。看 `runner/handlers.py` 的 `WorkbenchHandler.dispatch`（工具开跑前、手里有这次回复）与票 137 的 `runner/tell_user.py`、`workbench_bridge.py` 怎么发 `tell_user` 事件；尽量复用那条事件与 Core、GUI 的整条路，不另开一套。
6. **评测或测试**：单测覆盖：你发起的一轮里带字的步骤送到、在工具开跑之前；叫醒的一轮不送；最后一步不送；同一步 `tell_user` 不重复；回放不重复。真模型不必另跑评测（这是确定的画法），票 139 合入后主会话在 dev 里走。

## 怎么做

- **先读**：`AGENTS.md`（宪法）；票 136、137 的「设计」与「报告」（插话与「先说的一句」的落库、`sequence`、回放、GUI 画法）；裁决 186、189、191；`docs/design/conversation.md` 主对话一节。
- 第一步的数字写进本文件「## 量」一节；过了门槛再写「## 设计」一节，然后实现。
- 同时在跑：票 139（改 `core/src/managed_prompt.rs` 主对话入口层、删 `runner/handlers.py` 里票 135 的硬闸、改手册与评测）。你可能也要动 `handlers.py` 的 `dispatch`：只加你的那一段，别碰硬闸那几行；合入时我来对，报告里写明碰了哪些地方。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui exec vitest run
node scripts/check-docs-links.mjs
git diff --check
```

worktree 里跑 runner 测试借主树的 venv，先打印 `runner.__file__` 确认 import 的是 worktree 的代码。import `managed-ga/code` 的探针都用 `python -B`。

## 环境与边界

- 第一步只读，不需要 worktree；过了门槛再建：
  ```bash
  cd <主树>
  git worktree add -b t142-step-text <scratchpad>/wt-142 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  pnpm --dir <wt>/gui install
  ```
- 绝不碰主工作树的代码（JC 的 `tauri dev` 常驻在主树）；不跑 `tauri dev`；不写数据库。
- Core 不是 rustfmt-clean：只对自己改过的 Rust 文件跑 `rustfmt --check`。GUI 不是 prettier-clean：旧文件只格式化自己的 hunk。
- 只停在第一步时：在主树只提交本票文件（`git add <本票> && git commit …`，提交前 `git status` 确认没带上别人的改动）。实现时：在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t142-` 前缀。票面里不写本机用户目录、worktree 路径、服务商名、接口主机。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：第一步的数字与分类（不抄原文）、过没过门槛；过了的话：设计要点、改了哪些文件、测试与验证结果（数字照抄命令输出）、提交号（照抄 `git log --oneline -1`）、看到但没改的（Open risks），原样列出。

## 量

（2026-11-03 晚，执行代理，只读。真实库用 `sqlite3 -readonly` 同等的只读连接；脚本在 scratchpad，不进仓库。）

**真实库**：主对话（`sessions.main_chat = 1`，10-20 建）到 11-03 晚。

| 项 | 数 |
|---|---|
| 一轮（`sequence = 0` 的 user 行开头） | 91 |
| 其中你发起的 / 叫醒 | 69 / 22 |
| 你发起的、两步以上的 | 59 |
| 你发起的轮里没结束的步骤（最后一步以外、带真工具调用的 assistant 行） | 209 |
| 其中按回复的清洗规则洗过（`final_answer` 列，即 `clean_final_answer(content)`）还有字的 | **1** |
| 其中同一步也调了 `tell_user` 的 | 0 |
| 对照：叫醒那几轮的没结束步骤 / 有字的 | 44 / 0 |

- 另外 208 步的原文只有 `<summary>…</summary>`（没有一步缺 `<summary>`），洗掉什么都不剩；不是洗掉了别的标签才空。
- 那 1 条就是「为什么」里那一条（11-03 dev 真机，插话问还要多久之后的那一步）：告诉你还要多久、接下来怎么做。**对你说的 1 条，自言自语 0，别的 0；100%，过门槛。**
- 底数只有 1。所以另量了一份**补充**：`.scratch/main-chat/entry-layer-eval/` 各套件的 `results.json`（虚构用例、主对话提示词、同一模型经 API key、推理强度 high），同一判法（每次运行最后一轮以外、带工具调用的轮，按同一套规则洗）：747 次运行、1,260 个没结束的步骤、210 个有字；叫醒套件（`wake/`）的 2 条不算，你发起的用例里 **208 条**。逐条读：
  - **对你说的 207 条（99.5%）**：说接下来做什么、怎么做（虚构例：「我先看一下下载文件夹里的大文件。」「我会按内容分类，不删除文件。」），回答「还要多久」（9 遍「还要多久」用例里 7 遍在这里），说交出去的东西会是什么样（「整理稿会注明价格只是粗估。」），也有问你、接你话的（「车票这边，你从哪个城市出发？」「一年级啦，变化挺大的。」）。其中 3 条口吻是对你说、内容是它自己的流程（「我先确认任务执行规则，再交给后台处理。」）。
  - **像给自己记的 1 条**：没有对象、只说做法的一句（虚构例：「按本机日期定『昨天』，避免跨时区。」）。
  - **别的 0 条。**
- **频率差得多**：真实库里没结束的步骤 0.5% 有字（1 / 209），评测里 17.6%（208 / 1,179）。原因没查（真实主对话走订阅登录、评测走 API key；评测用例偏长活与派活）。照真实频率，这条路平时很少触发，主要在插话之后。

**结论**：真实库 1 / 1、补充 207 / 208 是对你说的，都过八成，进第二步。

## 设计

（2026-11-03，执行代理写于实现之前。）

### 一句话

模型某一步的回复带工具调用、`<summary>` 之外还有字，runner 在这一步第一个工具开跑之前，把洗过的字当作「先说的一句」发出去：同一个 `tell_user` 事件，多一个 `stepText: true`。Core 照票 137 写一行（同一个 `turn_index`、`sequence` ≥ 2），只多标一个来源，让回放跳过它；GUI 一行不改，照「先说的一句」画。

### 在哪接：`WorkbenchHandler.dispatch`，第一个工具开跑之前

- GA 的循环（`agent_loop.py` `agent_runner_loop`）拿到模型的整个回复后，按顺序对每个工具调用 `handler.dispatch(tool_name, args, response, index=ii, …)`。`index == 0` 那一次进来时，回复已经收完、还没有一个工具开跑，手里有 `response`：这是最早的点。
- handler 在 `index == 0` 时把 `response` 和这一步的步号交给 bridge 的回调（`step_text_callback`，同 `tell_user_callback` 的接法），bridge 决定发不发。读 `response.content`、`response.tool_calls` 只读，不改派发、不改结果；回调出错吞掉，不碍这一步（同 `tool_before_callback`）。
- **放在 `tell_user` 那一段之后、交给 GA 的派发之前**，不放在 `dispatch` 开头：票 139 要删开头的浏览器闸，紧挨着加会撞。代价：139 合入之前，第一个工具被闸挡下的那一步不发（闸挡下的工具本来就不跑）；139 合入后没有这个差别。第一个工具是 `tell_user` 时那一段先返回，这一步本来就不发（见下）。

### 发什么：`runner/step_text.py`

- **字**：`response.content` 按回复的清洗规则洗（`cleanFinalAnswer` / Core `clean_final_answer` 的 Python 版：去掉 `<thinking>`、`<summary>`、`<tool_use>`、`<file_content>`、`<next-suggestion>`、`<goal-status>`、`<subtask>`、`<no-reply/>`，没闭合的 `<subtask>` 起全去，去掉 GA 的 `LLM Running` 标记、`[Action]` 行、「当前阶段：」段、`[FILE:]`，三个以上换行并成两个，去首尾空白）。洗完是空就不发。发的是洗过的字。
- **哪一步**：`response.tool_calls` 至少有一个调用，且其中没有：
  - `tell_user`：这一步已经有它要先说的那句，只送那句（裁决 191 第 2 条）；
  - `ask_user`：GA 的 `do_ask_user` 结束这一轮，问的那一步就是这一轮最后一步，画法是提问气泡；先说的一句还会排在提问后面（票 137 Open risk 1）。
  - 没有工具调用的那一步（GA 记作 `no_tool`）是这一轮的回复，本来就不经过这里。
- **哪一轮**（bridge）：只在内置运行时的主对话（`tell_user.offered_here()`，同一组条件；外置、工作台、子任务、IM 什么都不发），且这一轮是你发起的：
  - Core 在 IPC `user_message` 上加一个字段 `wake: true`，只有叫醒（`subtask_report::deliver`：子任务汇报、到点提醒、巡看都走这里）带；别的 `user_message`（你发的话、队列里发出的、插话没赶上退回后发出的、CLI `session send`）不带。runner 每次开一轮时记下：`user_message` 看 `wake`，`ask_user_response`（你回答它的提问）算你的。这样「这一轮是谁开的」只由 Core 定（Core 知道），runner 不认提示词开头的字。
  - 插话送进一轮叫醒里，这一轮仍按开头算（叫醒），不发。
- **索引**：同 `tell_user` 的 `index`（这一步第几句，从 1 起）。同一步里不会两边都发，所以不撞 id。

### 事件与落库

- **IPC（加法）**：`tell_user` 事件加 `stepText`（runner 总是写，`false` / `true`）；`user_message` 命令加 `wake`（只在为真时写）。`runner/ipc.py`、`core/src/ipc.rs`、`gui/src/types/ipc.ts`、`docs/ipc-protocol.md` 同步。
- **Core**：`tell_user::persist` 照旧写行（`msg_{session}_{turn}_tell_{index}`、`sequence` 取已有最大值加一且至少 2、`content` 为这段字、`final_answer` 为洗过的字、可见时进搜索）；`stepText` 为真时多写来源：`created_via = 'system'`、`supervisor = 'galley-step-text'`（`MAIN_CHAT_STEP_TEXT_SUPERVISOR`）。助手行从来不带自己的来源，问候用的就是这一对做法（`galley-greeting`），所以这一对只认这种行，不新开迁移。
- **GUI**：不改画法。直播从 `runner-event` 的 `tell_user` 画（`interim` agent turn，行 id 同上）；冷恢复 `rowsToTurns` 把 `sequence` > 1 的助手行读成同一种（不看来源）。三点与那一行在它下面接着跑、不发通知、不算回复完成、侧栏、删除，全同票 137。只在 `ipc.ts` 镜像加字段。
- **手机**：`runner.event` 里原样收到；冷读是 `sequence` ≥ 2 的 agent 行。

### 回放：这一行跳过

- 那段字已经在那一步自己的行里（`content` 是 GA 的原文，回放原样给模型）。这一行再回放，模型就会看到两遍。
- 做法：`ReplayRow` 的 `shown_only`（「给人看、不进模型历史」，原来只有问候）加上这一对来源（`is_main_chat_step_text`）。回放、新段带过来的轮次（carry）、子任务带出门的背景（票 138）都经 `ReplayRow::from` 读行，一处改到。`main_chat_carry_from` 的 SQL 不用改：这一行永远排在它那一步之后，不会是一轮的第一条或最后一条回复。
- 没选「回放时从那一步的原文里去掉这段」：洗过的字不一定是原文里连续的一段（中间可能夹着标签），去起来不稳；原文是 GA 的，留原样。

### 宪法 Rule 1

只读 GA 交给 handler 的 `response`；只在 `tell_user.offered_here()` 为真（内置运行时、`GALLEY_MAIN_CHAT=1`）时发事件。外置运行时零变化。耦合点（`dispatch` 的 `index`、`response.content`、`response.tool_calls[].function.name`、「`index == 0` 那次在任何工具之前」）写进 `docs/ga-baseline.md` 契约面第 23 项。

### 测试

- runner（`runner/tests/test_step_text.py`）：洗字规则；哪一步发（带工具有字发、只有 `<summary>` 不发、同一步有 `tell_user` / `ask_user` 不发、没有工具不发）；bridge：你发起的一轮发、叫醒不发、回答提问的一轮发、外置与工作台不发、一轮已关不发；用内置 payload 自己的 `agent_runner_loop` 跑一遍（同票 137 的「会响」测试的做法）：事件在第一个工具开跑时已经在事件队列里、最后一步的回复不发、叫醒那一轮不发。
- Core：mock runner 发一条 `stepText` 的 `tell_user`：行的位置、来源、冷回放里这段字只出现一次；叫醒发出的 `user_message` 带 `wake: true`；普通发出的不带。

## 报告

（2026-11-04 凌晨，执行代理。分支 `t142-step-text`，从 main `06ccf342` 起，没有 rebase。）

### 第一步

见上「## 量」：真实库 209 个没结束的步骤里有字的只有 1 个，是对你说的（100%）；补充的评测数据 208 条里 207 条对你说（99.5%），1 条像给自己记的。过门槛，做了第二步。

### 做成了什么

照「设计」做的，没有偏离。

- **runner**：新 `runner/step_text.py`（洗字规则的 Python 版、哪一步发：带工具、没有 `tell_user` / `ask_user`、洗完不空）；`handlers.py` 的 `WorkbenchHandler` 加 `step_text_callback`，`dispatch` 在 `tell_user` 那一段之后、交给 GA 之前，`index == 0` 时把回复交给 bridge（出错吞掉）；`workbench_bridge.py` 加 `_run_from_user`（`user_message` 看 `wake`，`ask_user_response` 算你的）、`_tell_step_text`（内置主对话、你发起的一轮才发），`_tell_user` 与它共用 `_send_told_line`（同一把锁、同一个 `index` 计数）；`ipc.py` 加 `TellUserEvent.stepText`、`UserMessageCommand.wake`。
- **Core**：`ipc.rs` 两个字段（`wake` 只在为真时写）；`subtask_report::deliver` 写 `wake: true`，其余的 `UserMessageCommand`（产品代码 7 处、测试 7 处）写 `false`；`persist_told_line` 加 `step_text`，为真时写来源 `system` / `galley-step-text`（`MAIN_CHAT_STEP_TEXT_SUPERVISOR`、`is_main_chat_step_text`，在 `db/main_chat.rs`）；`ReplayRow::from` 的 `shown_only` 加上它（回放、carry、子任务背景同一处）；`tell_user.rs` 传字段、模块文档加一段。
- **GUI**：只改 `types/ipc.ts` 镜像；画法不变。
- **文档**：`docs/ipc-protocol.md`（§4.21 `stepText`、§5.1 `wake`）、`docs/architecture.md`、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`（新一节）、`docs/ga-baseline.md`（契约面第 23 项与审计入口）、`docs/design/conversation.md`（「在跑时它先说的一句」下加一条）、`docs/agent-api/session-commands.md`（加法：这种消息带的 `origin`）。

### 碰到的并行区域（票 139）

- `runner/handlers.py`：只加了 `__init__` 的一个关键字参数与属性，和 `dispatch` 里 `tell_user` 那一段之后的一段。没碰模块与类的文档串、导入、硬闸那几行（139 都在改）；所以文档串还没提这一段，合入时可以补一句。
- `runner/workbench_bridge.py`：导入行、`__init__`、`_install_handler_subclass`、`_tell_user` 一带、`dispatch_command` 两处；139 的那一段（`_interjections_allowed`）没碰。
- `runner/tests/test_tell_user.py`：只改了往返测试那一行（加 `"stepText":false`），离 139 的改动远。
- `docs/ipc-protocol.md` §4.21：在「消费方」那一条之后加一条，139 改的是它上面那一条；`docs/ga-baseline.md`：第 22 项之后加第 23 项，审计入口在 `tell_user.py` 那一条之后加一条，139 改的是 handlers 那一条；`docs/managed-ga-runtime/runtime-modes-and-sessions.md`：`tell_user` 一节末尾之后新一节，139 改的是那一节开头。都隔着没改的行，预计不冲突，没实际合过。
- 没碰 `core/src/managed_prompt.rs`、`runner/tell_user.py`、手册、评测。

### 验证（数字照抄输出）

- `cargo test --manifest-path core/Cargo.toml --workspace`：47 组 `test result`，合计 1334 passed，0 failed
- `.venv/bin/python -m pytest`（先打印 `runner.__file__`，是 worktree 的）：`767 passed, 6 deselected`
- `.venv/bin/python -m mypy runner`：`Success: no issues found in 43 source files`
- `.venv/bin/ruff check runner`：`All checks passed!`
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`：通过
- `TZ=UTC pnpm --dir gui exec vitest run`：`Test Files 254 passed (254)`，`Tests 2813 passed (2813)`
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 493 files checked.`
- 另跑：`check-ipc-protocol-drift`（`python: 18 events, 9 commands; rust: 18 events, 9 commands; ts: 18 events, 9 commands`）、`check-ga-baseline-drift`（`OK (d66509bf)`）、`check-managed-ga-payload`（`OK`）；`managed-ga/` 下没有 `__pycache__`
- `git diff --check`：无输出
- 只对自己改过的 Rust 文件跑 `rustfmt --check`：原本干净的都还干净（`subtask_report_test.rs` 整篇格式化过）；`db/session.rs` 在 main 上本来就不干净，剩下的差异只在第 942 行（不是这票的）。GUI 的新测试文件与 `ipc.ts` 过 prettier。

新测试：

- runner `test_step_text.py` 29 条：洗字规则对 GUI 生成的 38 条黄金行（`turn-persistence-rows.json`，含 JavaScript 的空白与换行符边角）逐条一致，加 10 条例子；哪一步发（带工具有字、只有标签、没有工具、同一步有 `tell_user`、提问那一步）；handler 在第一个工具开跑之前交出、第二个调用不交、回调出错不碍 GA；bridge：你发起的发（`stepText: true`、步号、`index`、绝对步号）、`tell_user` 那句是 `false`、叫醒不发而下一轮你的照发、回答提问那一轮算你的、一轮已关不发、工作台 / 非主对话 / 外置不发、`wake` 的线上格式；**内置 payload 自己的 `agent_runner_loop` 跑两轮**（同票 137 的「会响」测试的做法）：你发起的那轮，GA 的 `file_read` 开跑时这句已经发出、早于这一步的 `turn_end`，最后的回复不发；叫醒那轮不发；工作台会话不发。
- Core：`a_line_said_in_a_step_shows_once_and_replays_once`（位置、id、来源、冷回放里这段字只出现一次、普通发出的 `user_message` 不带 `wake`）；`an_idle_main_chat_is_woken_at_once_with_the_report_row` 加断言：叫醒发出的带 `wake: true`；`ipc.rs` 两个线上格式测试各加一段。
- GUI `step-text.test.ts` 3 条：带这种来源的行恢复成「先说的一句」、不是问候；画出来只有这一句和回复（那一步照旧是一步）；带 `stepText` 的事件照常落下。
- 变异检查（做完已还原）：把交出挪到 GA 的工具跑完之后，3 条红（含引擎那条）；bridge 忽略 `wake`，2 条红；回放不跳过这一行，Core 那条红（这段字出现 2 遍）。

### Open risks（看到但没改的）

1. **139 合入之前的一个缺口**：这一段放在 `tell_user` 那一段之后（为了不和 139 删硬闸撞），所以第一个工具被浏览器闸挡下的那一步不发。139 删了闸就没有这个差别。
2. **`tell_user` 说明里那半句不再全对**：「until your final reply, nothing else you write reaches them」在你发起的一轮里不成立了（调工具那一步写的字会送到）。没改：139 在改 `tell_user.py`，说明改了要重跑评测；要不要改、怎么改由主会话定。
3. **插话送进叫醒那一轮之后仍不发**：按这一轮的开头算（裁决 191 第 2 条的字面），票 136 在同样情况下把三点改成按「你开的一轮」画；两边不一致。
4. **回答提问开的一轮算你的**：即使它答的是叫醒那一轮里问的问题；那一轮之后若转告子任务、以 `<no-reply/>` 收尾，中途可能已经发了一句。真实库里主对话从没调过 `ask_user`。
5. **删除不对称**：删这条气泡只删这一行，那段字还在那一步自己的行里，模型冷回放时仍看得到（`tell_user` 那句删了模型就看不到）；删回复会带走那一步，气泡留着但模型不再看到。
6. **搜索会命中两次**：那一步自己的行本来就按 `final_answer` 进搜索，这一行也进；桌面搜索同一段字两条结果，其中那一步的那条在对话里不是一条消息。以前步骤有字时就这样，现在每次都这样（频率低）。
7. **平时很少触发**：真实库里没结束的步骤 0.5% 有字，评测里 17.6%，原因没查（见「量」）；主要会在插话之后出现。
8. **提问那一步的字照旧看不到**（设计里排除了）；过程卡片里那一步展开后也能看到这段字（卡片本来就画步骤的字）。
9. **洗字规则现在有三份**（TS、Rust、Python）：Python 这份由黄金行钉住，GUI 改了规则、重新生成黄金行时这条测试会先红。
10. **没跑真模型、没上 dev**：按票面，139 合入后主会话在 dev 里走；落下时没有动效，同票 137 Open risk 2。
11. `docs/project-status.md` 的未发布范围没动，留给主会话合入时写。
