# ask_user 之后步号归一、用时只算最后一段：把引擎的「段」合回 GUI 的「run」

日期：2026-09-18
状态：已落地（GUI only）。序号栏 / 侧栏「第 N 步」/ 进行中标记按 run 内位置连续；
折叠头用时、答案脚注 token 数、运行中 HUD 按段求和；缺段 telemetry 时 settled 数字留空。
相关：[run 分组 / 折叠](../../.scratch/conversation-run-fold/PRD.md)、
[Goal 位置编号](./2026-09-16-live-run-window.md)（`stepNumberOf` 的来源）。

## 起因

JC：一个对话里用过 ask_user 之后，步骤编号从 1 重新开始；对话结束后折叠头的总用时也
不对，「是以新的计时，而不是把 Ask user 之前的计时也包括进去；但步骤却是整个对话的
步骤」——同一行里「10 步 · 45 秒」，10 是全程，45 秒是最后一段。

## 诊断：一个根因，三张脸

GA 引擎把「一次 `put_task`」当一次运行；GUI 的 run 是「一个用户请求到最终答案」。两者
在 ask_user 处分叉：模型调 ask_user 时 GA 循环 `should_exit` 退出
（`managed-ga/code/agent_loop.py`），runner 发 run_complete；用户回答走
`AskUserResponseCommand`，再次 `put_task`，等于全新循环——runner 的注释自己写着
"turn counter restarting at 1"（`runner/workbench_bridge.py`）。于是：

- **步号**：`AgentTurn.turnIndex` 就是 GA 的段内步号；restore 的 stepper 遇 user 行就
  重置基准（`lib/turn-index.ts`），ask_user 回复在库里就是一条普通 user 行。live 与
  restore 一致地错。
- **用时 / token**：`_begin_run_tracking` 在每次 `put_task` 重置起点与 usage 基线；
  收尾 turn 的 telemetry 只覆盖最后一段。折叠头（`elapsedMs`）与答案脚注
  （`MessageActions` 的 token 数）读的都是它。
- **步数总计却是全程**：run-groups 早已把 ask_user 回复归入同一 run
  （`awaitingReply`），`stepCount` 数的是整组 agent turn。所以只有它是对的。

顺带发现：Goal run 已经解过步号这题——`lib/goal-run-groups.ts` 的 `stepNumberOf`
按组内位置重编号，因为 Goal 续跑也是一次 `put_task`。它只对 Goal 组生效，普通组原样
返回。管道铺好了，差一根接线。

## 方案与裁决

### 编号：扩 `stepNumberOf` 到所有 user-opened 组（JC 同意；侧栏一并改）

- 设计上「一个 run 的步是连续的」是用户心智，GA 的段是实现细节。
- `AgentTurn.turnIndex` **保持 GA 原值**：live / restore 的等价性靠它
  （rowsToTurns 回推同一个数），显示层换算。
- live 路径需要一个基数：回复 ask_user 时 run 已有的步数。messages store 加
  `runStepBase`，在 `appendUserTurn` / `appendUserTurnExternal` 追加 user turn
  **之前**由 run-groups `pendingReplyStepBase` 算出（尾部最后一个非 system turn 是带
  ask_user 的 agent turn → 该组 `stepCount`，否则 0）。`turn_start` / `turn_end` 处理
  把它加到 GA 步号上，进行中标记（`currentTurnIndex`）与侧栏
  （`bumpSessionAfterTurn` → `lastStepIndex`）因此同源连续。
- 已知缺口：CLI 往本次启动从未加载过的 session 里回答，GUI 没有 turns 可数，基数 0，
  侧栏从 1 起。与 run-groups 已记录的「中止后再发新问题被误归为回复」同一档次的代价，
  JC 判为可接受；误归组那条现在还会连续编号，一并接受。
