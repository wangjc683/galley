# B3 slice mapping · `useAppStore.ts` 静态分析

> **状态**：T1.1 落地 artifact（2026-05-19）· **B3 ship 后归档**（[B3 playbook T1.1](./B3-store-slice.md#m1--slice-切分设计--静态映射-d31-d33)）
>
> **用途**：把 `gui/src/stores/useAppStore.ts` 全部 State 字段 + Action 列出，按 5 个 slice 预分。M2-M6 实施时每个 sub-task 引用本文档的「assignment」列。开放项推到 T1.3 / T1.5+。
>
> **来源**：B2 ship 时 `useAppStore.ts` = **2858 行**；`grep -nE "^  [a-z][A-Za-z]*[:?]"` 出 193 个 line（含 nested gaConfig 字段 + comment doc-tag），经 manual review 收敛到 **32 个 State 字段 + 57 个 Action = 89 distinct items**。Callers (`grep -rn useAppStore gui/src`) = **96 sites**，分布在 App.tsx / Onboarding / bridge.ts / sessions.ts / ipc-handlers.ts 等核心模块。
>
> **方法论**：grep 起索引，但**判断按 5 个 slice 边界推**——slice 的 ownership 是「authoritative 还是 display」+「谁该订阅 Rust event」的组合，纯字段名不告诉你这个。

---

## Slice boundary recap

来自 [B3 playbook T1.2](./B3-store-slice.md#m1--slice-切分设计--静态映射-d31-d33)：

| Slice | Ownership | 同步方向 |
|---|---|---|
| **uiStore** | display state（modal open / palette / toast / pet 隐式迁移 staging） | 纯本地，无 transport |
| **sessionsStore** | session list / projects（authoritative — DB owns） | Rust event → cache（B3 M4 起） |
| **messagesStore** | per-session conversation（turns / approvals / askUser / inFlight / 决策） | Rust event → cache（B3 M5 起） |
| **runtimeStore** | per-session bridge runtime + LLM | Rust event → cache（B3 M3 起） |
| **prefsStore** | gaConfig / approvalConfig / yoloMode + lifecycle 独立 prefs | invoke setPref → Rust emit |

---

## A. uiStore 分配

### State fields

| Field | Source line | Type | Notes |
|---|---|---|---|
| `screen` | 416 | `Screen` | onboarding / empty / main 路由 |
| `paletteOpen` | 417 | `boolean` | Command Palette |
| `settingsOpen` | 418 | `boolean` | Settings dialog |
| `toasts` | 563 | `AppError[]` | 全局错误队列；不持久化 |
| `pendingPetMigrationTo` | 538 | `string \| null` | Desktop Pet 隐式迁移 staging；纯 UI 协调，不持久化 |

### Actions

| Action | Source line | Notes |
|---|---|---|
| `setScreen` | 630 | |
| `setPaletteOpen` | 631 | |
| `togglePalette` | 632 | |
| `setSettingsOpen` | 633 | |
| `toggleSettings` | 634 | |
| `pushToast` | 856 | |
| `dismissToast` | 857 | |
| `setPendingPetMigration` | 935 | |

**Slice-internal helper**：无（uiStore 是 5 个里最简单的）。

---

## B. sessionsStore 分配

### State fields

| Field | Source line | Type | Notes |
|---|---|---|---|
| `sessions` | 421 | `Session[]` | **authoritative**，B3 M4 改订阅 `sessions-updated` |
| `activeSessionId` | 422 | `string \| undefined` | 单一 active session；display state（filter 不变 transport 也不变） |
| `projects` | 431 | `Project[]` | authoritative，同 sessions |
| `activeProjectFilter` | 438 | `string \| undefined` | filter mode（O5 暂定 sessions，dogfood 复核） |

### Actions

| Action | Source line | Notes |
|---|---|---|
| `setActiveSession` | 637 | |
| `createSession` | 650 | trait method 需新加（G5 警示） |
| `activateSession` | 658 | 跨 slice：spawn bridge（runtime）+ restore turns（messages） |
| `bumpSessionAfterTurn` | 680 | turn_end 之后的 session row patch — trait method 加 |
| `archiveSession` | 698 | trait method 加 |
| `unarchiveSession` | 700 | trait method 加 |
| `renameSession` | 713 | trait method 加 |
| `togglePinSession` | 722 | trait method 加 |
| `deleteSessionPermanently` | 734 | trait method 加 |
| `archiveSessionsBulk` | 745 | trait method 加 |
| `unarchiveSessionsBulk` | 746 | trait method 加 |
| `deleteSessionsPermanentlyBulk` | 747 | trait method 加 |
| `createProject` | 756 | trait method 加 |
| `updateProject` | 760 | trait method 加 |
| `deleteProject` | 765 | trait method 加 |
| `assignSessionToProject` | 770 | trait method 加 |
| `setActiveProjectFilter` | 775 | 纯本地 set（filter 是 display） |
| `emptyArchive` | 782 | trait method 加（destructive bulk） |

**Slice-internal helper**：
- `deriveTitleFromText` (268), `truncateSummary` (274), `DEFAULT_NEW_SESSION_TITLE` (284) — 标题派生，留 sessionsStore
- `MOCK_TITLES_*` / `MOCK_SUMMARIES` / `MOCK_STATUSES` / `buildMockSessions` (1095-1216) — dev fixture，**T6.5 决定保留**给 contrib 起步

**Open**：`activateSession` 跨 sessionsStore + runtimeStore + messagesStore（spawn + restore + set active）。M4 实施时 activateSession action 留在 sessionsStore，但内部 invoke runtimeStore.spawnBridge + messagesStore.restoreSessionTurns（slice 间通过 store getter 不互调 action — 跨 slice 协调走 Rust 端，G10）。

---

## C. messagesStore 分配

### State fields（per-session `Record<sessionId, ConversationState>` 内）

| Field | Source line | Type | Notes |
|---|---|---|---|
| `_runtimes[].turns` | 197 | `Turn[]` | per-session conversation |
| `_runtimes[].pendingApprovals` | 198 | `PendingApproval[]` | |
| `_runtimes[].agentRunning` | 199 | `boolean` | **跨 slice 提示**：是 messages（conversation 是否流式中）还是 runtime（bridge 跑没跑）？语义上是 messages 的 — agent loop 是 conversation 的一部分。**暂分 messages**，runtimeStore 不重复持有 |
| `_runtimes[].currentTurnIndex` | 200 | `number \| null` | UI per-message step（rowsToTurns 反推 base） |
| `_runtimes[].inFlightContent` | 201 | `string` | streaming 累加文本（G6 batch reconcile） |
| `_runtimes[].approvalDecisions` | 202 | `Record<string, ApprovalDecision>` | |
| `_runtimes[].pendingAskUser` | 228 | `PendingAskUser \| null` | |
| `_runtimes[].turnIndexOffset` | 254 | `number` | per-message turn base（GA agent_runner_loop 每次从 1 重置的反推；详 SessionRuntime jsdoc） |
| `userSubmitTick` | 603 | `number` | 全局 monotonic（不是 per-session）；MainView scroll trigger；留 messages |

### Actions

| Action | Source line | Notes |
|---|---|---|
| `appendUserTurn` | 878 | |
| `appendSideQuestionUserTurn` | 890 | /btw transient，不写 DB |
| `appendAgentTurn` | 891 | |
| `appendSystemTurn` | 902 | /btw response，不写 DB |
| `addPendingApproval` | 903 | |
| `removePendingApproval` | 904 | |
| `recordApprovalDecision` | 905 | |
| `clearConversation` | 910 | |
| `setAgentRunning` | 911 | |
| `setCurrentTurnIndex` | 912 | |
| `appendInFlightDelta` | 913 | **关键**：streaming hot path，T1.6 决定 16ms batch（[playbook G2](./B3-store-slice.md#running-notes--gotchas)） |
| `clearInFlightContent` | 914 | |
| `setPendingAskUser` | 921 | |
| `restoreSessionTurns` | 796 | DB → store 单向 hydrate（read-only path） |

**Slice-internal helper**：
- `rowsToTurns` (302) — DB rows → Turn[] 反推（含 turnIndexOffset 双层语义反推），messages 私有
- `safeParseJsonArray` (375), `previewFromContent` (386) — rowsToTurns 副属

**Open (G11)**：messages 最容易超 600 行（B3-I5）。预备拆 `messages/turns.ts` + `messages/approval.ts` + `messages/streaming.ts` 三文件同 slice。

---

## D. runtimeStore 分配

### State fields（per-session `Record<sessionId, RuntimeState>` 内）

| Field | Source line | Type | Notes |
|---|---|---|---|
| `_runtimes[].llms` | 218 | `LLMOption[]` | per-bridge LLM list（N-active） |
| `_runtimes[].llmDisplayName` | 219 | `string` | per-bridge selected LLM |
| `_runtimes[].bridgeStatus` | 203 | `BridgeStatus` | |
| `_runtimes[].bridgeError` | 204 | `string \| null` | |
| `_runtimes[].bridgePid` | 205 | `number \| null` | Rust 是 ground truth；TS 这里只是 cache |
| `pendingLLMIndex` | 460 | `number \| undefined` | 全局 one-shot，EmptyState pre-bridge LLM 选择 |
| `petAttachedSessionId` | 529 | `string \| null` | 全局（pet 单实例）；不持久化 |
| `runtimeInfo` | 461 | `RuntimeInfo` | health check 数据 |

### Actions

| Action | Source line | Notes |
|---|---|---|
| `setBridgeStatus` | 938 | |
| `spawnBridge` | 945 | B2 M2 已经是 thin wrapper invoke Rust；B3 只搬位置 |
| `shutdownBridge` | 946 | 同上 |
| `shutdownAllBridges` | 948 | 同上 |
| `sendIPCCommand` | 949 | 同上 |
| `replaceLLMs` | 866 | |
| `selectLLMForNewSession` | 875 | |
| `warmupLLMList` | 853 | 启动后 one-shot bridge 拿 LLM 列表 |
| `setPetAttachedSession` | 929 | |

**Slice-internal helper**：无（emptyRuntime 跨 slice — 见 §F）。

---

## E. prefsStore 分配

### State fields

| Field | Source line | Type | Notes |
|---|---|---|---|
| `gaConfig` | 473 | `{python, gaPath, bridgeCwd, useExternalPython}` | prefs key `ga_config` |
| `approvalConfig` | 489 | `ApprovalConfig` | prefs key `approval_config` |
| `yoloMode` | 501 | `boolean` | prefs key `yolo_mode` |
| `yoloIntroSeen` | 510 | `boolean` | prefs key `yolo_intro_seen`（**O5 边界判断**：是 prefs lifecycle 因为持久化，不是 ui 因为它 gate 一个一次性 modal） |
| `conversationWidth` | 560 | `"compact" \| "wide"` | prefs key `conversation_width`（**O5 边界判断**：M1 T1.5 决定 prefs；理由是它持久化、跨 session、Settings + palette + TopBar 三处 modifier） |

### Actions

| Action | Source line | Notes |
|---|---|---|
| `setApprovalRequiredTools` | 799 | |
| `removeAlwaysAllow` | 800 | |
| `setYoloMode` | 808 | 副作用：广播 IPC 命令到所有 alive bridge |
| `acknowledgeYoloIntro` | 815 | |
| `setConversationWidth` | 823 | |
| `setGAConfig` | 833 | 副作用：reset `_warmupComplete` 触发 LLM warmup |

**Slice-internal helper**：无。

---

## F. 跨 slice / 内部 only state

### 待删除（T1.4 决定 B3 内 retire）

| Symbol | Line | Reason |
|---|---|---|
| `_bridgeClients` Map | 64 | B2 M2 后 RunnerManager (Rust) 是 ground truth；TS 端纯 cache，cache 唯一用途是 `getBridgeClient` 给外部用 |
| `getBridgeClient` export | 77 | 0 个外部调用方（grep verified），删干净 |
| `_stderrTails` Map | 74 | 同上，Rust 端 RunnerProcess.stderr_buffer 是 ground truth；外部如需，invoke `runner_stderr_tail` |
| `_STDERR_TAIL_MAX` | 75 | 同上 |
| `_lruOrder` 数组 | 102 | Rust 端 RunnerManager LRU 是 ground truth |
| `_lruTouch` / `_lruRemove` | 107 / 115 | 同上 |
| `LRU_CAP` | 103 | 同上 |
| `_warmupComplete` | 621 | LLM warmup state 是 runtime 顺手 cache，不持久化；可下放 runtimeStore 私有或彻底删（warmup 是 one-shot，重试机制走 setGAConfig reset） |

### Active-session 投影字段（**M3 起转 cache-only**，B3 ship 时删除）

下面这些 top-level 字段是 `_runtimes[activeSessionId]` 的 mirror（line 575-625）。B3 M3 期间：

1. M3 起每个 slice 暴露 active-session selector（如 `useRuntimeStore(s => s.byId[s.activeId]?.bridgeStatus)`）
2. 组件逐步从 `useAppStore(s => s.bridgeStatus)` 改 `useRuntimeStore(s => s.byId[activeId]?.bridgeStatus)`
3. M5 / M6 全部组件迁完后，top-level mirror **删除**

| Field | Mirror of |
|---|---|
| `llms` (443) | `_runtimes[active].llms` → runtimeStore |
| `llmDisplayName` (448) | `_runtimes[active].llmDisplayName` → runtimeStore |
| `turns` (583) | `_runtimes[active].turns` → messagesStore |
| `pendingApprovals` (584) | `_runtimes[active].pendingApprovals` → messagesStore |
| `agentRunning` (585) | `_runtimes[active].agentRunning` → messagesStore |
| `currentTurnIndex` (590) | `_runtimes[active].currentTurnIndex` → messagesStore |
| `inFlightContent` (604) | `_runtimes[active].inFlightContent` → messagesStore |
| `pendingAskUser` (609) | `_runtimes[active].pendingAskUser` → messagesStore |
| `approvalDecisions` (622) | `_runtimes[active].approvalDecisions` → messagesStore |
| `bridgeStatus` (623) | `_runtimes[active].bridgeStatus` → runtimeStore |
| `bridgeError` (624) | `_runtimes[active].bridgeError` → runtimeStore |
| `bridgePid` (625) | `_runtimes[active].bridgePid` → runtimeStore |

### 跨 slice helper functions

| Function | Line | Belongs |
|---|---|---|
| `applyRuntimeUpdate` | 989 | 当前是「合并 partial runtime → _runtimes + 同步 mirror + 同步 session row mirror（hasPendingAskUser）」三件事。M3-M5 拆分时**消失** —— 每个 slice 自己的 listener 直接 update 自己 cache，跨 slice 同步靠 Rust event |
| `projectionFrom` | 1043 | 同上，mirror 拆完即消失 |
| `emptyRuntime` | 396 | 拆成 messages-side `emptyConversation()` + runtime-side `emptyRuntime()` |

### 持久化入口

| Action | Line | M6 plan |
|---|---|---|
| `hydrateFromDB` | 952 | M6 T6.4：拆成每个 slice 自己的 `fetch*` action；AppShell init 期协调调用 |
| `seedMockSessions` | 962 | dev fixture，T6.5 保留；M4 实施时位置选 sessionsStore（mock 数据是 session list） |

---

## G. Open items（推到后续 sub-task）

| ID | Item | Resolves at |
|---|---|---|
| O1 (resolved) | Store 库选型 → Zustand | T1.5 |
| O2 (resolved) | Event batch window → 16ms streaming | T1.6 |
| O3 (resolved) | Selector ≤ 2 layers + store-side enrichment | T1.7 |
| **O5** | `activeProjectFilter` 是 sessionsStore 还是 uiStore？暂分 sessions | dogfood 后 |
| **O6** | demo seedMockSessions / DEMO_LLMS / DEMO_GA_CONFIG retire 时机 | T6.5 实施前再决定 |
| **O7** | `agentRunning` 归 messages 还是 runtime（本文 §C 暂分 messages） | M3/M5 边界 dogfood |
| **O8** | `userSubmitTick` 留 messages 还是去 ui（它纯触发 scroll effect）—— 倾向 ui，但当前 grep 表明只 messages action `appendUserTurn` 写它 | T1.8 dependency DAG |
| **O9** | `setGAConfig` 副作用（reset `_warmupComplete`）在 prefs 还是 runtime？setGAConfig 在 prefs，但它要触发 runtime warmup —— 需要 prefs slice 暴露 listener / runtime slice 订阅 prefs change | M3/M6 边界 |

---

## H. Numbers summary

- **State 字段**：32（含 12 个 active-session projection mirror，M3-M5 后 retire）
- **Action**：57
- **跨 slice 内部 helper**：3（applyRuntimeUpdate / projectionFrom / emptyRuntime —— 全部在拆分中消失）
- **待删 module-level state**：3 Map + 1 数组 + 4 helper + 1 flag = 9 个 dead-after-B3 symbol
- **External 调用方**：96 site，集中在 App.tsx / Onboarding / bridge.ts / sessions.ts / ipc-handlers.ts
- **Active-session projection 删除路径**：M3 起逐字段 retire，M6 时 top-level mirror 应 = 0

每个 slice 预估字段 + action 总数（slice 内行数会更多——含 listener / helper / store init）：

| Slice | Fields | Actions | 预估文件行（含 listener + helper） |
|---|---|---|---|
| uiStore | 5 | 8 | ~150 |
| sessionsStore | 4 | 18 | ~550（含 mock fixture） |
| messagesStore | 9 per-session + 1 global | 14 | ~600（G11 警示，可能拆子文件） |
| runtimeStore | 5 per-session + 3 global | 9 | ~400 |
| prefsStore | 5 | 6 | ~250 |

[B3-I5 ≤ 600 行硬上限](./B3-store-slice.md#phase-invariants--b3-特有的硬规则) — sessions / messages 接近上限，需要 M4 / M5 实施时盯紧。

---

## End of slice mapping
