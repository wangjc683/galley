# 05: GUI — Goal v2 表面

Status: done
PRD: ../PRD.md（§3.7、§4.3、§6 裁决 2 / 3 / 6）
Blocked by: 01, 03（Tauri command 与事件面定型后再动；可先按 PRD 类型定义
提前做 UI，接线最后合）

## 范围

### 02 / 03 交接过来的硬需求

- **流式清洗剥 `goal-status`**：`gui/src/lib/ipc/ga-output-cleaning.ts` 里
  `next-suggestion` 出现在四处（块剥离数组、`GA_TAG_NAMES`、`cleanPreamble`
  的 replace、尾部半截标签截断正则），`goal-status` 每处同加，否则真机流式
  会闪出 `<goal-status>complete</goal-status>`。补测试。
- **事件驱动**：Core 现在在 goal 每次状态变化时发 Tauri 事件 `goal-updated`
  `{ goal }`（`crate::goal_engine::GOAL_UPDATED_EVENT`），目标行经
  `user-message-persisted`（`dispatch: "dispatched"`，message 带 `goalId`）
  广播——GUI 启动 goal 后**不要**再从返回值 `appendUserTurnExternal`，改为
  统一吃事件（`useExternalCoreEvents` 里把 `message.goalId` 透传给
  `appendUserTurnExternal`），否则目标行会双渲染。
- **Tauri 命令面**（01 / 03 已落）：`start_session_goal({ sessionId,
  objective, budgetSeconds? })` → `{ goal, message, dispatch }`；
  `request_goal_stop(id)`（abort + stopped）；`goal_status(id)` 返回
  `GoalBrief`；`list_active_goals / list_visible_goals /
  list_goals_for_session / mark_goal_result_seen` 形状按 `GoalBrief` v2；
  `goal_context_for_session / goal_workspace_has_files / start_desktop_goal`
  已删。

### 类型与调用

- `types/goal.ts`：`GoalStatus` 七值；`GoalBrief` v2（PRD §3.6）；删
  `GoalTaskBrief / GoalEventBrief / GoalSessionBrief / GoalDeliverable /
  GoalStatusSnapshot（只留 goal）/ GoalWorkerContext / GoalMode /
  GoalWriteMode / GoalLaunchConfig.workerLimit / mode`；
  `StartDesktopGoalInput` → `{ sessionId, objective, budgetSeconds?: number
  | null }`（null = 无上限）；返回 `{ goal, message, dispatch }`。
- `lib/goals.ts`：`startSessionGoal`、`stopGoal`、`getGoal`、
  `listActiveGoals`、`listVisibleGoals`、`listGoalsForSession`、
  `markGoalResultSeen`；删 `getGoalContextForSession`、
  `goalWorkspaceHasFiles`、`getGoalStatus` 的快照用法。
  `goalStageLabel` 七态文案：运行中 / 已暂停 / 受阻 / 已完成 / 到达上限 /
  已停止 / 失败。
- `hooks/useGoalEffects.ts`：订阅 Tauri 事件 `goal-updated` 即时更新，
  5 秒轮询降为兜底；删 `hydrateGoalProjects`、worker context 加载；终态
  通知映射：`completed / budget_limited → done 音`，`blocked / failed →
  alert 音`，`paused / stopped` 不通知。
- `hooks/useGoalActions.ts`：`startGoalFromComposer` 改为「当前 session
  有则直接 start；空状态则先 `createSessionPersisted` 再 start」；删项目
  镜像、`assignSessionToProject`、`getGoalStatus` 后处理；`openGoal` 改为
  跳到 `goal.sessionId`；`stopGoalFromTopbar` 调新 stop。

### Composer

- `useComposerGoal.ts`：`hasActiveGoal` 语义改为「本 session 已有 active /
  paused / blocked goal」（App.tsx 从 `activeGoals.some(masterSessionId ===
  activeSession.id)` 派生）；`goalBlockedByActive` 文案改为「这个对话已有
  一个 Goal 在跑」。
