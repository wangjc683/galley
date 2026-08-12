# PRD: 会话消息队列（默认排队 + 一键插队 + 暂停即释放）

Status: ready-for-human
Date: 2026-08-11
关联: [galley#19](https://github.com/wangjc683/galley/issues/19)、
[galley#20](https://github.com/wangjc683/galley/issues/20)（同一位
报告人 Kinda2419，合并设计——见定案 1）

## 背景与动机

两个 issue 的公共底座是「composer 与运行状态解耦 + 单会话出站队列」：

- #19：运行中发送的消息默认排队，当前任务结束后自动按序执行；队列中
  每条消息提供「插队」按钮（= 暂停 → 优先执行该条）。痛点：想补一句话
  必须先暂停（误伤任务）；有前置依赖的消息只能人守着屏幕等通知。
- #20：点「暂停」后停止收尾异步化，UI 立即恢复可发送；期间提交的消息
  暂存，停止完成后自动出队执行。痛点：停止中间态硬锁输入，把实现细节
  的等待成本转嫁给用户。

\#20 是队列在 stopping 状态下的特例；#19 的「插队」= 自动执行一次
「暂停 → 排队 → 停止完成自动发出」。队列原语建好后 #20 近乎免费。

## 定案决策（2026-08-11，JC）

1. **#19 + #20 合并为一个 feature 设计**，不分开做。
2. **队列不持久化**：in-memory，进程生命周期内有效，app 重启即空。
   能实现两个 issue 期待的用户体验即可，不动 SQLite schema。
3. **队列权威在 Rust Core**（Rule 5）：队列是业务状态，GUI 只是呈现。
   这同时让 CLI / Supervisor 自动化可用同一原语。
4. **CLI 契约走 additive**：`send` 对运行中会话的现有行为不变（不把
   错误路径静默改成成功路径），新增显式 `--queue` 参数排队。
   schemaVersion 1 内 additive-only。
5. GUI 侧默认排队：运行中发送 → 入队，不再要求先暂停；「插队 / 立即
   执行」为每条排队消息的显式动作。
6. 报告人标记的可选增强（队列可视化 + 删除 / 编辑 / 拖动重排）不进
   首轮，后续迭代。跨会话全局调度明确不做（非目标）。

## 设计轮调查结论（2026-08-11，全部有 file:line 依据）

1. **GA 引擎层已有串行任务队列**：`managed-ga/code/agentmain.py:151`
   `put_task` 入队、`run()`（:172）串行消费。「运行中发消息默认排队」
   在引擎层天然成立。
2. **但该队列不可控**：`abort()`（agentmain.py:141）对「排队中尚未
   开跑」的任务无效（`if not self.is_running: return`）——排进 GA 队列
   的消息无法撤销、无法插队、abort 后照跑。
3. **Core 对 send 无任何运行门禁**：socket `dispatch_session_send`
   （core/src/socket_listener/session_cmds.rs:83）落库后直接透传
   bridge，不检查 `agent_running`（对比 `session.stop` :353 有检查）。
   **CLI 运行中 send 的现状 = 静默排进 GA 队列**，且 bridge
   （runner/workbench_bridge.py:1403）立刻 `run_in_progress.set()` +
   `_emit_turn_start(1)`——事件流把排队消息谎报为已开跑，双进度
   drain 线程互踩。现状不是「错误路径」，是**事件流损坏的 de facto
   排队**。
4. **stopping 只是 GUI 内存态**（gui/src/stores/messages.ts:725
   `isStopping`），停止完成靠 `RunCompleteEvent(ABORTED)` 确认
   （bridge :1452 合成）。停止耗时根因：GA `stop_sig` 只在 yield 边界
   检查，长工具调用（code_run 默认 timeout 60s）期间不可打断。
5. **Core 的实时 running 真值**是内存 `AtomicBool`
   （core/src/runner_manager/process.rs:255-260，TurnStart 置真、
   RunComplete 清），经 `RunnerManager::agent_running()` 可查，不广播
   不落盘。GUI 的 running 是自己从 IPC 事件派生的。
6. **事件广播的推荐仿照对象**：scheduled-tasks 模式（常量 + 类型化
   payload：core/src/api/schedule.rs:25 → ctx.notify → GUI 同名常量 +
   hook 订阅）。契约面：给 string enum 加新值是 non-breaking
   （stability-and-versioning.md:136）。

## 设计方案（2026-08-11 设计轮）

**中心结论：队列建在 Core（RunnerManager 侧 per-session
`VecDeque<QueuedMessage>`，in-memory），GA 的内部队列永远只持有
当前活跃任务。** 这是唯一同时满足 Rule 5、可插队/可撤销（结论 2 说明
GA 队列做不到）、CLI/GUI 同权的位置。

- **统一入口**：新增 Core 命令「dispatch-or-enqueue」，原子判定：
  `agent_running` 为真或队列非空 → 入队（emit queue-changed）；否则
  立即走现有「落库 + 下发 + user-message-persisted」路径。GUI 的
  运行中/停止中发送与 CLI 的运行中 send 都收敛到这一个入口，判定在
  Core 内做，天然免掉「点发送瞬间 run 恰好结束」的竞态。
- **出队**：Core 在收到 `RunCompleteEvent` 处（process.rs 事件泵，
  即清 AtomicBool 的同一位置）钩出队：pop front → 复用 CLI-send 的
  Core 侧落库 → 下发 bridge → emit `user-message-persisted`（GUI
  已有该事件的追加处理）+ queue-changed。GA 自身串行消费保证无并发。
- **插队**：Core 命令 `queue-jump(queueId)`：移到队首；若
  `agent_running` → 发 Abort，`RunComplete(ABORTED)` 到达后出队机制
  自动先发它；若已空闲 → 立即出队。精确等价「暂停 → 发送」。
- **#20 暂停即释放**：纯 GUI 改动——点停止后不再锁 composer
  （`isStopping` 只约束停止按钮自身），停止期间发送走统一入口自动
  入队，`RunComplete(ABORTED)` 一到自动出队执行。输入区给一行轻提示
  （报告人建议的「正在停止，你的消息将在停止后自动发出」）。
- **落库时机 = 出队下发时**。排队项不进 messages 表、不进 transcript
  （避免「消息序 ≠ 执行序」和被撤销项的幽灵行），只显示在队列区。
  与「不持久化」定案自洽：重启丢队列 = 重启丢未发送草稿。
- **失败兜底**：出队只由 RunComplete 触发。bridge 崩溃/错误时队列
  原地保留（队列挂在 session 键下、不挂 RunnerProcess，respawn 不丢），
  GUI 队列区照常可见，用户可对队首「立即发送」（= 空闲态 jump，走
  正常 ensure-bridge 路径拉起 runner）。首轮不做自动重拉。
- **连发多条**：严格按序，不做「以最后一条为准」的合并——不丢消息
  优先，合并语义留给用户手动删除。
- **撤销/编辑**：`queue-remove(queueId)` 进首轮（Core 内存删除 +
  event，成本极低）；「编辑」= 撤销 + 文本回填 composer，不做独立
  编辑 UI。
- **bridge 防御**：`UserMessageCommand` 分支补 `run_in_progress`
  拒绝（业务错误，仿 LoadHistory :1479）——Core 接管队列后合法流量
  不会再 mid-run 到达 bridge，留这道闸防止事件流再被打乱（/btw
  旁路不受影响）。
- **CLI 面**：见裁决点 1（调查推翻了此前 `--queue` 附加参数的前提）。
- **事件**：`session-queue:changed`（常量 + 类型化 payload，全量
  快照 `{sessionId, items:[{queueId, preview, origin, queuedAt}]}`），
  仿 scheduled-tasks 模式。
- **范围**：仅普通会话的主 agent 消息。/btw 旁路、ask_user 应答
  （此时本就空闲）、Goal 编排流不入队。

## 设计轮定案（2026-08-11，JC 确认）

1. **CLI 默认走 Core 队列**（修订并取代顶部定案 4 的 `--queue` 方案，
   前提被调查结论 3 推翻——现状已是事件流损坏的 de facto 排队）：
   `dispatch` 字段新增 `"queued"` 值（additive），无需 `--queue`；
   新增 `--jump` 供 supervisor 插队。
2. **动作槽视觉走真机变体实测**：a) 有草稿时槽变发送 + Stop 退旁侧
   小钮；b) 槽保持 Stop、Enter 排队；c) 双钮并排。做常驻切换器 pill
   进 tauri dev，测完拆、裁决进 devlog。
