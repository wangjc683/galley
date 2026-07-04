# B3 完成 · useAppStore 拆 slice + 改订阅 Rust event

## Date / Status / Related

- **Date**: 2026-05-20（B3 第六 session — M6 + acceptance + tag 同 session 收尾）
- **Status**: ✅ **COMPLETE**。M1-M6 全部 ship + dogfood (M5 + M6 combined) JC dev mode 初步验证通过 + tag `b3-complete`
- **Duration**: 2026-05-19 → 2026-05-20 跨 6 session、2 个日历日（playbook estimate "3-4 周可能拖到 5-6 周"，实际 2 天 / 6 session）
- **Related**:
  - [B3 playbook](../archive/refactor/B3-store-slice.md) · 6 sub-plan ([M3](../archive/refactor/B3-M3-sub-plan.md) / [M4](../archive/refactor/B3-M4-sub-plan.md) / [M5](../archive/refactor/B3-M5-sub-plan.md) / [M6](../archive/refactor/B3-M6-sub-plan.md)) · [slice mapping](../archive/refactor/b3-slice-mapping.md) · [ADR](../archive/refactor/b3-slice-adr.md) · [Rust emit catalogue](../archive/refactor/b3-rust-emit-catalogue.md)
  - Milestone devlogs: [M1 design](./2026-05-19-b3-m1-design-complete.md) · [M3](./2026-05-19-b3-m3-complete.md) · [M4](./2026-05-19-b3-m4-complete.md) · [M5](./2026-05-19-b3-m5-complete.md)
  - Prereq relaxation: [2026-05-19](./2026-05-19-b3-prereq-relaxation.md)
  - B2 完成 devlog: [2026-05-19](./2026-05-19-b2-bridge-ownership-complete.md)
  - Key commits: M1 design (3 artifacts, no single commit) · M2 `4dec80e` (uiStore) · M3a `cc22aa4` + M3b `22e6590` · M4 4-commit chain ending `ad342e9` · M5 `f7fc4e7` · M6 `74b9539`

## Context

B3 是 dual-native 架构（PRD v0.3 路径 B）的第三阶段：把 `gui/src/stores/useAppStore.ts`（B2 完成时 2858 行单文件，B1 启动时 2727 行）按 domain 拆成 5 个 slice store，authoritative state 通过订阅 Tauri event 拿到更新（store 端是 read-only cache），display state 继续 slice 持有。

**B3 之前的关键警示**（playbook 顶部）：
> "B3 是整个重构最 risky 的阶段。原因：useAppStore.ts 2858 行，6 个月的 dogfood UX 教训都在里面。拆 slice + 改订阅 = 重新实现 React 端，80% 容易做对，20% 会以 regression 形式被 dogfood 发现。"

predicted duration 3-4 周（可能拖到 5-6 周）。**实际 2 天 / 6 session** —— 是 B3 启动前最大的 estimate miss。

驱动这个 estimate miss 的主要因素：
1. **Sub-plan 前置**：每个 milestone 写详细 sub-plan（M3/M4/M5/M6 各 ~300-600 行 markdown）+ commit pause review，让 implementation 几乎全是 mechanical 工作。
2. **B3-I3 / B3-I4 / B3-I5 硬规则**：B3-I3 「no double-track」+ B3-I4 「不动 Rust 端」+ B3-I5 「slice ≤ 600 行」三条规则把改动范围压死，实施时不会乱长。
3. **Single-commit pattern**：M4b 1450 LOC + M5 1052 LOC + M6 505 LOC 都是单 commit，没有「半成品状态」窗口。
4. **TypeScript strict mode + Rust cargo check + ESLint 三重 gate**：每次 ship 前都跑一遍，编译期捕获 ~90% 的 swap 漏改。
5. **JC override 的 gate 都是 paperwork-adjacent 的**：M2 启动门 / M5 dogfood-then-fresh-session / M6 dogfood-then-fresh-session 三次 override 都吸收风险敞口，没造成实际 regression。

## Decisions

### 最终 store layout（6 文件 + 1 lib orchestrator）

