# B3 M1 完成（slice 设计 + Rust emit catalogue · 0 代码改动）

- **Date**: 2026-05-19
- **Status**: ✅ M1 deliverables ship · 3 个 artifact + 本 devlog · 待 commit
- **Related**:
  - [B3 playbook](../archive/refactor/B3-store-slice.md) cursor 从 T1.1 → T1.10 (done) → M2 T2.1
  - [B3 slice mapping (T1.1)](../archive/refactor/b3-slice-mapping.md) — 字段-级 inventory
  - [B3 slice ADR (T1.2-T1.8)](../archive/refactor/b3-slice-adr.md) — 11 个 architecture decision
  - [B3 Rust emit catalogue (T1.9)](../archive/refactor/b3-rust-emit-catalogue.md) — 5 新 event spec
  - [B3 prereq relaxation devlog (前置)](./2026-05-19-b3-prereq-relaxation.md) — 同日 M1 启动门 codified
  - [B2 完成 devlog (前序)](./2026-05-19-b2-bridge-ownership-complete.md) — runtime authority 已迁，B3 在此基础上拆 TS store

## Context

B3 M1 是 paperwork 阶段（[playbook M1](../archive/refactor/B3-store-slice.md#m1--slice-切分设计--静态映射-d31-d33) 明文 "不改任何代码，先纸面对齐"）—— slice 边界一旦定下，M2-M5 实施 mechanical。

[B3 prereq relaxation](./2026-05-19-b3-prereq-relaxation.md) 同日把 M1 启动门降到「scenarios checklist 落地即可」，立即开 T1.1，连推到 T1.9。原 G1 预算 4-6h，实际 **~3.5h**（含读 / 写 / 验证 / cursor 同步）。预算超估 1.5×。

主因：B2 已经把 IPC schema / RunnerManager / origin tracking / socket transport 全 codified，B3 M1 的工作大量是"指向 B2 已经做完的 Rust 端，标注 TS 这一侧的对应订阅边界"——不是从零设计。SessionRuntime 这个 interface 把所有 per-session 字段集中到一个 type，grep + jsdoc 互相印证非常省。

## Decisions

11 个 architecture decision 全部落到 [`b3-slice-adr.md`](../archive/refactor/b3-slice-adr.md)；这里只复述与"边界判断"相关的核心 5 个，其它（Zustand 沿用 / 16ms batch / selector ≤ 2 layers）已经 RESOLVED 在 playbook 内不重复。

| # | Decision | Why this not that |
|---|---|---|
| 1 | **5 slice 不是 4**：prefs 单独成 slice | prefs lifecycle 独立（写入极低频）；混 ui 会让 prefs save 触发 ui 不必要 rerender。早期 stub 4 slice 是省事不是设计 |
| 2 | `activeProjectFilter` → **sessionsStore**（不是 ui） | filter 是 sessions list 的衍生 view。挂 ui = 跨 slice 派生 visibleSessions 时 selector 路径 > 2 layers（违反 T1.7）或 cycle（违反 G9）。两层都不通 |
| 3 | `agentRunning` → **messagesStore**（不是 runtime） | 语义是 "conversation 在 streaming/agent loop" 而非 bridge lifecycle。订阅方全在 conversation-area 组件（Composer / TurnTicker / Sidebar "正在工作"）。bridgeStatus 才是真 runtime 字段 |
| 4 | 9 个 module-level symbol **全删** | B2 后 Rust RunnerManager 是 ground truth；3 Map + getBridgeClient（0 外部 callers，grep verified）+ LRU + stderr buffer + _warmupComplete + 各种 const 全成 vestigial cache。删干净不留 @deprecated（[B3-I6](../archive/refactor/B3-store-slice.md#phase-invariants--b3-特有的硬规则)） |
| 5 | Rust 端 emit **5 个 domain event**，GUI 不订阅 raw runner-event | sessions-updated / messages-appended / projects-updated / prefs-updated / runtime-updated 是 Rust spawn_emit_task 派生的 domain event。这是 [Galley 架构原则 §1 路径 B 不可逆](../../CLAUDE.md)的 TS 端落地 —— Rust 是 authoritative interpreter，GUI 是 stateless presenter；GUI 不重复解释 IpcEvent |

完整决策列表 + delete 路径 + DAG / dependency 见 [`b3-slice-adr.md`](../archive/refactor/b3-slice-adr.md) AD-01 到 AD-11。

## Rejected alternatives

- **4 slice（合并 ui + prefs）** — prefs lifecycle 独立到必须独立。合并 = ui rerender 累。AD-01 reject
- **`activeProjectFilter` 挂 uiStore** — Sidebar 渲染时跨 slice 取 filter + sessions 路径长度不止 2 layers，违反 T1.7 selector hardline。AD-02 reject
- **`agentRunning` 挂 runtimeStore** — runtime 名称暗示但 semantics 不对。订阅方全是 conversation 组件，跨 slice 订阅会引入 [useShallow 类反模式](./2026-05-11-stage3-multi-session-and-perf.md) 风险。AD-05 reject
- **`getBridgeClient` 留 @deprecated 而非删** — 0 外部 callers + cache 跟 Rust ground truth 异步 = 潜在 bug 来源；B3 是 last hop，留就再也不删。AD-11 reject
- **5 个新 emit event 合并成单一 `state-changed` event with `kind` discriminant** — 同 channel 跨 slice 共用 = 跨 slice subscriber 互相干扰（messagesStore 收到 prefs-updated 要 ignore），违反 [emit catalogue § 设计原则 "Per-event 单一 slice subscriber"](../archive/refactor/b3-rust-emit-catalogue.md#事件清单5-新--3-沿用)。reject
- **`subscribe + replay since invoke timestamp` 协议** 解决 invoke / listen 之间的 race window — 复杂度高（Rust 需要 ring buffer），单 user 场景下 < 50ms 窗口实测不会出问题。reject，emit catalogue § Initial state contract 标 "B3 不引入"
- **schemars-derive 自动生成 emit event TypeScript types** — 跟 B2 的 IPC manual sync 同道理：codegen 工具 lock 在 lifecycle 上比手维护 60 个字段贵。reject
- **16ms batch 改 32-50ms 把 streaming delay 隐藏到 perceptual threshold 之下** — 高于 16ms streaming 字符延迟肉眼可见，反产品定位。AD-10 § T1.6 keep 16ms (可调到 32 但不 50)

## Open questions

延续 [mapping doc § G](../archive/refactor/b3-slice-mapping.md#g-open-items推到后续-sub-task) 的 O5 / O6 / O7 / O8 / O9，全部 unresolved 到 M3-M5 dogfood：

- **O5**: `activeProjectFilter` 实测如果 filter 切换触发 sessions list 不必要 re-fetch / re-emit，考虑反转到 uiStore（M4 dogfood 后复核）
- **O6**: demo `seedMockSessions` / DEMO_LLMS / DEMO_GA_CONFIG 是否 retire（T6.5 实施前定）
- **O7**: `agentRunning` 边界（M3/M5 dogfood 时复核；若发现 Sidebar 跨 slice 订阅造成 useShallow 问题，倾向反推到 sessionsStore.session.isRunning 物化）
- **O8**: `userSubmitTick` 边界（兜底；当前唯一 reader 是 MainView scroll effect，归 messages 没问题）
- **O9**: `setGAConfig` 副作用 prefs → runtime cross-slice listener 实现细节（M3/M6 边界）

新增 1 条：

- **O10**: emit catalogue § "Initial state contract" 容忍 invoke + listen 之间 < 50ms race window。M2-M5 dogfood 时如果出现 "刷新后 session list 漏了 1 条"，touch 这条。

## What's next

- T1.10 M1 commit + this devlog + cursor update
- 进入 **M2 uiStore 抽离**（[playbook M2](../archive/refactor/B3-store-slice.md#m2--uistore-抽离-d34-d35) · D34-D35）—— 5 slice 最简单的，建模式。pre-condition：M1 commit 后 cursor 移到 T2.1
- M2 启动前**不需要等** M2 dogfood gate —— M2 内部已经 dogfood 1 天作为 milestone-end gate。M2 启动门 ([Prerequisites § M2 启动门](../archive/refactor/B3-store-slice.md#prerequisites--必须先完成)) 是 M2 **commit 前**的强 gate

## Verification

- 3 个 artifact 全部 cross-link 互通：mapping doc § F / § G 引用 ADR AD-04 / AD-07；ADR AD-09 引用 catalogue § sections；catalogue § Subscriber 字段引用 ADR + mapping
- B3 playbook 顶部 cursor 更新为 T2.1
- B3 playbook M1 全 9 sub-task checkbox ✅
- T1.9 emit catalogue 跟 B2 M2 现有 emit (`runner-event` / `runner-malformed` / `runner-closed`) 关系明确：3 个沿用 + 5 个新增 = 8 个 channel，GUI 在 B3 ship 后只订阅 5 新的（runner-event 转 forensics）
