# B3 slice 设计 · ADR

> **状态**：M1 deliverable（2026-05-19）· B3 ship 后归档（同 [b3-slice-mapping.md](./b3-slice-mapping.md)）
>
> **用途**：[b3-slice-mapping.md](./b3-slice-mapping.md) 是「哪个字段去哪个 slice」的字段-级 contract；本文档是「**为什么**这么分 + 边界判断 + slice 间依赖」的决策记录。M2-M6 实施前每个 sub-task 引用对应 AD。
>
> **覆盖**：T1.2（边界 ADR verbatim）/ T1.3（边界判断）/ T1.4（module-level Map 删除）/ T1.5-T1.7（已 RESOLVED 字段回顾）/ T1.8（依赖 DAG）。T1.9 emit event catalogue 拆到独立文件 [b3-rust-emit-catalogue.md](./b3-rust-emit-catalogue.md)。

---

## AD-01 · 5 slice 不是 4

**Decision**: prefs 单独成第 5 slice，不并入 ui（v3 stub 曾提 4 slice）。

**Why**: prefs 是独立 lifecycle —— onboarding 写一次、Settings 调整偶尔写、其它时刻几乎不动。它的 subscriber 也不一样：prefs change 几乎总是「设置 dialog 内反映」而不是 conversation / sidebar 主流。跟 ui state（频繁变化的 modal / toast / palette）混在一起，会让 prefs save 触发不相关的 ui rerender —— 这正是 [G3 store-side enrichment 警示](./B3-store-slice.md#running-notes--gotchas)反过来想避免的「不相关字段同 slice = re-render 浪费」。

**Impact**：M6 prefsStore 独立 milestone，hydrateFromDB 拆解后 prefs.fetch* 跟其它 slice 平级 init。

---

## AD-02 · `activeProjectFilter` 归 sessionsStore（不是 uiStore）

**Decision**: filter 字段挂在 sessionsStore，不是 uiStore。

**Why**: 表面看 filter 是「sidebar 渲染时怎么过滤」纯 view state，归 ui 似乎合理。但实操上 filter 跟 sessions list 是**强耦合的衍生**：filter 变 → sidebar visibleSessions selector 重算 → 衍生需要 sessions list 在同一 slice 才能跑 store-side enrichment。如果分两 slice，要么 ui 持有 filter + sessions slice 暴露 list selector → ui selector 路径长度 > 2 layers（违反 T1.7 决议），要么 ui 持有 filter + sessions 持有 visibleSessions selector + ui 反向订阅 → 跨 slice cyclic（违反 [G9](./B3-store-slice.md#running-notes--gotchas)）。

**Impact**：M4 sessionsStore 包 sessions list + projects + activeProjectFilter + visibleSessions 派生（store-side enrichment 物化）。

**Open**: [O5](./b3-slice-mapping.md#g-open-items推到后续-sub-task) — 如果 dogfood 时发现 filter 切换触发 sessions list 不必要的 re-fetch / re-emit，考虑反转。等 M4 完成 + 一轮 dogfood 后复核。

---

## AD-03 · `yoloIntroSeen` 归 prefsStore（不是 uiStore）

**Decision**: yoloIntroSeen 挂在 prefsStore。

**Why**: 表面是「modal 一次性 gate」似 ui 字段。但 yoloIntroSeen 持久化到 prefs（key `yolo_intro_seen`）跨 launch sticky —— 这是 prefs lifecycle 的核心标志（写一次后近永久不动）。挂 ui 等于让 ui slice 持有一个生命周期跟自己完全不同的字段，且 hydrate 时要从 prefs 取，相当于 prefs slice 给 ui slice 喂数据 —— 反 G10 「slice 间通过 Rust 端协调」原则。

**Impact**：M6 prefsStore 持有；YoloIntroDialog 组件订阅 `usePrefsStore(s => s.yoloIntroSeen)`。

---

## AD-04 · `conversationWidth` 归 prefsStore（不是 uiStore）

**Decision**: conversationWidth 挂在 prefsStore。

**Why**: 跟 AD-03 同样 lifecycle 判断 —— 持久化 prefs 字段（key `conversation_width`），跨 launch sticky，写场景三处（TopBar pill / palette / Settings）都通过同一个 setter。归 prefs 跟 yoloMode / approvalConfig 平级 = 「持久化 user 偏好」=  prefs 的核心 type。

**Impact**：M6 prefsStore 持有；TopBar / palette / Settings 三处订阅 `usePrefsStore(s => s.conversationWidth)`。

**Sub-note (mapping doc T2.3)**：M2 uiStore 实施 phase 不动 conversationWidth —— M6 prefs 抽出时一并迁；M2-M5 期间 conversationWidth 留在老 useAppStore，组件继续 useAppStore 订阅。

---

## AD-05 · `agentRunning` 归 messagesStore（不是 runtimeStore）

**Decision**: agentRunning 挂在 messagesStore，跟 conversation 状态一起。

**Why**: 字面是「bridge 在跑」似 runtime，但实际语义是「conversation 在 streaming/agent loop 中」—— agent_running 切换由 `turn_start` / `run_complete` 事件驱动，这两个事件属于 conversation 流。组件订阅 agentRunning 都是 conversation-area 组件（Composer 显示 Stop 按钮 / TurnTicker 显示 streaming 状态 / Sidebar 显示 "正在工作"）—— 没有任何 runtime-tab 组件用 agentRunning。

边界对比：`bridgeStatus`（connecting / ready / closed）才是真 runtime 字段 —— 它跟 RunnerProcess lifecycle 1:1 对应，归 runtimeStore。

**Impact**：M3 runtimeStore 不持有 agentRunning；M5 messagesStore 持有。

**Open**: [O7](./b3-slice-mapping.md#g-open-items推到后续-sub-task) — M3/M5 dogfood 时复核。如果发现 Sidebar 渲染 "正在工作" 状态时跨 slice 订阅（messages.agentRunning + sessions.title）造成 useShallow 反模式风险，倾向把 agentRunning 物化到 session 行（store-side enrichment 反推到 sessionsStore.session.isRunning）。

---

## AD-06 · `userSubmitTick` 归 messagesStore（不是 uiStore）

**Decision**: userSubmitTick monotonic 计数器挂在 messagesStore。

**Why**: 表面是「MainView scroll effect 触发器」似 ui，但唯一 writer 是 messagesStore.appendUserTurn，唯一 reader 是 MainView 的 scroll effect。挂 ui 等于 ui 暴露一个 setter 给 messages action 调用 —— 反 G10。挂 messages = writer/reader 同 slice，scroll effect 跨 slice 订阅一个简单 number（路径 ≤ 1 layer，符合 T1.7）。

**Impact**：M5 messagesStore 持有；MainView 改 `useMessagesStore(s => s.userSubmitTick)` 订阅。

**Open**: [O8](./b3-slice-mapping.md#g-open-items推到后续-sub-task) — 若 dogfood 时发现「不发 message 也需要 scroll 回顶」场景（不会有，但兜底），revisit。

---

## AD-07 · Module-level state 全删（T1.4 verbatim）

**Decision**: 以下 9 个 module-level symbol 在 B3 内**全删干净**，不留 @deprecated 注释（[B3-I6](./B3-store-slice.md#phase-invariants--b3-特有的硬规则)）：

| Symbol | 删除时机 | Replacement |
|---|---|---|
| `_bridgeClients` Map | M3 (runtimeStore) | Rust RunnerManager 是 ground truth |
| `getBridgeClient` export | M3 | 0 外部 callers（grep verified），干净删 |
| `_stderrTails` Map | M3 | `invoke runner_stderr_tail`（已存在 B2 命令） |
| `_STDERR_TAIL_MAX` const | M3 | Rust 端 `STDERR_BUFFER_LINES` 单一 source |
| `_lruOrder` 数组 | M3 | Rust RunnerManager LRU 单一 source |
| `_lruTouch` / `_lruRemove` | M3 | 同上 |
| `LRU_CAP` const | M3 | Rust 端 `LRU_CAP` 单一 source |
| `_warmupComplete` flag | M3 / M6（看 AD-08） | runtimeStore 私有字段 |

**Why**: B2 之后 Rust RunnerManager 持有真 lifecycle / stderr / LRU 状态。TS 端三个 Map 是 cache + cache 跟 ground truth 不同步是潜在 bug。第一性原理：cache 的 `getBridgeClient` 0 外部 callers 已经证明 cache 是 vestigial。

**Impact**：M3 T3.5 实施。删完跑 `grep -rn "_bridgeClients\|_lruOrder\|_stderrTails\|getBridgeClient\|_lruTouch\|_lruRemove" gui/src` 应该返回 0（除了 useAppStore.ts 自身被一并清掉）。

---

## AD-08 · `_warmupComplete` 归 runtimeStore（私有）

**Decision**: `_warmupComplete` flag（current line 621）迁到 runtimeStore 作为模块私有 state（非 exported）。不挂在 prefs（不持久化），不挂在 ui（跟 ui 无关），不删（warmup idempotence 仍要保护）。

**Why**: warmupLLMList 的 idempotence 是单 launch 内不重复跑，重启自然 reset。这是 runtime lifecycle 范畴。挂 runtimeStore 跟 warmupLLMList action 同 slice，符合 single-writer 原则。

**Impact**：M3 实施时 runtimeStore 内置 `_warmupComplete: boolean`（默认 false，warmup 成功后 true，setGAConfig listener 监听 prefs-updated 时 reset 回 false）。

---

## AD-09 · Slice dependency DAG（T1.8）

**Decision**: 5 slice 跨 slice 关系按以下 DAG，**禁止 cycle**：

```
                  ┌──────────┐
                  │   ui     │   (无 deps · M2 实施)
                  └──────────┘
                       
                  ┌──────────┐
                  │  prefs   │   (无 deps · M6 实施)
                  └──────────┘
                       │
                       │ Rust prefs-updated event
                       ▼
                  ┌──────────┐
                  │ runtime  │   (订阅 prefs-updated · spawn 时读 prefs.gaConfig)
                  └──────────┘
                       ▲
                       │ (read activeSessionId for active-session selector)
                       │
                  ┌──────────┐
                  │ sessions │   (无 cross-slice import · M4 实施)
                  └──────────┘
                       ▲
                       │ (read activeSessionId)
                       │
                  ┌──────────┐
                  │ messages │   (无 cross-slice import · M5 实施)
                  └──────────┘
```

**关键 invariants**：

1. **零 cross-slice action 调用**（G10）—— 跨 slice 协调走 Rust 端 emit event。例：messagesStore.appendUserTurn 想 bump session.lastActivityAt → 不是 `sessionsStore.bumpSession()`，而是 Rust 端持久化 message 时一并 emit `sessions-updated`，sessionsStore 自己的 listener 处理
2. **允许 cross-slice READ**：runtimeStore / messagesStore 可以 `useSessionsStore(s => s.activeSessionId)` 取 active id 作 selector key
3. **prefs → runtime 是唯一 hot edge**：gaConfig 变化触发 warmup reset，通过 Rust prefs-updated event 传递（不是直接函数调用）
4. **ui slice 0 deps**：M2 实施时不读其它 slice，纯本地 state

**M3 过渡期 caveat**（playbook T3.2 已注）：M3 runtimeStore 抽出时 sessionsStore 还没出（M4 才出），M3 期间 runtimeStore 临时订阅 `useAppStore(s => s.activeSessionId)`；M4 完成后切到 `useSessionsStore`。这条**短命**依赖是 transitional，M4 后消失。

---

## AD-10 · 已 RESOLVED 字段回顾（T1.5-T1.7）

3 个早期就 RESOLVED 的决策，本文档复述以便 B3 全程查阅一处：

### T1.5 · Store 库 = Zustand

不换 Redux Toolkit / Jotai。理由：(a) JC 熟悉 + dogfood 稳定 (b) 小 bundle (c) [2026-05-11 useShallow 踩坑 devlog](../../devlog/2026-05-11-stage3-multi-session-and-perf.md) 的根因是 React 19 strict mode getSnapshot 死循环，跟 Zustand 无关；换 Jotai/Redux 不解决，反而引入新学习成本。Strict mode 兼容通过 [AD-12 store-side enrichment](#ad-12--selector--2-layers--store-side-enrichment-t17) 解决。

### T1.6 · Event batch window = 16ms (单帧)

`turn_progress` streaming events 在 Rust 端 [`spawn_emit_task`](../../../core/src/runner_commands.rs) 内累积 16ms 后 batch emit。其它 event（turn_start / turn_end / approval / askUser）不 batch。**16ms 是 Rust 端 emit syscall 减半优化，不是 TS 端 React update 减半**——TS 端在一帧内多 event 触发的多次 setState 由 Zustand + React batching 处理（[G6](./B3-store-slice.md#running-notes--gotchas) 复述）。

实测路径（M5 T5.3）：先实测当前 streaming event/sec rate，再决定是否落地 16ms batch；若 50-100 tokens/sec 实测 batch 收益 < 5% throughput，可改 32ms 或者**完全跳过 batch**（少一层复杂度）。

### T1.7 · Selector ≤ 2 layers + store-side enrichment

每个组件 selector 路径长度 ≤ 2 layers：`useStore(s => s.activeSession)` 而非 `useStore(s => s.sessions.list[0].turns[3].x)`。Derived value 物化到 store-side cached field。

根因：[2026-05-11 useShallow 踩坑 devlog](../../devlog/2026-05-11-stage3-multi-session-and-perf.md) — React 19 strict mode 要求 getSnapshot 对同输入返回同 reference。任何 `useStore(s => s.x.filter(...).map(...))` 在 strict mode 下死循环 = app 空白，dogfood 不可恢复。

[AD-12 + AD-13 在 mapping doc § A-E 实施时已隐含遵守]

---

## AD-11 · 老 useAppStore 切换不留双轨（B3-I3）

**Decision**: 每个 capability 迁移结束时，老 useAppStore 的对应字段 + action **当 commit 删除**，不留 `@deprecated` 注释。

**Why**: B1/B2 留 @deprecated 是因为跨 phase 兼容窗口长（B2 用 B1 trait method 几个月）。B3 是 last hop，留就再也不删 + 让 grep 找老路径会假阳性 + onboarding 新 contributor 时分不清哪个是「现在的」。

**Impact**：M2 T2.5 / M3 T3.8 / M4 T4.8 / M5 T5.10 / M6 T6.6 - T6.7 每个 milestone 强制 `grep -rn "useAppStore" gui/src` 应**逐步减少**，M6 后 = 0。

---

## End of ADR
