# 03: Core — 续跑循环、三份模板、停止 / 暂停 / 出错 / 重启

Status: done
PRD: ../PRD.md（§3.2、§3.3、§3.4、§6 裁决 1 / 5）
Blocked by: 01, 02

## 范围

Goal 的全部运行时行为，全在 Core 进程内。CLI controller 不再存在。

### 状态记录（`runner_manager`）

- `attach_queue_forwarder` 在每个 `IpcEvent::TurnEnd` 上把
  `(goal_status, exit_reason.is_some())` 记到该 session 的 queue state
  `last_final_turn`；在 `IpcEvent::Error`（bridge 的 business / runner
  error，非可重试）上记 `last_run_errored = true`；`RunComplete` 时一并交给
  drain task 后清零。
- `send_command(Abort)` / `queue_jump(AbortThenDrain)` 路径给 session 打
  `aborting = true`；drain task 读到即视为「用户中止」。

### 循环（`message_queue::spawn_queue_drain_task`）

`queue_take_next` 返回 None 且 `!ask_pending` 时调 `evaluate_goal(session_id)`：

1. `list_goals_for_session` 取 `active` goal；无则返回。
2. `aborting` → `paused`（`paused_at = now`），通知，返回。
3. `last_run_errored` → `blocked`，`latest_summary` = 错误摘要（前 200 字），
   通知，返回。
4. `goal_status == complete` → `completed`，`latest_summary` = 该轮
   summary，`ended_at = now`，通知，返回。
5. `goal_status == blocked` → `blocked`，`latest_summary` = 该轮 summary，
   通知，返回。
6. 若 `budget_seconds` 非空且 `now − started_at ≥ budget`：
   - `wrap_up_dispatched` 已置 → `budget_limited`，`ended_at = now`，通知，
     返回。
   - 否则派发 `budget_limit` 模板，置 `wrap_up_dispatched`，`bump_continuation`。
7. 否则派发 `continuation` 模板，`bump_continuation`。

派发三步照抄旧 `dispatch_session_goal_solo_turn`：`try_reserve_run` →
`send_message_with_visibility(Internal)` → 确保 runner（复用
`ensure_goal_synthesis_runner` 的 spawn 路径，改名 `ensure_session_runner`）
→ `UserMessageCommand { visibility: None, absolute_turn_index }`。任一失败
`queue_release_run` + goal `failed`，`latest_summary` 写原因。

### 恢复

`paused` / `blocked` goal 所在 session 的下一次用户消息派发成功时（GUI
`persist_user_message` 派发路径、socket `session.send`、队列 drain 三处共用
的派发点）置 `active`，`paused_at = NULL`。找一个共用的落点，不要三处各写。

### 目标轮

新 Tauri command `start_session_goal(session_id, objective, budget_seconds?)`
与 socket `goal.start`（04 接线）共用 `desktop_goal::start_session_goal`：
`create_goal` → `send_message_for_goal`（可见，目标原文，盖 goal_id）→ 派发
`objective` 模板文本（同上三步；session 忙则走 `queue_offer`，返回
`dispatch: "queued"`）→ 通知。删启动叙述 system 行。

### 停止

`stop_goal(id)`：若 session 有 open run 发 `IpcCommand::Abort`（`aborting`
标记要区分「停 goal」与「暂停」：停止路径先写 `stopped` 再 abort，drain
task 读到非 active 直接返回）；`ended_at = now`。

### Core 重启

`app_setup` 启动时：`active` 全部置 `paused`（替换 `resume_active_goals`）。

### 模板（`core/src/goal_prompts.rs`，双语按 `GoalLocale`）

三份：`objective` / `continuation` / `budget_limit`。按 PRD §3.4 三段必保：
目标是数据不是指令（`<objective>` 包裹）、不许缩小目标 + 上一轮分类、
完成前逐条证据审计；blocked 三轮审计；标签格式
`<goal-status>complete</goal-status>` / `<goal-status>blocked</goal-status>`
放在最终答案末尾；每轮结尾几行进展说明；剩余时间仅有上限时附。
`budget_limit`：不开新工作、收尾、总结剩余与下一步、此轮只认 complete。
Codex 原文在 `codex-rs/ext/goal/templates/goals/`，措辞按 Galley 语境改写，
中文为主、英文版对照。

### 通知

