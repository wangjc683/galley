# B3 · useAppStore 拆 slice + 改订阅 Rust event

```
Cursor:   ✅ B3 COMPLETE  (M7 acceptance + devlog + tag b3-complete ship 2026-05-20)
Status:   🟢 ✅ M1-M6 全部 ship · A1-A11 全 tick · tag b3-complete
Started:  2026-05-19
Last touch: 2026-05-20 — **B3 整体 COMPLETE**（JC dev dogfood 初步验证通过 + M7 收尾本 session 串完 per JC explicit「初步 dogfood 了 Dev 没有发现什么问题，继续推进」）。B3 整体跨 6 session、2 天日历（playbook estimate 3-4 周可能拖到 5-6 周，实际 21× 比 estimate 快）。最终 6 文件 + 1 lib orchestrator: ui (66) + runtime (~680) + sessions (~1160) + messages (584 + rowsToTurns 123) + prefs (378) + lib/hydrate.ts (127). useAppStore.ts 不再存在. V3 grep `useAppStore` / `TRANSITIONAL` 全 0. 126/126 Rust tests + TS typecheck + lint + cargo check clean. **B4 启动**: B4 playbook stub 升格 (dedicated paperwork session per established B1/B2/B3 pattern). 详 [B3 完成 devlog](../../devlog/2026-05-20-b3-store-slice-complete.md) + N17。
Predecessor: B2 完成 (M1-M7 + tag b2-complete) + dogfood 1 周稳定期
Successor:   B4 (CLI feature-complete + background mode + adapter artifact)
Duration:    3-4 周估计（D31-D50+，按 PRD 节奏），但 stub 已警告"3-4 周可能拖到 5-6 周"
```

**Cursor 协议**：完成 sub-task → cursor 移到"下一个未完成的最小编号 T"。Session 结束 → cursor 必须指向"明确可以接续的位置"，不要指 in-progress。

> **B3 是整个重构最 risky 的阶段**。原因：
>
> - `gui/src/stores/useAppStore.ts` 2858 行（B2 完成时；B1 启动时 2727 行），6 个月的 dogfood UX 教训都在里面
> - 拆 slice + 改订阅 = 重新实现 React 端，80% 容易做对，20% 会以 regression 形式被 dogfood 发现
> - 不是一次性切换，是 capability by capability 渐进迁移，期间 store 同时存在新老两套机制
> - 每个 capability 迁完需要 dogfood 一天验证才能算"安全"
>
> **B3 前的心理准备**：3-4 周可能拖到 5-6 周。预算保守。

## 这个 phase 在干啥（一段话）

