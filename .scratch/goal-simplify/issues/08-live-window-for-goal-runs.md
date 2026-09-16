# 08: live 窗口接入 Goal run（续接 live-run-window PRD 第二步）

Status: done
PRD: ../PRD.md（§2 定案 5）、../../live-run-window/PRD.md 第二步
Blocked by: 07

## 范围（07 验收后再细化）

新形态下 Goal run = 目标 user turn 开的一个 run 组，含全部续跑轮的步，
续跑行 internal 不在 turns 里。接入 live 窗口只需三处：

- `Conversation.tsx`：goal run 的 `liveGroup` 条件从 `agentRunning ||
  askUserPending` 改为「goal 为 active 且该组是最后一组」，轮间空隙不拆窗口。
- `complete` 对 goal run 以 goal 状态判定（离开 active / paused / blocked
  即 complete），不看末步形状；每轮末尾的进展说明当普通步进窗口。
- settled 后可折：翻转 08-06 的「Goal run 不折」，头只显示步数与气味段，
  用时归收口标记。`foldEligible` 对 goal run 放开，`hasSystem` 不再是排除
  项（叙述行已删）。

步号：live 每轮 nudge 后回 1、恢复时跳号的既有不一致（见 goal-simplify PRD
初稿分析）在本票一并处理：goal run 组内按位置连续编号，两条路径统一。

MainView 的 `inRunRail` 判定改为「窗口有头」而非「步号 > 1」。

## 验收

live-run-window PRD 的待真机验清单在 goal run 上重跑一遍。

## Comments

**2026-09-16 裁决（JC 全按推荐）**：翻转 08-06「Goal run 不折」；paused /
blocked 折叠而非平铺；引导消息切组保留但也走 goal 规则；进展说明降为叙述体。

**落地**

- 新 `gui/src/lib/goal-run-groups.ts`：`goalOfTurns`（借 `annotateGoalThread`
  的段边界给每个 turn 标 goal）、`planGoalRuns`（在 `buildRunGroups` 的形状
  分组之上盖 goal 规则：goal `active` 且是最后一组 → live；否则一律可折；
  只有 `completed / budget_limited` 的 goal 的最后一组保留 `finalTurnIndex`；
  goal 组 `elapsedMs` 置空；步号按组内位置）、`liveWindowHasSettledStep`
  （MainView 的 rail 判定）。`run-groups.ts` 未动。
- `Conversation.tsx`：分组改用 plan；委派标记下也渲染折叠 / live 头；goal 组
  里非 deliverable 的 agent turn 传 `stepNumber` 与 `intermediateAnswer`；
  `AgentTurnView` 两个新 prop（步号覆盖、进展说明走 `MessageAgentNarration`
  不画 StrongHr / footer）。
- `MainView.tsx`：`inRunRail` 在有 live 组时看 plan（窗口里已有落定步），
  否则沿用「步号 > 1」（/btw 那类不可折 run 的平铺区仍能接上）。
- 测试：`goal-run-groups.test.ts` 10 条（段边界含引导与终态后聊天、active
  不看 agentRunning、进展说明留在窗口、paused / blocked 折叠无答案、四种
  终态的 deliverable 判定、引导前段折叠、deliverable 只给最后一组、连续编号、
  普通 run 原样）。typecheck / lint / 406 用例全绿。
- 待真机：goal 完成瞬间的 settling sweep（live → 折叠 + deliverable 平铺）；
  暂停时窗口收成折叠头 + 暂停尾标的观感；续跑边界思考行的卸载 / 挂载是否
  仍有一闪（Core 派发在同进程，理论上毫秒级）。

**2026-09-16 真机回报：goal 下只见折叠头、无窗口。** 数据：该 goal
`continuation_count = 0`，线程里有一条手动「继续」——推断是中止后（goal
`paused`）发消息恢复。两处根因与修法：

1. **恢复时机太晚**：引擎原来在用户轮**结算**时才把 paused / blocked 拨回
   active，整轮期间 GUI 认为 goal 是 paused，goal 组按「非 live 一律折」只剩
   折叠头。改为 forwarder 在用户轮的第一个 `TurnStart` 发
   `RunSignal::UserRunStarted`，引擎 `on_user_run_started` 立即置 active
   （结算时的恢复保留为兜底）；续跑轮改为 `mark_goal_continuation` 先于
   `send_command`，避免 bridge 的 turn_start 抢在标记之前。GUI 侧同时把
   「open goal + agentRunning」视为 live，覆盖事件到达前的空窗。
2. **委派标记下的头没接上**：assembly 里 commission item 没有 turnIndex，
   `headerFor` 查不到。`annotateGoalThread` 的 commission item 现在带 `turn`，
   assembly 对它也解析 turnIndex。
