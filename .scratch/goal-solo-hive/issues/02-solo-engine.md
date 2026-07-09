# 02 — Solo Goal 引擎(单 agent · Core-owned · 预算驱动续跑)

Status: ready-for-agent
Created: 2026-07-08
Parent: ../PRD.md
Blocked by: 01(建议先合,但技术上独立)

## 目标

新增与 hive 并列的 **solo** 引擎:单 agent 长跑,预算耗尽前不能宣告完成,到点
收口交当前最好结果。天生无 master/worker/claim/wave,不带 hive 那类协调 bug。
solo 为**产品默认**(见 PRD D1)。

## 三个设计岔口 —— 决策与理由(按 JC 授权"最佳实践"定,假设已标注)

### 岔口 1:solo 怎么接进现有 Goal —— 用显式 `mode` 字段,不 hack worker_limit

**决策**:新增枚举 `GoalMode { Hive, Solo }`,作为 goals + goal_proposals 的一
列(`mode TEXT NOT NULL DEFAULT 'hive'`),additive 进 schemaVersion 1。

**理由**:
- worker_limit=0 表示 solo 是隐式耦合(数字字段扛语义),且现在 DB 把 0 clamp
  到 1,要改 clamp 逻辑,更脏。显式 `mode` 自解释、匹配"两种模式"的产品概念。
- 契约安全:新增可选字段 + `goal propose --mode` additive flag,不动现有命令面
  和 exit code。

**⚠️ 假设 A(默认值,重要)**:**API/CLI 层 `mode` 默认 `hive`**,**GUI 层显式
发 `mode=solo` 作为产品默认**。
- 为什么不把 API 默认也改成 solo:`goal propose` 是冻结契约,现有 supervisor
  调用者一直得到 hive,悄悄翻默认 = 行为性破坏(违反 Rule 3 精神)。
- 干净的拆分:**产品默认(人点 GUI 得到 solo)**在 GUI 层强制;**API 默认(未指定
  的 `goal propose`)保持 hive** 向后兼容。PRD 的"solo 默认"是产品语义,不是 API
  语义。做完请 JC 确认这个拆分可接受。

### 岔口 2:控制器形态 —— 独立 `run_solo_goal`,不在 hive 状态机里分支

**决策**:`goal run` 读到 goal 后按 `mode` 分发:`Hive` → 现有
`run_goal_controller`;`Solo` → 新的精简 `run_solo_goal` 循环。

**理由**:solo 本质简单(无 task board / claim / wave / 兜底 / master 规划),塞进
`run_goal_controller`(近 2000 行)只会让两个引擎互相污染、hive 的不变量更难维护。
独立循环复用共享原语(见岔口 3),不复制 hive 的复杂度。

### 岔口 3:续跑驱动 —— 复用现有 session dispatch + follow-until-idle

**决策**:solo 循环 =
1. session 承载对话:复用 `start_desktop_goal` 建 session + 发 objective 的通用
   部分(跳过 hive 专属:master duty SOP 落盘、task board)。