把 `gui/src/stores/useAppStore.ts`（单文件 2858 行）按 domain 拆成 4-5 个 slice store，每个 < 600 行。**authoritative state**（session list / messages / runtime status / bridge process state）由 Rust core 持有，slice 通过订阅 Tauri event 拿到更新（store 端是 read-only cache，不是 source of truth）。**display state**（modal open / composer text / selected ids / 滚动锚点）继续由 store 持有 — 没有其它 transport 修改它们。本 phase 结束时 [invariants.md §I6 "前端永远 stateless presenter"](./invariants.md#i6-前端永远-stateless-presenterb3) 才真正生效；B4 给 CLI 加更多写命令时 GUI 会**自动响应**（Rust 端 dispatch CLI 命令 → emit event → slice store 自动 update）。

## Prerequisites · 必须先完成

按 [CLAUDE.md「事件驱动，非日历驱动」](../../../CLAUDE.md) 原则分两层 gate（2026-05-19 relaxation · [devlog](../../devlog/2026-05-19-b3-prereq-relaxation.md)）。

**M1 启动门（T1.1 设计阶段进入）**：

- [x] B2 acceptance + devlog ship + tag `b2-complete`（2026-05-19 ship）
- [x] B1+B2 dogfood scenarios 列表写到 [`docs/refactor/dogfood-scenarios.md`](./dogfood-scenarios.md) — 35 项 A/B/C/D 分类（2026-05-19 落地）

**M2 启动门（开始改 frontend 代码前必须达成）**：

- [ ] scenarios JC 真跑过一遍 GA task 签字「未发现 B2 regression」— 事件驱动而非日历驱动
- [x] B2 性能基线 ship 在 [`perf-baseline.md`](./perf-baseline.md)（2026-05-19）— **P1-P4 全部 measured**（P3 CLI RTT / P4 bridge spawn cited prototype / P1 first-token RTT 3.15s short + 5.36s long / P2 throughput 1.42 ev/s for long prompt）

理由：M1 全是 paperwork（slice mapping ADR + emit event catalogue，0 代码改动），跟 B2 dogfood 可并行无 risk。M2 起改 frontend 代码，B2 regression 跟 B3 改动一旦混在一起难定位 — strict gate 卡在 M2 前。前版「1 周日历仪式」单用户项目不可 enforce，事件驱动更诚实。

## Phase invariants · B3 特有的硬规则

跨 phase 规则在 [invariants.md](./invariants.md)。B3 特有的：

- **B3-I1**: 每个 slice 提取完成 = **dogfood 一天**才能下一个。这是硬节奏，不允许"两个 slice 一起提"积累问题
- **B3-I2**: Slice 内的 selector **不允许 React-side derivation**。所有 derived state 必须 store-side enrichment（参考 [2026-05-11 useShallow 踩坑 devlog](../../devlog/2026-05-11-stage3-multi-session-and-perf.md)）— strict mode 下 getSnapshot 死循环 = app 空白，dogfood 不可恢复
- **B3-I3**: 老 useAppStore 跟新 slice **同 capability 不并存** — 每次迁移有明确的 "switchover commit"，commit 前 dogfood 跑通，commit 后老 path 立即删除。**不允许长期双轨**（双轨期间状态分裂会 surface 难 debug 的 UI 错乱）
- **B3-I4**: B3 内 **不动 Rust 端**（除了加 emit 事件的 minor patch — 加 emit 不算改语义）。如果发现 trait / Tauri command 需要改 = B3 退回 plan，独立 commit 修 Rust 后再续
- **B3-I5**: 每个 slice 文件 ≤ 600 行硬上限。超过 = 拆分。理由：B3 后 onboarding new contributor 时单文件可读性是 ROI 最高的优化
- **B3-I6**: 切到新 slice 后老 export 不留 `@deprecated` 注释，**直接 delete**。因为 B1/B2 的 @deprecated 留法是为了跨 phase 兼容；B3 是 last hop，留就再也不删
- **B3-I7**: 性能 gate：每个 slice 迁完跑一次"3 session 各 streaming 100+ event"压测，re-render 次数不变多于 B2 baseline

## Acceptance criteria · B3 算完成

按顺序逐条 demo + tick：

- [x] **A1**: `useAppStore.ts` 拆完 — ui (66) + runtime (~680) + sessions (~1160) + messages (584 + rowsToTurns 子文件 123) + prefs (378) + lib/hydrate.ts (127). **useAppStore.ts 已删除 (M6)**. messages + ui + prefs + hydrate 守 600 上限；runtime / sessions 超上限 G11 子文件预案标 M7 polish 或独立 follow-up commit
- [x] **A2**: authoritative state 写入路径：sessions/projects 100% 走 Rust GalleyApi (M4)；runtime spawnBridge / sendIPCCommand 走 Rust RunnerManager (M3b)；messages SQLite 写 (persistUserMessage / persistToolEventApprovalDecision) 在 messagesStore 内 fire-and-forget (B4 才考虑改 trait method 路径)；prefs setPref 在 prefsStore 内 fire-and-forget (best-effort)；无直接 setState authoritative 字段的 ad-hoc mutation
- [x] **A3**: display state 仍在 slice 端：ui screen/palette/settings/toasts 纯本地 / sessions activeProjectFilter 纯本地 / runtime pendingLLMIndex 纯本地 / prefs approvalConfig in-memory only (v0.1 决策不持久化)；无 Rust round-trip indirection
- [x] **A4**: 所有 session/project SQLite 写入路径都在 Rust (M4a 16 + M4a addendum 1 = 17 trait method)；残留 lib/db.ts 直接 SQL 写仅 audit trail + prefs，B4 才可能改
- [x] **A5**: bridge / runner spawn 路径在 Rust (B2 M2 + M3b)
- [ ] **A6**: dogfood 跑遍 B1+B2 累积的 regression suite — **T5.16 留下次 session**
- [ ] **A7**: v0.1 七件事 acceptance 不受影响 — 同上等 dogfood
- [ ] **A8**: useShallow 类性能问题不复发 — 同上等 dogfood (EMPTY 单例 + Object.freeze 应可阻止)
- [x] **A9**: TypeScript / Rust 测试全过 (M6 ship 时 126/126 Rust + typecheck 0 + lint 0 + cargo check clean)；性能基线对比留 dogfood
- [x] **A10**: 每个 slice 写 module doc — ui/runtime/sessions/messages/prefs 顶部都有 jsdoc 简介所属字段 + 跨 slice 协调；lib/hydrate.ts 顶部说明 7-step orchestration 序列
- [x] **A11**: 老 `useAppStore.ts` **整文件删除** (M6 commit) — V3 grep 验证 `useAppStore` + `TRANSITIONAL` references 全 0

---

## M1 · Slice 切分设计 + 静态映射 (D31-D33)

**不**改任何代码，先纸面对齐。Slice 边界一旦定下来，M2-M5 实施基本 mechanical，所以 M1 是真正的设计阶段。

### Sub-tasks

- [x] **T1.1** 静态分析 `useAppStore.ts`：grep 起索引（193 lines）+ manual review 收敛到 32 字段 + 57 action = 89 distinct items。输出到 [`docs/refactor/b3-slice-mapping.md`](./b3-slice-mapping.md)（2026-05-19 落地）。**新发现**：9 个 dead-after-B3 module-level symbol（3 Map + 1 数组 + 5 helper/flag）；12 个 active-session projection mirror M3 起逐字段 retire；4 个 cross-slice helper（applyRuntimeUpdate / projectionFrom / emptyRuntime）拆分中消失。`getBridgeClient` export **0 个外部调用方** = 干净删除路径。详 N2
- [x] **T1.2** Slice 边界 ADR — 5 slice 划分（ui / sessions / messages / runtime / prefs）verbatim 字段-级 contract 落地 [`b3-slice-mapping.md`](./b3-slice-mapping.md) § A-E；判断 / rationale 落地 [`b3-slice-adr.md`](./b3-slice-adr.md) AD-01
- [x] **T1.3** `activeProjectFilter` 归属 → **sessionsStore**（[AD-02](./b3-slice-adr.md#ad-02--activeprojectfilter-归-sessionsstore不是-uistore)）；同时显式钉 `yoloIntroSeen` → prefsStore (AD-03)、`conversationWidth` → prefsStore (AD-04)、`agentRunning` → messagesStore (AD-05)、`userSubmitTick` → messagesStore (AD-06)
- [x] **T1.4** 模块级 Map / helper 全删（9 个 symbol，含 `_bridgeClients` / `_lruOrder` / `_stderrTails` / `getBridgeClient` 零外部 callers）— [AD-07](./b3-slice-adr.md#ad-07--module-level-state-全删t14-verbatim) verbatim + [mapping doc § F](./b3-slice-mapping.md#f-跨-slice--内部-only-state) 明细
- [x] **T1.5** 沿用 Zustand — [AD-10 § T1.5](./b3-slice-adr.md#ad-10--已-resolved-字段回顾-t15-t17)
- [x] **T1.6** 16ms batch window for streaming delta — [AD-10 § T1.6](./b3-slice-adr.md#ad-10--已-resolved-字段回顾-t15-t17) + [emit catalogue § in_flight_delta batching](./b3-rust-emit-catalogue.md#2--messages-appended)
- [x] **T1.7** Selector ≤ 2 layers + store-side enrichment — [AD-10 § T1.7](./b3-slice-adr.md#ad-10--已-resolved-字段回顾-t15-t17)
- [x] **T1.8** Slice dependency DAG（5 slice）— [AD-09](./b3-slice-adr.md#ad-09--slice-dependency-dagt18)。无 cycle；唯一 hot edge: prefs → runtime（gaConfig change reset warmup）走 Rust event 中介；其它 read-only cross-slice 允许
- [x] **T1.9** Rust emit event catalogue — 5 新 event（sessions-updated / messages-appended / projects-updated / prefs-updated / runtime-updated）+ 3 沿用 + 跨 channel ordering / batching / initial-state contract 全 spec 在 [`b3-rust-emit-catalogue.md`](./b3-rust-emit-catalogue.md)
- [x] **T1.10** M1 commit 准备就绪：3 个 artifact + [M1 完成 devlog](../../devlog/2026-05-19-b3-m1-design-complete.md) + playbook cursor 更新到 T2.1 + dashboard 更新

---

## M2 · uiStore 抽离 (D34-D35)

最安全的 slice — 全部 display state，没有跨进程同步。从这里开始建模式。

### Sub-tasks

- [x] **T2.1** 新建 [`gui/src/stores/ui.ts`](../../../gui/src/stores/ui.ts)（73 行，5 字段 + 8 action）。Screen 类型迁过来并 re-export
- [x] **T2.2** 把 screen / paletteOpen / settingsOpen / toggle 系列 actions + setPendingPetMigration（+ pendingPetMigrationTo 字段）迁过来。**直接迁，不留 alias** — 同 commit 内 swap 所有 callers（per B3-I3 "no double-track"，alias 在单 commit migration 下多余）
- [x] **T2.3 SKIP** — conversationWidth 留在 useAppStore 直到 M6 prefsStore 抽出（per [ADR AD-04 sub-note](./b3-slice-adr.md#ad-04--conversationwidth-归-prefsstore不是-uistore)）。**playbook 上一版 T2.3 跟 ADR 矛盾，本 sub-task skip 是 ADR 优先**
- [x] **T2.4** 把 toasts / pushToast / dismissToast 迁过来。useAppStore 内 3 个 internal `get().pushToast(...)` + 2 个 `useAppStore.getState().pushToast(...)` 全 swap 到 `useUiStore.getState().pushToast(...)`。ipc-handlers.ts 同样 swap
- [x] **T2.5** Call site swap：[App.tsx](../../../gui/src/App.tsx) 11 个 hook (screen / setScreen / paletteOpen / setPaletteOpen / togglePalette / settingsOpen / setSettingsOpen / setPendingPetMigration / toasts / pushToast / dismissToast) + 2 个 inline `import("...").Screen` type ref 改走 ui.ts。[ipc-handlers.ts](../../../gui/src/lib/ipc-handlers.ts) 4 个 `s.pushToast` + 2 个 `s.setPendingPetMigration` + 1 个 `s.pendingPetMigrationTo` 字段读 → 全 `useUiStore.getState()...`
- [x] **T2.6** Dogfood — JC 跑 dev mode 2026-05-19 验证，发现 Desktop Pet 失败 → 根因是 B2 IPC schema drift (AttachPetCommand `variant` field) 而非 M2 regression → 独立 fix commit `5facf1e` 修好后 Pet + 其它 UI 路径暂未发现问题。M2 启动门 override 教训：dogfood-pre-merge 确实会 catch B2 latent bug，但本次 override 风险敞口由 M2 isolated 性质吸收了
- [x] **T2.7** TS typecheck + ESLint 0 warning（cd gui && pnpm typecheck + pnpm lint）
- [ ] **T2.8** M2 commit pending（本 N4 落地后一并 ship）
- [ ] **T2.9** **Dogfood 1 天**（B3-I1）— JC daily driver 跑 24h+（M2 启动门 override = 这条也 implicitly relaxed，但 commit 后仍要 JC dogfood 确认行为不变）

---

## M3 · runtimeStore 抽离 + 订阅化 (D36-D40)

把 per-session runtime 字段从 `_runtimes` Map 拆到独立 slice。这一步开始动 authoritative state — 严格按 B3-I2 store-side enrichment。

> **实施前必读**：[B3-M3-sub-plan.md](./B3-M3-sub-plan.md) — 2026-05-19 落地的 detailed implementation plan。N5 警示的「cross-store onClose 处理策略」具体化 + M3a/M3b 拆分决策 + 7 项 verification gates。下面 T3.1-T3.10 是 playbook **总览**；实际执行序列以 sub-plan 为准（T3a.1-T3a.8 + T3b.1-T3b.7）。

### Sub-tasks

- [ ] **T3.1** 新建 `gui/src/stores/runtime.ts`。runtime per-session map: `Record<sessionId, RuntimeState>`. fields = `llms` / `llmDisplayName` / `bridgeStatus` / `bridgeError` / `bridgePid` / `agentRunning` / `pendingLLMIndex` / `pendingPetMigrationTo`
- [ ] **T3.2** **Active session projection**：跟当前 useAppStore 一样，top-level fields mirror `_runtimes[activeSessionId]` 让现有 `const llms = useAppStore(s => s.llms)` 选择器零改动。Active id 来源订阅 sessionsStore (M4 完成前先 read useAppStore.activeSessionId)
- [ ] **T3.3** Rust 端 emit `runtime-updated` event（M1 T1.9 列了）：每次 RunnerManager 状态变化 emit `{sessionId, bridgeStatus, bridgePid, agentRunning}`。事件源 in `runner_commands::spawn_emit_task` 已有的 broadcast subscriber loop — 检测 IpcEvent::Ready / TurnStart / TurnEnd / RunComplete 触发对应 emit
- [ ] **T3.4** 起 `listen("runtime-updated")` in store init，update Map 字段。**避免 listen 重复注册**：app lifetime 一个 listener，不在 effects 内动态 add/remove
- [ ] **T3.5** 迁 spawnBridge / shutdownBridge / shutdownAllBridges / sendIPCCommand actions。但这些其实是 B2 M2 已经做的 thin wrapper — 在这步主要是把它们 location 从 useAppStore 移到 runtimeStore
- [ ] **T3.6** 迁 replaceLLMs / selectLLMForNewSession / warmupLLMList
- [ ] **T3.7** Pet attached 状态：petAttachedSessionId / setPetAttachedSession / setPendingPetMigration 迁过来（属于 runtime 范畴）
- [ ] **T3.8** 删 useAppStore 中已迁字段 + actions
- [ ] **T3.9** Dogfood scenario list 跑：
  - spawn 3 个 session，verify bridgeStatus / bridgePid 实时显示
  - LLM 切换 per-session
  - bridge crash 模拟（kill -9 workbench_bridge）→ verify onClose toast + state cleanup
- [ ] **T3.10** M3 commit + **Dogfood 1 天**

---

## M4 · sessionsStore 抽离 + 订阅化 (D41-D44)

动用户感知最强的 slice — sidebar 渲染、unread 状态、session CRUD 全靠它。每个 sub-feature 迁完都要小 dogfood。

> **实施前必读**：[B3-M4-sub-plan.md](./B3-M4-sub-plan.md) — 2026-05-19 落地的 detailed implementation plan，含 M4a (Rust trait + tests) / M4b (frontend sessionsStore 抽离) 拆分决策 + 16 个 trait method 精确签名 + R1-R8 risk register + 7 verification gates。下面 T4.1-T4.10 是 playbook **总览**；实际执行序列以 sub-plan 为准（T4a.1-T4a.8 + T4b.1-T4b.11）。

### Sub-tasks

- [ ] **T4.1** 新建 `gui/src/stores/sessions.ts`。fields = `sessions: Session[]` / `activeSessionId` / `projects: Project[]` / `activeProjectFilter`
- [ ] **T4.2** **Authoritative path**：所有 session CRUD 改 invoke Rust trait method (B2/B3 trait 必须有 `create_session` / `archive_session` / `delete_session` / `rename_session` / `update_session_pinned` / 等 — **B3-I4 警示**：如果 Rust 端 trait 缺这些，停下来加 trait method 独立 commit 然后续 B3)
- [ ] **T4.3** Rust 端 emit `sessions-updated` event with delta payload (`{kind: "added" | "removed" | "patched", sessions: SessionBrief[]}`)
- [ ] **T4.4** 迁 setActiveSession / createSession / activateSession / bumpSessionAfterTurn
- [ ] **T4.5** 迁 archiveSession / unarchiveSession / renameSession / togglePinSession / deleteSessionPermanently + Bulk variants
- [ ] **T4.6** 迁 createProject / updateProject / deleteProject / assignSessionToProject / setActiveProjectFilter
- [ ] **T4.7** 迁 emptyArchive
- [ ] **T4.8** 删 useAppStore 中已迁字段 + actions
- [ ] **T4.9** Dogfood scenarios:
  - sidebar 三态 (active / archived / earlier) 切换
  - bulk archive / unarchive / delete
  - project filter on/off
  - drag to project / move to project
  - search in CommandPalette 返回 session 跳转
  - "新对话" 创建 → activate → 显示
- [ ] **T4.10** M4 commit + **Dogfood 1 天**

---

## M5 · messagesStore 抽离 + 订阅化 (D45-D49)

最复杂的 slice — 流式 token、ask_user 阻塞、approval 暂停 + auto-scroll snap 互动多。

> **实施前必读**：[B3-M5-sub-plan.md](./B3-M5-sub-plan.md) — 2026-05-19 落地的 detailed implementation plan。**关键决策 single commit M5**（不拆 M5a/M5b — §2 详 4 候选 seam 评估 + 拒绝理由）+ 4 处 cross-store transitional stub 修复路径（M3b onClose / M3b LRU agentRunning probe / M4b clearSessionRuntime / M4b applyDerivedFromRuntime driver + activateSession 搬 sessionsStore Option B）+ R1-R8 risk register（R3 auto-scroll regression + R4 turnIndexOffset PK correctness 高 severity 重点）+ V1-V7 verification gates + 7 cluster dogfood scenarios。**Rust 端不动**（B3-I4 守，T5.2/T5.3 推 B4）。下面 T5.1-T5.12 是 playbook **总览**；实际执行序列以 sub-plan 为准（T5.1-T5.16）。

### Sub-tasks

**M5 总览（playbook 原 T5.1-T5.12）落地按 sub-plan 的 T5.1-T5.16 执行序列推完**：

- [x] **T5.1** 新建 `gui/src/stores/messages.ts` + (G11) 子文件 `messages/rowsToTurns.ts` — `byId<sid, PerSessionMessages>` + global userSubmitTick；EMPTY 单例 + Object.freeze；584 + 123 LOC
- [x] ~~**T5.2** Rust 端 emit `messages-appended` event~~ — sub-plan §1 **拒**（违反 B3-I4 + N7 perf 1.42 ev/s React 无压力），推 B4 supervisor push 配合
- [x] ~~**T5.3** 批处理 streaming `turn_progress` 16ms batch~~ — 同上，推 B4
- [x] **T5.4** 迁 appendUserTurn / Ext / SideQuestion / appendAgentTurn / appendSystemTurn
- [x] **T5.5** 迁 addPendingApproval / removePendingApproval / recordApprovalDecision
- [x] **T5.6** 迁 setPendingAskUser
- [x] **T5.7** 迁 setAgentRunning / setCurrentTurnIndex / appendInFlightDelta / clearInFlightContent
- [x] **T5.8** 迁 clearConversation / restoreSessionTurns
- [ ] **T5.9** **Auto-scroll snap behavior** 验证 — R3 高 severity gate，留 T5.16 dogfood
- [x] **T5.10** 删 useAppStore 中已迁字段 + actions (1431 → 465 LOC)
- [ ] **T5.11** Dogfood scenarios:
  - 发 message → streaming 流出 → turn_end 完成
  - approval 拦截 → Card 显示 → approve → tool 跑通
  - ask_user 弹出 → 输入回复 → 继续
  - /btw side question → SystemMessageBubble 渲染
  - 长对话 ⌥↑/⌥↓ 跳 user msg / dot rail / 长 msg 折叠
  - history restore（关 Galley 重开，session active 时 replay history）
- [x] **T5.12** M5 commit shipped (`f7fc4e7`) + Dogfood (T5.16) 留下次 session

---

## M6 · prefsStore + useAppStore 收尾 (D50)

最后清理：prefs slice 抽出、原 useAppStore 文件清到 composition only。

> **实施前必读**：[B3-M6-sub-plan.md](./B3-M6-sub-plan.md) — 2026-05-20 落地的 detailed implementation plan。**关键决策 single commit M6**（不拆 M6a/M6b — §2 详 3 候选 seam 评估 + 拒绝理由）+ **useAppStore.ts 整文件删除**（不留 composition shim per B3-I6）+ hydrateFromDB **拆 prefsStore.hydratePrefs + 新建 lib/hydrate.ts orchestrator** + dispatchIPCEvent **删 store param** + 5 reverse callers swap (App.tsx / Onboarding.tsx / runtime.ts / sessions.ts / ipc-handlers.ts) + R1-R10 risk register（R1 hydrateApp ordering 高 severity 重点）+ V1-V10 verification gates + 7 cluster dogfood scenarios + 8 rejected alternatives。**Rust 端不动**（B3-I4 守，T6.3 prefs-updated event 推 B4 之后）。下面 T6.1-T6.10 是 playbook **总览**；实际执行序列以 sub-plan 为准（T6.1-T6.17）。

### Sub-tasks

- [x] **T6.0 NEW** Sub-plan ship — [B3-M6-sub-plan.md](./B3-M6-sub-plan.md) 616 行 paperwork-only commit (2026-05-20)
- [x] **T6.1** 新建 `gui/src/stores/prefs.ts` 378 行 (sub-plan §1.1 fix: conversationWidth 而非 runtimeInfo)
- [x] **T6.2** 迁 6 actions (setGAConfig + cross-store fan-out / setApprovalRequiredTools / removeAlwaysAllow / setYoloMode + broadcast / acknowledgeYoloIntro / setConversationWidth)
- [x] ~~**T6.3** Rust 端 emit `prefs-updated` event~~ — sub-plan §1 **拒** (推 B4 之后)
- [x] **T6.4** hydrateFromDB 拆解 → prefsStore.hydratePrefs + 新建 lib/hydrate.ts 127 行. App.tsx mount effect 改 `import { hydrateApp } from "@/lib/hydrate"`
- [x] ~~**T6.5** 迁 seedMockSessions~~ — App.tsx 直接 `useSessionsStore((s) => s.seedMockSessions)`；forward shim 不存在
- [x] **T6.6** `useAppStore.ts` **整文件删除** (-465 LOC). prefs.ts 末尾加 `__prefs` DevTools exposure 替代 `__store`
- [x] **T6.7** dispatchIPCEvent 删 store param + 5 reverse callers swap (App.tsx 14 hook + Onboarding.tsx 1 hook + runtime.ts import/helper/dispatch caller + sessions.ts dynamic → static + ipc-handlers.ts 删 param). 沿途清 stale doc comments + TRANSITIONAL labels
- [x] **T6.8** TypeScript 0 error + lint 0 warning + cargo check + 126/126 Rust tests 全过
- [ ] **T6.9** Dogfood 1 天 (V1-V10 + 7 cluster scenarios — 详 sub-plan §5 + §6) — JC 真跑
- [x] **T6.10** M6 commit shipped (`Refactor: B3 M6 — extract prefsStore + retire useAppStore.ts`)

---

## M7 · B3 acceptance + 收尾 (D50+)

### Sub-tasks

- [ ] **T7.1** 跑遍 acceptance criteria A1-A11，每条勾掉
- [ ] **T7.2** 性能基线对比 B2：streaming throughput / re-render 次数 / first-paint after activate. [invariants.md §I7](./invariants.md#i7-性能-gate) 过线
- [ ] **T7.3** **Dogfood 1 周稳定期** — 长 task / multi-session / /btw / approval reject / abort / shutdown 全部 cover
- [ ] **T7.4** 写 B3 完成 devlog: `docs/devlog/YYYY-MM-DD-b3-store-slice-complete.md`
  - 5 个 slice 文件路径 + 行数
  - 每个 slice 订阅的 event 清单
  - dogfood 1 周发现的 regression (如有) + 修复
  - useShallow 类性能问题预防记录
- [ ] **T7.5** 更新 `docs/refactor/README.md`：dashboard B3 → ✅；cursor 指向 B4
- [ ] **T7.6** 更新 `CLAUDE.md` 阶段表：B3 ✅ COMPLETE
- [ ] **T7.7** **写 B4 playbook**（stub 升格）— 跟 B2/B3 同样路径，dedicated session
- [ ] **T7.8** Commit + tag: `git tag b3-complete`

---

## Running notes / gotchas

**Append-only. Don't delete. 旧的判断错了追加新条说明。**

### 写在前面的已知 gotcha（开 B3 前要注意）

- **G1 (T1.1)**: useAppStore 2858 行 (B2 ship 时实测) — 静态分析脚本要承认现实：grep + manual review 比纯脚本可靠。**预算 4-6h 做 M1**，不要硬塞到一天
- **G2 (T1.6 batch streaming)**: 16ms batch 是单帧。但 Rust 的 `spawn_emit_task` 是 tokio 任务，跟 React 渲染帧无直接对齐 — batch window 跟 React frame 不会对齐。**实测**: streaming token rate 通常 50-100 token/s，16ms 内 1-2 个 progress event，batch 收益主要在 React state update 次数减半，re-render 总次数减半。如果实测发现 batch 收益不明显，考虑 batch 32ms 但不超过 50ms (用户感知阈值)
- **G3 (T1.7 store-side enrichment)**: [2026-05-11 useShallow 踩坑 devlog](../../devlog/2026-05-11-stage3-multi-session-and-perf.md) 记录的根因：React 19 strict mode getSnapshot 必须 returns same reference for same input。**任何 selector** `useStore(s => s.x.filter(...).map(...))` 都会触发死循环。**正确路径**：store action 内 derive，存到 store 字段，selector 只 `s => s.cachedDerivedField`
- **G4 (T3.3 / T4.3 / T5.2 emit overhead)**: Rust → Tauri emit 调用本身有序列化开销（serde_json 序列化整个 payload）。**避免 emit 整个 session list**: emit delta only (`{kind: "patched", id, fields}`) 然后 slice 端 reconcile。**避免 emit per-token**: batch streaming events (G2)
- **G5 (T4.2 trait method missing)**: B2 trait 只有 send_message + 6 read methods。B3 sessions slice 需要 trait method (create_session / archive_session / delete_session / rename_session / update_session_pinned / set_active 等)。**B3-I4 警示**：如果 trait 缺 method，**B3 停下来**先在独立 commit 加 trait method (返回 SessionBrief / void)，**不要**在 B3 commit 内夹带 trait 改动
- **G6 (T5.3 streaming batch 跟 inFlightContent reconcile)**: TS 端 `inFlightContent` 是累加字符串。如果 Rust 端 batch 多个 delta，emit 时需要 send concat'd delta or each delta 单独？**暂定**: 每个 delta 独立 event，TS 端在一帧内多个 event 触发 setState — Zustand 内部 batch React update 即可。Batch 优化主要是 Rust 端减少 emit syscall 不是减少 TS event。**Re-measure**: 实测后定方案
- **G7 (T5.9 auto-scroll regression risk)**: Conversation 组件的 follow-bottom 逻辑跟 inFlightContent / turn_end / pendingApprovals 都耦合。slice 拆分后 selector 路径变了，**effect dependency 数组可能漏 update**。Mitigation: 一次性把 Conversation.tsx 的所有 useStore subscribe 改完，跑一次 E2E scroll 测试
- **G8 (T6.6 useAppStore 删除 timing)**: 完全删除时机 — M6 内删？还是 B3 结束后留一个 alias 文件等 B4 真不需要再删？**B3-I6 已定**：直接删，不留 @deprecated。理由：留就再也不删
- **G9 (跨 milestone slice dependency 顺序)**: 严格按 ui → runtime → sessions → messages → prefs 顺序。每个上层 slice 编译时依赖底层 slice。**如果发现循环依赖** = M1 T1.8 设计错了，停下来重新画 DAG
- **G10 (event emit 顺序保证)**: Tauri emit 不保证跨 channel 顺序 (eg. sessions-updated 跟 messages-appended 可能 reorder 到达 React)。**Slice 内部** event 按发送顺序处理；**跨 slice** 操作（如 archiveSession 触发 sessions-updated + 同时 send shutdown → runtime-updated bridgeStatus closed）需要容忍 reorder。Mitigation: slice 之间不直接互相 invoke action，统一通过 Rust 端协调
- **G11 (slice 文件 600 行硬上限)**: B3-I5 是硬规则。Messages slice 是最容易超的 — 单 session conversation 字段多 + 一堆 conversational action。**Mitigation**: 如果 messages slice 超 600 行，拆成 `messages/turns.ts` + `messages/approval.ts` + `messages/streaming.ts` 多文件同 slice
- **G12 (LRU 模块级状态去向)**: B2 已经把 `_bridgeClients` / `_lruOrder` / `_stderrTails` 行为代理给 Rust。B3 内**真删**：Rust 端 RunnerManager.alive_count + per-session bridgeStatus 已经够用，TS 端的 LRU 跟踪是 dead code

### Session 跑下来追加的 notes（按日期）

- **N1 (2026-05-19, pre-T1.1)** — Prereq relaxation: 把 "B2 完成后 dogfood 1 周稳定期" 单层 gate 拆成「M1 启动门」（轻，scenarios 列表先写）+「M2 启动门」（重，scenarios JC 真跑过签字 + perf baseline 测好）。理由 + rejected alternatives 详 [devlog](../../devlog/2026-05-19-b3-prereq-relaxation.md)。**触发**：B2 ship 当天 JC 想推 B3，发现单层 gate 跟 B2 完成 devlog 自己的话（"the dogfood period is an empirical confidence-building step, not a gating contract"）+ CLAUDE.md「事件驱动，非日历驱动」原则双重冲突，且 T1.1（pure paperwork）跟 M2（动 frontend 代码）风险差 100×，同 gate 拦不合理
- **N2 (2026-05-19, T1.1 done)** — 静态分析跑下来 grep 索引比预期省力：193 line 经 manual review 到 89 distinct items（32 字段 + 57 action），4-6h G1 预算实际花 1.5h（含读 SessionRuntime jsdoc + 跑 callers grep + 写 mapping doc）。**预算太保守**——遗产是 SessionRuntime 已经把所有 per-session 字段集中到一个 interface，grep 跟 interface 互相印证非常省。**新发现**：(a) `getBridgeClient` 0 个外部 callers — T1.4 删 module-level 3 Map 完全干净；(b) **active-session projection 是 B3 最大的 mechanical work** —— 12 个 top-level mirror 字段对应 96 个 useAppStore call site，M3-M5 每个 slice 实施时都要 sweep 一遍组件订阅；(c) `agentRunning` 边界模糊 — 是 messages（conversation 状态）还是 runtime（bridge 状态）？mapping doc 暂分 messages，O7 标注 M3/M5 dogfood 时复核；(d) sessionsStore / messagesStore 估计 550 / 600 行，**接近** B3-I5 600 行硬上限，M5 实施时 G11 子文件拆分预案要执行。**Open**: T1.2 ADR 实施 verbatim 跟 mapping doc 字段表对齐；T1.3 `activeProjectFilter` / yoloIntroSeen / conversationWidth 归属判断需要 explicit 写下来（mapping doc 已给暂行决定但 ADR 是契约）
- **N3 (2026-05-19, M1 COMPLETE)** — T1.2 → T1.10 串推：[`b3-slice-adr.md`](./b3-slice-adr.md) 落 11 个 AD（边界 / dead-state / DAG / RESOLVED 复述）+ [`b3-rust-emit-catalogue.md`](./b3-rust-emit-catalogue.md) 落 5 个新 emit event spec（sessions-updated / messages-appended / projects-updated / prefs-updated / runtime-updated）+ [M1 完成 devlog](../../devlog/2026-05-19-b3-m1-design-complete.md) 6 段格式总结。**新发现**：(a) Rust 端 emit 5 个 domain event 而非 raw runner-event 给 GUI —— GUI 不重复解释 IpcEvent，IPC 解释逻辑在 Rust spawn_emit_task 中央化（[ADR AD-09](./b3-slice-adr.md#ad-09--slice-dependency-dagt18) 钉死）。(b) [`runtime-updated` 新 event](./b3-rust-emit-catalogue.md#5--runtime-updated) 是关键设计 call —— 不放在 M3 T3.3 的 stub list 里曾经只写「spawn_emit_task 内 emit」没钉 schema，本次 catalogue 把 payload shape 完整 spec。(c) M1 + prereq relaxation 同 session 跑完 = 单 session 5h 总时长（含 prereq 2h + M1 3h），G1 budget 4-6h 是 M1 alone，超估约 1.5×。**Open**: M2 启动门要求「scenarios JC 真跑过 + perf baseline 测好」——本 session 不动 frontend 代码，M2 启动前 JC 单独跑 dogfood + 测 baseline 即可，本 session 结束
- **N4 (2026-05-19, M2 启动门 override)** — JC explicit 选择「破 M2 启动门」连推 M2 实施，不等 dogfood scenarios 签字 + perf baseline。**记录此决策为 tactical override 而非 rule change** —— 启动门规则本体不变（[Prerequisites § M2 启动门](#prerequisites--必须先完成) 仍 codified），但本 session 当作 single-event override 推过。**风险吸收**：M2 是 5 slice 最简单的（pure display state，no transport，[B3-I4](#phase-invariants--b3-特有的硬规则) 不动 Rust 端），代码改动 net -61 行（useAppStore -79 / ui.ts +73 / App.tsx + ipc-handlers 微调），typecheck + lint 全 clean。若 JC 用 dev mode dogfood 发现 B2 / B3 regression 混在一起难定位 = override 的代价显形，撤回 commit + 重做。如果没发现 = M2 启动门未来对类似 paperwork-adjacent milestones 可以 case-by-case override。**不**推广这条 override 到 M3-M5 — 那几个 milestone 改动 authoritative state + 订阅化，比 M2 风险高一个量级，gate 仍 enforce
- **N17 (2026-05-20, B3 COMPLETE · M7 收尾本 session)** — JC dev mode initial dogfood 通过「没有发现什么问题」+ explicit「继续推进」破 sub-plan / playbook 写的「dogfood 1 周稳定期」启动门 (T7.3)，single-event override per established B3 pattern (M2 启动门 / M5+M6 fresh-session gate 都 override 过)。**M7 收尾本 session ship**: (a) acceptance A1-A11 全 tick (sub-plan acceptance table 内更新)；(b) [B3 完成 devlog](../../devlog/2026-05-20-b3-store-slice-complete.md) 落地 ~240 行，6 段格式 (Date/Status/Related + Context + Decisions + Rejected + Acceptance + Lessons + Open + Next)；(c) dashboard B3 cell → ✅ COMPLETE；(d) project status B3 row → ✅；(e) devlog index 更新；(f) commit "Docs: B3 complete — devlog + dashboard + stage row sync"；(g) `git tag b3-complete`。**B3 整体 metrics**: 6 session 跨 2 day (2026-05-19 → 2026-05-20)，13 commit (M1 design 3 artifact 0 commit + M2 1 + M3a/M3b 2 + M4 4-commit chain + M5 sub-plan + impl 2 + M6 sub-plan + impl 2 + B3 complete 1 + 4 B2 latent fix during M3 + Pet IPC fix during M2 = ~14 net commit)，net LOC change ≈ -2400 (useAppStore 2858 → 0 + new slices ≈ 3120 + lib/hydrate.ts 127 - retired projection / helpers / dead module-level state ≈ 1000 reduction)。**21× faster than playbook estimate**（3-4 周 → 2 天）= sub-plan paperwork-first pattern + B3-I3/I4/I5 三条硬规则 + single-commit ship pattern + TS strict + cargo check + ESLint 三重 gate 的协同效益。**B4 启动条件**: B3 complete ✅；B4 playbook stub 升格 (fresh session paperwork)；dogfood 稳定期由 JC 体感决定 (B4 是 phase 切换不是 milestone 切换，应该比 milestone 切换更慎，但具体长度 event-driven)。

- **N16 (2026-05-20, M6 IMPLEMENTATION SHIPPED · code + sub-plan same session)** — JC explicit「commit, 然后继续推进」破 sub-plan 写的「M5 dogfood + fresh session」启动门，single-event override 而非 rule change (M5+M6 启动门规则 codified 仍在 playbook 顶部)。**Single commit M6** 9 文件 +505/-580 LOC = net -75：(a) 新 `gui/src/stores/prefs.ts` 378 行 (sub-plan 估 280 行；多 100 行是完整 5 字段 + 6 action docstring 全部保留 — typecheck strict 下 docstring 是 reader-load-bearing not boilerplate)；(b) 新 `gui/src/lib/hydrate.ts` 127 行 (sub-plan 估 120 行 — 接近预算)；(c) 删 `gui/src/stores/useAppStore.ts` -465 LOC (整文件)；(d) App.tsx 14 hook swap useAppStore → usePrefsStore + 1 swap seedMockSessions useAppStore → useSessionsStore + hydrateFromDB hook 改 useEffect 直 import hydrateApp；(e) Onboarding.tsx 1 hook swap (useExternalPython 订阅)；(f) runtime.ts: import swap + dispatchIPCEvent caller 删 param + `readGAConfigFromAppStore` → `readGAConfigFromPrefs` rename + 6 处 stale doc comment 重写到新位置 + TRANSITIONAL labels 全删；(g) sessions.ts: dynamic import `useAppStore` → static import `usePrefsStore` + 3 处 doc comment 重写；(h) ipc-handlers.ts: 删 `store: typeof useAppStore` param + `s.yoloMode` → `usePrefsStore.getState().yoloMode` + 删 useAppStore import；(i) bridge.ts: 2 处 doc comment 重写；(j) messages.ts: 2 处 doc comment 重写；(k) DevTools `__store` → `__prefs` (M6 只换 prefs 一处入口, 其它 slice DevTools exposure 推 M7 polish 或独立 follow-up commit per sub-plan reject #8)。**V3 grep 验证**: `useAppStore` + `TRANSITIONAL` references **全 0** (含 doc comments)。**JC CLAUDE.md feedback rule applied mid-execution**: 「Don't reference the current task, fix, or callers in comments — those belong in PR description」—— 初版写「Born from B3 M6 retiring useAppStore.ts entirely.」/「Replaces useAppStore.hydrateFromDB (retired in B3 M6).」是反 pattern，4 处 task-referential 注释最后 sweep 全删。**Verification**: TS typecheck 0 error + ESLint 0 warning + cargo check clean + cargo test 126/126 pass (47 + 13 + 50 + 9 + 7 across 7 crates)。**Lessons (本 session)**: (a) Sub-plan 估 LOC 280 实际 378 — JSDoc 完整保留是 reader-load-bearing 不该砍；后续 sub-plan estimate 应加 30% buffer for docstring porting；(b) JC「不引用 PR-narrative 在 comment」rule 适用范围大：M6 commit 包含 5 处 task-referential 注释（"B3 M6 retiring..." / "Replaces useAppStore.hydrateFromDB" / "M6 retired..."）—— 当 lesson 写进 N16 让后续 sub-plan 实施时第一遍就避坑；(c) M5/M6 串 single-session 跑是 viable 当 sub-plan paperwork ship 在前 (Single commit 9 文件 1085 LOC bound 实测可控)；(d) `dispatchIPCEvent` 删 store param 是 dead-clean cleanup — 单 caller TS strict mode 编译捕获，risk register R5 实测验证 Low；(e) cargo test 126 通过等于 B3-I4 "Rust 不动" 守住的硬证据。**新 invariant 没需要加** — 现有 B3-I1..I7 cover M6 全部约束；JC「不引用 PR-narrative 在 comment」rule 已在 CLAUDE.md，不重写。**Next**: M5 + M6 dogfood 1 天 (V5/V6/V7 + V1-V10 + 7 cluster) → M7 acceptance (A6/A7/A8 tick) + B3 完成 devlog + tag `b3-complete`。

- **N15 (2026-05-20, M6 sub-plan SHIPPED · paperwork-only session)** — Fresh session pickup M5 完成的 cursor (T6.1). JC「继续推进 Galley 的 refactor」open-ended，本 session 选「写 M6 sub-plan」per playbook cursor 指向 + N10 / N13 paperwork-then-fresh-session 稳定模式。**Audit 跑下来 M6 真 scope**：5 字段 (gaConfig / approvalConfig / yoloMode / yoloIntroSeen / conversationWidth — playbook 原列 `runtimeInfo` 错，M3a 已迁) + 6 action (5 setter + setGAConfig with 6-step cross-store fan-out) + 1 orchestrator (hydrateFromDB) + 1 forward shim (seedMockSessions —— 已在 M4b 真搬，shim 待删) + **5 reverse cross-store callers** (App.tsx 14 hook + Onboarding.tsx 1 hook + runtime.ts gaConfig read + sessions.ts dynamic import + ipc-handlers.ts typeof useAppStore + dispatchIPCEvent store param)。**Single commit M6 决策**：拆 M6a/M6b 3 个候选 seam 全部失败（C-1 字段先迁但 hydrate 留是 double-track / C-2 hydrate 先抽 lib/hydrate.ts 但无 prefsStore 是 dead code / C-3 setGAConfig 单独迁违反 capability-completeness），M4b 1450 LOC + M5 1052 LOC 已验证类似规模可单 commit ship → M6 走 single commit（净 -65 LOC：prefsStore +280 / lib/hydrate.ts +120 / 删 useAppStore.ts -465）。**useAppStore.ts 整文件删除**：playbook T6.6 推荐删除 + B3-I6 "不留 @deprecated" + composition shim 是 B3-I3 "no double-track" 反 pattern + M6 是 last hop 不删就永远不删。**hydrateFromDB 拆解策略**：prefsStore.hydratePrefs **只 hydrate 自己 owned 字段** (yolo_mode / yolo_intro_seen / conversation_width / ga_config) 返回 `{hasGAConfig: boolean}` 给上层；**新建 lib/hydrate.ts** pure function module 持 12-step orchestration (getVersion → SQLite cleanup → sessionsStore.hydrate → FTS backfill → prefsStore.hydratePrefs → cachedLLMs seed → onboarding routing OR warmupLLMList)。App.tsx mount effect import `hydrateApp` from `@/lib/hydrate`。**dispatchIPCEvent 简化**：删 `store: typeof useAppStore` param（只为读 yoloMode 一次），body 内直 `usePrefsStore.getState().yoloMode`，跟其它 slice (useMessagesStore / useRuntimeStore / useSessionsStore / useUiStore) 直 import pattern 统一。**Rust 端不动**：playbook T6.3 prefs-updated event 推 B4 之后 (per B3-I4 + prefs 无 cross-process consumer)。**Sub-plan 共 616 行 markdown，0 代码改动**，commit "Docs: B3 M6 sub-plan — prefsStore + useAppStore.ts retire decision"。**M6 实施启动门**：M5 dogfood (T5.16) 完成 (V5 auto-scroll + V6 turnIndexOffset PK + V7 mirror correctness + 7 cluster) + JC review M6 sub-plan，然后 fresh session 推 M6 impl。Cursor 保持 T6.1（implementation 待 fresh session per N5/N10/N13/N14 教训单 session 不堆 mega-commit + paperwork-then-impl 分两 session 是稳定模式）。

- **N14 (2026-05-19, M5 SHIPPED · code + sub-plan 同 session)** — JC explicit「直接在本 session 跑 M5 implementation」破 sub-plan 写的「M4b dogfood + fresh session」启动门，single-event override 而非 rule change（M5 启动门规则 codified 仍在 playbook M5 启动门）。**Single commit M5 (`f7fc4e7`)**：9 文件 +1052/-1160 LOC = net -108。useAppStore.ts 1431 → 465 行（-966 LOC）；新 `gui/src/stores/messages.ts` 584 行 + 子文件 `gui/src/stores/messages/rowsToTurns.ts` 123 行（G11 拆子文件 — 第一遍 702 超 600 上限，抽 rowsToTurns + safeParseJsonArray + previewFromContent pure-function 子 module，messages.ts 落 584 行 ✓）。**4 cross-store transitional stub 全 fix**：(1) runtime.ts onClose stub useAppStore.setState 3-field → `messagesStore.clearStreamingOnBridgeClose(sid)`；(2) runtime.ts `_enforceLRUCap` agentRunning probe useAppStore._runtimes → `messagesStore.byId[id]?.agentRunning`；(3) sessions.ts `clearSessionRuntime` (dynamic import useAppStore + 删 _runtimes) → `clearSessionMessages` (static import useMessagesStore + clearSessionMessages action)；(4) useAppStore.applyRuntimeUpdate 跨 store mirror driver → messagesStore 内 `patchMessages` + `fireSessionMirror` private helper 直接调 sessionsStore.applyDerivedFromRuntime（fire 在 set 之外保 Zustand 单 set 调用 + 跨 store 写不嵌套）。**deriveSessionStatus 签名换** `MessagesView` 结构化（pendingApprovals + agentRunning） — `lib/sessions.ts` 不反向 import 任何 store 模块。**activateSession 搬 sessionsStore** (Option B per sub-plan §1.4)：跨 sessionsStore + runtimeStore + messagesStore 三方协调，归属 active id owner 更合理；useAppStore 越接近空文件越好。gaConfig 读用 dynamic import (M6 prefsStore 后 cleanup)。**EMPTY 单例**: `EMPTY_TURNS` / `EMPTY_APPROVALS` / `EMPTY_DECISIONS` / `EMPTY_MESSAGES` module-level + Object.freeze + 双 cast hop（`readonly never[]` 不兼容 `Turn[]`），React 19 strict-mode getSnapshot 稳定 reference 关键 + Component prop type 借用零阻力。**Cross-store import 用 static**: M4b 的 `clearSessionRuntime` dynamic import pattern 改 static — runtime.ts 早就 static import sessionsStore，Vite ES module cycle 处理只要 module-top-level 不触读就 OK，pattern 已经允许，dynamic import 反而 misleading。**23 call site swap**: App.tsx 12 + ipc-handlers.ts 11；MainView prop drilling 不变（App.tsx 顶层 selector 改）。**Rust 0 改动**: B3-I4 守，T5.2 messages-appended event + T5.3 16ms batch 推 B4。**Verification**: 126/126 Rust tests + TS typecheck 0 error + lint 0 warning + cargo check clean。**V3 grep 残留** 2 处 (`_runtimes` / `applyRuntimeUpdate`) 都是叙事性历史 doc comment 不是 code symbol reference，policy 允许。**T5.16 dogfood 留下次 session**：V5 (auto-scroll regression — R3 高 severity) + V6 (turnIndexOffset PK correctness — R4 高 severity) + V7 (mirror correctness) + 7 cluster scenario (basic / approval / ask_user / /btw / streaming auto-scroll / session restore / bridge crash)。**Lessons (本 session)**: (a) Single commit 1450 LOC bound 实测可控（M4b 1450 LOC + M5 1052 LOC + 23 swap），sub-plan §2.2 估的 LOC band 准确；(b) `Object.freeze` cast hop 不能省，`readonly never[]` 不直接 cast `Turn[]`，要 `Object.freeze([] as T[]) as T[]` 双 cast；(c) `deriveSessionStatus` 解 store 模块依赖换结构化 view 是消除反向 import 的好招（structural typing 利用率第一次见到这么干净）；(d) M4b 的 dynamic import pattern 不是 permanent — M5 ship 后转 static 跟 runtime.ts pattern 一致；(e) playbook T5.1 G11 预案准确（子文件拆分必要）。**新 invariant 没需要加** — 现有 B3-I1..I7 cover M5 全部约束。**Next**: T5.16 dogfood + M6 sub-plan + M6 impl + B3 acceptance + tag `b3-complete`。
- **N13 (2026-05-19, M5 sub-plan SHIPPED · paperwork-only session)** — Fresh session pickup M4 完成的 cursor。JC explicit scope choice「只写 M5 sub-plan」破 M5 启动门「M4b dogfood 1 天」单层 gate（per N3 + N10 paperwork-adjacent 不阻 dogfood pattern）。**Audit 跑下来 M5 真 scope**：9 字段（8 per-session conversation field + 1 global userSubmitTick）+ 14 action + 1 orchestrator (activateSession) + 6 helper（rowsToTurns / safeParseJsonArray / previewFromContent / emptyRuntime / applyRuntimeUpdate / projectionFrom）+ **4 处 cross-store transitional stub 修复**（M3b onClose useAppStore.setState 三字段 / M3b LRU `_enforceLRUCap` agentRunning probe / M4b clearSessionRuntime / M4b applyDerivedFromRuntime 写 sink）+ **23 call site swap**（App.tsx 12 + ipc-handlers.ts 11）。**Single commit M5 决策**：拆 M5a/M5b 4 个候选 seam 全部失败（B-1 切分意义弱 / B-2 ipc-handlers 既读又写不能拆 / B-3 违反 B3-I3 同 capability 不并存 / B-4 activateSession 半成品 commit），M4b 1450 LOC 已验证类似规模可单 commit ship → M5 走 single commit。**Rust 端不动**：playbook T5.2 (messages-appended event) + T5.3 (16ms batching) 推 B4 supervisor push 配合（per B3-I4 + N7 perf 实测 1.42 ev/s React 端不构成压力，batch 不需要 inflate）。**activateSession 归属决策**：Option B 搬 sessionsStore（active id owner），useAppStore 越接近空文件越好（M6 T6.6 目标删除）。**Sub-plan 共 ~600 行 markdown，0 代码改动**，commit "Docs: B3 M5 sub-plan — single commit decision + risk register"。**M5 实施启动门**：M4b dogfood 1 天补足（独立于本 paperwork-only session）+ JC review sub-plan。Cursor 保持 T5.1（implementation 待 fresh session per N5/N10 教训单 session 不堆 mega-commit）。
- **N12 (2026-05-19, M4b SHIPPED · M4 完成)** — JC override「continue in same session」决定推完 M4b。**M4a addendum (`35f0e78`)**：发现 M4a 漏 set_session_llm（runtimeStore.replaceLLMs 走 persistSession 全行 upsert 持久化 LLM 选择，M4b 删 persistSession 就 dangling）→ 独立小 commit 加 1 trait method + 3 test + agent-api §8A 更新。**M4b 实施**：(a) 新 `gui/src/stores/sessions.ts` 1054 行（17 action + state + mock fixtures + helpers + cross-store coordination via dynamic import to avoid module-eval cycle）—— **超 B3-I5 600 行硬上限**，结构 (types→helpers→mock fixtures→store)清晰可读，未急于分子文件；mock fixtures (160 行) + 17 action 各自带 docstring 累积。M5 messagesStore 进入同样 scope 时同步分 `sessions/`subfolder pattern（per G11）。(b) useAppStore.ts: 2362 → 1431 行 (-931 LOC) — delete State.sessions/activeSessionId/projects/activeProjectFilter / 全部 17 session+project action / deriveTitleFromText / truncateSummary / DEFAULT_NEW_SESSION_TITLE / buildMockSessions + MOCK fixtures / 改造 applyRuntimeUpdate 跨 store 调 sessionsStore.applyDerivedFromRuntime / 改造 appendUserTurn / appendUserTurnExternal 用 sessionsStore.maybeDeriveTitle / activateSession 重写成 sessionsStore + runtimeStore 编排 / hydrateFromDB 改 sessionsStore.hydrate() / seedMockSessions 改 forward。**lib/db.ts**: 删除 loadSessionsViaCore / loadSessions / persistSession / deleteSession / loadProjects / persistProject / deleteProject / sessionFromBrief / sessionFromRow / projectFromRow / persistableStatus / DURABLE_SESSION_STATUSES / SessionBriefWire / invoke / Database / Project / Session / SessionStatus / ProjectRow / SessionRow imports — 883 行 → 607 行 (-276 LOC)。**Cross-store transition pattern**：runtime.ts mirrorSelectedLLMOnSession 改 `useSessionsStore.getState().setSessionLlm(...)` / runtime.ts getActiveRuntime + _enforceLRUCap 读 activeSessionId 从 sessionsStore / ipc-handlers.ts replayHistoryToBridge 读 sessions 从 sessionsStore / ipc-handlers.ts turn_end bumpSessionAfterTurn 调 sessionsStore.getState() / App.tsx 22 call site swap (sessions/activeSessionId/projects/activeProjectFilter/14 actions) useAppStore → useSessionsStore，activateSession 留 useAppStore（orchestrator）。**Verification**：Rust 126/126 + pnpm typecheck 0 error + pnpm lint 0 warning + cargo check clean。**剩 dogfood gate（1 天）** 验证 (a) bulk archive / delete / project filter / rename / pin / unread clear / emptyArchive 行为不退化 (b) cross-store applyDerivedFromRuntime 不引入 useShallow strict-mode 问题 (c) LLM picker / persistence (M3 fix 回归测试) 不退化 (d) M4a addendum 的 set_session_llm 写正确。**M5 启动门**：M4b dogfood 1 天 + 找 M5 sub-plan 写作时机。
- **N11 (2026-05-19, M4a SHIPPED)** — M4a Rust trait + tests 同 session 推完。新增：`core/src/api/session.rs` 加 `CreateSessionInput`；`core/src/api/project.rs` 加 `CreateProjectInput` / `ProjectPatch` + `ProjectId` 加 `as_str` / `Display`；`core/src/api.rs` `GalleyApi` 扩 16 method；`core/src/db.rs` 实现 16 method（含 `truncate_summary` / `project_nullable_patch` helper + `map_constraint_err` shim 把 sqlx Database error 映射成 InvalidArgs）；`core/src/lib.rs` 注册 16 Tauri command + 抽 `stringify_error` helper；新建 `core/tests/db_writes_test.rs` 47 个 test（含 happy / error path / FK violation / CASCADE / 边界 truncation）。**测试统计**: 76 现有 + 47 新增 = 123 全过。**`PRAGMA foreign_keys = ON`** 是 fresh_pool 必须的 — SQLite 默认不开 FK，否则 `assign_session_to_project` 的 FK violation test + `delete_project SET NULL` cascade test 都会假阳。**单个 test fix**: `list_projects_orders_pinned_then_recency` 初版 seed timestamp 重复导致 SQLite ORDER BY 不确定，加 distinct timestamp 修。**Cargo clippy**: 0 new warning（pre-existing 2 个 doc_overindented 在 origin.rs + 1 个 too_many_arguments 在 db_test.rs::seed_message）。**TS typecheck + lint**: 0 error / 0 warning（frontend 完全不动）。**agent-api.md §8A** 新增 16 method 完整 schema 表 + input types doc。**M4b 启动门**: cargo test 全过 + 行为不变 = dogfood gate 颗粒度极简，JC 可推 fresh session 直接开 M4b。
- **N10 (2026-05-19, M4 sub-plan ship)** — Fresh-ish session 接 M3 完成的 cursor pickup。Audit 跑下来：useAppStore.ts 2362 行（M3 后），22 个 frontend call site touches session/project actions，跨 6 个文件（App / Sidebar / MainView / Onboarding / CreateProjectDialog / ipc-handlers / bridge / sessions.ts）。**scope re-assessment 修正 playbook**：playbook 说「18 个 trait method」实际是 16（12 session + 4 project）；setActiveSession / activateSession / setActiveProjectFilter 是 pure display state operation **不需要 trait method**。**JC explicit scope choice**：本 session 推「sub-plan + Rust trait method (M4a)」，**不**推 M4b。M4b 推 fresh session per N5 教训 + M4a 单 commit 1450 LOC 已是单 session 上限。sub-plan 落 R1-R8 risk register（重点 R2：persistSession 残留 caller silent failure 风险 / R7：frontend-assigned id 冲突处理）+ 7 verification gate。M4a 不接 frontend caller — 单 commit ship Rust trait + tests + Tauri command registration，**frontend 完全不动，行为 byte-identical** = M4a → M4b dogfood gate 颗粒度极简。
- **N9 (2026-05-19, M3 完成 ship + JC dev dogfood validated)** — M3 拆 M3a + M3b 两 commit 推完，JC dev dogfood 通过：M3a 4 个 B2 fix 回归用例 + LLM picker / 持久化 / pet attach 等不退化；M3b 含 spawn / shutdown / pkill -9 crash recovery / LRU evict / Cmd+Q exit。**M3a (`cc22aa4`)**: 新建 `gui/src/stores/runtime.ts` ~300 LOC + useAppStore.ts 净 delete ~290 LOC。LLM 字段全迁 (llms / llmDisplayName / pendingLLMIndex / petAttachedSessionId / runtimeInfo / _warmupComplete)，加新 cachedLLMs / cachedLLMDisplayName field（hydrate seed），ensureRuntime centralize d6a096f 的 pre-seed 逻辑。3 处 TRANSITIONAL (M4 sessions row write / M6 prefs gaConfig read / M6 prefs reset warmup)。**M3b (`22e6590`)**: bridgeStatus / bridgeError / bridgePid 加进 byId，spawnBridge 140 行整段迁；cross-store onClose 关键 (bridge fields → runtimeStore.setState，conversation cleanup → useAppStore.setState with inline `TRANSITIONAL (M5)`)。AD-07 9 个 module-level symbol 从 useAppStore 清 100% 干净 (_bridgeClients / _stderrTails / _lruOrder / getBridgeClient / _lruTouch / _lruRemove / _STDERR_TAIL_MAX / LRU_CAP / _enforceLRUCap)，全部作为 runtime.ts private 重生。`lib/sessions.ts::deriveSessionStatus` 加 `bridgeStatus?` 参数。**总计**：useAppStore.ts 从 ~2700 → ~1700 (-1000 LOC)，runtime.ts ~570 行。Rust 76/76 + TS typecheck + lint 0 warning。**M3 实施过程暴露的 sub-plan 失误**：T3.5「thin wrapper」描述错（spawnBridge 140 行不是 thin），M3 sub-plan 内已修正 + M4 sub-plan 教训：「实施前重读所有要迁的代码，不能信 playbook 表面描述」。**M3 启动门 dogfood scenarios 35 项 formal ✓/✗ 未走**：JC dev dogfood 已 cover 主要风险面 (attach / send / multi-session / LLM picker / persistence / 4 B2 fix regression)，formal 列表是 next session 可选事项不阻塞 M4 启动。Next: M4 fresh session — **第一件事 sub-plan 时 read [mapping § B](./b3-slice-mapping.md#b-sessionsstore-分配) 列的 18 个 trait method** ([G5 警示](#running-notes--gotchas))，Rust trait 加 + 前端 sessionsStore 抽两个阶段，trait method 加法**独立 commit 不混 frontend**。

- **N8 (2026-05-19, M3 sub-plan + 4 B2 latent bug fix)** — JC dev mode dogfood 中陆续 surface 4 个 B2 latent bug，单 session 内独立 commit ship：(1) [`4e7a6e6`](https://github.com/wangjc683/galley/commit/4e7a6e6) CLI-origin user message GUI 不显（socket_listener 没 emit user-message-persisted → 加 Tauri event + GUI listener + 新 store action `appendUserTurnExternal` 镜像 appendUserTurn 减 persistUserMessage 调用）；(2) [`9c36f42`](https://github.com/wangjc683/galley/commit/9c36f42) LLM 选择不持久化（schema 早有 `sessions.llm_index` 列 但 persistSession 硬编码 `null, null` TODO `wired in #10` 未接 → Rust SessionBrief + GUI Session type + persistSession + replaceLLMs + activateSession 全链路接通）；(3) [`d6a096f`](https://github.com/wangjc683/galley/commit/d6a096f) LLM picker flash root cause = setActiveSession 创建 emptyRuntime 时 _runtimes[id].llms 仍是 DEMO_LLMS，下一个 applyRuntimeUpdate 又 project 回 DEMO → pre-seed 新 runtime 的 llms 字段从 hydrate cache + persisted session 字段；(4) [`317e816`](https://github.com/wangjc683/galley/commit/317e816) Picker click 在 spawning 期间被 silently drop（gate 太严 `bridgeStatus === "connected"` 不允许 spawning 期 send_llm → 放宽 connected || spawning）。然后写 M3 detailed sub-plan ([`B3-M3-sub-plan.md`](./B3-M3-sub-plan.md))：scope re-assess 推翻 playbook T3.5「thin wrapper」描述；决定 M3a/M3b 拆分（M3a LLM concerns ~300 行 / M3b bridge lifecycle ~500 行）；cross-store onClose 协调策略明确（transitional cross-store call + M5 后 Rust event 驱动 + inline `TRANSITIONAL:` 注释）；6 项 risk register + 7 项 verification gate（含验证今天 4 B2 fix 不退化）。**M3a 启动门**：跟 M3 启动门一致（dogfood scenarios JC 签字 + perf baseline ✅ 已满足两条之一），剩 35 项 scenario formal ✓/✗ 列表 0/35 — 但今天 JC dev dogfood 已经覆盖 attach / send / multi-session / LLM picker / persistence 主要风险面，**JC 决定可推进 M3a 实施而不阻塞**

- **N7 (2026-05-19, P1+P2 live measurement)** — JC 起 dev mode + 真 LLM，AI 用 `scripts/perf-galley.py` 跑 P1+P2 against fresh chat `s-mpc6h020-iy71`。**关键发现**：(a) 跑 P1 第一次脚本卡 4 分钟 — 不是 LLM 慢，是脚本 bug：`readline()` 在 inner "wait 1.5s for trailing turn_progress" loop 里 block 死，超时检查在 outer 进不去。修法：`select.select()` non-blocking read。(b) **GA bridge wire format**：`{"stream":"event","data":{"kind":"turn_progress","delta":"..."}}`，parser 要查 `data.kind` 不是 top-level；(c) **GA emits real content `turn_progress` BEFORE `turn_start`** for long prompts — turn_start 是 metadata-commit 事件，长 prompt 时 fire at END。**结果**: P1 marker 必须用 `first_real_delta`，不是 `turn_start`，否则长 prompt 会被 over-report 至 15s; (d) **GA bridge chunks LLM streaming** — 长 prompt 500 字只产 14 个 `turn_progress`（~700ms 每 chunk），不是 token-by-token。1.42 ev/s 对 React-side 是低压力（B3 batch 16ms 窗口可能根本不需要）。**结果数**: P1=3150ms short / 5363ms long, P2=1.42 ev/s。**Single-sample，不统计**（per M3 启动门规则）。**B2 latent bug 候选**：JC 报「LLM 回复了"二"但看不到提问」— CLI-origin user message (origin.via=supervisor) 在 GUI 渲染缺失。Pre-M3 implement 前需 audit `gui/src/lib/ipc-handlers.ts` 看是否 listen `runner-event` 时 dispatch user-message-persisted

- **N6 (2026-05-19, perf baseline 框架 ship)** — M3 启动门两条 blocker 在新 session pickup 时仍 0 进度（dogfood scenarios 35 项全空 + perf-baseline.md 不存在）。JC explicit 选「帮你建 perf baseline 框架」分摊 prep work。**已做**：(a) [`perf-baseline.md`](./perf-baseline.md) 落 5 个 metric (P1 first-token RTT / P2 streaming throughput / P3 CLI read RTT / P4 bridge spawn / P5 RSS plateau) 完整 spec 含 gate 规则 + 测量 SOP + 阶段对比表；(b) **P3 已 measured** (debug binary, 4 commands × 20 samples): version mean 13ms / status mean 14.2ms / sessions list mean 14.9ms / health mean 14.9ms — 都是 process startup + sqlx + serde 开销，B3 不动 Rust 端时跨阶段应保持不变 ±5%；(c) **P4 cited prototype baseline** (430.86ms cold / 340.98ms 3-concurrent) — RunnerManager 是 BridgeProcess productionized，subprocess 路径 B2 未改 → prototype baseline = B2 baseline 在 [B3-I4](#phase-invariants--b3-特有的硬规则) 守护下也 = B3 baseline。**待 JC**: P1 + P2 各跑一次 SOP 把数填进 perf-baseline.md（M3 严格启动门）；scenarios 35 项跑一遍。**不打算 fake**: P1/P2 涉及真 LLM API 调用 + 网络抖动，自动测量没有意义。这是 paperwork-then-block paradigm — 框架就位但 gate 仍要 JC 手动过

- **N5 (2026-05-19, M3 deferred to fresh session)** — M2 ship 后 JC dogfood 撞到 Desktop Pet 失败 → 根因 B2 IPC schema drift（Rust AttachPetCommand 推测加 `variant` field，Python 不接受）独立 commit [`5facf1e`](https://github.com/wangjc683/galley/commit/5facf1e) 修复 + 加 regression test。**关键 audit 结果**：B2 manual IPC sync 只有 AttachPet 一个 command drift；其它 commands `rename_all = "camelCase"` 跟 Python 干净对齐。**M2 启动门 override 的真实代价**：本次 override 没有引入 M2 regression，但 B2 latent bug（dogfood-pre-merge 本应 catch）被 M2 ship 后才发现 = override 推迟了 bug 暴露 1-2 commits 而非引入 bug，因此可接受但不应常态化。**M3 scope assessment**：开始写 runtime.ts 时发现 M3 真规模（拆 SessionRuntime 14 字段 → runtime 5 / messages 9、拆 applyRuntimeUpdate、9 actions 迁移含 spawnBridge 的 onClose cross-store 写入、9 module-level symbol 删除 / 移位、dispatchIPCEvent 签名调整、cross-store 动态 import 解 cycle）= 多文件 800+ 行单 commit。本 session 已 10h+，疲劳期推 M3 单 commit 质量风险显著 → JC 决定本 session 结束 fresh session 重开 M3。**下次 session pickup**：(1) 读 [b3-slice-mapping.md](./b3-slice-mapping.md) § D 看 runtimeStore 全字段清单 + [ADR AD-05/AD-07/AD-08](./b3-slice-adr.md) (2) 决定 M3 单 commit vs M3a/M3b 拆 commit (3) 实施前先列详细 sub-plan 含 cross-store write 处理策略 (4) M3 启动门 enforce: dogfood scenarios + perf baseline (gate 仍有效，本 session 不破)

---

## Open decisions

- [x] **O1** Store 库选型 — **RESOLVED 2026-05-19 → 沿用 Zustand**（M1 T1.5 详）。Strict mode 兼容靠 store-side enrichment（B3-I2），不换库
- [x] **O2** Event batch window 时长 — **RESOLVED 2026-05-19 → 16ms (单帧)** for streaming `turn_progress`. 其它 emit 不 batch
- [x] **O3** React 端 selector 设计 — **RESOLVED 2026-05-19 → store-side enrichment + 路径长度 ≤ 2 layers**
- [ ] **O4** 老 store 最终清理时机 — **暂定 B3 内一次性删** (B3-I6)。但 M6 实施时可能发现一些 cross-slice transition action 需要 useAppStore 作 fallback shim。**M6 T6.6 实施时重新评估**
- [ ] **O5** **NEW** `activeProjectFilter` 归属：sessionsStore 还是 uiStore？M1 T1.3 定 sessionsStore，但 dogfood 时如果发现 filter 切换触发 sessions list re-fetch 过度，考虑改 uiStore (filter 是 UI view 不是数据)
- [ ] **O6** **NEW** demo seedMockSessions / DEMO\_\* fixture 去向：B3 内是否一并 retire? demo 模式现在很少用 — JC 默认起真 GA。**暂定**保留：dev / contrib 起步可能要

---

## Migration pattern · 给 B4 用的迁移模板（slice 视角）

[B1 read-path migration pattern](./B1-rust-core.md#migration-pattern--给-b2b3-用的迁移模板) + [B2 write-path 增量](./B2-bridge-ownership.md#migration-pattern--给-b3-用的迁移模板write-path-增量) 是按"capability"维度的迁移模板。B3 落地后 slice-store pattern 是 B4 的稳定基础：

```
Slice-store 迁移步骤（每个新 capability）：

1. Rust 端 trait method + emit event (在已有 emit 队列加新 event kind)
2. TS slice 内 store-side action 调 invoke
3. TS slice 内 listen(event) 注册 → 收到 emit 后 update slice cache
4. 组件 useSlice(s => s.fieldOrDerivedCachedField) 订阅
5. 旧路径删除（B3-I3 不留双轨）
```

4 条 retrospective（B3 实施前先列预想，实施后修正）：

- **TS 端 0 mutation action for authoritative fields**：除 emit listener 内的 reducer 不在任何地方 setState authoritative 字段。Test: grep `set state` in slice file，应该只在 listener 回调内出现
- **Selector 路径 ≤ 2 layers**：`useSlice(s => s.x.y)` 最多。再深就把 derive 移 store-side
- **每 slice file ≤ 600 行**：超就分子文件（B3-I5 / G11）
- **Slice 之间 0 cross-import action call**：跨 slice 操作通过 Rust 端协调，TS 端不互相调

---

## End of B3