- `GoalConfirmDialog.tsx`：只剩目标 + 上限单选（30 / 60 / 120 / 无上限，
  默认 60），删自定义输入、hive 段、项目承载段、`HIVE_MIN_BUDGET_MINUTES`。
  正文文案（zh）：「Galley 会一轮一轮自己推进，直到判断目标完成或到达时间
  上限。中途你随时可以发消息引导，或停止。」en 对应。
- `ComposerGoalControls / ComposerFooterHint / composer-hint.ts`：删 hive
  提示与 worker 相关分支。

### 线程内

- `GoalRunMarkers.tsx`：
  - `GoalCommissionMarker` eyebrow：`Target Goal` + 右侧「上限 N 分钟」或
    「无上限」+ 状态徽标；删 worker 数、只读。
  - `GoalTerminalMarker`：图标与文案按 `completed ✓ / budget_limited ⏱ /
    stopped ⏸ / failed ✕`；行内「用时 N 分钟 · 续跑 N 轮」；`failed` 与
    `budget_limited` 下方带 `latestSummary`；删任务计数、改进版数、产出文件
    夹按钮与 `revealItemInDir` 依赖。`blocked` / `paused` 不出收口标记。
  - `GoalRunningTail` 重做为 `GoalPausedTail`：`paused` →「Goal 已暂停 ·
    发消息继续」+ 停止；`blocked` →「Goal 受阻」+ `latestSummary` + 停止。
    仅在 session 空闲且 goal 处于这两态时挂在线程尾。
- `lib/goal-thread.ts`：收口规则改为「goal 段到下一个委派、或
  `createdAt` 晚于 `goal.endedAt` 的非回复 user turn 之前结束」；无
  `createdAt` 的 user turn 视为在 goal 之后。删 `task-board` item。测试补
  solo 形状（委派 → 步 → 步 → 收口）与 goal 后普通对话。
- `Conversation.tsx`：删 `GoalTaskBoard` 渲染分支与 `onOpenWorkerSession`
  prop；`run-groups.ts` 不动。
- `MainView.tsx`：删 `GoalTaskBoard`、`GoalWorkerContextBar`、
  `runningGoal` 的 live board；接 `GoalPausedTail`。

### 顶栏与侧栏

- `GoalIndicator.tsx`：pill 文案七态；popover 显示目标、状态、耗时
  （`elapsedSeconds`）、上限、续跑轮数、停止；`paused`「已暂停 · 发消息
  继续」；`blocked`「受阻 · 需要你介入」+ `latestSummary`；进度条 = 耗时 /
  上限，无上限不画。多 goal 列表沿用。
- `SidebarSessionRow.tsx`：`goalMaster` 改名 `sessionGoal`；`paused` /
  `blocked` 各有静态态（不呼吸）。`SidebarProjectReview.tsx` 删
  `activeGoalProjectIds`。
- `App.tsx`：`goalMasterStatus` 改按 `sessionId`；`goalSlotOccupied` 改
  per-session；删 `openGoalProject`。
- `ErrorCard` / `app-error.ts` 的 `view_goal` 动作改跳 `sessionId`。
- `EmptyState.tsx`：`hasActiveGoal` 语义随之（空状态没有 session，永远
  可发起）。
- `SettingsGeneral`：通知开关文案「Goal 结束或需要介入时通知」。

### 删除

`GoalTaskBoard.tsx`、`GoalWorkerContextBar.tsx` 及其 copy；两份 locale 里
hive / worker / task / deliverable / workspace / 项目承载相关 key（grep
`goalHive`、`goalWorker`、`goalTask`、`goalImproved`、`goalRunInProject`、
`goalRunNewProject`、`goalRunHere`、`openGoalWorkspace`、`goalWorking`）。