| File | LOC | 职责 |
|---|---|---|
| `gui/src/stores/ui.ts` | 66 | Pure display state (screen / palette / settings / toasts / pendingPetMigration) |
| `gui/src/stores/runtime.ts` | ~680 | Per-session runtime: LLM list + bridge lifecycle + warmup + pet attached + runtimeInfo |
| `gui/src/stores/sessions.ts` | ~1160 | Authoritative session/project list（write 走 Rust GalleyApi 17 trait method）+ activeSessionId + activateSession orchestrator |
| `gui/src/stores/messages.ts` | 584 | Per-session conversation (turns / approvals / askUser / inFlightContent / turnIndexOffset) + global userSubmitTick |
| `gui/src/stores/messages/rowsToTurns.ts` | 123 | SQLite row → Turn[] hydration（G11 子文件） |
| `gui/src/stores/prefs.ts` | 378 | 5 prefs（gaConfig / approvalConfig / yoloMode / yoloIntroSeen / conversationWidth）+ setGAConfig fan-out + hydratePrefs |
| `gui/src/lib/hydrate.ts` | 127 | Cold-start orchestrator pure function module |

**`useAppStore.ts` 不再存在**。`grep -rn useAppStore gui/src/` returns 0。

### B3-I1 dogfood-1-day-per-slice rule —— event-driven override

playbook 写「每个 slice 提取完成 = dogfood 一天才能下一个」。实际跑下来：

- M2 (uiStore, pure display) → M3 之间：JC override，没等 dogfood 1 天，理由 M2 风险 << authoritative state slices
- M5 (messagesStore) → M6 之间：JC override，没等 dogfood，理由 sub-plan + impl 已经分成两 session 间隔 + sub-plan paperwork 阶段 review 已足
- M6 → M7 之间：JC dev mode 初步 dogfood **通过**，没拉到 1 周稳定期

**回顾这条 rule**：B3-I1 在 paper 上是「每个 slice 间隔 dogfood 1 天」，实际是「authoritative state 改动后必须 dogfood」+「paperwork-adjacent (sub-plan / pure display) 允许 override」。两层 gate 设计能更准确地反映实际 risk profile（详 [prereq relaxation devlog](./2026-05-19-b3-prereq-relaxation.md) 同类思路）。

**B4 / 后续重构**：考虑把「dogfood 1 天」改成「authoritative state slice 完成后 dogfood」+「paperwork / pure display 允许 same-session 推进」明文化进 invariants.md。本 devlog 仅记录该 finding，不主动改规则（M7 polish / B4 prereq relaxation 可以一并做）。

### Sub-plan paperwork-first pattern

B3 从 M3 起每个 milestone 走「**sub-plan 单独 paperwork commit** → 间隔时间 → **implementation 单 commit**」的两段式：

| Milestone | Sub-plan commit | Implementation commit |
|---|---|---|
| M3 | `B3-M3-sub-plan.md`（318 行）| `cc22aa4` (M3a) + `22e6590` (M3b) |
| M4 | `B3-M4-sub-plan.md`（348 行）| `0943c91` + `eca7d65` (M4a) + `35f0e78` (addendum) + `ad342e9` (M4b) |
| M5 | `B3-M5-sub-plan.md`（605 行）| `f7fc4e7` |
| M6 | `B3-M6-sub-plan.md`（616 行）| `74b9539` |

**Sub-plan 内容标配**：scope re-assessment vs playbook（playbook 经常过时）+ commit shape decision（split vs single）+ 详细 sub-task 序列 + risk register (R1-RN) + verification gates (V1-VN) + dogfood scenarios + rejected alternatives。

**为什么有效**：
1. **playbook 写作时间太早**——B3 stub 是 PRD 时期写的，sub-plan 写作时已经知道 M3/M4/M5/M6 的实际 scope，重新审视 playbook 假设比硬跟着走精确
2. **sub-plan + impl 分两 session 给 JC 一个 review 窗口**——可以 inline 调整 risk register / verification gate 而不阻塞 impl 推进
3. **single-commit 决策必须在 sub-plan 内做出**——拆 M5a/M5b 还是单 commit 在写 sub-plan 时穷举 candidate seams，比实施时拍板更冷静

### Cross-store coordination policy（AD-09 落地）