- 副作用：`ToolCallout` / `TurnMarker` 用 `index === 1` 当 run 边界给 `mt-6`。回复后的
  第一步现在不是 1，拿的是步内 `mt-2.5`——它本来就在 run 内，是修正不是回归。

### 计时：GUI 侧分段求和（JC 裁决 A；排除等待时间）

JC 先定了语义：**总计时只算 agent 真正在跑的时间**，用户在 ask_user 上停留的时间
不算。这条直接淘汰「runner 回复时不重置起点」——它会把等待算进去。剩下两条路：

- **A. GUI 分段求和**。ask_user turn 是循环退出点，runner 在 `exit_reason` 非空时给
  它附了 telemetry 并持久化到 telemetry 列。把 run 内每个「段收尾 turn」（每段最后一
  个 agent turn：暂停段是 ask_user turn，末段是收尾 turn）的 telemetry 加起来，live 与
  restore 走同一份数据。
- **B. runner 跨段累加**。收到 `AskUserResponseCommand` 时不重置而是接着加，收尾
  turn 的 telemetry 直接是全程。

推荐 A，JC 裁 A。B 有一个修不掉的洞：restore 路径明确支持「app 重启后从持久化的
ask_user 参数重建气泡、继续回答」（`derivePendingAskUser` 为此而写），那时回答落在
全新 bridge 进程，累加器是空的，又退回只算最后一段。另外 B 让同一字段有两种含义
（ask_user turn 上是段、收尾 turn 上是全程），下游要靠位置判断；A 让 telemetry 的
含义统一为「这一次 GA 循环的数字」，就是 runner 现在的真实行为。A 也不碰 runner、
IPC 协议与 Core。

落地在 run-groups：`segmentClosers` 按 user turn 切段取每段最后一个 agent turn；
`RunStats.telemetry` 是合并后的全程 telemetry——可加字段（elapsed、四种 token、
requestCount）求和，上下文占用取末段快照；`elapsedMs` 直接取合并结果。单段 run 的
结果与改前逐字节相同。

### 两张同根的脸一并修（JC 裁决）

- **答案脚注的 token 数**：usage 基线与计时起点在同一函数重置，同一个 bug。
  `Conversation` 给收尾 turn 传 `runTelemetry`（`finalTurnIndex → stats.telemetry`），
  `MessageAgent` 优先用它。
- **右下角运行中 HUD**：`currentRunStartedAtMs` 在回复时被重设为 `Date.now()`，不改
  的话 run 结束那一瞬 HUD 显示 30 秒、折叠头显示 2 分 10 秒，肉眼可见的跳变。
  `RunElapsedHud` 加 `baseMs`，MainView 从 `liveRunElapsedBaseMs(turns)` 取
  已回答段之和。

### 缺段时显示空，不显示部分和（JC 裁决）

只可能出现在 telemetry 列上线前的旧行。部分和是一个看起来可信但错的数字，比没有更糟。
规则：合并 telemetry 时任一段缺该字段 → 该字段 null。**HUD 例外**：它是活体信号，
缺段按 0 继续走——让一个正在跑的计时器消失比数字偏小更糟；且要同时满足「整个 run
是旧数据」和「此刻还在等回答」才会触发，实际不会发生。

## 验证

- 新测试：run-groups（分段求和、缺段留空、telemetry 合并规则、单段不变、
  `pendingReplyStepBase` / `liveRunElapsedBaseMs` 边界）、goal-run-groups（普通 run
  跨回复连续编号、headless 组不编号）、ipc-handlers（turn_start / turn_end 跨回复后
  进行中标记与侧栏读 3，存储的 turnIndex 仍是 1，新问题归 0）。
- `pnpm --dir gui typecheck` / `lint` / `vitest run`（52 文件 427 用例）绿，
  `git diff --check` 干净。runner / core 未动。
- 真机待 JC 验：一次带 ask_user 的对话，看序号栏、侧栏、HUD 与折叠头四处数字是否
  说同一件事。