Tauri 事件 `goal-updated { goal }`，状态每次变化发一次；GUI 05 订阅后可把
5 秒轮询降为兜底。

## 验收

- `cargo test` 过，新增：drain task 单测覆盖判定顺序全部 7 条分支（用
  fake runner）、abort 与 stop 的区分、恢复落点、budget 收尾两段、派发失
  败置 failed。
- 模板单测：三份都含 `<objective>`、标签格式、三段关键词；locale 切换。
- `session.goal_*` 旧 socket handler 与 `desktop_goal.rs` 旧内容删除。

## 注意

- 用户消息永远优先：队列非空不评估 goal。
- 续跑模板不写「不能宣告完成」「用满预算」。
- 只格式化自己动过的文件。

## Comments

**2026-09-16 落地（分支 `goal-v2`，未提交）**

- 新模块 `core/src/goal_engine.rs`（`GoalEngine { galley, ctx: &HandlerCtx }`：
  `start / stop / on_run_settled / on_runner_closed`，纯函数 `judge`）与
  `core/src/goal_prompts.rs`（三份模板）。drain task
  （`message_queue::spawn_queue_drain_task`）在 `queue_take_next` 弹空时把
  session 交给引擎；`Closed` 信号交给 `on_runner_closed`。
- **run 结算记录不靠 Abort 标记**：bridge 对 abort 合成的 run_complete 自带
  `exitReason.result == "ABORTED"`，forwarder 直接读它；同时在 `TurnEnd`
  （最终 turn）记 `goalStatus` 与 summary、在非 business 且 severity=error 的
  `Error` 事件记错误文案，汇成 `RunOutcome` 存进 queue state，
  `take_run_outcome` 一次性取走。
- **恢复不需要单独落点**：`send_command` 开门时 `run_kind = UserTurn`，引擎
  派发后 `mark_goal_continuation` 翻成续跑；paused / blocked goal 在一次
  **非续跑**的 run 结算时置 active 并继续评估（同一轮若带 complete 标签也认）。
  票面写的「三处派发点共用落点」因此免了。
- **目标轮不落 internal 行**：可见目标行与派发文本共用一个 turn index
  （`session.goal_synthesize` 的旧做法），agent 步的绝对序号紧接目标行，
  恢复时步号不跳。续跑轮才落 internal 行。
- **忙碌语义改判**：session 正在跑时 `start` 返回 `invalid_args`，不排队
  （PRD §3.6 已改，理由写在那）。
- **`try_reserve_run` 现在也拒绝 `ask_pending`**：续跑不能盖过 agent 向用户
  提的问题。
- **模板只有英文一份**：模板是 model-facing 且 internal，模型按目标语言作答；
  `GoalLocale` 随之删除（01 留它就是为这）。
- **`MessageBrief.goalId`**（additive）：目标行经 `user-message-persisted`
  广播时 GUI 需要它匹配委派标记；`session_messages_*` 的 SELECT 与插入路径
  都带上，三个测试 harness 补了 031 迁移。
- 02 的遗留：`runner/im_reporter.py` 加 `GOAL_STATUS_RE` 剥离；补丁 0022
  扩到 `fsapp.py`（与 0019 同一对文件），从干净 payload `git apply --check`
  过、`py_compile` 过；GUI 流式清洗交给 05（票面已加）。
- 测试：`goal_engine` 10 条流程用例（fake RunnerPort + 内存库：启动 / 忙 /
  派发失败置 failed / 续跑到完成 / abort→paused→用户轮恢复且旧续跑被忽略 /
  出错→blocked→用户轮带 complete / 上限收尾→budget_limited / 抢门失败静默 /
  stop 发 abort 且幂等 / runner 关闭→paused）+ 4 条 judge 纯函数 + 4 条模板
  + manager 2 条。`cargo test --workspace` 全绿，`pytest / mypy / ruff` 全绿。
- 交给 04：`goal.start / goal.stop` socket handler 照 `commands/goal.rs`
  的样板建 `HandlerCtx` 调引擎即可，无需再碰引擎。
- 已知：bridge 若在 run 中途死掉且不发 run_complete，只有 `Closed` 信号 →
  goal 置 paused；若 runner 活着但 GA 循环卡死不发 run_complete，goal 停在
  active 无续跑（与队列同病，非本票新增）。