## 验收

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test`
  过；`goal-thread.test.ts`、`goals.test.ts`、`notify.test.ts`、
  `composer-hint.test.ts` 更新。
- `grep -rn "worker\|hive\|deliverable\|taskBoard" gui/src` 只剩与 Goal 无关
  的命中。
- 真机视觉验收归 07（JC）。

## 注意

- React 编译器规则：effect 内同步 setState、渲染期 Date.now 是 error；
  `elapsedSeconds` 的实时计时用现有 `useElapsed*` hook。
- 中英 copy 都要 grep 一遍（双语文档教训）。
- 走 `--step-gutter` / StepRegion 的过程区不动。

## Comments

### 2026-09-16 — 实施完成（agent）

范围全部落地，`gui/src/**` 之内，未碰 core / cli / runner / docs。

**验证（全绿）**

- `pnpm --dir gui typecheck` — 通过，无输出
- `pnpm --dir gui lint` — 通过，0 error 0 warning
- `pnpm --dir gui test` — 50 files / 396 tests 全过
- `git diff --check` — 干净
- `grep -rn "worker\|hive\|deliverable\|taskBoard\|workspacePath\|start_desktop_goal\|goal_context_for_session" gui/src`
  只剩与 Goal 无关的命中：`/btw side worker` 注释（messages.ts ×4、
  Conversation.tsx、useMessageSend.ts）、MessageAgent.tsx 的
  "deliverable" 散文、useGoalActions.ts 里「v2 没有 worker session」的
  说明注释。`hive` 的命中全部来自 **arc-hive**（`\bhive\b` 零命中）。

**改动文件**

- 类型与调用：`types/goal.ts`（重写为 v2 七态 + `GoalBrief` v2 +
  `StartSessionGoalInput/Result` + `isOpen/isTerminalGoalStatus` 助手）、
  `lib/goals.ts`（`startSessionGoal / stopGoal / getGoal /
  listActiveGoals / listVisibleGoals / listGoalsForSession /
  markGoalResultSeen`；`goalStageLabel` 七态）
- hooks：`useGoalEffects.ts`（订阅 `goal-updated`，5s 轮询降为兜底；
  终态通知映射 completed/budget_limited→done、blocked/failed→alert、
  paused/stopped 不通知）、`useGoalActions.ts`（不再 append 目标行）、
  `useComposerGoal.ts`、`useExternalCoreEvents.ts`（透传 `message.goalId`）、
  `useProjectNavigation.ts`（删 `activeGoals` / `activeGoalProjectIds`）
- Composer：`GoalConfirmDialog.tsx`（目标 + 30/60/120/无上限，默认 60）、
  `ComposerGoalControls.tsx`、`Composer.tsx`、`composer-props.ts`、
  `EmptyState.tsx`
- 线程内：`GoalRunMarkers.tsx`（委派 / 收口 / 新 `GoalPausedTail`）、
  `lib/goal-thread.ts` + `goal-thread.test.ts`、`Conversation.tsx`、
  `MainView.tsx`
- 顶栏侧栏：`GoalIndicator.tsx`、`StatusCluster.tsx`、`MainHeader.tsx`、
  `MainHeaderHost.tsx`、`Sidebar.tsx`、`SidebarTimeline.tsx`、
  `SidebarSessionRow.tsx`、`SidebarProjectReview.tsx`、`App.tsx`
- 流式清洗：`lib/ipc/ga-output-cleaning.ts` 四处加 `goal-status` +
  `ga-output-cleaning.test.ts` 三条新测试
- copy：`i18n/locales/zh.ts` / `en.ts` 两份同步增删
- 删除：`GoalTaskBoard.tsx`、`GoalWorkerContextBar.tsx`、
  `globals.css` 的 `.goal-pill-fill-breathe`（随 wrapping 态一起退役）

**偏离与判断**

1. **收口规则的「非回复 user turn」**：`UserTurn` 上没有 `askUserReply`
   字段（那是 `Conversation.tsx` 用 `run-groups` 的 `replyUserIndices`
   现算的）。`goal-thread.ts` 因此 import 了 `buildRunGroups` +
   `replyUserIndices` 自己算一遍（只读，未改 `run-groups.ts`）。代价是
   每次 annotate 多跑一次 O(n) 分组。
2. **`goalMasterSessionTitle` → `goalSessionTitle`**：票面没点名，但
   「master」已是退役词汇，顺手改名并同步 `goals.test.ts`。
3. **耗时不做本地秒表**。popover 的耗时与 pill 进度条都直接读
   `goal.elapsedSeconds`（Core 每次读时算），刷新靠 5s 轮询 +
   `goal-updated` 事件。这样渲染期没有 `Date.now()`，也不需要
   `useElapsed*`；代价是耗时分钟数最长有 5s 延迟（分钟粒度看不出来）。
   顺带删掉了旧的 `useGoalBudgetFraction` / `budgetFractionNow`。
4. **`stopGoalConsequence` 文案改了**（票面未列）：旧文案「停止后
   Galley 会先做一次简短收尾（约 1–2 分钟）」在 v2 是错的（03 的 stop =
   abort + stopped，无收尾轮），改为「停止会中止当前这一轮，Goal 不再
   续跑」。
5. **启动 toast 保留但收窄**：`goalStartedMessage(minutes)` /
   `goalStartedMessageNoBudget`，删掉了「查看项目」动作。票面没说删
   toast，就没删。
6. **侧栏 parked 态用「等待」静态轨**：`paused` / `blocked` 走
   `railKind: "waiting"`（静态琥珀，与 ask_user / 待审批同轨），
   `active` 才呼吸；subline 统一是 `Goal · <状态词>`。
7. **`blocked` 也发通知**（alert 音）。它不是终态，但票面的通知映射
   明确列了它；实现上用「状态发生变化且不是首次见到」做去重，避免
   冷启动时对历史 backlog 补发通知。

**留给 07 视觉验收的问题**

1. **Composer 的 Goal 入口：隐藏还是置灰？** 现状沿用 v1 行为——
   `canShowGoalEntry = !goal`，所以本 session 有 open goal 时 Goal 按钮
   直接消失，只留 `GoalContextBadge`。后果是新加的
   `goalBlockedByActive`「这个对话已有一个 Goal 在跑」**实际不可达**
   （App 里 `goal` 与 `hasActiveGoal` 现在是同一个条件）。要让这句话
   可达，需要把入口改成「常驻 + 置灰 + tooltip」，但那样 badge 和灰按钮
   会同时出现。属于视觉分叉，没自作主张，等 JC 裁。
2. **pill 的计数后缀**：多 goal 时 pill 是
   `Goal · 运行中 · N`（N = 全部可见 goal 数，含待查看的终态）。v1 的
   「review badge」小圆点已删。真机多 goal 场景下这个 N 读起来是否
   歧义，需要实感。
3. **收口标记的 `latestSummary`**：按票面只在 `failed` /
   `budget_limited` 下渲染。`completed` 的 summary 只在 pill popover 里
   出现——如果真机上「完成了但看不到它怎么收的尾」别扭，可以放开。
4. **`budget_limited` 的中性色**：图标 ⏱ + `text-ink-muted`，与
   `stopped` 同色。两者在同一线程里不会同时出现，但如果希望
   「到达上限」比「已停止」更有存在感，需要单独给色。
5. **Composer 确认框正文**较长（两句），`text-[12.5px]` 下约三行。真机
   看是否压住了下面的目标卡片。

### 2026-09-16 — 预算档位 / 自定义 / 延长

JC 2026-09-16 裁决的三件事全部落地，范围严格在 `gui/src/**`，未碰
`core/` `cli/` `runner/` `docs/`（另一位工程师正在同一工作树改 Rust）。

**验证（全绿）**

- `pnpm --dir gui typecheck` — 通过，无输出
- `pnpm --dir gui lint` — 通过，0 error 0 warning
- `pnpm --dir gui test` — 51 files / 414 tests 全过（较上次 +1 file +18
  tests，新增的是 `goals.test.ts` 里 `resolveGoalBudgetSeconds` 的 7 条）
- `git diff --check` — 干净

**改动文件**

- `lib/goals.ts`：新增 `GOAL_BUDGET_PRESET_MINUTES`（15/30/60/120/240）、
  `GoalBudgetPreset`、`DEFAULT_GOAL_BUDGET_PRESET`（`"60"`）、
  `GOAL_CUSTOM_BUDGET_MIN_MINUTES`（5）、`GOAL_EXTEND_SECONDS`（1800）、
  纯函数 `resolveGoalBudgetSeconds(preset, customMinutes)`，以及
  `extendGoal(id, extraSeconds)` → `invoke("extend_goal", { id, extraSeconds })`
- `lib/goals.test.ts`：`resolveGoalBudgetSeconds` 7 条（各档位、默认 60、
  `none` → null、自定义下限/无上限/空白容错、小数与 `1e3` 拒绝而非四舍五入）
- `components/conversation/GoalConfirmDialog.tsx`：六档 + 自定义共七段；
  选中「自定义」时下方展开分钟数 number input（min 5，无上限），空值或
  < 5 时启动按钮禁用
- `components/conversation/GoalRunMarkers.tsx`：`GoalTerminalMarker` 新增
  `onExtend`，`budget_limited` 且有上限时在收口行右端出「再给 30 分钟」
- `components/layout/header/GoalIndicator.tsx`：popover 行新增延长动作，
  `budget_limited` 用「再给 30 分钟」、`active`（有上限）用「延长 30 分钟」，
  与停止同一行（延长靠左、停止靠右）
- `hooks/useGoalActions.ts`：新增 `extendGoalFromTopbar(goalId, extraSeconds
  = GOAL_EXTEND_SECONDS)`，成功 upsert 进 `activeGoals` + info toast，失败
  走既有 `pushToast` 错误路径
- `hooks/useGoalEffects.ts`：`resultAlreadySeen()` 见下「偏离 3」
- 接线：`App.tsx` → `MainHeaderHost` → `MainHeader` → `StatusCluster` →
  `GoalIndicator`，以及 `App.tsx` → `MainView` → `Conversation` →
  `GoalTerminalMarker`（与 `onStopGoal` 同一条路）
- copy：`i18n/locales/zh.ts` / `en.ts` 同步增删（删 `goalDurationShort /
  goalDurationRecommended / goalDurationLong`；增 `goalDurationOption /
  goalDurationRecommendedTip / goalDurationCustom / goalCustomMinutesLabel /
  goalCustomMinutesPlaceholder / goalCustomMinutesHint`，topbar 增
  `extendGoalAtCeiling / extendGoal`，toasts 增 `goalExtended /
  goalExtendedMessage / goalExtendFailed`）；两份 locale 各 grep 过，
  旧 key 零残留

**偏离与判断**

1. **档位段只放数字，单位提到 section label**。七段如果各自写全
   「15 分钟 … 240 分钟 / 无上限 / 自定义」，按 12.5px 估宽约 446px，
   放不进 440px 的确认框（会折成两行）。改成 `15 / 30 / 60 / 120 / 240 /
   无上限 / 自定义`，label 从「时间上限」改为「时间上限（分钟）」，
   实测估宽约 305px（en 约 324px），一行装得下。完整措辞和「推荐」没丢：
   做成每个数字段的 tooltip（`SegmentedControl` 的 `title` → `TooltipLabel`），
   60 那段是「60 分钟 · 推荐」。另给控件加了 `flex-wrap` 兜底，窄窗口
   （`max-w-[calc(100vw-32px)]`）下折行而不溢出。
2. **自定义字段用 `number` input 而非 stepper/slider**，宽 `w-24`，右侧
   常驻灰字「最少 5 分钟」。小数与科学计数法一律拒绝（禁用启动）而不是
   四舍五入 —— 「你输的就是它拿到的」。无上限不设，符合票面。
3. **顺手修了一个 extend 会撞上的既有假设**（票面点名要查的那类）：
   `useGoalEffects` 原来用 `!goal.resultSeenAt` 判断「结果没看过」。
   一个 `budget_limited` 的 goal 被延长后再次到达上限时，第一轮留下的
   `resultSeenAt` 会让第二次的结果直接从 pill 里消失。改为
   `resultAlreadySeen()`：`resultSeenAt >= endedAt` 才算看过，旧戳记
   自动失效。这样**不依赖 Core 在 extend 时清 `resultSeenAt`**；如果
   Core 确实清了，这段逻辑也不会有副作用。
   其余终态假设都查过了：`goal-thread.ts` 的收口标记、
   `goal-run-groups.ts` 的 `isDeliverableStatus` / `goalRunning`、
   `GoalIndicator` 的 `open / awaitingReview` 分组、通知去重的
   `goalStatusRef`，全部是每次渲染/每次事件从 status 现算，
   `budget_limited → active` 回流是自然的（收口标记自动消失、
   第二次到上限会再通知一次）。
4. **延长没有二次确认、也没有 in-flight 禁用**。停止有确认是因为它不可逆；
   延长是加时间，多点一次只是多给 30 分钟，加 pending 态反而要处理
   「失败后按钮卡住」。如果真机上觉得容易误触，再补。
5. **延长成功出一条 info toast**（「Goal 已续上时间 / 又给了 30 分钟，
   Galley 继续推进。」）。票面只要求失败出 toast；但收口标记在成功后
   会立刻消失（goal 回到 active），不给一句回执的话点击像是没反应。
6. **格式化踩了一次坑并已回滚**：`gui/src` 不是 prettier-clean（与
   `core/` 不是 rustfmt-clean 同理）。对改动文件跑 `prettier --write` 时
   `en.ts / zh.ts / App.tsx / Conversation.tsx` 被顺带重排了 20 处无关行，
   已逐一还原（脚本按「去空白后内容相等」识别纯重排 hunk 反向 apply，
   剩两处手工还原）。现在这四个文件的 diff 只剩本票与前几票的真实改动。

**留给视觉验收的问题**

1. **七段一行的密度**。数字段（15/30/60/120/240）比「无上限 / 自定义」
   两段窄不少，段宽不齐。要不要给数字段一个 `min-w`（比如 40px）让
   前五段等宽、后两段自然宽？没自作主张，等真机看。
2. **单位挪进 label 之后**，「时间上限（分钟）」这个括号在中文下会不会
   显得啰嗦。备选是 label 保持「时间上限」、把「分钟」做成控件右侧的
   灰字后缀。
3. **「推荐」只剩 tooltip**。60 默认选中本身已有暗示，但新用户不 hover
   就看不到「推荐」二字。如果希望它可见，最小改法是在控件下方加一行
   「默认 60 分钟 · 推荐」，代价是确认框又长一行（第 5 条老问题：正文
   已经三行）。
4. **pill popover 里延长按钮和停止按钮同一行**（延长 `mr-auto` 靠左、
   停止靠右）。`active` 的行会同时出现「延长 30 分钟」和「停止」，
   两个动词挨着；如果觉得挤，`active` 的延长可以直接砍掉（票面写的是
   nice-to-have），`budget_limited` 那条保留即可。
5. **收口标记上的「再给 30 分钟」用了 brand 色**。它和 `budget_limited`
   本身的中性灰（⏱ + `text-ink-muted`）并排，是全行唯一的彩色。想让它
   更安静的话换 `text-ink-muted hover:text-ink` 即可。
6. **30 分钟这个增量写死在 GUI**（`GOAL_EXTEND_SECONDS`）。如果希望
   「再给多少」也能自定义（比如按下拉选），是另一票。
