# Goal 派发装门与真实忙闲信号（galley#19 家族返场）

日期：2026-08-23
背景：用户群报 Goal 模式两症状（截图 + 描述），JC 要求排查后裁决「直接开修」。

## 症状

solo Goal 运行期间：

1. GUI 反复弹「操作未能完成 · Cannot start a new task while a run is in
   progress; Galley Core queues messages and dispatches after run_complete
   (galley#19)」，十几个相同 toast 堆叠，但任务实际仍在推进；
2. 用户点停止后，sidebar 的 Goal 徽标几秒内变「已停止」，主对话区却肉眼可见
   还在干活。

## 根因：液位计失灵，不是毫秒竞态

会话内 agent 自己的分析说这是「Core 没处理完 run_complete 的调度竞态」——
方向对了一半，真实机制是**无条件的**，不靠时序运气：

- **地基**：goal 控制器判断「会话忙不忙」读的是 SQLite `sessions.status`
  列（CLI 直连 DB），而 Core **从不**把这列写成 `running`——全仓只有写
  `'archived'` / `'idle'` 的语句，`status_db` 的注释自己承认 transient
  status 只活在内存。于是控制器里所有「等会话空闲」的门永真。
- **缺陷 1（toast 刷屏）**：`wait_solo_turn` 的返回条件退化成「出现一条新
  agent 消息行」，而消息行**每步落一行**（turn_index 逐步递增）不是每轮一
  行——10 步的 turn 在第 1 步落库 ~1 秒后就被判「这轮完成了」，下一条
  keep-going 立即发出。
- **缺陷 2（错误可见）**：`session.goal_solo_turn` / `goal_synthesize` /
  `goal_master_plan` 三个派发 handler 直接 `runner.send_command`，完全绕过
  为 galley#19 修的出站队列门（讽刺的是错误文案还在宣传那个队列）。mid-run
  派发落到 bridge 的防御门上（`workbench_bridge.py` `run_in_progress`
  拒收），以 business error 事件的形式变成 GUI toast——**每步一条**。
- **缺陷 3（提前 Stopped）**：停止收尾的 synthesis 派发同样被 bridge 拒收
  （socket 层却报成功，拒收是异步事件），`wait_master_final_answer` 的
  `!is_live_candidate` 闸门同样永真失效，于是**还在跑的旧 run 的下一个中间
  步骤行**（narration 落在同一 final_answer 字段、非空）被误认成收尾答案，
  goal 几秒内写成 `Stopped`；成功路径只关 worker runner 不关 master，旧 run
  继续可见地跑。`latest_summary` 也因此是某个中间步骤的第一行。

一个此前误解的澄清：`RunnerManager::send_command` 本来就会给每条
run-opening 命令置 `open_run`（门是开着的），只是 CLI 不读它、goal 派发
handler 也不查它。

## 修复（三层，Core + CLI，GUI/runner 零改动）

1. **真实忙闲信号**：新增内部 socket 读命令 `session.run_state`
   （additive，schemaVersion 1 不变），返回
   `{runnerAlive, agentRunning, openRun, queuedCount}`，直读 RunnerManager。
   CLI 侧 `goal_run_state_busy` 判 busy =
   `openRun || agentRunning || queuedCount > 0`——`openRun` 只在
   RunComplete 关闭，天然跨过多步 turn 的轮间空隙（`agent_running` 每个
   TurnEnd 都闪断，queue.rs 的注释早就警告过不能拿它当 run 级门）。
   `wait_solo_turn` / `wait_master_final_answer` 改用它；socket 探测失败
   （旧 Core）回退旧 DB 读——盲但有界，不会挂死。
2. **派发装门**：`RunnerManager::try_reserve_run`（幂等门的无队列兄弟：仅
   在 `!open_run && queue 空` 时原子占门）。三个 goal 派发 handler 先占门，
   占不到返回 `{dispatch:"busy"}` 且**零副作用**（不落库、不发 bridge）；
   占到后任何失败路径 `queue_release_run` 释放，防止门卡死把后续消息堵在
   永不到来的 RunComplete 后面。CLI 对 busy 的处理是等待后**重新生成**更新
   过剩余时间的 nudge，绝不排队旧文案。
3. **收尾锚定**：finish 的 synthesis 派发改成 busy 重试循环（睡 1s，受
   synthesis_timeout 上界），**每次尝试前重取 baseline**——由于派发只可能
   发生在真空闲时刻，baseline 之后的 agent 行只能来自收尾轮本身，缺陷 3 的
   误锚从机制上消失。整个预算内都没等到空闲则落入既有超时分支（solo：
   best-effort 交付 + 关 runner + 终态），语义不变。hive 的 master planning
   派发同样加 busy 重试（受 GOAL_MASTER_PLANNING_TIMEOUT 上界）。

行为连带改善：solo 控制器第一次循环不再在 objective turn 还在跑时就发
nudge（原来必撞门）；`galley#19` 的 bridge 防御门回归「永不该命中的协议断
言」的本职。

## 已否

- **把 nudge 塞进出站队列**（而不是 busy 丢弃）：keep-going 每轮重新生成、
  带新鲜的剩余分钟数，排队一条过期副本比没有更坏；且队列项会出现在 GUI 的
  排队 UI 里，`[Galley Goal — keep going]` 脚手架文本不该见人。
- **动 GUI/sidebar**：sidebar 显示「已停止」是忠实渲染 DB 里被写错的状态
  （5 秒轮询无过错），修状态源头而不是修显示。
- **拿 `agent_running` 当等待信号**：轮间闪断，等于把缺陷 1 换个姿势重演；
  它只作为 belt-and-braces 参与 busy 判定。

## 验证

- 全 workspace `cargo check` + `cargo test` 通过（新增：manager 3 条——
  `try_reserve_run` 幂等/队列拒绝/run_state 快照；socket handler 5 条——
  busy 零副作用 ×2、送达、失败释放门、run_state 读数与 not_found；CLI 纯函
  数 2 条——busy 判定含轮间空隙形状、dispatch busy 标记）。
- e2e 未跑（需真 GA + LLM + 分钟级 Goal 真跑）；诊断与修复都建立在静态可
  证的无条件机制上，真机效果待社区报告者升级回验（同 v0.4.9 #23 的验证通
  道逻辑）。

## 余量

- hive 引擎更深处的 wait（worker 信号、drain）走 goal 事件流，不受本次液位
  计问题影响，未全面复核；worker 唤醒走 `session.send`（有队列）无此病。
- 「停止立即 abort 当前轮」是本次浮出的产品问题（现状：停止要等当前 turn
  跑完才进收尾，长 turn 下「简短收尾 1–2 分钟」的文案兑现不了），已记
  [deferred](./deferred.md)，未实施。
- 版本偏斜（新 CLI + 旧 Core）下 run_state 探测失败回退旧行为、busy 字段
  缺失按 dispatched 处理——两端各自优雅降级，但两个二进制本就同包发运。