3. **队列区 = composer 上方 chips**，每条带插队/删除；无拖动重排。
4. **崩溃兜底 = 队列保留 + 手动「立即发送」**，不自动重拉 runner。
5. **落库时机 = 出队下发时**，排队项不进 transcript。
6. **排队消息 v1 纯文本**（实现期决定，2026-08-11）：与 CLI v1
   text-only 契约一致；GUI 运行中带图发送沿用现有 image-block toast
   模式提示等空闲再发，免去附件 data URL 在 Core 内存排队的整套
   plumbing。后续有真实需求再扩。

## Issues

- 01 Core 队列原语：VecDeque + dispatch-or-enqueue 入口 + RunComplete
  出队钩子 + jump/remove 命令 + queue-changed 事件
- 02 bridge 防御闸：mid-run user_message 业务拒绝
- 03 GUI：composer 解锁（running/stopping）+ 队列区 chips + 插队/撤销
  + 动作槽变体实测
- 04 CLI/契约：`dispatch:"queued"` + `--jump` + agent-api 文档更新

## 出口标准

- 运行中直接发送 → 消息入队不打断任务，任务结束自动出队执行；
- 点暂停后输入区立即可用，停止期间发送的消息在停止完成后自动执行，
  无需二次点击；
- 插队一次点击完成「打断当前 + 优先执行该条」；
- 全程不丢消息、不弹阻断性报错；
- CLI 空闲 send 的响应形状与 exit code 完全不变；`queued` /
  `--jump` 为 additive（定案修订见设计轮定案 1）。

