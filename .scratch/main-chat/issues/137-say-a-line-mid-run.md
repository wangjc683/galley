# 137 先说一句：主对话在一轮中间先回你一句，不结束这一轮

Status: needs-dogfood（2026-11-03 快进合入 `9cd9fd32`…`c4a7f732`。工具在 runner 层（JC 选甲），条件是两条会报警的测试：主会话自己跑 `test_tell_user_survives_gas_tool_list_reload`、`test_tell_user_never_reaches_a_request_elsewhere`（工作台、外置）都过；代理验证 workspace 1,333 条、runner 738 条、vitest 2,810 条与门禁过。评测：插话的用例 36 遍用了 2 遍，不插话的 24 遍没用；票 139 收完派活条款后要重跑）

来源：[主对话 PRD](../PRD.md) 裁决 186 第 2 条（「少规矩、多手」的第二只手）。只在内置运行时的主对话；外置零变化（宪法第 1 条：外置 GA 不打补丁、不加工具）。

## 为什么

- 有了插话改道（票 136），你在它干活时说的话，下一步就送到它面前。但 GA 一轮只出一个回复：它想先回你，只能把手上的交出去，或者结束这一轮。选项太少，它就容易闷头做完，你还是在等。
- 真人助理会边查边回你一句：「记上了，天气还在查」。
- 136 的 dev 真机（票面 Status 行）：插话「只数 PDF 和图片就行」在第 1 步后读到，第 2 步改了方向；它没有先回一句，因为现在没有这只手。

## 要做到

1. **一个工具**：给主对话一个「先给用户发一句话」的工具，这一轮不结束、接着做。只在主对话里有（runner 已经认得主对话：`GALLEY_MAIN_CHAT` 环境变量，`runner/handlers.py`；Core 在 `core/src/runner_commands.rs` 设）；工作台会话、子任务、IM 渠道、外置都没有这个工具。
   - GA 的工具在 `managed-ga/code/assets/tools_schema.json` / `tools_schema_cn.json` 里声明，`managed-ga/code/ga.py` 里 `do_<name>` 实现（参照 `do_ask_user`，`ga.py:353` 一带）。按 [managed GA runtime](../../../docs/managed-ga-runtime/README.md) 的补丁规则做：最小、隔离、可重放，编号接现有最后一个之后；先看有没有更小的扩展缝（比如 runner 的 handler 子类那一层就能加），有就用，写理由。
   - 名字、参数由你定：一个参数，给用户的一句话（或一小段）。
2. **工具说明**：只讲它是什么、什么时候有用（用户在你干活时说了话；手上的事要做很久，用户该知道进展），不加规则。一两句，英文，和 GA 工具说明的写法一致；中文 schema 照现有做法配中文。
3. **落库与画法**：这句落成主对话里的一条 Galley 消息，画成气泡，落在它说出来的位置（插话之后、这一轮后面的步骤之前）；思考的点点与进展小字挪到它下面接着跑；这一轮最后的回复照常落在后面。落库顺序沿用票 136 的 `sequence` 做法（同一个 `turn_index` 里排序），冷启动回放给模型的历史要和它当时的一致：它说过这句。手机端照样收到（`remote-protocol/`）。
4. **工具结果**：模型调用后拿到的结果要短，说明已发给用户、接着做；不要让它以为这一轮结束了。
5. **通知**：这句发不发系统通知、算不算「回复完成」，设计时定，写理由。默认倾向：不单发通知，这一轮结束时的通知照旧。
6. **侧栏与摘要**：侧栏助理卡片的第二行、`<summary>` 小字、工作台过程卡片里怎么出现这一步，按现有画法定，写进设计。
7. **评测**（真模型，可以放开用，额度够）：在 `.scratch/main-chat/entry-layer-eval/` 加一套或在现有套件里加用例，至少量三件：
   - 插话后手上的事还要做几步时，它用不用这只手先回一句；
   - 没人插话、事情也不长时，它会不会滥用（每一步都发一句）；
   - 用了之后，接着做的那段对不对。
   模型写死 `mm_1792576875658`（API key 接入），解释器用评测 README 里写的系统 python3.14。用例里的人名、地名用虚构的。