2. `follow` 该 session 直到 idle(复用控制器现有的 follow/wait 原语)。
3. 预算未耗尽 → 发**续跑 prompt**("你在 Goal 模式,预算耗尽前不能宣告完成,继续
   在 探测→产出→自检 间推进锚点")→ 回到 2。
4. 预算耗尽 → 发**收口 prompt**(交当前最好结果)→ 落 deliverable / 捕获 final
   answer → 标 `completed`。

**理由**:借 GA `goal_mode.py` 的"预算驱动续跑"**理念**,但实现全 Core-owned
(不碰 `--reflect` / `goal_state.json`,守 Rule 1/5)。复用现成 dispatch/follow/
budget/deliverable,不造新等待原语(除非勘探发现现有原语不够,再议)。

## 收口(岔口 3 的步骤 4 细节)

solo 无 master synthesis。单 session 的最终产出即结果:latest_summary 从该
session 的 final answer / 最新 deliverable 锚点捕获(具体接线见勘探结论,
`ac9472fa` agent)。solo 也维护 deliverable 锚点(可选但推荐,便于长跑不靠
scrollback 找最新结果)。

## 落地切片(每片可编译可测)

1. **数据模型**:`GoalMode` enum + SQL 映射 + migration(goals & goal_proposals 加
   `mode`)+ GoalBrief/Row 读写 + proposal→goal 流转 + tests migration 常量。
2. **CLI**:`goal propose --mode=solo|hive`(默认 hive)。
3. **solo 控制器**:`run_solo_goal` + `goal run` 分发。
4. **收口 + 状态**:solo 结束落 latest_summary / deliverable，标 completed。
5. (下一 issue)**GUI**:solo 默认 + hive 次级按钮 + 预算门槛。

## 验证

- `cargo test --workspace`(新增 solo 引擎单测:mode 流转、solo 收口标 completed)。
- 回归:hive 路径(mode 默认/显式 hive)行为不变。
- 手动 dogfood:GUI 起一个 solo Goal 跑通(JC 最终验收)。

## 明确不做(本 issue)

- GUI 改造(下一 issue / task #4)。
- solo→hive 自动升级(v2)。

## Comments

### 2026-07-08 — 后端 + CLI 切片 1–4 已落地并验证

- **数据模型**:`GoalMode { Hive, Solo }`(`core/src/api/goal.rs`)+ SQL 映射
  (`db/helpers.rs`)+ migration `032_goal_mode.sql`(goals & goal_proposals 加
  `mode TEXT NOT NULL DEFAULT 'hive'`)+ GoalRow/GoalProposalRow 读写 +
  proposal→goal 流转。default = Hive(向后兼容,假设 A)。
- **CLI**:`galley goal propose --mode=solo|hive`(默认 hive)。
- **solo 控制器**:`run_solo_goal_loop`(`cli/src/goal/controller.rs`)——单 session
  follow-until-idle → 预算续跑 nudge → 预算耗尽走共享 `finish_goal_with_master`
  (空 worker)收口。`goal run` 在 preamble 后按 `goal.mode` 分发。
- **收口 prompt**:`build_goal_synthesis_prompt` 按 `goal.mode` 分支,solo 用无
  hive 术语的「final answer」提示,跳过 worker-output 段。
- **测试**:`goal_mode_defaults_hive_and_flows_solo_through_proposal`(default +
  proposal→goal 流转)。全 workspace 测试绿,fmt/clippy 干净(仅 pre-existing 警告)。

**剩余**:切片 5 = GUI(见 `issues/03` 或 task #4)。solo 引擎的**运行时行为**
(真正跑一个 solo goal)需 JC 在桌面 dogfood 验收——单测覆盖不到 live bridge 循环。

### 2026-07-08 — dogfood 发现死循环 bug,已修

**现象**:solo goal 疯狂重发"[Galley Goal — keep going]"续跑 prompt(每 ~1.5s
一条,刷屏)。

**根因**:solo 用 `session.send` 派发续跑,但该命令是 best-effort——只投给**已
存活的 runner**,不 spawn。solo session 的 runner 从没被拉起(launch 只持久化
objective;hive 靠 `session.goal_master_plan → ensure_goal_synthesis_runner` 才
spawn master runner,solo 循环没调)。于是 agent 一个 turn 都没跑(DB 实据:pid 空、
turn_count=0、0 条 assistant),`project_follow(until_idle)` 立即返回,循环空转刷屏。

**修复(三层)**:
1. 新 Core socket 命令 `session.goal_solo_turn`(`session_cmds.rs`):**可见**派发
   (agent 工作显示在用户对话里)+ `ensure_goal_synthesis_runner`**拉起 runner**。
   区别于 `session.send`(可见但不 spawn)和 `session.goal_master_plan`(spawn 但
   隐藏)。CLI 侧 `session_goal_solo_turn_value`。
2. `run_solo_goal_loop` 改为:派发 → `wait_solo_turn` **真等这个 turn 跑完**
   (新 Agent 消息 + session 回 idle,预算+grace 上限);60s grace 内没起 turn →
   `NoStart` → break 收口,不再对死 session 灌消息。用 `session.goal_solo_turn`
   替换 `session.send`。
3. 抽出纯函数 `solo_turn_produced_output` + 单测覆盖"user nudge 不算完成、需新
   Agent 回复"的反死循环逻辑。

**续跑 prompt 可见性**:采用「可见但靠真等保证极少量」(JC 预批的 fallback)——
隐藏 nudge 需要 runner visibility 深挖,留作后续 polish。

**验证**:cargo test --workspace 全绿 + 新单测;**但 live 桌面运行需 JC dogfood**
(我无法驱动 Tauri UI)。

### 2026-07-08(二) — dogfood #2:提前收口 bug,已修

**现象**:solo 能跑了,但设 5 分钟只跑了 ~1 分钟就 completed(agent 只正常回复一
次)。

**根因**:`wait_solo_turn` 的 60s `NoStart` grace 误判 managed GA **冷启动**。首次
拉起 Python bridge 约 60s,期间 session 状态是 `Idle`(不是 Connecting/Running),
`is_live_candidate` 为 false → `observed_live` 一直 false → 60s 到点判 NoStart →
提前收口。证据:收口的 synthesis turn agent **1 秒**就回了,说明 bridge 刚好那时
热好——冷启动几乎正好吃满 60s grace。

**修复**:**删掉 NoStart 固定 grace**。它既错(把慢冷启动当成 runner 挂了)又多余
(`session.goal_solo_turn` spawn 失败会在 dispatch 直接报错走 `?`,不需计时器兜底)。
`wait_solo_turn` 改为只在"turn cycle 真正跑完(observed_live→idle,或新 Agent 回复+
idle)或预算上限"时返回。冷启动多慢都容忍(上限是预算)。无 tight-loop 风险:每次
迭代由真实 LLM turn 时长托底。

**验证**:cargo test 全绿;**仍需 JC dogfood #3 确认真能跑满预算**。

### 2026-07-08(三) — dogfood #3:能跑满预算了,但续跑"非常非常多"

**现象**:每个 agent turn 前挤了 ~8 条 `[keep going]`(同一秒瞬发)。

**根因**:`wait_solo_turn` 完成判定基线用了 `session.turn_count` + `turn_index >=`,
把**上一轮**的 agent 回复(turn_index 2)一直判成"新回复"→ 每次瞬间返回 → 循环秒
发下一条,直到 agent 真回一次才推进。

**修复**:基线改为"派发前的**最大 agent turn_index** + 严格 `>`"
(`latest_agent_turn_index` + `solo_turn_produced_output(after_agent_turn)`)。只认
index 严格大于上一条 agent 回复的新回复,瞬发匹配不到 → 老实等一轮。单测更新。

**遗留(UX 决策,非 bug)**:即使修成"每 turn 一条",reflect 循环对**快 turn 任务**
(如浏览器操作,每步一个 ~5s 短 turn)仍会产出很多可见续跑。是否隐藏 scaffolding /
中间步骤 = 产品决策,待 JC 拍(见与 JC 的讨论)。

### 2026-07-08(四) — JC 拍板方案 A(深研模式),已实现

solo 改为**深研形态**:续跑 nudge + agent 中间步骤全部 **internal(隐藏)**,只有
目标(launch)和最终答案(收口 synthesis,可见)进用户对话。

- `dispatch_session_goal_solo_turn`(`session_cmds.rs`):从 visible 改为
  `send_message_with_visibility(Internal)` + `UserMessageCommand.visibility=
  "internal"`,去掉 GUI mirror emit。(保留独立命名以隔离 hive。)
- `wait_solo_turn` / `latest_agent_turn_index`:改用
  `session_messages_including_internal`——否则内部 agent 回复对完成判定不可见。
- 收口的最终答案走 `session.goal_synthesize`(可见),不受影响。

用户所见:目标 → 「正在生成最终汇总」→ 最终答案。运行中进度靠顶栏 Goal 指示(JC
已知此取舍)。

**验证**:cargo test --workspace 全绿 + 单测;**需 JC dogfood #4**(叠加了 burst 修复 +
提前收口修复 + 本次隐藏派发,得真跑一次确认 agent 回复确实以 internal 落库、对话干净)。

### 2026-07-08(五) — 加回进展心跳(深研模式的黑盒问题)

JC:纯隐藏后 10 分钟零反馈,像卡死。讨论后加**节流的进展心跳**(策展进展,非原始
碎步、非静默):

- `goal_solo_progress(locale, elapsed_min, latest)`(`api/goal.rs`):Galley 署名的
  可见进展行 = 已运行时长 + agent 最近一行摘要。
- `latest_agent_progress`(`controller.rs`):取内部消息里最新 agent turn 的 summary
  (fallback:final_answer/content 首行)。
- solo loop:每个 turn 完成后,**第一条必发**(尽早破静默)+ 之后每 ~90s 一条,
  经 `session_checkpoint_value`(可见系统 narration,会 emit GUI 事件实时渲染)落库。
  10 分钟 ≈ 7~10 条。

用户所见:目标 → 「进行中(X 分钟)· 最近:…」×N → 正在生成最终汇总 → 最终答案。

**已知取舍**:头 ~60–90s(冷启动+首 turn)仍只有 launch 的"Goal 已启动"那条;首个
进展心跳在首 turn 完成后才发。若嫌初始 gap 长,可加一条开场 heartbeat(易)。

**验证**:cargo test 全绿;**需 JC dogfood(叠加全部 4 处运行时改动)**。

### 2026-07-09 — 形态反转:深研模式 → 完整过程可见(方案 A,JC 拍板)

Dogfood 后 JC 反馈心跳仍"反馈感差",要求像普通 session 一样展示工具调度与进展。
勘探发现关键事实:当初判"刷屏"的元凶是**续跑 nudge**(叠加已修掉的瞬发 burst
bug),**"工作 turn 可见 + nudge 隐藏"组合从未被真正试过**;且落库可见性与
`UserMessageCommand.visibility` 是两个独立开关,拆开即可,GUI 零改动(直接复用
TurnMarker / 工具 pill / 流式渲染的现成策展)。

实现(commit `bf35060`):
- `dispatch_session_goal_solo_turn`:nudge 仍 Internal 落库(不 mirror),
  派发 visibility 改 None(可见)。
- 删 90s 心跳全链(`goal_solo_progress` + locale 串、`latest_agent_progress`、
  `SOLO_PROGRESS_THROTTLE`)。阶段 checkpoint(launch/deadline/synthesizing)保留。
- 续跑 prompt 加"每 turn 只留简短进展说明,完整答案收口时给"约束,防长跑刷屏。
- `goal_launch_ack` 分 mode:solo 承诺"过程和结果都在本对话"。

备选方案 B(默认折叠的"工作过程"组)记为 A 试跑后嫌吵的 v2 退路——需净新
折叠组件 + 第三种可见性档位 + 改两层过滤(live 门控 + SQL 恢复),成本高一个量级。

**需 JC dogfood**:live 渲染密度是否合适(尤其快 turn 任务)。
