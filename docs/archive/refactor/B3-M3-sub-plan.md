# B3 M3 · runtimeStore 抽离实施 sub-plan

> 用途：B3 playbook M3 启动前的详细实施 plan（per [B3-store-slice.md N5 step 3](./B3-store-slice.md#running-notes--gotchas)）。M3 scope 实测 ≠ playbook T3.5 描述（不是「thin wrapper 搬位置」），需要明确 cross-store 协调策略 + 决定 M3 单 commit vs 拆分。
>
> **状态**：drafting 2026-05-19。实施前 JC 过目。

---

## 1. Scope re-assessment vs playbook

| Playbook claim | 实际验证 |
|---|---|
| T3.5「spawnBridge 是 B2 M2 已经做的 thin wrapper」 | **不准确**。`useAppStore.spawnBridge` (line 2492-2635) **140+ 行** onClose/onError 状态协调；只有 `bridge.ts` 里的 `spawnBridgeProcess` 才是 thin invoke wrapper |
| M3 一次推完 ~800 行单 commit | N5 已 reject（疲劳期质量风险） |
| 「runtimeStore = LLM + bridge + pet 一锅端」 | M3 实际同时撞两个不同 lifecycle 的字段集合（见 §2） |

**Cross-store onClose 痛点**（N5 警示具体化）：当前 `spawnBridge` 的 onClose 回调（line 2557-2572）一次写 5 个字段，按本文 / AD-05 拆分会落到不同 slice：

| Field in onClose | After B3 owner |
|---|---|
| `bridgeStatus: "closed"` | runtimeStore |
| `bridgePid: null` | runtimeStore |
| `agentRunning: false` | **messagesStore** (per [AD-05](./b3-slice-adr.md#ad-05--agentrunning-归-messagesstore不是-runtimestore)) |
| `currentTurnIndex: null` | **messagesStore** (per [mapping § C](./b3-slice-mapping.md#c-messagesstore-分配)) |
| `inFlightContent: ""` | **messagesStore** (per [mapping § C](./b3-slice-mapping.md#c-messagesstore-分配)) |

M3 实施时 messagesStore 还没出（M5 才出），剩 3 个 field 当前仍在 `useAppStore._runtimes`。意味着 runtimeStore 的 onClose 必须：

```
runtimeStore.setBridgeClosed(sid):
  - runtimeStore 自己写 bridgeStatus + bridgePid
  - 跨 store 调 useAppStore.getState()._clearStreamingOnBridgeClose(sid) 写另外 3 个
```

这跟 [AD-09 「零 cross-slice action 调用」](./b3-slice-adr.md#ad-09--slice-dependency-dagt18) 表面冲突。但 **AD-09 守的是 slice-to-slice**；M3→old useAppStore 是 transition 阶段，**M5 ship 后改回 runtimeStore 自己 emit + messagesStore 自己 listen Rust event** — transition cross-store call 不污染长期架构。

---

## 2. Decision · 拆 M3a / M3b

按 lifecycle / risk 自然分组：

### M3a — LLM concerns (low risk · ~300 行)

**纳入**：

- 新建 `gui/src/stores/runtime.ts` skeleton（Zustand store + per-session Map + global pendingLLMIndex / petAttachedSessionId）
- 迁字段：`_runtimes[].llms` / `_runtimes[].llmDisplayName` / 全局 `pendingLLMIndex` / 全局 `petAttachedSessionId`
- 迁 action：`replaceLLMs` / `selectLLMForNewSession` / `warmupLLMList` / `setPetAttachedSession` / `setPendingPetMigration`
- 迁 `_warmupComplete` flag（私有，per [AD-08](./b3-slice-adr.md#ad-08--_warmupcomplete-归-runtimestore私有)）

**留下 / 不动**：
- `bridgeStatus` / `bridgeError` / `bridgePid` — 留 useAppStore until M3b
- `spawnBridge` / `shutdownBridge` / `shutdownAllBridges` / `sendIPCCommand` / `setBridgeStatus` — 留 useAppStore until M3b
- 9 个 module-level state（`_bridgeClients` 等）— 留 until M3b
- `applyRuntimeUpdate` / `projectionFrom` — 留（M3b / M5 才彻底拆）

**Cross-store 协调**（M3a 范围内）：

1. **`replaceLLMs` 写 session row + persistSession**（commit 9c36f42 加的逻辑）— sessions 在 useAppStore 还没拆（M4 才拆）。M3a 阶段：runtimeStore.replaceLLMs 内 `useAppStore.getState().setState(...)` 直接改 sessions 数组。**transitional ugly 可接受**，M4 ship 后改成 runtimeStore emit + sessionsStore listen
2. **`replaceLLMs` 更新 top-level projection llms/llmDisplayName** — runtimeStore 暴露 active-session selector，useAppStore.replaceLLMs 改成 deprecated thin shim 转发到 runtimeStore（M3a 结束删 useAppStore.replaceLLMs，组件改订阅）
3. **`setActiveSession` pre-seed** (commit d6a096f) — 这逻辑需跟 runtimeStore 一起搬，否则 setActiveSession 创建 emptyRuntime 时不能 pre-seed llms。**做法**：runtimeStore 暴露 `getOrCreateRuntime(sid, seedHints)` action，useAppStore.setActiveSession 调用它

**字段不动 means 组件订阅路径**：

- `useAppStore(s => s.llms)` → `useRuntimeStore(s => s.byId[activeId]?.llms ?? [])` (96 个 call site 中 LLM 相关的子集)
- `useAppStore(s => s.bridgeStatus)` — **保持不动**（M3b 才迁）
- `useAppStore(s => s.agentRunning)` — **保持不动**（M5 才迁）

### M3b — Bridge lifecycle + module-level state cleanup (high risk · ~500 行)

**纳入**：

- 迁字段：`_runtimes[].bridgeStatus` / `bridgeError` / `bridgePid`
- 迁 action：`spawnBridge` / `shutdownBridge` / `shutdownAllBridges` / `sendIPCCommand` / `setBridgeStatus`
- 删 9 个 module-level symbol（`_bridgeClients` / `_lruOrder` / `_stderrTails` / `getBridgeClient` / `_lruTouch` / `_lruRemove` / `_STDERR_TAIL_MAX` / `LRU_CAP` / `_enforceLRUCap`）— 一次性 ship per AD-07
- **Cross-store onClose**：runtimeStore.spawnBridge 的 onClose 写 bridgeStatus + bridgePid 到自己；调 `useAppStore.getState().setState(...)` 写 agentRunning / currentTurnIndex / inFlightContent 到 messages-not-yet-extracted 字段。M5 ship 时改成 Rust event 驱动

**Cross-store stderr toast / spawn error toast**：runtimeStore → uiStore.pushToast（M2 已经 ship）—— uiStore 是单向 sink（per AD-09 DAG），这条 OK

**Rust 端 emit `runtime-updated` event**（playbook T3.3）— **不在 M3b 范围**，推 M4 / M5 一起做。理由：M3b 还是 frontend-only 重组，Rust 端不动 守 [B3-I4](./B3-store-slice.md#phase-invariants--b3-特有的硬规则)。当前 runtimeStore 状态通过现有 `runner-event` / `runner-closed` 间接驱动（ipc-handlers.ts 已经 dispatch 这些事件到 store），无需新 emit

**Sub-task 序列**：

1. 在 runtimeStore 加 bridge lifecycle 字段 + setBridgeStatus action
2. `useAppStore.setBridgeStatus` 改 thin shim 转发 runtimeStore
3. 迁 spawnBridge 整块（含 onClose）— 这是 M3b 的「大爆炸 commit」block
4. 删 module-level state（一次性）
5. `useAppStore` 内删已迁字段 + actions
6. 全仓 grep verify 无残留

### 序列 + dogfood gate

```
M3a ship (单 commit "Refactor: B3 M3a — extract runtimeStore (LLM concerns)")
  ↓ dogfood 1 天（重点：LLM 切换 / persistence / flash / spawning click —— 都是今天 fix 过的）
M3b ship (单 commit "Refactor: B3 M3b — extract runtime bridge lifecycle + retire module state")
  ↓ dogfood 1 天（重点：spawn / shutdown / crash recovery / LRU evict）
M4 starts (sessionsStore)
```

---

## 3. M3a 详细 sub-task

### T3a.1 · 新建 `gui/src/stores/runtime.ts` skeleton

- 文件 ~80 行起步
- State shape:
  ```ts
  interface RuntimeState {
    llms: LLMOption[];
    llmDisplayName: string;
  }
  interface RuntimeStore {
    byId: Record<string, RuntimeState>;
    pendingLLMIndex: number | undefined;
    petAttachedSessionId: string | null;
    pendingPetMigrationTo: string | null;
    _warmupComplete: boolean;  // private to slice
    // actions：
    getOrCreateRuntime: (sid: string, seedHints: SeedHints) => RuntimeState;
    replaceLLMs: (sid: string, llms: LLMOption[]) => void;
    selectLLMForNewSession: (index: number) => void;
    warmupLLMList: () => Promise<void>;
    setPetAttachedSession: (sid: string | null) => void;
    setPendingPetMigration: (sid: string | null) => void;
  }
  ```
- SeedHints = `{ persistedIndex?: number; persistedDisplayName?: string }`
- 不暴露 raw byId map setter — 所有写都通过 named action（store-side enrichment）

### T3a.2 · 迁 `replaceLLMs`

- 把当前 useAppStore.replaceLLMs body 整块搬到 runtimeStore
- session row write + persistSession 暂时直接 `useAppStore.setState(...)` —— 加 inline 注释 `// TRANSITIONAL: M4 ship 后改 sessionsStore.upsertSession`
- 删 useAppStore.replaceLLMs
- 更新 ipc-handlers.ts 调用方：`s.replaceLLMs(...)` → `useRuntimeStore.getState().replaceLLMs(...)`

### T3a.3 · 迁 `selectLLMForNewSession` + `warmupLLMList`

- selectLLMForNewSession: 简单搬位置
- warmupLLMList 含 `_warmupComplete` flag — 私有字段一起搬。setPref("llm_list", ...) 副作用保留
- setGAConfig 的 reset `_warmupComplete: false` 是 cross-store（prefs → runtime）—— **M6 实施 prefsStore 时再处理**；M3a 阶段 useAppStore.setGAConfig 内直接 `useRuntimeStore.setState((s) => ({ ...s, _warmupComplete: false }))`（transitional）

### T3a.4 · 迁 pet 相关

- petAttachedSessionId / pendingPetMigrationTo / setPetAttachedSession / setPendingPetMigration
- ipc-handlers.ts 的 pet_attached / pet_detached case 调用方调整

### T3a.5 · setActiveSession pre-seed 重构

- 当前 `setActiveSession` 内的 pre-seed 逻辑（commit d6a096f 加的）— 把读取 hydrate cache + persisted session 字段 + 构造 seedLLMs / seedDisplayName 的逻辑搬成 `useRuntimeStore.getState().getOrCreateRuntime(sid, { persistedIndex, persistedDisplayName })`
- useAppStore.setActiveSession 调 getOrCreateRuntime 拿到 runtime → 仍走老 projection（runtime field 拆开后这里项目数减少，但还有 turns / pendingApprovals / ... messages 字段需要 project）

### T3a.6 · 组件订阅路径切换

96 个 call site 中 LLM 相关的 grep：

```bash
grep -rn "useAppStore.*llms\|useAppStore.*llmDisplayName\|useAppStore.*pendingLLMIndex\|useAppStore.*petAttachedSessionId\|useAppStore.*pendingPetMigrationTo" gui/src/
```

预估 15-20 site（Composer / TopBar / Sidebar Cat badge / EmptyState picker / CommandPalette / App.tsx）。批量改 `useRuntimeStore`。

### T3a.7 · TypeScript / lint / Rust 测试 + dogfood

- `cd gui && pnpm typecheck && pnpm lint`
- Rust `cargo test` 不应受影响（不动 Rust 端）
- Dogfood scenarios：
  - LLM picker pill 显示正确 + 切换有响应（覆盖今天的 4 个 fix）
  - LLM 持久化 ✓
  - 多 session 各持 不同 LLM ✓
  - pet attach / detach / migrate ✓
  - warmup 在 GA path 切换时 reset ✓

### T3a.8 · M3a commit + tag

```
git commit -m "Refactor: B3 M3a — extract runtimeStore (LLM concerns)"
```

---

## 4. M3b 详细 sub-task（M3a dogfood 通过后）

### T3b.1 · 加 bridge lifecycle 字段到 runtimeStore

- `byId[sid].bridgeStatus / bridgeError / bridgePid`
- 加 `setBridgeStatus / setBridgeError / setBridgePid` action

### T3b.2 · 迁 spawnBridge 整块

- 整段 140 行搬到 runtimeStore
- onClose 拆 cross-store 写法：
  ```ts
  onClose: (code, signal) => {
    // ...stderr toast 不变...
    useRuntimeStore.setState((s) => ({
      byId: {
        ...s.byId,
        [sid]: { ...s.byId[sid], bridgeStatus: "closed", bridgePid: null },
      },
    }));
    // TRANSITIONAL: M5 ship 后改 useMessagesStore + Rust event 驱动
    useAppStore.setState((state) =>
      applyRuntimeUpdate(state, sid, (rt) => ({
        ...rt,
        agentRunning: false,
        currentTurnIndex: null,
        inFlightContent: "",
      })),
    );
  }
  ```
- 注意 onError 也有类似 cross-store 写

### T3b.3 · 迁 shutdownBridge / shutdownAllBridges / sendIPCCommand

- 都搬到 runtimeStore
- `_bridgeClients` Map 一并迁（或直接删，看 T3b.4）

### T3b.4 · 删 9 个 module-level state

per [AD-07](./b3-slice-adr.md#ad-07--module-level-state-全删t14-verbatim) 一次性删：

```bash
grep -rn "_bridgeClients\|_lruOrder\|_stderrTails\|getBridgeClient\|_lruTouch\|_lruRemove\|_STDERR_TAIL_MAX\|LRU_CAP\|_enforceLRUCap" gui/src/
```

每个 grep 命中要么搬到 runtimeStore 内部（如果还要用），要么改 `invoke runner_stderr_tail` 等 Rust command（per AD-07 表）。

### T3b.5 · 组件订阅路径切换

剩下的 useAppStore.bridgeStatus / bridgeError / bridgePid 引用（App.tsx 多处 gate / Sidebar status pill / TopBar pid display）—— grep + 改 useRuntimeStore.

### T3b.6 · TypeScript / lint / Rust 测试 + dogfood

dogfood scenarios：
- spawn 新 session
- 主动 shutdown
- pkill -9 workbench_bridge → onClose toast + state cleanup
- LRU evict（开 6 session）
- 多 session 并发 spawn
- 关 Galley → 所有 bridge 干净退出

### T3b.7 · M3b commit + tag

```
git commit -m "Refactor: B3 M3b — extract runtime bridge lifecycle + retire module state"
```

---

## 5. Risk register

| # | 风险 | Mitigation |
|---|---|---|
| R1 | `setActiveSession` pre-seed 逻辑跟今天 fix 紧耦合（d6a096f）—— 拆 store 时 regress 风险高 | T3a.5 把 pre-seed 完整搬到 runtimeStore.getOrCreateRuntime，逻辑不动只改位置；dogfood 覆盖 |
| R2 | onClose cross-store 写法 transitional ugly | 加 inline `// TRANSITIONAL: M5 ship 后改 Rust event 驱动` 注释 + 在 N notes 记下 commit hash 方便 M5 时定位 |
| R3 | `applyRuntimeUpdate` 同一 helper 在 useAppStore / runtimeStore 都要用 | M3 期间双方各自 inline 一份 mini helper；M5 拆完 messagesStore 后 useAppStore 版本消失，runtimeStore 版本简化（runtime 字段不 sync 到 session row） |
| R4 | 组件订阅切换 grep 漏 site → runtime stale | typecheck 强制（runtime field 改名后旧调用 TS error）；额外 manual grep `useAppStore(s => s\.llms\|llmDisplayName\|pending(?:LLMIndex\|PetMigrationTo)\|petAttached)` 兜底 |
| R5 | warmupLLMList 跨 prefs（setGAConfig 触发）—— M3a 暂时 transition cross-store call，M6 才规范化 | inline 注释；O9 已 open |
| R6 | M3a 改完到 M3b 之间这段时间 useAppStore 字段一半已迁 / 一半留——dogfood 测试覆盖不全可能 ship 状态分裂 bug | 严格 M3a dogfood 1 天才推 M3b（B3-I1）；不允许同 session 同时改两段 |

---

## 6. Open questions

| ID | Item | Decide at |
|---|---|---|
| Q1 | M3a 是否一并迁 `runtimeInfo`（health check 全局数据）？mapping § D 列了但本 sub-plan 没纳入 | T3a.1 开干前；本 sub-plan 倾向**纳入 M3a** —— 全局 health 数据，无 lifecycle 复杂度，跟 LLM 一组搬干净 |
| Q2 | `_runtimes[sid]` map 在 useAppStore 内的部分字段被 M3a 迁出，会不会 hashmap 维护混乱？每次 emptyRuntime() 还要包含 llms 吗？ | M3a 实施时；倾向**emptyRuntime 不再含 llms/llmDisplayName**（这些字段成 runtimeStore.byId 私有），useAppStore._runtimes[sid] 只剩 messages-bound 字段 |
| Q3 | runtime store 字段名命名约定：跟 mapping doc 一致 (`byId[sid].llms`) vs 跟 useAppStore 当前一致 (`_runtimes[sid].llms`)？ | T3a.1；倾向 `byId` —— 公共 store API 不再带 `_` private 前缀（mapping doc 用 `_runtimes` 是 useAppStore 的内部命名约定） |

---

## 7. Verification gates

**M3a 完成判据**（all must pass）：

- [ ] TS typecheck 0 error
- [ ] ESLint 0 warning
- [ ] Rust `cargo test` 76/76 pass（不应受影响）
- [ ] 4 个今天的 dogfood case 不退化：
  - [ ] CLI session send → user message 在 GUI 显示（commit 4e7a6e6）
  - [ ] LLM persistence 跨重启（commit 9c36f42）
  - [ ] Picker pill 无 flash（commit d6a096f）
  - [ ] Picker click 在 spawning 期间生效（commit 317e816）
- [ ] LLM picker 列表 / pill / dropdown highlight 正确
- [ ] Pet attach / detach / migrate 正常
- [ ] grep `useAppStore.*\(llms\|llmDisplayName\|pendingLLMIndex\|petAttached\|pendingPetMigration\|_warmupComplete\)` 返回 0

**M3b 完成判据**：

- [ ] M3a 全部 + 以下
- [ ] spawn / shutdown / crash recovery / LRU evict 正常
- [ ] grep `_bridgeClients\|_lruOrder\|_stderrTails\|getBridgeClient\|_lruTouch\|_lruRemove\|_STDERR_TAIL_MAX\|LRU_CAP\|_enforceLRUCap` 返回 0
- [ ] `useAppStore.*\(bridgeStatus\|bridgeError\|bridgePid\|spawnBridge\|shutdownBridge\|sendIPCCommand\|setBridgeStatus\)` 返回 0
- [ ] 性能 baseline 对比：P3 CLI RTT / P4 bridge spawn / P5 RSS 跟今天 B2 baseline 一致（±5%）

---

## 8. Estimate

| Sub-phase | LOC | 时长 |
|---|---|---|
| M3a | ~300 净增减 | 单 session 3-4h（含 typecheck + lint + dogfood 准备） |
| M3a dogfood gate | 0 | 1 天 user time（JC 用真 GA 跑 24h+） |
| M3b | ~500 净增减 | 单 session 5-6h（onClose cross-store 是注意点） |
| M3b dogfood gate | 0 | 1 天 user time |
| **总计 M3** | ~800 | 2-3 个工作 session + 2 天 dogfood |

**对比 N5 单 commit 风险评估**：N5 估 800 行单 commit、单 session 推完。本 plan 拆 2 commit、2 session、中间 1 天 dogfood — 同总量但 risk 收敛得多。

---

## End of M3 sub-plan