## 怎么做

- **先读**：`AGENTS.md`（宪法，尤其 Rule 1、3、5）；票 136 的「设计」与「报告」（`.scratch/main-chat/issues/136-interject-mid-run.md`）：插话的落库、`sequence`、GUI 画法、回放都在那里，这票照着接；`docs/architecture.md`、`docs/ipc-protocol.md`；`managed-ga/patches/manifest.md`；GUI 主对话画法（`gui/src/lib/assistant-conversation*`、`run-groups`、`gui/src/stores/messages.ts`）。
- **先在本文件写「## 设计」一节**（工具放在哪一层、名字与说明原文、事件与落库、回放、GUI 画法、通知、评测设计），然后直接实现。碰到要改 Agent API 已有字段含义、或画法与 `docs/design/` 主对话一节冲突时，先停下回报。
- 更新 `docs/architecture.md`、`docs/ipc-protocol.md`、`gui/src/types/ipc.ts` 镜像、`docs/managed-ga-runtime/` 相关页、`managed-ga/manifest.json` 与 `managed-ga/patches/manifest.md`（若加补丁）。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui exec vitest run
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
node scripts/check-docs-links.mjs
git diff --check
```

worktree 里跑 runner 测试借主树的 venv：在 worktree 根目录用 `<主树>/.venv/bin/python -m pytest`，先打印 `runner.__file__` 确认 import 的是 worktree 的代码。import `managed-ga/code` 的探针都用 `python -B`。真机 dev 由主会话合入后走，代理不跑 `tauri dev`。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。
  ```bash
  cd <主树>
  git worktree add -b t137-say-a-line <scratchpad>/wt-137 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  pnpm --dir <wt>/gui install
  ```
- 同时在跑：票 140（每次模型请求封顶 5 分钟，改 `managed-ga/code/llmcore.py` 与它的测试、补丁栈）。补丁编号与 manifest 可能撞，合入时我来对；你别碰 `llmcore.py`。
- 不写 Galley 的真实数据库，不写内置 / 外置 GA 的状态；真实数据库只读。
- Core 不是 rustfmt-clean：只对自己改过的 Rust 文件跑 `rustfmt --check`。GUI 不是 prettier-clean：旧文件只格式化自己的 hunk。Windows CI 检出是 CRLF：Rust 原始字符串的 contains 断言别跨行。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t137-` 前缀命名。票面与文档里不写本机用户目录、worktree 路径、服务商名、接口主机。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：设计要点（含工具名与说明原文）；评测结果（每个用例几遍、用没用、发了什么）；改了哪些文件；测试与验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。

## 依赖

- 票 136 已合入（`f6dfe347`…`e25f079f`）。

## 设计

（2026-11-03，执行代理写于实现之前。）

### 一句话

`tell_user` 是主对话 runner 自己给 GA 加的一个工具：模型调用它，这句话立刻作为 Galley 的一条消息落库、画成气泡，工具结果告诉它「已发、接着做」，这一轮照常往下走。落库照票 136：同一个 `turn_index`、`sequence` 2 起，排在说出它的那一步后面；回放不改规则，它就是那一步之后的一段 assistant 文字。

### 工具放在哪一层：runner 的 handler 子类，不加 GA 补丁

- **做法**：工具不进 `managed-ga/code/assets/tools_schema*.json`、不在 `ga.py` 加 `do_tell_user`。runner 在每次 `put_task` 前把这一条声明补进 `agentmain.TOOLS_SCHEMA`（`GaSession.offer_tool`），调用由 `WorkbenchHandler.dispatch` 在交给 GA 之前接住（同票 135 的浏览器闸那一处）。
- **理由**：
  1. 只有主对话有。GA 的工具表是整个内置 payload 共用的文件，工作台会话、子任务、IM 渠道读的都是它；改文件就得再在 `agentmain` 里按环境变量删掉它（又一处补丁）。主对话本来就是自己一个进程，在它的 runner 里补一条最小。
  2. 缝是现成的：handler 子类已经在主对话里接住浏览器工具（票 135）；评测脚本也一直这样给模型加工具（票 06 的 `start_subtask`）。
  3. 零补丁：没有要重放、要 rebase 的东西，不和票 140 抢编号；上游没有同样的东西可等。
