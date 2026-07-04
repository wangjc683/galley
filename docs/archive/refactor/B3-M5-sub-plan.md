# B3 M5 · messagesStore 抽离实施 sub-plan

> 用途：B3 playbook M5 启动前的详细实施 plan，mirror [M3 sub-plan](./B3-M3-sub-plan.md) / [M4 sub-plan](./B3-M4-sub-plan.md) 结构。M5 是 **B3 最复杂的 slice**（playbook M5 标题原话）—— 流式 token + ask_user 阻塞 + approval 暂停 + auto-scroll snap 互动多，且承接 M3b / M4b 留下的两处 cross-store transitional stub。
>
> **状态**：drafting 2026-05-19。本 session ship sub-plan markdown，不动代码。M5 实施推 fresh session（per N5 教训 + N10 教训：sub-plan + 大 commit 分两 session 是稳定模式）。
>
> **关键决策**：**single commit M5**（不拆 M5a/M5b）。详 §2。

---

## 1. Scope re-assessment vs playbook

| Playbook claim | 实际验证 |
|---|---|
| T5.1 「per-session `Record<sessionId, ConversationState>`: `{turns, pendingApprovals, pendingAskUser, inFlightContent, currentTurnIndex, approvalDecisions, userSubmitTick}`」 | 漏了 **`agentRunning`**（[AD-05](./b3-slice-adr.md#ad-05--agentrunning-归-messagesstore不是-runtimestore) 钉死 messages）和 **`turnIndexOffset`**（[mapping § C](./b3-slice-mapping.md#c-messagesstore-分配) 列出）。`userSubmitTick` 是 **global** 不是 per-session（[mapping § C 注释](./b3-slice-mapping.md#c-messagesstore-分配) "全局 monotonic"），sub-plan 内独立处理 |
| T5.2 「Rust 端 emit `messages-appended` event」 | **B3-I4 警示**：B3 内**不动 Rust 端**（除 minor patch）。M5 真实路径 = 沿用现有 `runner-event` → ipc-handlers.ts → messagesStore action 链路，不引入新 Rust emit。`messages-appended` event 推 B4（CLI feature-complete 时配合 supervisor 推送）。本 sub-plan **不**走 T5.2 |
| T5.3 「批处理 streaming `turn_progress` 16ms batch」 | 同上 B3-I4。本 sub-plan **不动** Rust 端 batch。`appendInFlightDelta` 调用频率由 GA 端 chunking 决定（[N7 perf 实测](./B3-store-slice.md#running-notes--gotchas) 长 prompt **1.42 ev/s** — Zustand 单字段 setState 在该频率下不构成 re-render 压力，batch 收益不足以打破 B3-I4）。Open 留 R7 |
| T5.9 「Auto-scroll snap behavior 验证」 | **保守的最高风险点**（playbook G7）。MainView 跟 inFlightContent / turn_end / pendingApprovals / userSubmitTick / agentRunning 5 个字段都 effect dep — slice 拆分后 selector 路径变了，effect deps 容易漏 update。R3 重点 |
| T5.11 「dogfood scenarios」 | 实际范围比 playbook 列出的 6 个 cluster 大：还要 cover history restore + long-running multi-step + /btw 撞 main agent + approval 中途 abort + bridge crash 进 onClose stub |

**真实 scope 总览**：

### 1.1 字段 (9 per-session + 1 global)

| Field | Source line (useAppStore.ts) | Notes |
|---|---|---|
| `turns` | _runtimes[].turns (line 57) | Turn[] |
| `pendingApprovals` | _runtimes[].pendingApprovals (line 58) | |
| `agentRunning` | _runtimes[].agentRunning (line 59) | M3b onClose stub 写入 (line 549) |
| `currentTurnIndex` | _runtimes[].currentTurnIndex (line 60) | M3b onClose stub 写入 (line 550) |
| `inFlightContent` | _runtimes[].inFlightContent (line 61) | M3b onClose stub 写入 (line 551) |
| `approvalDecisions` | _runtimes[].approvalDecisions (line 62) | |
| `pendingAskUser` | _runtimes[].pendingAskUser (line 91) | applyRuntimeUpdate mirror `hasPendingAskUser` 到 sessionsStore |
| `turnIndexOffset` | _runtimes[].turnIndexOffset (line 117) | absolute → per-message 反推基准（SQLite PK 防碰） |
| `userSubmitTick` | line 383 | **global** monotonic counter，scroll trigger |

### 1.2 Actions (14 + 1 orchestrator)

| Action | Source line | Side effect (cross-store) |
|---|---|---|
| `appendUserTurn` | 968 | sessionsStore.maybeDeriveTitle + persistUserMessage SQLite + userSubmitTick++ |
| `appendUserTurnExternal` | 1029 | sessionsStore.maybeDeriveTitle + userSubmitTick++ (no SQLite — Rust 已写) |
| `appendSideQuestionUserTurn` | 1091 | userSubmitTick++ only (transient) |
| `appendAgentTurn` | 1052 | 无 — caller (ipc-handlers turn_end) 单独调 sessionsStore.bumpSessionAfterTurn |
| `appendSystemTurn` | 1073 | 无 (transient) |
| `addPendingApproval` | 1105 | applyRuntimeUpdate mirror `pendingApprovalCount` 到 sessionsStore |
| `removePendingApproval` | 1118 | 同上 |
| `recordApprovalDecision` | 1128 | persistToolEventApprovalDecision SQLite |
| `clearConversation` | 1151 | applyRuntimeUpdate mirror status 到 sessionsStore |
| `setAgentRunning` | 1164 | 同上 |
| `setCurrentTurnIndex` | 1172 | 同上 |
| `appendInFlightDelta` | 1180 | **HOT PATH** — 同上（mirror status 应该不变 since agentRunning 不变） |
| `clearInFlightContent` | 1188 | 同上 |
| `setPendingAskUser` | 1196 | applyRuntimeUpdate mirror `hasPendingAskUser` 到 sessionsStore |
| `restoreSessionTurns` | 808 | loadMessagesBySession SQLite + rowsToTurns |
| `activateSession` orchestrator | 708 | 留在 useAppStore (orchestrator — 调 sessions + runtime + messages 三方 — 见 §1.4) |

### 1.3 Helpers 迁移路径

| Helper | Source line | Target |
|---|---|---|
| `rowsToTurns` | 143 | messagesStore 内部 |
| `safeParseJsonArray` | 216 | messagesStore 内部（rowsToTurns 私有） |
| `previewFromContent` | 227 | messagesStore 内部（rowsToTurns 私有） |
| `emptyRuntime` (messages-side) | 237 | messagesStore 内部 `emptyMessages()` (rename 反映只剩 messages 字段) |
| `applyRuntimeUpdate` | 591 | **删除**。逻辑拆 messages-side internal patch + 显式调 sessionsStore.applyDerivedFromRuntime（[AD-09](./b3-slice-adr.md#ad-09--slice-dependency-dagt18) "slice 之间 0 cross-import action call" 守不了 transitional 期；但 M5 后 messagesStore → sessionsStore 单向写 mirror 是 [AD-09 允许的](./b3-slice-adr.md#ad-09--slice-dependency-dagt18) read-only cross-slice 之外的 mirror sink） |
| `projectionFrom` | 632 | **删除**。M5 后 top-level active-session projection 不再维护，所有 caller 改 `useMessagesStore(s => activeId ? s.byId[activeId]?.field : default)`（M3a 已立 precedent） |

### 1.4 `activateSession` orchestrator 处理

`useAppStore.activateSession` (line 708-806) 当前**跨 3 store**：
- sessionsStore.setActiveSession + sessionsStore.sessions read
- runtimeStore.ensureRuntime + runtimeStore.spawnBridge + pendingLLMIndex consume
- useAppStore._runtimes 读 + restoreSessionTurns (messages-side)

M5 后 messages 字段全去 messagesStore，但 `activateSession` 仍要协调三方。两种处理：

- **Option A**：`activateSession` 留 useAppStore（thin shim file），调三个 slice
- **Option B**：搬 sessionsStore.activateSession，sessions 已经是 active id 持有者，逻辑上 sessions 自己点亮 active 顺手补齐 messages + bridge

**推荐 Option B**。理由：
1. activate 主要工作是 "set active id + 顺手准备其它 slice"，归属应跟 active id owner（sessionsStore）一起
2. useAppStore 越接近空文件越好（M6 T6.6 目标删除），把 activateSession 留 useAppStore 等于给 M6 留尾巴
3. sessionsStore 已经动态 import useAppStore 解循环（M4b 落地 `clearSessionRuntime` 模式），加 activateSession 在 sessionsStore 是同 pattern 扩展

**实施细节**：M5 sub-task T5.10 把 activateSession 搬 sessionsStore，body 改调 messagesStore.restoreSessionTurns + messagesStore.ensureMessages + runtimeStore.ensureRuntime + runtimeStore.spawnBridge。useAppStore 删 activateSession action 字段。

### 1.5 Cross-store transitional inheritances

M5 必须**同步修**两处 M3b/M4b 留下的 `TRANSITIONAL (M5)` 注释 stub：

#### Inheritance #1 · M3b onClose stub
**位置**：`gui/src/stores/runtime.ts:536-555`
**当前**：
```ts
useAppStore.setState((state) => {
  const rt = state._runtimes[sessionId];
  if (!rt) return {};
  return {
    _runtimes: {
      ...state._runtimes,
      [sessionId]: {
        ...rt,
        agentRunning: false,
        currentTurnIndex: null,
        inFlightContent: "",
      },
    },
  };
});
```
**M5 后**：
```ts
useMessagesStore.getState().clearStreamingOnBridgeClose(sessionId);
```
messagesStore 新加 action `clearStreamingOnBridgeClose(sid)` — 一次 set 三个字段。

#### Inheritance #2 · M3b LRU eviction agentRunning 探测
**位置**：`gui/src/stores/runtime.ts:240-247`（`_enforceLRUCap`）
**当前**：
```ts
const appState = useAppStore.getState();
const victim = _lruOrder.find(
  (id) => id !== activeId && !appState._runtimes[id]?.agentRunning,
);
```
**M5 后**：
```ts
const messagesState = useMessagesStore.getState();
const victim = _lruOrder.find(
  (id) => id !== activeId && !messagesState.byId[id]?.agentRunning,
);
```

#### Inheritance #3 · M4b clearSessionRuntime 删 session 跨 store 清理
**位置**：`gui/src/stores/sessions.ts:178-190`
**当前**：动态 import useAppStore 删 `_runtimes[sid]`
**M5 后**：dynamic import useMessagesStore 调 `clearSessionMessages(sid)`。M5 加 action `clearSessionMessages(sid)` —— 简单 `delete byId[sid]`

#### Inheritance #4 · M4b `applyDerivedFromRuntime` 驱动方
**位置**：messagesStore 内 patch 每次都得调用 `useSessionsStore.getState().applyDerivedFromRuntime(sid, {...})` —— 在 M5 messagesStore 内 internal helper `patchMessages(sid, updater)` 实现，最后 fire applyDerivedFromRuntime
**当前**：useAppStore 的 applyRuntimeUpdate 写 messages + 调 sessionsStore.applyDerivedFromRuntime
**M5 后**：messagesStore 内 patchMessages 写自己 + 调 sessionsStore.applyDerivedFromRuntime

### 1.6 Call sites swap (23 处)

#### App.tsx (12 处)
| Line | Read | M5 后 |
|---|---|---|
| 101 | `useAppStore((s) => s.appendUserTurnExternal)` | `useMessagesStore((s) => s.appendUserTurnExternal)` |
| 121 | `useAppStore((s) => s.approvalDecisions)` | `useMessagesStore((s) => activeId ? s.byId[activeId]?.approvalDecisions ?? EMPTY_DECISIONS : EMPTY_DECISIONS)` |
| 122 | `useAppStore((s) => s.recordApprovalDecision)` | `useMessagesStore((s) => s.recordApprovalDecision)` |
| 161 | `useAppStore((s) => s.turns)` | `useMessagesStore((s) => activeId ? s.byId[activeId]?.turns ?? EMPTY_TURNS : EMPTY_TURNS)` |
| 162 | `useAppStore((s) => s.pendingApprovals)` | 同 pattern |
| 163 | `useAppStore((s) => s.agentRunning)` | 同 pattern (default false) |
| 164 | `useAppStore((s) => s.currentTurnIndex)` | 同 pattern (default null) |
| 165 | `useAppStore((s) => s.userSubmitTick)` | `useMessagesStore((s) => s.userSubmitTick)` (**global** — 不 per-session) |
| 166 | `useAppStore((s) => s.inFlightContent)` | 同 pattern (default "") |
| 167 | `useAppStore((s) => s.pendingAskUser)` | 同 pattern (default null) |
| 168 | `useAppStore((s) => s.appendUserTurn)` | `useMessagesStore((s) => s.appendUserTurn)` |
| 169 | `useAppStore((s) => s.appendSideQuestionUserTurn)` | 同 |
| 172 | `useAppStore((s) => s.removePendingApproval)` | 同 |

**EMPTY 常量必须 module-level singleton**（[B3-I2 / G3](./B3-store-slice.md#phase-invariants--b3-特有的硬规则)）。React strict-mode getSnapshot 必须返回稳定 reference：
```ts
// messagesStore.ts module level
const EMPTY_TURNS: Turn[] = [];
const EMPTY_APPROVALS: PendingApproval[] = [];
const EMPTY_DECISIONS: Record<string, ApprovalDecision> = {};
```

#### ipc-handlers.ts (11 处)
所有 `s.<action>(...)` 调用方改 `useMessagesStore.getState().<action>(...)`：

| Line | Action |
|---|---|
| 145, 230 | setAgentRunning |
| 146, 231, 244 | setCurrentTurnIndex |
| 147, 232, 247 | clearInFlightContent |
| 160 | `s._runtimes[event.sessionId]?.turnIndexOffset` (read) |
| 174 | appendAgentTurn |
| 198 | `s._runtimes[event.sessionId]?.turnIndexOffset` (read) |
| 207 | addPendingApproval |
| 255 | appendInFlightDelta |
| 271 | setPendingAskUser |
| 369 | appendSystemTurn |

**特殊处理 `_runtimes[id]?.turnIndexOffset` 读** (line 160 / 198) —— M5 后 `messagesStore.byId[id]?.turnIndexOffset`。

#### App.tsx 内部 user-message-persisted listener (line 280)
`appendUserTurnExternal(sessionId, message.content)` — 直接调 messagesStore.action，无 swap 改动。

#### MainView.tsx
**纯 prop drilling**（App.tsx 传值进去），不直接订阅 useAppStore。M5 后接收的 prop 来自 messagesStore 订阅 — 形参类型不变。

---

## 2. Decision · single commit M5 (不拆 M5a/M5b)

### 2.1 候选 split seams 评估

| Seam | M5a 内容 | M5b 内容 | 问题 |
|---|---|---|---|
| **B-1 结构 vs 热路径** | skeleton + 非 streaming actions | streaming + onClose stub fix | "非 streaming actions" 实际包含全部 14 actions（streaming 就 1 个 appendInFlightDelta），切分意义弱 |
| **B-2 读 vs 写** | rowsToTurns + restoreSessionTurns + active selector | 全部 write actions | ipc-handlers.ts 既有读又有写，单 commit 内不能拆开订阅 |
| **B-3 onClose 字段先迁** | agentRunning + currentTurnIndex + inFlightContent 三字段先到 messagesStore，其它字段留 useAppStore | 其余 5 字段 + actions 全迁 | **违反 B3-I3**："同 capability 不并存"——3 字段 in messagesStore + 5 字段 in useAppStore 是 split-capability 的反 pattern |
| **B-4 字段集 vs orchestrator** | 字段 + actions + helpers 单 commit | activateSession 搬 sessionsStore (Option B per §1.4) 独立 commit | activateSession 改不动 messages 字段就改不掉，分两 commit 第一 commit 行为不完整 |

### 2.2 推荐 · single commit M5

**理由**：
1. M4b 1450 LOC 单 commit 已验证可行（[N12](./B3-store-slice.md#running-notes--gotchas)）—— M5 估 ~600 行新文件 + ~600 行 useAppStore.ts 减小 + 23 swap site = 类似规模
2. messagesStore 是**最后一个 per-session authoritative state slice** —— 拆完后 useAppStore 接近空文件，应该一次到位
3. 拆 M5a/M5b 都创造 double-track 状态（违反 [B3-I3](./B3-store-slice.md#phase-invariants--b3-特有的硬规则)）
4. Cross-store stubs (3 处 M3b/M4b 残留) 必须**同 commit 一起 fix** —— 拆开会留个 commit 里 messagesStore 存在但 stubs 仍指向 useAppStore 的中间态

### 2.3 sequencing

```
M5 sub-plan ship (本 session,单 commit "Docs: B3 M5 sub-plan — messagesStore 抽离 single-commit 决策")
  ↓ JC review sub-plan
  ↓ M4b dogfood 1 天补足（per playbook M5 启动门）
M5 implementation (fresh session,单 commit "Refactor: B3 M5 — extract messagesStore + retire active-session projection")
  ↓ dogfood 1 天（V1-V7 verification + 7 cluster dogfood scenarios）
M6 starts (prefsStore + useAppStore 收尾)
```

---

## 3. M5 详细 sub-task

### T5.1 · 新建 `gui/src/stores/messages.ts` skeleton

预计文件 ~600 行（含 helpers + mock-free 实际是 ~550；rowsToTurns 是大块）。**G11 警示**：超 B3-I5 600 行硬上限时拆子文件路径：
- `messages.ts` (store + actions + active-session helpers)
- `messages/rowsToTurns.ts` (rowsToTurns + safeParseJsonArray + previewFromContent helpers)
- 单方向 import：`messages.ts` import helpers，反向不允许

State shape：
```ts
interface PerSessionMessages {
  turns: Turn[];
  pendingApprovals: PendingApproval[];
  agentRunning: boolean;
  currentTurnIndex: number | null;
  inFlightContent: string;
  approvalDecisions: Record<string, ApprovalDecision>;
  pendingAskUser: PendingAskUser | null;
  turnIndexOffset: number;
}

interface MessagesStore {
  byId: Record<string, PerSessionMessages>;
  userSubmitTick: number;  // global

  // Lifecycle
  ensureMessages: (sid: string) => void;
  clearSessionMessages: (sid: string) => void;
  clearStreamingOnBridgeClose: (sid: string) => void;

  // Read path
  restoreSessionTurns: (sid: string) => Promise<void>;

  // Conversation write path
  appendUserTurn: (sid: string, text: string) => void;
  appendUserTurnExternal: (sid: string, text: string) => void;
  appendSideQuestionUserTurn: (sid: string, text: string) => void;
  appendAgentTurn: (sid: string, turn: AgentTurn) => void;
  appendSystemTurn: (sid: string, turn: SystemTurn) => void;
  setAgentRunning: (sid: string, running: boolean) => void;
  setCurrentTurnIndex: (sid: string, idx: number | null) => void;
  appendInFlightDelta: (sid: string, delta: string) => void;
  clearInFlightContent: (sid: string) => void;
  setPendingAskUser: (sid: string, value: PendingAskUser | null) => void;
  clearConversation: (sid: string) => void;

  // Approval write path
  addPendingApproval: (sid: string, p: PendingApproval) => void;
  removePendingApproval: (sid: string, approvalId: string) => void;
  recordApprovalDecision: (sid: string, approvalId: string, decision: ApprovalDecision) => void;
}
```

Module-level EMPTY singletons:
```ts
const EMPTY_TURNS: Turn[] = [];
const EMPTY_APPROVALS: PendingApproval[] = [];
const EMPTY_DECISIONS: Record<string, ApprovalDecision> = {};
const EMPTY_MESSAGES: PerSessionMessages = Object.freeze({
  turns: EMPTY_TURNS,
  pendingApprovals: EMPTY_APPROVALS,
  agentRunning: false,
  currentTurnIndex: null,
  inFlightContent: "",
  approvalDecisions: EMPTY_DECISIONS,
  pendingAskUser: null,
  turnIndexOffset: 0,
});
```

### T5.2 · 迁 helpers

- `rowsToTurns` / `safeParseJsonArray` / `previewFromContent` 三 helper 整段搬到 messagesStore（或 helper subfolder per G11）
- 删 useAppStore.ts 对应函数
- `emptyRuntime` 拆：runtime-side 早在 M3a/M3b 删过，messages-side 整段 inline 进 messagesStore 的 `emptyMessages()` private helper

### T5.3 · 实现 `patchMessages` private helper

替代 useAppStore.applyRuntimeUpdate：

```ts
function patchMessages(
  state: MessagesStore,
  sid: string,
  updater: (m: PerSessionMessages) => PerSessionMessages,
): { byId: Record<string, PerSessionMessages>; sessionMirror?: { sid: string; status: SessionStatus; pendingApprovalCount: number; hasPendingAskUser: boolean } } {
  const old = state.byId[sid] ?? emptyMessages();
  const next = updater(old);
  const byId = { ...state.byId, [sid]: next };
  // sessionMirror 留 caller fire（不在 set 内调跨 store action，保 set 单调性）
  return { byId, sessionMirror: deriveSessionMirror(sid, next) };
}
```

Caller 在 set 后单独触发：
```ts
set((s) => {
  const { byId, sessionMirror } = patchMessages(s, sid, updater);
  return { byId };
});
fireSessionMirror(sessionMirror);
```

`fireSessionMirror` 内调 sessionsStore.applyDerivedFromRuntime —— 但因为 status 来自 deriveSessionStatus 需要 sessions[sid] 数据 + runtimeStore bridgeStatus，逻辑要复制 (or import) [lib/sessions.ts:deriveSessionStatus](../../../gui/src/lib/sessions.ts)。**复用 deriveSessionStatus**：lib/sessions.ts:40 注释 "useRuntimeStore.getState().byId[sid]?.bridgeStatus and pass in" —— 改 deriveSessionStatus 也接 messagesState 参数。

**关键 decision**: `deriveSessionStatus(session, rt, bridgeStatus)` 当前签名读 SessionRuntime → 改读 PerSessionMessages（agentRunning/pendingApprovals/turns 都在 PerSessionMessages）。这是 [lib/sessions.ts](../../../gui/src/lib/sessions.ts) 的 signature change，1 处用法 in useAppStore.applyRuntimeUpdate 已搬 + sessionsStore call site。M5 commit 内同步改。

### T5.4 · 迁 conversation actions

整段搬：appendUserTurn / appendUserTurnExternal / appendSideQuestionUserTurn / appendAgentTurn / appendSystemTurn / clearConversation / setAgentRunning / setCurrentTurnIndex / appendInFlightDelta / clearInFlightContent / setPendingAskUser

特殊：
- **`appendUserTurn` SQLite write** — `persistUserMessage` 保留 fire-and-forget，跟当前一样。**不** route through Rust core trait method（B3-I4 守 Rust 端不动；persistUserMessage 是 read-path-adjacent 直接 SQL，B2 时未走 trait — B4 可能改）
- **`appendUserTurn` cross-store call** — `useSessionsStore.getState().maybeDeriveTitle(...)` 保留（M4b 已 ship）
- **`userSubmitTick++`** — global field，set 时 `userSubmitTick: state.userSubmitTick + 1`

### T5.5 · 迁 approval actions

addPendingApproval / removePendingApproval / recordApprovalDecision

- `recordApprovalDecision` persistToolEventApprovalDecision SQLite call 保留 fire-and-forget

### T5.6 · 迁 restoreSessionTurns

`loadMessagesBySession` + `rowsToTurns` 整块搬。`ensureMessages(sid)` precedes — restoreSessionTurns 内先 ensureMessages 再写 turns。

### T5.7 · Fix M3b onClose stub (Inheritance #1)

`gui/src/stores/runtime.ts:536-555` 整块替换：

```ts
// Was: useAppStore.setState((state) => { ... })
useMessagesStore.getState().clearStreamingOnBridgeClose(sessionId);
```

`clearStreamingOnBridgeClose` 实现：
```ts
clearStreamingOnBridgeClose: (sid) => {
  set((s) => {
    const old = s.byId[sid];
    if (!old) return {};
    const { byId, sessionMirror } = patchMessages(s, sid, (m) => ({
      ...m,
      agentRunning: false,
      currentTurnIndex: null,
      inFlightContent: "",
    }));
    return { byId };
  });
  fireSessionMirror(...);
},
```

### T5.8 · Fix M3b LRU agentRunning probe (Inheritance #2)

`gui/src/stores/runtime.ts:240-247` 改 `messagesStore.getState().byId[id]?.agentRunning`。删 `useAppStore` import from runtime.ts —— 检查后没有其它 caller 后可整段去（如还有 e.g. `useAppStore.getState().gaConfig` 那等 M6 prefsStore 时再清）。

**Note**：runtime.ts 当前还在用 `useAppStore.getState().gaConfig` (line 696)，属于 prefsStore scope。M5 内**不动** runtime.ts 的 gaConfig 读 —— M6 prefsStore 时整块清。M5 只删 messages 相关的 useAppStore 引用。

### T5.9 · Fix M4b clearSessionRuntime stub (Inheritance #3)

`gui/src/stores/sessions.ts:178-190` 改：
```ts
async function clearSessionMessagesAndRuntime(sid: string): Promise<void> {
  const { useMessagesStore } = await import("@/stores/messages");
  useMessagesStore.getState().clearSessionMessages(sid);
  // 不需要再清 useAppStore._runtimes —— M5 后此字段已不存在
}
```

Caller (`deleteSession` / `deleteSessionsBulk` / `emptyArchive`) 跟着 rename → `clearSessionMessagesAndRuntime`。

### T5.10 · 搬 `activateSession` orchestrator to sessionsStore (Option B per §1.4)

`useAppStore.activateSession` 整段 (line 708-806) 搬到 sessionsStore.activateSession。body 内：
- `useSessionsStore.getState().setActiveSession(id)` → 改 `get().setActiveSession(id)`（same store）
- `_runtimes[id]` 读 + 写 → 改 `useMessagesStore.getState().byId[id]` 读 + `useMessagesStore.getState().ensureMessages(id)`
- `restoreSessionTurns` → `useMessagesStore.getState().restoreSessionTurns(id)`
- `runtimeStore.ensureRuntime` / `spawnBridge` / `pendingLLMIndex` → 不变

App.tsx 内 `const activateSession = useAppStore((s) => s.activateSession)` → `useSessionsStore((s) => s.activateSession)`。

### T5.11 · 删 useAppStore.ts 内 message-related state + actions + helpers

按 grep 清单删：
- State 字段：`_runtimes`, `turns`, `pendingApprovals`, `agentRunning`, `currentTurnIndex`, `inFlightContent`, `pendingAskUser`, `approvalDecisions`, `userSubmitTick`
- Actions：T5.4 / T5.5 迁的 14 个 + restoreSessionTurns + activateSession
- Helpers：rowsToTurns / safeParseJsonArray / previewFromContent / emptyRuntime / applyRuntimeUpdate / projectionFrom
- SessionRuntime interface 整体删除（所有字段已迁 runtimeStore + messagesStore）
- imports：persistUserMessage / persistToolEventApprovalDecision / loadMessagesBySession 删（messagesStore 持有）

预计 useAppStore.ts: 1431 → ~700 行（含 gaConfig + approvalConfig + yoloMode + yoloIntroSeen + conversationWidth + hydrateFromDB + setGAConfig + setApprovalRequiredTools + removeAlwaysAllow + setYoloMode + acknowledgeYoloIntro + setConversationWidth + seedMockSessions forward）。M6 prefsStore 接着清剩下 ~500 行。

### T5.12 · 全仓 swap 23 call sites (per §1.6)

`App.tsx` 12 处 + `ipc-handlers.ts` 11 处。

**App.tsx 单变量 → 单 selector pattern**：
```ts
const activeSessionId = useSessionsStore((s) => s.activeSessionId);
const storeTurns = useMessagesStore((s) =>
  activeSessionId ? (s.byId[activeSessionId]?.turns ?? EMPTY_TURNS) : EMPTY_TURNS,
);
```

`EMPTY_TURNS` 等常量 `export const` from messages.ts 给 App.tsx import。

### T5.13 · Migrations / lib/db.ts 清理

- `lib/db.ts` 内 `loadMessagesBySession` 保留（M5 内不删 —— B4 才可能改 trait method 路径）
- `persistUserMessage` / `persistToolEventApprovalDecision` 保留同上
- 不删 `lib/db.ts` 任何 export —— messagesStore import path 改成 `@/lib/db` 即可

### T5.14 · TypeScript / Rust / lint

- `cd gui && pnpm typecheck` — 0 error
- `cd gui && pnpm lint` — 0 warning
- `cd core && cargo check` — 不应受影响（不动 Rust）
- `cargo test` — 同上

### T5.15 · M5 commit

```
git commit -m "Refactor: B3 M5 — extract messagesStore + retire active-session projection"
```

Commit body 列：
- 5 cross-store stub 修复（M3b onClose / M3b LRU / M4b clearSessionRuntime / M4b applyDerivedFromRuntime driver / activateSession 搬 sessionsStore）
- 23 call site swap
- 14 action + 1 orchestrator + 6 helper relocate
- useAppStore.ts 1431 → ~700 行（M6 接着清剩下）
- 行为 byte-identical 预期

### T5.16 · Dogfood 1 day (V1-V7 + 7 cluster — 见 §5)

---

## 4. Risk register

| ID | Risk | Mitigation | Severity |
|---|---|---|---|
| **R1** | streaming `appendInFlightDelta` 改单字段 setState 触发 re-render 比 useAppStore.applyRuntimeUpdate 多 (后者一次 set 多字段 + 触发 mirror update 一次) | Zustand 单字段 set 默认 `Object.is` 不同字段比较 — 跟 useAppStore set 是同一机制；React batching 自动合并同一帧多 setState。**Mitigation**: 实施完跑 N7 P2 perf measurement 对比 baseline (1.42 ev/s 应保不变) | **Low** |
| **R2** | `applyDerivedFromRuntime` 触发频率变高（M5 后每次 messages 写都 fire 一次 mirror） | 当前 useAppStore.applyRuntimeUpdate 每次 set 都 fire 一次（line 612-622），M5 后**频率不变** — `fireSessionMirror` 调 `applyDerivedFromRuntime`，后者内部 early-return if no actual change (sessions.ts:938-944) | **Low** |
| **R3** | **MainView auto-scroll regression** (playbook G7) — pendingAskUser / pendingApprovals / userSubmitTick / inFlightContent / agentRunning 5 个字段都 effect dep，slice 拆分后 selector 路径变了，dep 数组可能漏 update 或 reference 不稳 | (a) **EMPTY 常量 module-level singleton** 保证 getSnapshot 返回稳定 ref (b) MainView.tsx prop drilling 不变，只 App.tsx 内 selector 变 (c) 单独跑 V5 scroll regression test | **High** |
| **R4** | `turnIndexOffset` 是 PK 防碰关键，迁移过程中读写错位会导致 user message 跟 assistant rows 错对 → SQLite ON CONFLICT 静默覆盖 → restore 时丢消息 | (a) `appendUserTurn` 内 `turnIndexOffset: currentTurnCount` 写入逻辑 byte-identical 保留 (b) ipc-handlers.ts:160 + 198 读 offset 改 messagesStore 同字段同语义 (c) V6 验证：开 dev 跑 2-3 个 user_message 各产 2-step turn_end，restore 后 PK 不冲突 | **High** |
| **R5** | `activateSession` 搬 sessionsStore (T5.10) 后 App.tsx import 从 useAppStore 改 useSessionsStore — 漏改 1 处 = activateSession 是 undefined function 静默 noop | TS strict mode 编译捕获（useAppStore 删 activateSession 字段 → typecheck error），实施时跑 `pnpm typecheck` 不让过 | **Low** |
| **R6** | 23 call site swap 漏一个 — useAppStore 已无该字段，runtime crash | TS strict mode 编译捕获，同 R5 | **Low** |
| **R7** | T5.3 16ms batching 没做的话，长 streaming session 内 React 端 re-render 多 | N7 实测显示 1.42 ev/s 实际频率 — Zustand 单字段 set + EMPTY_TURNS singleton 应足够。如 dogfood 发现卡顿 → **B4 / 单独 commit** 再加 batching，**不**借 M5 commit 加 | **Low** (推 B4) |
| **R8** | useAppStore.activateSession 包含的 4 个 ↓ 4 个 ↑ "5 step" 复杂 flow 搬 sessionsStore 时漏 step（特别是 `pendingLLMIndex` consumption + isFreshSession 计算） | sub-task T5.10 内逐行 review + diff vs commit `4b0d7c3`（activateSession 最后一次大改） | **Medium** |

---

## 5. Verification gates

### V1 · TypeScript / lint
- `cd gui && pnpm typecheck` — 0 error
- `cd gui && pnpm lint` — 0 warning

### V2 · Rust no regression
- `cd core && cargo check` + `cargo test` 全过（不应受影响，B3-I4 不动 Rust）

### V3 · grep no leakage
- `grep -rn "useAppStore" gui/src/` — 应只剩 useAppStore 自己 + 5-6 处保留字段 (gaConfig / approvalConfig / yoloMode / yoloIntroSeen / conversationWidth / hydrateFromDB) 的引用，M6 接着清
- `grep -rn "_runtimes" gui/src/` — 应**全部 0**（M5 后该字段不存在）
- `grep -rn "applyRuntimeUpdate" gui/src/` — 0
- `grep -rn "projectionFrom" gui/src/` — 0

### V4 · Cross-store stub 清完
- runtime.ts 内不再 import useAppStore（runtime.ts:22 删；只剩 gaConfig 读 line 696 留 M6 处理）
- sessions.ts:178-190 改成 messagesStore.clearSessionMessages
- 全仓 `grep -n "TRANSITIONAL (M5"` 应 0

### V5 · Auto-scroll regression (R3 重点)
开 dev mode 跑：
1. 发 message → streaming 流出 → 自动 scroll 到底 ✓
2. user scroll up 拉到中部 → streaming 不再 follow ✓
3. 新发 message → snap 回底 ✓
4. approval card 弹出 → 视觉无 jump ✓
5. ask_user bubble 弹出 → 视觉无 jump ✓
6. Mode 切 wide / compact → 不掉滚动位置 ✓

### V6 · turnIndexOffset PK correctness (R4 重点)
1. 起 fresh session，发 user_message "你好" → GA 跑 2-step turn → turn_end x2 → 应 persist 为 absolute turn_index 1, 2（user row=1, assistant rows=2,3 — depends on GA loop）
2. 同 session 再发 user_message "谢谢" → 应 persist 为 absolute turn_index 4, 5, 6（不复用 1, 2, 3）
3. 关 app → 重开 → activateSession → restoreSessionTurns → 应看到两个 user message + 各自 assistant turns，per-message step 显示 1/2 而不是 4/5

### V7 · Cross-store mirror correctness
跑：
1. Sidebar 显示 "工作中 · 第 N 步" — agentRunning + currentTurnIndex 都对（通过 status mirror）
2. 等 approval → Sidebar 黄点 (pendingApprovalCount > 0) ✓
3. ask_user → Sidebar 黄点（hasPendingAskUser）✓
4. 全 clear → Sidebar 状态回 idle ✓

---

## 6. Dogfood scenarios (M5 启动门 + ship 后 1 天)

按 playbook T5.11 扩展：

### Cluster 1 · Basic conversation flow
- [ ] 发 message → streaming 流出 → turn_end 完成 → final answer 渲染
- [ ] 长答（多 step turn_end）— sidebar "第 N 步" 累加 + summary 更新
- [ ] 多 user message 一对话 — 每条 user_msg 后 agent reply 完整

### Cluster 2 · Approval flow
- [ ] tool_call_pending 弹 ApprovalCard → approve → tool 跑通 + 记录 decision
- [ ] tool_call_pending → reject → run_complete (DENIED) → agent stops
- [ ] tool_call_pending → 长等 → user abort → 状态 clean

### Cluster 3 · Ask user flow
- [ ] GA call ask_user → AskUserBubble 弹 + Sidebar yellow ⏸
- [ ] candidate chip click → answer 走 user_message path
- [ ] free-text reply → 同上
- [ ] 用户跳转其它 session → 黄点保留；返回 → 黄点消失（applyDerivedFromRuntime mirror）

### Cluster 4 · /btw side question
- [ ] 主 agent 跑步时 /btw "随便问一句" → SystemMessageBubble 渲染
- [ ] 主 agent 状态不变（agentRunning / currentTurnIndex 不动）
- [ ] /btw 多发几次 → 没 interfere main loop

### Cluster 5 · Streaming + UI scroll (V5 重点)
- [ ] 长 prompt 长 reply — scroll follow + 中部停 + 新 message snap 回底
- [ ] ⌥↑ / ⌥↓ jump 跨 user-msg ✓
- [ ] dot rail ≥3 条 user msg 出现 ✓
- [ ] 长 user-msg 折叠 ✓
- [ ] hover ↻ resend prefill ✓

### Cluster 6 · Session restore (R4 重点)
- [ ] 跑 3 个独立 user_message (各 2 step) → 重启 → activateSession → 3 user + 6 assistant turns 全在
- [ ] 顺序正确 (user → assistant chain × 3)
- [ ] per-message step 显示正确 (1/2/1/2/1/2 而不是 1/2/3/4/5/6)
- [ ] toolCalls + toolResults JSON 反序列正常 → tool callout 渲染

### Cluster 7 · Bridge crash recovery (Inheritance #1 重点)
- [ ] 起 session → 发 message → `pkill -9 workbench_bridge` → onClose triggers → toast 显示 + agentRunning false + currentTurnIndex null + inFlightContent ""
- [ ] 切到该 session → bridgeStatus closed → 再发 message → spawnBridge respawn → history replay → 继续
- [ ] LRU evict 触发（开 6 个 session）→ idle 旧 session 被 closed → agentRunning 检查正确（不 evict 正在跑的）

---

## 7. Transitional comments policy

M5 内**禁止**留新 `TRANSITIONAL (M6+)` 注释。理由：
1. M5 后续只剩 M6 prefsStore 一个 milestone；prefsStore 完全独立 slice（gaConfig / approvalConfig / yoloMode 等），不跟 messagesStore 共字段
2. M5 实施过程中如果发现新 cross-store coupling → 退回 plan 改 sub-plan 而不是 silent 留 comment

允许保留的 TRANSITIONAL：
- runtime.ts:696 `useAppStore.getState().gaConfig` — `TRANSITIONAL (M6 prefsStore)` 保留
- useAppStore.setGAConfig 内 `useRuntimeStore.getState().resetWarmup()` — `TRANSITIONAL (M6 prefsStore)` 保留

---

## 8. Rejected alternatives

### Reject #1 · 拆 M5a (skeleton) + M5b (full migrate)
**理由**：M5a "skeleton only" 不动 useAppStore.\_runtimes，messagesStore 是 dead code 直到 M5b。等于 paperwork + 0 行为变化 = 浪费 commit slot。

### Reject #2 · 拆 M5a (3 字段 onClose 先迁) + M5b (剩余字段)
**理由**：违反 [B3-I3](./B3-store-slice.md#phase-invariants--b3-特有的硬规则) "同 capability 不并存"。"messages-side 字段" 是单 capability，拆成 3 字段在 messagesStore + 5 字段在 useAppStore = split-capability，dogfood 期间状态分裂难 debug。

### Reject #3 · M5 同时引入 Rust messages-appended event + 16ms batching
**理由**：违反 [B3-I4](./B3-store-slice.md#phase-invariants--b3-特有的硬规则) "B3 内不动 Rust 端 (除了加 emit 事件的 minor patch — 加 emit 不算改语义)"。messages-appended event + 16ms batching 是 Rust 端**语义**改动（spawn_emit_task 内累积 + flush 是新逻辑），不是 thin emit。推 B4 (CLI feature-complete 配合 supervisor push) 一起做。

### Reject #4 · activateSession 留 useAppStore (Option A per §1.4)
**理由**：activateSession 主要工作是 "set active id + 准备 messages / runtime"。useAppStore 在 M5 / M6 后接近空文件，留 activateSession 等于给 M6 收尾留尾巴。Option B 把 orchestrator 搬 sessionsStore（active id owner），符合 [AD-09 DAG](./b3-slice-adr.md#ad-09--slice-dependency-dagt18) "上层 slice 编排下层"。

### Reject #5 · 用 React Context 替代 useMessagesStore selector
**理由**：[O1 已 resolved](./B3-store-slice.md#open-decisions) 沿用 Zustand。Context 改造跨 slice 协调成本更高 + strict-mode 兼容性同样需要 store-side enrichment + 不能 store getState() 同步读 = 大 regression risk。

### Reject #6 · `userSubmitTick` 迁 uiStore (per [O8](./b3-slice-mapping.md#g-open-items推到后续-sub-task))
**理由**：mapping doc O8 提议过。Re-evaluate：当前只 `appendUserTurn` / `appendUserTurnExternal` / `appendSideQuestionUserTurn` 三 messages action 写 userSubmitTick。如迁 uiStore 这三 action 需 cross-store 调 uiStore.bumpSubmitTick — 加跨 store 写为不必要的 indirection。留 messagesStore 全局字段更紧凑。**Final**: 留 messagesStore.userSubmitTick (global，per `MessagesStore` interface 顶层不 byId)。

---

## End of M5 sub-plan
