# 02 ask_user 按钮、停止按钮、命令补齐

Status: done
Blocked by: 01（同一补丁 0023、同一文件，同一 agent 接着做）
PRD：[../PRD.md](../PRD.md)

## 做什么

修 PRD 问题 1、2：ask_user 在 Discord 里可见、可点；状态消息加「停止」按钮；补上 `/btw` `/review`。

## ask_user

### 捕获

- 不要解析 🛠️ 回显文本（问题里可以有换行和括号）。照 `tgapp.py:355-400` 的做法用 `agent._turn_end_hooks`：
  每个频道 agent 创建时注册一个 Discord 专属 key 的 hook，从 `ctx["exit_reason"]` 取
  `{"result": "EXITED", "data": {"status": "INTERRUPT", "intent": "HUMAN_INTERVENTION", "data": {question, candidates}}}`。
  hook 是 GA 线程里调的，事件要按 chat_id 线程安全地交给 run 循环（run 在收到 `done` 时取）。
- 多选问题（沿用 tgapp 的 `_MULTI_SELECT_RE`）不做按钮，走下面的纯文本形态，末尾加一行 `-# 多选：直接回复序号或文字`。

### 提问消息（新消息，会推送）

run 以 ask_user 结束时：删状态消息（01 已保证）、保存续跑计数，然后发：

```
-# ⏸ 等你回复 · 已完成 {N} 步
<该步旁白（outputs[-1] 清洗后，非空才有）>
<问题>
<list 形态时：1. 候选一 / 2. 候选二 …>
[按钮]
```

- 候选排布与桌面 `gui/src/lib/ask-user-candidates.ts` `candidateLayout` **同一判定**：≥ 5 条，或任一条（trim 后）> 20 字，
  或合计 > 60 字 → list；否则 row。
  - row：按钮文字 = 候选全文。
  - list：正文编号列出全文，按钮只写 `1` `2` `3`…
  - > 25 条（Discord 5×5 上限）或多选：不给按钮，纯文本编号。
- 按钮用 `discord.ui.View(timeout=None)`（默认 180 秒超时会让长时间不回答的按钮失效）、`ButtonStyle.secondary`。
- 问题正文保留单换行（桌面 ask_user 用 softBreaks 的理由：GA 的 question 是纯文本，换行有语义）——Discord 本来就保留单换行，别合并。

### 回答

- **点按钮**：只认绑定的 owner（`_is_allowed_user(str(interaction.user.id))`）；非 owner 用 `interaction.response.defer()` 静默吞掉
  （与「非 owner 消息静默忽略」一致，又不让 Discord 显示「交互失败」）。owner 点选 → `interaction.response.edit_message(...)`
  把提问消息改成回显（见下）并去掉按钮，然后以**候选全文**为任务文本起续跑 run，状态消息 reply 挂在这条提问消息下。
- **直接打字**：该频道有待答提问时，下一条普通消息（非命令、非退出词）就是回答——提问消息改成不带勾的回显、去按钮，
  以这条消息起续跑 run。（与桌面一致：ask_user 之后的下一条用户消息就是回复。）
- 提问已被答过 / 已失效时再点旧按钮：`defer()` 并尝试去掉该消息的按钮，不起 run。
- `/new`、退出频道、agent 被驱逐：清掉待答提问（去按钮）与续跑计数。

### 回显（编辑提问消息）

```
-# 已回复 · 已完成 {N} 步
<问题>
✓ 被选的候选          ← 正常字号（桌面：所选 ink-soft + Check）
-# 其余候选            ← 每条一行 subtext（桌面：其余 ink-muted）
```
list 形态保留编号（`✓ 2. …`、`-# 1. …`）。打字回复时所有候选都是 `-#`、无勾（桌面：自由回复不勾）。

### 续跑计数

与桌面 09-18「提问不切断 run」一致：续跑 run 的步号从 N+1 接着编、「已完成 N 步」与最终回答的 `N 步 · 用时 X` 都是各段之和，
等待回答的时间不计。01 负责计数结构，这里负责在回答时接上。

## 停止按钮

- 状态消息**运行态**挂一个「停止」按钮（`secondary`，`timeout=None`）；排队态不挂。只认 owner，规则同上。
- 点击 = `/stop` 同一路径（停当前 run、`ga.abort()`），用 `interaction.response.edit_message` 直接把状态消息改成
  `⏹ 已停止 · {N} 步 · 用时 {X}`、去按钮（01 的停止终态）。
- 文本 `/stop`：有 run 在跑时**不再**另回「⏹️ 正在停止...」（状态消息的定格就是回执）；没有 run 时回一行「当前没有在跑的任务」。

## 命令补齐

- `/btw <q>`：`await asyncio.to_thread(_handle_btw_frontend, ga, cmd)`，答案以 reply 挂在命令消息下。`_handle_btw_frontend`
  已在 `chatapp_common` 模块底部导入，加进 dcapp 的 import 列表。
- `/review [scope]`：走 `run_agent`（即 01 的状态消息流程）。
- `/help`：`HELP_TEXT` 后追加一行 `退出该频道 / 退出该子区 - 停止在本频道响应`（格式随 `build_help_text` 的 `cmd - desc`）。

## 约束 / 验证

同 01（补丁流程、ledger 行在 01 那行上补充描述即可、不动访问控制）。测试加进 `runner/tests/test_managed_discord_dcapp.py`：
row / list / >25 / 多选四种形态、owner 点选起续跑且计数累加、非 owner 点击静默、打字回答、旧按钮点击、停止按钮、
`/stop` 有无 run 两种回执、`/btw` `/review` 分支、`/help` 含退出词。按钮回调用假 interaction 对象测，不连 Discord。

## Comments