- **代价（耦合点，写进 `runner/ga_session.py` 文件头与 `docs/ga-baseline.md` 契约面第 22 项）**：`run()` 每个任务开始时把模块全局 `TOOLS_SCHEMA` 交给 `agent_runner_loop`；`next_llm` 里的 `load_tool_schema()` 会重新绑定它，所以每次 `put_task` 前补一次（有就不补）；没有 `do_tell_user`，GA 自己的 `tool_before` / `tool_after` 插件钩子不为它触发。
- **2026-11-03 JC 选留在 runner 层（甲），不进补丁栈**，条件是一条「会响」的测试：`runner/tests/test_tell_user.py` 的 `test_tell_user_survives_gas_tool_list_reload` 在子进程里跑内置 payload 自己的 `agentmain`（`run()`、`agent_runner_loop`、`NativeToolClient`），假后端记下每次请求真正拿到的工具清单：主对话两轮共三次请求都有 `tell_user`，第二轮在 GA 自己的 `next_llm` 重新载入工具表之后（测试同时断言那次重新载入确实换掉了清单、里面没有它）；`test_tell_user_never_reaches_a_request_elsewhere` 断言工作台会话（没有 `GALLEY_MAIN_CHAT`）与外置模式的请求里没有。上游改了重新载入工具表或 `run()` 交出 `TOOLS_SCHEMA` 的方式，前一条先变红。
- **只在内置运行时的主对话**：同浏览器闸的两个条件，`GALLEY_MAIN_CHAT` 正好是 `"1"`，且 `managed_runtime.is_managed_runtime()`。不成立时既不补声明，也不接调用：模型硬调，GA 照常回「未知工具」。外置零变化（宪法第 1 条）。

### 名字、说明、参数、结果

- 名字 `tell_user`（与 `ask_user` 成对），一个参数 `message`（必填）。
- 说明（英文，工具表里那一条）：`Send the user a message right away, without ending your turn; until your final reply, nothing else you write reaches them. Useful when the user says something while you are working, or when what you are doing will take a while and they would want to know how it is going.`（第二版。第一版没有分号后那半句，评测里「还要多久？」被答在调用工具那一步的文字里，主对话不画那段字；那半句是主对话的事实，不是规则。两版对照见评测。）
- 参数说明：`What to tell them: a sentence or a short paragraph.`
- 中文配对（GA 已载入中文工具表时用，判据是表里 `ask_user` 的说明有没有中文，同 GA 的 `tools_schema_cn.json` 做法）：「立即给用户发一条消息，不结束这一轮；在你最后回复之前，你写的别的话用户都看不到。用户在你干活时说了话，或手上的事要做很久、用户该知道进展时有用。」，参数「要告诉用户的话：一句或一小段。」
- 结果（模型读到的，GA 的结果写法）：`{"status": "success", "msg": "Sent to the user. Carry on; your turn has not ended."}`；下一步提示同 GA 的工具（`_get_anchor_prompt`）。`message` 为空：`{"status": "error", "msg": "message is empty; nothing was sent."}`，什么也不发。这一轮已经关了（停止和它赛跑）：`{"status": "error", "msg": "Not sent: this turn has already ended."}`。

### 事件与落库