## Comments

2026-08-11 四个 issue 实现完成（agent），待 JC 真机验收后 commit。
验证：core+cli workspace cargo test 全过（含 7 个队列状态机新单测）、
runner 212 passed + mypy + ruff（含 mid-run 拒绝新单测）、gui
typecheck + lint + vitest 315 passed、git diff --check。要点：

- 01：队列挂 `RunnerManager`（queues map + `open_run`/`ask_pending`
  门），**出队门用 `open_run` 而非 `agent_running`**（后者 TurnEnd 也
  清零，轮间空隙有假空闲窗口）；`send_command` 是所有派发路径的
  funnel，成功发出 UserMessage/AskUserResponse 即开门（`/btw` 豁免，
  与 bridge 旁路同形状 keep-in-sync）；per-spawn forwarder（挂在
  `RunnerManager::spawn`，两条 spawn 路径自动覆盖）报 RunComplete/
  Closed 给全局 drain task（app_setup 一次接线）；ask_user 挂起出队
  （给 Agent 提问让路），应答或抢占后恢复。落库+下发+双事件在
  `core/src/message_queue.rs` 的共享 helper。
- 02：bridge `UserMessageCommand`/`AskUserResponseCommand` mid-run
  → business error，GA put_task 不再被调用；/btw 旁路保持。
- 03：composer 的 stopMode 提交闸删除（byTheWay 纠错提示整体退役，
  hint 策略换 queueEnterHint / stoppingQueueHint）；发送路由在
  useMessageSend：运行/停止中 → `queue_or_dispatch_user_message`
  （带图 → imageBlockedQueue toast，PRD 定案 6）；队列 chips
  （ComposerQueueStrip：点文本=取回编辑，ArrowLineUp=插队，X=删除）；
  动作槽三变体 + 常驻切换器 pill（QueueSlotVariantPill，仅 running
  时显示，localStorage 记忆，**裁决后连 lib/queue-slot-variant.ts
  一起拆**）。
- 04：CLI `--jump`；`dispatch:"queued"` + `queue:{queueId,position}`
  + `message:null`；agent-api session-commands §5.5a、stability
  dispatch 表、ipc-protocol §5.1 已更新。

真机验收清单：运行中发送入队→任务结束自动接续；停止中发送→停止后
自动发出（footer 状态行）；插队打断；chips 编辑/删除；CLI
`galley session send` 对运行中会话返回 queued 形状；ask_user 挂起时
队列不抢跑。

2026-08-12：dev 启动 panic 修复（drain task 误用裸 `tokio::spawn`，
setup hook 无 tokio runtime；改 `tauri::async_runtime::spawn`，教训
已记入代码注释）。动作槽变体 JC 真机实测裁决 **定 B**（槽保持
Stop、Enter 排队），理由与落选方案见 devlog
[2026-08-12-queue-slot-variant-verdict](../../docs/devlog/2026-08-12-queue-slot-variant-verdict.md)；
切换器与 A/C 代码已拆除。

2026-08-12（验收轮）：JC 真机验证 ask_user 挂起全链路通过（不抢跑 /
应答后自动接续 / 回答不误入队列）。确认「插队抢占后提问气泡残留」
边界 → 已修：GUI `turn_start` 处理器现在无条件失效 pendingAskUser
（新 run 开跑即问题不可回答，bridge 也会拒绝迟到的应答）——气泡
清理不再单独依赖 user-row append 事件，队列插队 / CLI send 等一切
抢占路径统一覆盖；ipc-handlers 单测已加。