### 2026-09-30 · 实现完成（与 01 同一补丁 `0023`）

**做了什么**

- ask_user：`_get_agent` 创建频道 agent 时（在 `GALLEY_AGENT_HOOK` 之后）在 `agent._turn_end_hooks["discord_ask_user"]` 注册 hook，从 `ctx["exit_reason"]` 取 question 与 candidates，加锁按 chat_id 存放，run 收到 `done` 时取走。提问消息、四种形态（row、list、超过 25 条、多选）、回显（选中打 ✓，其余 `-#`，list 保留编号）、续跑计数累加、非 owner 静默 defer、打字回答、旧按钮、`/new` 与退出、驱逐时的清理，均按规格实现。
- 停止按钮：运行态的状态消息挂「停止」；owner 点击走与 `/stop` 相同的停止路径，用 `interaction.response.edit_message` 定格为 `⏹ 已停止 · N 步 · 用时 X` 并去掉按钮。文本 `/stop` 有 run 时不另回执，没有 run 时回「当前没有在跑的任务」。
- 命令：`/btw` 的答案以 reply 挂在命令消息下；`/review` 走 `run_agent`；`/help` 末尾追加退出词一行。

**偏差与自行裁量（附理由）**

1. **按钮不用 View 回调，统一在 `on_interaction` 里按 `custom_id` 路由**（`galley-dc:stop:<token>`、`galley-dc:ask:<token>:<i>`）。View 仍是 `discord.ui.View(timeout=None)` 加 `ButtonStyle.secondary`，但发送前先 `stop()`：它只负责渲染，不进 discord.py 的 ViewStore（`timeout=None` 的 view 否则每条消息一个，在进程里永久累积）。好处是「旧按钮」只有一条路径：进程内已答、已失效的按钮，和**进程重启后**残留的按钮（重启后没有 View 在监听，用回调方案会显示「交互失败」）一并处理。已用 2.7.1 实测 `stop()` 过的 view 照常序列化。
2. **回显保留该步旁白。** 规格的回显模板只有 header、问题、候选；按字面编辑的话，提问消息里的旁白（常见如「我查到三个问题：……」）会在回答后从频道里消失。现在的回显是 `-# 已回复 · 已完成 N 步`，接旁白（原消息里有才有），再接问题与候选。JC 真机若觉得多余，删掉 `_ask_echo_text` 里的两行即可。
3. **没有候选的 ask_user 也发提问消息**（只有问题，打字回答）。tgapp 的提取函数在没有候选时返回 None，照抄会让纯问题继续被吞（PRD 问题 1）。
4. **拆分的并行 ask_user 合并候选。** 有模型会把一个问题拆成 N 个各带一个候选的 ask_user 调用（桌面 `mergedAskUserArgs` 注释里的 grok-4.6 案例），GA 只执行第一个。hook 从 `ctx["tool_calls"]` 把同一问题的候选按序去重并入，与桌面一致。
5. **事件按 display queue 认领。** hook 记下当时的 `agent._current_queue`，只有拥有该任务的 run 能取走事件。否则报告轮若调了 ask_user，事件会被下一个用户 run 误取。
6. **`/review` 不加 FILE_HINT，原样入队。** mixin 的写法 `run_agent(chat_id, cmd)` 会在前面拼上 FILE_HINT，而 `review_cmd` 装进 GA 的 `_handle_slash_cmd` 拦截只认以 `/review` 开头的 query，于是模型收到的只是字面上的「/review ……」（上游 mixin 同样有这个问题）。`/review help` 这类由 GA 直接回 `done` 的情况：状态消息删掉，回答没有 header（0 步）。
7. **`/review` 不算对待答提问的回答**（规格：「下一条普通消息（非命令、非退出词）」），提问保持待答，按钮仍可点。反过来，同频道排队的 run 若恰好在提问之后开始，它就是回答（GA 视角如此），见 01 偏差 2。
8. 提问消息同样套用回答的引用规则（中间插进了别的消息才引用触发消息）；该步的 `[FILE:]` 附件在提问消息之后照常发出。旁白加问题超过 1900 字时，旁白先单独发，问题与按钮留在同一条消息里；仍然超长则截断并加「…」。
9. 多选提示行只在有候选时追加。候选在列表和按钮里把内部空白压成单个空格（按钮标签截到 80 字）；发给 GA 的回答文本仍是候选原文。

**验证（全部通过）**

与 01 的 Comments 是同一次构建与测试，命令和结果见那里。本票相关的测试都在 `runner/tests/test_managed_discord_dcapp.py`：`test_ask_layouts`、`test_ask_row_click_continues_run_with_carried_counts`（含已答按钮再点）、`test_ask_non_owner_click_is_silent`、`test_ask_typed_answer_echoes_without_tick`、`test_ask_list_layout_numbers_buttons`、`test_ask_over_25_candidates_is_plain_text`、`test_ask_multi_select_is_plain_text_with_hint`、`test_ask_from_other_task_is_not_claimed`、`test_new_command_drops_pending_question`、`test_stale_ask_button_after_restart`、`test_stop_button_stops_running_run`、`test_stop_command_freezes_status_and_keeps_queue`、`test_stop_command_without_running_run`、`test_help_btw_review_commands`、`test_ask_user_event_extraction`。

**集成方（04）需要看的**

- 真机：按钮点击的 3 秒应答窗口。点选与停止都在第一个 await 之前完成状态变更，第一个 await 就是 `edit_message`。重启 Galley 后再点旧提问的按钮，应当静默去掉按钮。
- 旧按钮「defer 之后去按钮」按规格写成 `interaction.message.edit(view=None)`；用 `interaction.response.edit_message(view=None)` 一次调用也能做到，差别只在请求数。