1. **runner**：`tell_user` 调用 → bridge 在 `_run_complete_lock` 下确认这一轮还开着，发 IPC 事件 `tell_user { message, turnIndex, absoluteTurnIndex, index, visibility }`；`index` 是这一步里第几句（1 起），给行 id 用。
2. **Core 的 runner watcher**（同一个有序消费者，在这一步的 `turn_end` 之前收到）：再核一次「内置运行时的主对话」，然后写一行：`role = 'assistant'`、`turn_index` = `absoluteTurnIndex`（没有时同 `turn_end` 的兜底）、`sequence` = 这个 `turn_index` 已有的最大值加一、至少 2（与插话共用这段空间：先说的一句在这一步结束时读到的插话之前）、`content` = 原文、`final_answer` = 按回复的清洗规则洗过的字、`visibility` 同事件；id `msg_{session}_{turn}_tell_{index}`，同 id 再来不重写。可见且有字时进搜索索引。不动 `turn_count`、`summary`、`last_activity_at`（这一步的 `turn_end` 马上就会动）。
3. **不新增 Core 广播**：GUI 同画 `turn_end` 一样直接从 `runner-event` 画它（行 id 两边按同一个公式算）；手机在 `runner.event` 里原样收到这个事件，冷读 `session.messages` 时这一行是 `sequence` ≥ 2 的 assistant 行。
4. **一条判据**：assistant 行 `sequence` 1 是一步（问候也是 1），`sequence` ≥ 2 是一轮中间先说的一句。凡是「最新一步 / 这一轮的回复」的查询都只看 `sequence = 1`：`latest_reply`（派子任务只读最后的回复）、`main_chat_segment_facts` 的「停在提问上」、分页的 `run_opener_at_or_before`（找上一条是不是提问）。待办 / 备忘 / 定时的 settle 取最大 `turn_index`，先说的一句不会比回复晚，不改。

### 回放

不改转换规则。先说的一句是 assistant 行，夹在那一步与下一步之间，按既有规则与相邻 assistant 行合并：…第 k 步的文字、这句话、第 k+1 步的文字…，正是模型当时说过的话（工具调用本身从来不回放，同所有工具）。新段带过来的轮次、子任务带出门的背景（票 138）读的是同样的行，也都带上这句。

### GUI 画法

- **类型**：`AgentTurn.interim: true`（先说的一句）：没有工具，`finalAnswer` 是这句话。直播时 `tell_user` 事件追加它（在等它读的插话前面）；这一步的 `turn_end` 落在它自己那几句前面（同一个 `turnIndex`），所以直播与冷恢复顺序一致；冷恢复 `rowsToTurns` 把 `sequence` > 1 的 assistant 行读成它。
- **分组**（`run-groups`）：是这一轮的成员（同插话），但不是一步：不计步数，不算回答、不算提问、不切段、不进 `runStepNumbers`；判断「最后一步」的地方都跳过它（`stoppedPartway`、`liveWindowHasSettledStep`、`pendingReplyStepBase`、`derivePendingAskUser`）。
- **对话里**：一条左侧气泡，同回复（行动条：复制 · 引用 · 保存 · ⋯，没有「过程」，下面不挂卡片：卡片只挂在回复的行 id 上）。落在插话之后、这一轮后面的回复之前；三点气泡与下面那一行在对话末尾，也就在它下面接着跑，用时不重置；那一行跨过它接着说上一步在做什么（`settledStepHalf` 跳过它）。这一轮没结束，所以不做「三点长成回复」的交接；它出现时不加新动效，直接落在三点上面。
- **过程卡片**：它不是一行；调用它的那一步照常是一行（模型的 `<summary>`，没有时是工具名「给你发消息」），工具条显示「给你发消息」与这句话的开头。
- **侧栏卡片第二行**：按现有优先级，在跑时说在跑的那句（「正在工作…」等），不说这句；叫醒那一轮写字间隙、停在半路的那一轮静止时，最后一条消息就是它（它是一条消息）。顶栏不变。
- **删除**：它是单独一条消息：删它只删这一行；删回复删这一轮的步骤与回答，不带走它（同微信，各删各的）。Core 的 `message_unit` 与 GUI 的 `messageRowIds` 同一规则。
- **不变的**：工作台、子任务、IM 渠道、外置。

### 通知与「回复完成」

不单发系统通知，不算「回复完成」，不标未读，不动三点交接；这一轮结束时的通知照旧。理由：插话之后你多半就在跟前，一句一通知是噪音；「回复完成」说的是这件事做完了，先说的一句恰好是「还没完」；通知已有的节流键按回复走，不为它另开一套。

### Agent API 与 IPC