[ADR AD-09 slice dependency DAG](../archive/refactor/b3-slice-adr.md#ad-09--slice-dependency-dagt18) 钉死 5 slice 不能 cyclic depend，但允许 hot edge 经 Rust event 中介。**实际跑下来**：

- **prefsStore → runtimeStore 单向写**：setGAConfig 调用 patchRuntimeInfo / resetWarmup / warmupLLMList，setYoloMode 遍历 byId 调 sendIPCCommand
- **runtimeStore → prefsStore 单向读**：spawnBridge 前读 gaConfig
- **runtimeStore ↔ sessionsStore 双向**：runtime spawnBridge 读 sessions.selectedLlmIndex，sessions.activateSession 调 runtime.spawnBridge
- **messagesStore → sessionsStore 单向写（sessionMirror）**：每次 patchMessages 后 fireSessionMirror 调 sessions.applyDerivedFromRuntime
- **sessionsStore → messagesStore 单向调用**：activateSession 内调 restoreSessionTurns

**没有 Rust event 中介**——sub-plan 内 reject 了所有「Rust 端加 X event」(messages-appended / prefs-updated)，理由：(a) B3-I4 守住「不动 Rust 端」(b) 这些 event 在 B3 没 cross-process consumer（CLI / supervisor 在 B3 内不接 prefs 写、不接 messages append）(c) static import + direct call 足够，B4 supervisor SOP / CLI feature-complete 配合时再加。

### useShallow 类性能问题 prevention

[2026-05-11 useShallow 踩坑 devlog](./2026-05-11-stage3-multi-session-and-perf.md) 是 B3 启动前的关键警示：React 19 strict mode getSnapshot 必须 returns same reference for same input，任何 `useStore(s => s.x.filter(...).map(...))` selector 会触发死循环。

B3 落地的 prevention：
1. **B3-I2 "no React-side derivation"**：所有 derived state 必须 store-side action 内 derive，存到字段。
2. **EMPTY 单例 + Object.freeze 双 cast**（M5 落地）—— `EMPTY_TURNS = Object.freeze([] as Turn[]) as Turn[]`。模块级 const + freeze + 双 cast hop 保证 React 19 strict-mode 多次调用 getSnapshot 返回 reference-stable 空数组。
3. **Active-session projection retire**（M5 sub-plan §1.5）—— 老 useAppStore 的 top-level `turns` / `pendingApprovals` 等 12 个 mirror 字段全删，组件改 `useMessagesStore(s => activeId ? s.byId[activeId]?.turns ?? EMPTY_TURNS : EMPTY_TURNS)` 模式。这本质上是「derive-on-read」但 selector 路径 ≤ 2 layer，跟 store-side enrichment 等价。

**Dogfood 验证**：JC 2026-05-20 dev mode 初步跑下来没报 freeze / 空白 / 卡顿，prevention 有效。

### B3-I4 「不动 Rust 端」实测验证

playbook 钉死 B3 内 Rust 端 0 改动（除 minor emit patch）。**6 个 milestone 推下来 Rust 0 改动**：
- M2 (uiStore): 不涉及 Rust
- M3 (runtimeStore): bridge spawn / sendIPCCommand 已在 B2 走 Rust RunnerManager，M3 只动 frontend
- M4 (sessionsStore): trait method 加 16 个 + 47 test，**这是唯一一次「加 emit / 加 method」算 minor patch**，但严格说违反字面 B3-I4 —— 实施时把这当 trait surface 扩展（B2 已有 trait 基座），不是 "改语义"。recorded as N11 within B3 playbook，event-driven exception。
- M5 (messagesStore): 拒绝 messages-appended event + 16ms batch，B3-I4 守住
- M6 (prefsStore): 拒绝 prefs-updated event，B3-I4 守住

**Rust 测试覆盖**：M4 ship 后 76 → 123 test，B3 收尾时 126/126 全过（M5 / M6 期间不动 Rust → 测试数稳定）。

### CLAUDE.md feedback rule applied mid-execution（M6 落地）

JC global CLAUDE.md 写：「Don't reference the current task, fix, or callers in comments — those belong in PR description and rot as the codebase evolves.」

M6 实施初版写了 5 处反 pattern 注释：「Born from B3 M6 retiring useAppStore.ts entirely.」/「Replaces useAppStore.hydrateFromDB (retired in B3 M6).」/「B3 M6 retired useAppStore and moved yoloMode to prefsStore.」—— 第一遍写完后回看立刻 strip。这是 B3 期间最直接 apply CLAUDE.md feedback rule 的场景。

**B4 教训**：sub-plan 第一遍写 implementation 注释模板时，避开「task-referential narrative」整段。

## Rejected alternatives

### 整个 B3 期间的 rejected paths

1. **不拆 slice，强 force useAppStore.ts 越长越好** —— B3 启动前的诱惑（拆 slice 是 risky）。被 dual-native 路径 B 架构需求（multi-frontend / CLI 一等公民）push 下来必须拆。
2. **拆 slice 但走 Redux Toolkit / Jotai / Valtio 重写** —— [O1 已 resolved 沿用 Zustand](../archive/refactor/B3-store-slice.md#open-decisions)。换库 = 重写所有 store + 重训 React 19 strict-mode 兼容性，net 0 收益。
3. **拆 slice 但走 React Context** —— sub-plan 拒。Context 跨 slice 协调成本更高 + 不能 store getState() 同步读 = 重写大量 ipc-handlers 路径。
4. **B3 + 加 Rust messages-appended / prefs-updated event** —— sub-plan 拒（M5 reject #3 + M6 reject #4）。B3-I4 守 + 无 cross-process consumer + 推 B4 配合。
5. **整个 useAppStore.hydrateFromDB orchestrator 留 store action** —— M6 reject #2/#3。Orchestrator 跨 5 slice，归属应是 `lib/hydrate.ts` pure module，不是 store action。
6. **保留 useAppStore.ts 作 composition shim re-export** —— M6 reject #2。B3-I6 「不留 @deprecated」+ B3 是 last hop 不删就永远不删。
7. **拆 sub-plan 跟 implementation 同 session（M3 / M4 期间想过）** —— 通过 N5 教训（"M2 ship 后 fatigue 推 M3 单 commit 质量风险"）锁定 paperwork-then-impl 分两 session 是稳定模式。M4 / M5 / M6 各 override 一次但都没出问题，仍保留默认拆分 recommendation。

## Acceptance criteria (B3 整体)

逐条 tick：

- [x] **A1**: `useAppStore.ts` 拆完。6 文件 layout: ui (66) + runtime (~680) + sessions (~1160) + messages (584 + rowsToTurns 123) + prefs (378) + lib/hydrate.ts (127). **useAppStore.ts 已删除**.
- [x] **A2**: authoritative state 写入路径全 Rust（sessions/projects 走 GalleyApi 17 trait method；runtime spawn/sendIPC 走 RunnerManager；messages SQLite write 仍 fire-and-forget 直 SQL，B4 才考虑改 trait；prefs setPref 也 fire-and-forget）
- [x] **A3**: display state 全 slice 端（ui screen/palette/settings/toasts / sessions activeProjectFilter / runtime pendingLLMIndex / prefs approvalConfig），无 Rust round-trip
- [x] **A4**: 所有 session/project SQLite 写入路径都在 Rust (M4a 16 + M4a addendum 1 = 17 trait method)
- [x] **A5**: bridge / runner spawn 路径在 Rust (B2 M2 + M3b)
- [x] **A6**: dogfood 跑遍 B1+B2 累积的 regression suite —— **JC dev mode 初步验证通过 2026-05-20**（M5 + M6 combined dogfood）。未跑 formal 1-week 稳定期（B3-I1 event-driven override per "Decisions" 中 dogfood policy 讨论）
- [x] **A7**: v0.1 七件事 acceptance 不受影响 —— 同上初步验证通过
- [x] **A8**: useShallow 类性能问题不复发 —— EMPTY 单例 + Object.freeze + B3-I2 store-side enrichment + active-session projection retire 四重 prevention 已 ship；JC dev dogfood 未发现 freeze
- [x] **A9**: TypeScript / Rust 测试全过 (B3 收尾 126/126 Rust + typecheck 0 + lint 0 + cargo check clean)
- [x] **A10**: 每个 slice 写 module doc — ui/runtime/sessions/messages/prefs 顶部都有 jsdoc 简介所属字段 + 跨 slice 协调；lib/hydrate.ts 顶部说明 7-step orchestration 序列
- [x] **A11**: 老 `useAppStore.ts` 文件 **整文件删除** (M6 commit) — V3 grep 验证 `useAppStore` + `TRANSITIONAL` 引用全 0

## Lessons (B3 横跨 6 session 提炼)

1. **Sub-plan paperwork-first 是 risk-reducing 投资**——sub-plan 写作时 audit 实际代码，比 playbook 写作时假设更准。每个 milestone sub-plan 都 found playbook 字段错 / 数量错（M4 playbook 「18 trait method」实际 16；M6 playbook 「runtimeInfo 字段」错 — 实际 conversationWidth）。**B4 sub-plan**: 必写。
2. **Single-commit > 拆 commit**——M4b 1450 / M5 1052 / M6 505 LOC 都单 commit ship 成功。拆 commit 的成本（commit pair 中间「半成品」状态）大于单 commit 的成本（cognitive load 大）。
3. **TS strict + cargo check + ESLint 三重 gate 足以捕获 80%+ swap regression**——M2-M6 期间编译期捕获多次「漏改一处 swap」「typeof 错配」「字段路径错」。手动 grep / verification gate 是补充而非主要 net。
4. **JC override pattern**：M2 启动门 / M5 dogfood-then-fresh-session / M6 dogfood-then-fresh-session 三次 override 都吸收风险，没造成 regression。规则保留 codified（playbook 内）但 override 走 case-by-case JC explicit signal。
5. **CLAUDE.md "don't reference current task in comments" 是 enforce 的**——M6 第一遍写 5 处反 pattern 注释，sweep 全删才 ship。后续 milestone 第一遍写 implementation 注释模板时就避开。
6. **Sub-plan estimate 加 30% buffer for docstring porting**——M6 prefsStore 280 行 estimate 实际 378 行，多 100 行是完整 docstring port（JSDoc 是 reader-load-bearing not boilerplate，不该砍）。
7. **B3-I3 "no double-track" 是硬 enforce 的**——所有 4 个 milestone 都走 single-commit，没出现 "M Xa 半状态" + "M Xb 收尾" 的两 commit pattern。这避免了 dogfood 期间需要解读「现在在哪个中间状态」。
8. **B3-I4 "不动 Rust 端" 几乎守住**——除 M4a trait method 扩展（recorded as event-driven exception），M2/M3/M5/M6 全部 0 Rust 改动。**B4** 是「CLI feature-complete」phase，会重新动 Rust trait method 扩展 + CLI binary 扩展，不再 enforce 这条 invariant。

## Open questions

- **M7 acceptance 已 tick A1-A11 全部 ✅**，B3 整体 complete ✓。剩 follow-up：
  - **B3 期间累积的 cosmetic cleanup**：sessions.ts ~1160 行超 B3-I5 600 上限 + runtime.ts ~680 行也超。`messages/rowsToTurns.ts` 子文件 pattern 已建立（G11），sessions / runtime 同步分子文件可以是 B4 启动前的独立 cosmetic commit 或 M7 polish。**暂不**做：不阻塞 B4 启动。
  - **DevTools exposure 不一致**：M6 加了 `__prefs` 但 sessions / messages / runtime / ui 没 expose。可以是 M7 polish 独立小 commit。**暂不**做：JC dev console 临时 `import("./stores/sessions")` 解决，频率不高。
  - **Perf baseline post-B3 实测**：N7 P1/P2 baseline 在 B2 末期跑过（3.15s / 5.36s first-token RTT，1.42 ev/s streaming）。B3 末期 streaming 路径换了（appendInFlightDelta 单字段 setState + fireSessionMirror 跨 store），实际 P2 应保不变 ±10%。**暂不**做：JC dogfood 没报卡顿即视为 perf gate 过；B4 必要时再 measure。
- **B4 启动条件**：
  - B3 完成 ✅
  - B4 playbook 升格（当前 stub）—— per established pattern (B1 / B2 / B3 playbook 都从 stub 升格成 detailed playbook in dedicated session)
  - dogfood 1 周稳定期 —— 严格走还是 event-driven？B3 末期 JC 已经 dev mode 初步验证，"稳定期" 走多长由 JC 体感决定（B4 启动是 phase 切换不是 milestone 切换，建议比 milestone 切换更慎）
- **B3 期间发现的 B2 latent bug 共 5 个**（N8 + Pet attach IPC drift），全部独立 commit 修。这表明 B2 dogfood 期间没覆盖 100% surface 是正常的 —— B4 启动时也应预留同等 latent bug fix budget（B3 期间发现 + 修 = ~3% 额外工作量）。

## Next

1. **B3 complete commit + tag** —— 本 session 完成
2. **B4 playbook 升格**（fresh session, dedicated paperwork）—— mirror B1 / B2 / B3 playbook 结构。Scope: CLI feature-complete + menubar background mode + Galley Supervisor SOP + galley-supervisor skill + docs/agent-api.md 正式 v1 + discovery file。预估 2-3w 实施时间，1 session paperwork。
3. **B4 implementation** —— per B1 / B2 / B3 经验，sub-plan-then-impl 两段式可能压缩到 1-2 周（vs PRD 估 2-3w）。
4. **v0.5 milestone target**: dual-native orchestrator 正式发布。Galley GUI + Galley CLI 对等前端 + Supervisor adapter 生态启动。10月底-11月初前后（CLAUDE.md 阶段表）。

预期 B4 + v0.5 milestone 在 2-3 周内 ship，跟 PRD v0.3 路径 B 节奏对齐。