- IPC（加法）：事件 `tell_user`。`docs/ipc-protocol.md`、`runner/ipc.py`、`core/src/ipc.rs`、`gui/src/types/ipc.ts` 同步。
- Agent API：字段不变；主对话的消息列表里多了这种 agent 消息（一轮中间的一句，`turnIndex` 不晚于那一轮的回复）。加法，写进 `session-commands.md`。`session wait` 默认「有 agent 输出就完成」本来就会被中间一步的文字触发，`--until-idle` 不受影响。

### 评测设计

在 `.scratch/main-chat/entry-layer-eval/` 加一套 `tell-user`（`run.py --suite tell-user`）：沙盒、假 `galley`、下载文件夹占位文件同派活判据那套；提示词用主对话现在的那份（`dispatch-criterion/galley-prompt/main_chat.v4.txt`，票 134 第四轮之后 `managed_prompt.rs` 的主对话部分没改过）加浏览器闸；工具表补上 runner 自己的 `tell_user` 声明，调用由 runner 的同一段代码回结果；插话照 runner 的写法（Core 的 `INTERJECTION_PREAMBLE` 加用户的话，`runner/interject.py` 的 `compose`）在指定那一步结束时写进 `intervene`。用例三类：插话后手上的事还长（用不用、先说了什么、接着做得对不对）；不插话的短事（滥用）；不插话的长事（是否每步都发）。模型 `mm_1792576875658`，每个用例 3 遍。

## 报告

（2026-11-03，执行代理。分支 `t137-say-a-line`，已 rebase 到 main `4bab8f38`（含票 140、141），无冲突。没有加 GA 补丁，补丁栈与 manifest 没动。）

### 做成了什么

照上面「设计」做的，偏离两处：工具说明改成第二版（见下「评测」，原因写在「设计」里那一条后面）；JC 加的「会响」测试（见下）。

- **runner**：新 `runner/tell_user.py`（工具的声明、中英两版说明、结果、`offered_here` 判据）；`ga_session.py` 加 `offer_tool`（耦合点写进文件头）；`handlers.py` 的 `WorkbenchHandler.dispatch` 在交给 GA 之前接住 `tell_user`（发出转弯信号，回结果与 GA 的下一步提示）；`workbench_bridge.py` 每次 `put_task` 前补声明、`_tell_user` 在 `_run_complete_lock` 下发 `tell_user` 事件（一轮已关就不发）；`ipc.py` 加 `TellUserEvent`。
- **Core**：新 `core/src/tell_user.rs`（再核「内置运行时的主对话」，写行）；`SqliteGalley::persist_told_line`（`msg_{session}_{turn}_tell_{index}`，`sequence` 取已有最大值加一、至少 2，同 id 不重写，可见时进搜索）；runner watcher 收 `TellUser` 时写库；`ipc.rs` 加事件。「一步 / 这一轮的回复」只看 `sequence = 1` 的四处：`latest_reply`（派子任务）、`main_chat_segment_facts` 的停在提问上、分页的 `run_opener_at_or_before`、删除后重算摘要的 `latest_reply`；`message_unit` 把先说的一句当单独一条消息（删回复不带走它）。
- **GUI**：`AgentTurn.interim`；`tell_user` 事件 → `appendInterimTurn`（插话之前），这一步的 `turn_end` 落在它自己那几句前面（`withLandedStep`）；`rowsToTurns` 把 `sequence > 1` 的 assistant 行读成它（直播与恢复同一个 `interimTurn`）；`run-groups` 的 `isStep`（不计步、不算回答 / 提问、不切段、不是「最后一步」）；`assistantLinePlan` 画成气泡；三点下面那一行、提问的回答查找、待回答的提问、叫醒那一轮的「不出声」、删除都跳过它；过程卡片里调用它的那一步工具条是「给你发消息」。
- **文档**：`docs/architecture.md`、`docs/ipc-protocol.md`（§4.21）、`gui/src/types/ipc.ts` 镜像、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`（新一节）与 `prompt-composition.md`、`docs/ga-baseline.md` 契约第 22 条（含「会响」测试的名字、升级先跑）、`docs/agent-api/session-commands.md`（加法：主对话里一轮中间的 agent 消息）、`docs/design/conversation.md`「在跑时它先说的一句」。
- **「会响」测试**（JC 选甲的条件）：`runner/tests/test_tell_user.py` 的 `test_tell_user_survives_gas_tool_list_reload` 在子进程里跑内置 payload 自己的 `agentmain.run()` → `agent_runner_loop` → `NativeToolClient.chat`，假后端记下每次请求拿到的工具清单：主对话两轮三次请求都有且只有一个 `tell_user`，第二轮在 GA 自己的 `next_llm` 重新载入工具表之后（同时断言那次重新载入换了清单、里面没有它），那句话作为 `tell_user` 事件出来；`test_tell_user_never_reaches_a_request_elsewhere` 断言工作台会话与外置模式的两次请求里都没有。做过一次变异：把 runner 改成只补一次，前一条立刻红。

### 评测（真模型，`mm_1792576875658`，推理强度 high，`run.py --suite tell-user`）

66 次运行（现行 60 次，被替换的 6 次），181 次模型调用，输入 1,196,014 token（缓存 601,088），输出 60,084 token。提示词是主对话今天的那份（v4）加浏览器闸。说明三组：r1 第一版；r2 现行（加半句「在最后回复之前，你写的别的话用户都看不到」）；r3 是 r2 加改过的插话开场白（只评测，产品没改）。每格 3 遍：

| 用例 | r1 | r2 | r3 | 怎么处理的 |
|---|---|---|---|---|
| `i-question`：分类整理时问「扫描件存 PDF 还是 PNG」 | 0/3 | 0/3 | 0/3 | 9 遍都把整理派给子任务，问题在派活的回复里一起答 |
| `i-howlong`：每 20 秒看一次文件夹、看 4 次时问「还要多久？」 | 0/3 | 1/3 | 1/3 | 用了的先说「还需要约 80 秒……」「还需要约 1 分钟……」再做完；没用的 7 遍都把这句写在调用工具那一步的文字里，主对话不画，用户看不到 |
| `i-correction`：「只数 PDF 和图片就行」 | 0/3 | 0/3 | 0/3 | 直接按新范围做完、回复里说明（一两步的事） |
| `i-todo`：整理报销清单时说「记一下：周五下午三点前给许明远回电话」 | 0/3 | 0/3 | 0/3 | 先记待办（多 3 步、约 1 分钟）再回复，整理派给子任务；r2 有 1 遍插话没读到（第一步就派了、回复） |
| `n-short`、`n-chat`（短事，不插话） | 0/6 | 0/6 | — | 没用（合格） |
| `n-long`（分类整理，不插话） | 0/3 | 0/3 | — | 都派了子任务 |
| `n-wait`（等 80 秒，不插话） | 0/3 | 0/3 | — | 自己做完，没发进展（合格；不算滥用） |

- **滥用**：24 遍不插话的运行一次都没用。
- **用了之后接着做**：用了的 2 遍都接着把检查做完，最终回复给结果、不重复那句。
- **要点**：现在的派活条款下，手上的长活几乎都派出去了，这只手主要剩「等」这类主对话自己做的事；票 139 收条款以后这一套要重跑。模型把要对用户说的话写进调用工具那一步的文字里（用户看不到），r2 的事实半句只多换来 1 遍。
- `--dry-test`：本套 15 条全过；整个 dry test 另有 7 条不过，是 main 上原有的（票 134 第四轮派活判据的标注），在 main `725704c1` 上单独跑过、同样 7 条。
- 文件：`.scratch/main-chat/entry-layer-eval/tell-user/`（`cases.json`、`results.json`、`results.md`、`composed/`），README「先说一句（票 137）」一节。

### 验证（rebase 到 `4bab8f38` 之后，数字照抄输出）

- `cargo test --manifest-path core/Cargo.toml --workspace`：47 组 `test result`，合计 1333 passed，0 failed（之后只按 rustfmt 改了自己的两处格式，`cargo check --workspace` 通过）
- `.venv/bin/python -m pytest`：`738 passed, 6 deselected`
- `.venv/bin/python -m mypy runner`：`Success: no issues found in 41 source files`
- `.venv/bin/ruff check runner`：`All checks passed!`
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`：通过
- `TZ=UTC pnpm --dir gui exec vitest run`：`Test Files 253 passed (253)`，`Tests 2810 passed (2810)`
- `node scripts/check-managed-ga-payload.mjs`：`[managed-ga-payload] OK`
- `node scripts/check-ga-baseline-drift.mjs`：`[ga-baseline-drift] OK (d66509bf)`
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 493 files checked.`
- 另跑：`check-ipc-protocol-drift`（`python: 18 events, 9 commands; rust: 18 events, 9 commands; ts: 18 events, 9 commands`）、`check-supervisor-sop-drift`、`check-version-consistency`：都过
- `git diff --check`：无输出
- 只对自己改过的 Rust 文件跑 `rustfmt --check`（新文件整篇，旧文件只改自己的 hunk；`core/src/lib.rs` 在 main 上本来就不干净，没动），GUI 旧文件只格式化自己的 hunk。`managed-ga/` 下没有 `__pycache__`。

新测试：runner `test_tell_user.py` 32 条（声明与中英配对、只在内置主对话、handler 的发出 / 空消息 / 一轮已关 / 别处走 GA 的「未知工具」、`offer_tool` 重新载入后再补、事件往返、bridge 的步号与句号与停止赛跑、两条「会响」）；Core `a_line_told_mid_run_lands_after_its_step`、`a_line_told_outside_the_managed_main_chat_is_dropped`、`a_line_told_beside_a_question_hides_neither`、`a_line_told_mid_run_is_a_message_of_its_own`、`tell_user_wire_parses`；GUI `tell-user.test.ts` 11 条与 `Conversation.assistant.test.tsx` 2 条。

### Open risks（看到但没改的）

1. **跟提问同一步说的那句排在提问后面**：模型在同一次回复里既 `tell_user` 又 `ask_user` 时，库里那句（`sequence` 2）排在提问那一步（`sequence` 1）之后，对话里画在提问气泡下面，虽然它先说。查询都改成只看 `sequence = 1`、GUI 都跳过它，所以「停在提问上」「你的回答」「分页」都不受影响，只是画的顺序反了。评测里没出现过。
2. **落下时没有动效**：先说的一句直接出现在三点上面，三点和下面那一行被推下去；没上切换器、没在真机比。
3. **用得少**：见评测。现在的派活条款下长活都派出去了；`i-howlong` 里 7/9 遍把「还需要约 80 秒」写在调用工具那一步的文字里，主对话不画（三点下面那一行有时恰好显示那一步 `<summary>` 的后半句）。这是这票之前就有的缺口，要不要画、或者再怎么提示，没定。
4. **说明里那半句**：「until your final reply, nothing else you write reaches them」是我按评测加的事实（过程卡片在落定后能看到步骤的字，三点下面那一行显示 summary 的半句，严格说不是「都看不到」）；r1 → r2 只多用了 1 遍。可能被认为像规则。
5. **插话开场白没改**：r3（开场白的选项里加上这只手）没有比 r2 多用，没进产品。
6. **不发通知**：人不在跟前时，先说的那句不会弹系统通知，这一轮结束时照旧。
7. **先说的那句里写 `<subtask>` 不会派活**：Core 只从最后的回复派；显示时标签被洗掉。评测里没出现。
8. **只有标签的那句画不出来**：`message` 洗完是空（比如只有 `<summary>`），行照写，GUI 不画（`finalAnswer` 为空），模型却拿到「已发」。
9. **手机**：靠 `runner.event` 里原样转发的 `tell_user` 事件与冷读时 `sequence` ≥ 2 的 assistant 行；没有专门的手机事件，手机 App 还没有对话画法。
10. **Agent API**：`session show` 多了这种 agent 消息（加法，已写进文档）；默认的 `session wait` 本来就会被中间一步的文字触发，`--until-idle` 不受影响。
11. **工具条的字与图标是我定的**：「给你发消息」/「Message you」，图标 `ChatCircleText`。
12. **评测的工具调用上限不算 `tell_user`**：真实主对话没有这个上限（GA 180 步）。
