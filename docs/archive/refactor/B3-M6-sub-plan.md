# B3 M6 · prefsStore 抽离 + useAppStore.ts 退役 sub-plan

> 用途：B3 playbook M6 启动前的详细实施 plan，mirror [M3 sub-plan](./B3-M3-sub-plan.md) / [M4 sub-plan](./B3-M4-sub-plan.md) / [M5 sub-plan](./B3-M5-sub-plan.md) 结构。M6 是 **B3 最后一个 milestone** —— prefsStore 出生 + useAppStore.ts 整文件 retire。
>
> **状态**：drafting 2026-05-20。本 session ship sub-plan markdown，不动代码。M6 实施推 fresh session（per N5 / N10 / N14 教训：sub-plan + 大 commit 分两 session 是稳定模式）。
>
> **关键决策**：**single commit M6**（不拆 M6a/M6b）+ **useAppStore.ts 整文件删除**（不留 composition shim）。详 §2。

---

## 1. Scope re-assessment vs playbook

| Playbook claim | 实际验证 |
|---|---|
| T6.1 「新建 `gui/src/stores/prefs.ts`. fields = `gaConfig` / `approvalConfig` / `yoloMode` / `yoloIntroSeen` / `runtimeInfo`」 | **`runtimeInfo` 字段错** — runtimeInfo 在 M3a 已迁 runtimeStore (本 sub-plan §1.1 钉)；prefsStore 真实 5 字段 = `gaConfig` / `approvalConfig` / `yoloMode` / `yoloIntroSeen` / **`conversationWidth`**。playbook 写时 conversationWidth 未存在 |
| T6.2 「迁 setGAConfig / setApprovalRequiredTools / removeAlwaysAllow / setYoloMode / acknowledgeYoloIntro」 | 漏 **`setConversationWidth`**（M5 ship 前不存在；2026-05-14 之后加的字段）。actions 共 6 个（5 setters + setGAConfig） |
| T6.3 「Rust 端 emit `prefs-updated` event」 | **B3-I4 警示**：B3 内不动 Rust 端（除 minor patch）。M6 真实路径 = setPref / getPref 单端写 SQLite，prefs 没 cross-process consumer（无 CLI / supervisor 在 B3 触 prefs）—— prefs-updated event 推 B4 之后再做。本 sub-plan **不**走 T6.3 |
| T6.4 「迁 hydrateFromDB → 协调 5 slice 在 init phase 调各自的 fetch action（不是单一 hydrateFromDB action）」 | 实际有更明确路径：抽出 `gui/src/lib/hydrate.ts` 顶层 orchestrator（pure function module，不属 store），各 slice 内只暴露自己的 hydrate action。详 §1.3 |
| T6.5 「迁 seedMockSessions（demo 模式）」 | seedMockSessions **已经搬 sessionsStore (M4b)**；useAppStore.seedMockSessions 当前是 forward shim。M6 内**整段删 forward shim**，DevTools 用户改用 `__sessions.getState().seedMockSessions()`（详 §3.6 + R7） |
| T6.6 「`useAppStore.ts` 清到 < 200 行（B3-I5）或彻底删除」 | **彻底删除路径** —— 本 sub-plan 推荐。M6 后只剩 prefsStore + lib/hydrate.ts，useAppStore.ts 没有任何 unique state 或 unique action，留下来是 dead artifact（[B3-I6](./B3-store-slice.md#phase-invariants--b3-特有的硬规则) "useAppStore @deprecated 不留"） |
| T6.7 「全仓 grep useAppStore 还剩多少 import — 应该 0」 | 直接钉 V3 gate |
| T6.8-T6.10 | sequencing 标准 |

### 1.1 字段（5）

| Field | useAppStore.ts source line | Notes |
|---|---|---|
| `gaConfig` | 44-58 | 4-key object: `python` / `gaPath` / `bridgeCwd` / `useExternalPython` |
| `approvalConfig` | 60 | `ApprovalConfig` from `Settings.tsx` shape (requiredTools / alwaysAllowProject / alwaysAllowGlobal) |
| `yoloMode` | 72 | bool, default true, sticky pref `yolo_mode` |
| `yoloIntroSeen` | 81 | bool, default true (hidden during cold start); pref `yolo_intro_seen` |
| `conversationWidth` | 102 | `"compact" \| "wide"`, pref `conversation_width` |

### 1.2 Actions（6）

| Action | Source line | Side effect (cross-store / cross-module) |
|---|---|---|
| `setApprovalRequiredTools` | 160 | 单 store set，无 SQLite write（approvalConfig 不持久化 — Stage 3 决策，approval rules 本来想接 settings persistence 但 v0.1 未 wire） |
| `removeAlwaysAllow` | 165 | 同上 |
| `setYoloMode` | 184 | 遍历 `useRuntimeStore.getState().byId` → 每 alive bridge `sendIPCCommand({kind: "set_yolo_mode", ...})` + setPref |
| `acknowledgeYoloIntro` | 207 | optionally call setYoloMode + setPref `yolo_intro_seen` |
| `setConversationWidth` | 224 | 单 store set + setPref `conversation_width` |
| `setGAConfig` | 236 | 跨 store fan-out（详 §1.4）：python alias resolve via `lib/python-probe` + `useRuntimeStore.patchRuntimeInfo` + `useRuntimeStore.resetWarmup` + `useUiStore.pushToast` + `useRuntimeStore.warmupLLMList` + setPref `ga_config` |

### 1.3 hydrateFromDB（cold-start orchestrator）

`useAppStore.hydrateFromDB` (line 288-449) 当前职责（按调用顺序）：

1. `getVersion()` from `@tauri-apps/api/app` → `runtimeStore.patchRuntimeInfo({workbenchVersion})`
2. `deleteEmptyNewSessions()` SQLite cleanup
3. `deleteDemoSessions()` SQLite cleanup
4. `useSessionsStore.getState().hydrate()` (M4b 落地)
5. `backfillFtsIfEmpty()` SQLite FTS index backfill
6. `getPref<boolean>("yolo_mode")` → `set({yoloMode})`
7. (条件) `getPref<boolean>("yolo_intro_seen")` → `set({yoloIntroSeen: false})` 当真新用户
8. `getPref<"compact"|"wide">("conversation_width")` → `set({conversationWidth})`
9. `getPref<LLMOption[]>("llm_list")` → `useRuntimeStore.getState().seedCachedLLMs(cachedLLMs)`
10. `getPref<GAConfig>("ga_config")` → `set({gaConfig: migrated})` + python alias resolve + `useRuntimeStore.patchRuntimeInfo` + 判断 `hasGAConfig`
11. 当 `hasGAConfig === false` → `useUiStore.getState().setScreen("onboarding")` 早 return
12. 否则 → `useRuntimeStore.getState().warmupLLMList()` fire-and-forget

**M6 拆解方案**：

- **prefsStore.hydratePrefs()** 内只负责 step 6 / 7 / 8 / 10（自己 owned 字段的 pref load）+ 不调跨 slice
- **lib/hydrate.ts** 新建 pure orchestrator module，整段搬 1-12 的 sequencing；调用 prefsStore.hydratePrefs 在第 10 步前后；调 sessionsStore.hydrate 在 step 4；调 runtimeStore.patchRuntimeInfo / seedCachedLLMs / warmupLLMList 在 1 / 9 / 12
- **App.tsx** 内 `useEffect(() => { hydrateApp(); }, [])` 改 import from `@/lib/hydrate`

**理由**：
1. 单 slice 的 hydrate action **只 hydrate 自己字段**（slice scoping），跨 slice orchestration 不该在 slice 内做（DAG cleanliness, AD-09）
2. lib/hydrate.ts pure function module 比 useAppStore.hydrateFromDB action 更诚实 —— 它本来就不是 state，只是冷启动顺序
3. 写成 module function 可以让 sequencing 单元测试化（future B4）

### 1.4 `setGAConfig` cross-store fan-out

| Step | Code (line) | 跨 store |
|---|---|---|
| python alias resolve | 242-244 | `findCandidateByAlias` from `lib/python-probe`（pure function，非 store） |
| `patchRuntimeInfo({gaPath, pythonVersion})` | 248-251 | runtimeStore |
| `resetWarmup()` | 257 | runtimeStore（注释「TRANSITIONAL (M6 prefsStore)」当时预想：M6 后 prefs-updated event → runtimeStore listener。本 sub-plan **不走 event 路径**因 B3-I4 + 跨进程 prefs event 无意义 — keep direct cross-store call） |
| setPref `ga_config` | 259 | persistent |
| pushToast | 269-280 | uiStore（带 changedField 判断） |
| `warmupLLMList()` | 284 | runtimeStore（条件 — 仅当 changedField 非空） |

**M6 后 setGAConfig 仍跨 3 store 调度**（prefs → runtime + ui + persistent）。这是 prefs slice 的本质职责：用户改 GA 配置时整个 app 重新热身。**不存在更干净的拆法** —— 跟 setYoloMode 遍历 bridges 同 pattern，prefsStore 持有「广播 prefs 变化到其它 slice」职责。

### 1.5 Reverse cross-store reads（其它 slice 当前读 useAppStore）

| Caller | Line | 读什么 | M6 swap |
|---|---|---|---|
| `runtime.ts` import (line 23) | `useAppStore` | gaConfig 读 (`readGAConfigFromAppStore` helper line 685) | static import `usePrefsStore`，`readGAConfigFromAppStore` rename → `readGAConfigFromPrefs` |
| `runtime.ts:496` dispatchIPCEvent param | `useAppStore` | 给 ipc-handlers 传 store ref 读 yoloMode | **删除 param**：ipc-handlers 内直接 `usePrefsStore.getState().yoloMode`（详 §1.6） |
| `sessions.ts:537-538` dynamic import in activateSession | `useAppStore.getState().gaConfig` | spawnBridge args | static import `usePrefsStore`，删 dynamic import 模式 |
| `Onboarding.tsx:171` | `useAppStore((s) => s.gaConfig.useExternalPython)` | useExternalPython 字段订阅 | swap to `usePrefsStore((s) => s.gaConfig.useExternalPython)` |
| `ipc-handlers.ts:19, 47` import + param | `typeof useAppStore` | `s.yoloMode` 读 in ready handler (line 93) | **删 store param**：dispatchIPCEvent 内 inline `usePrefsStore.getState().yoloMode`（详 §1.6） |

### 1.6 dispatchIPCEvent signature simplification

当前签名 (`ipc-handlers.ts:45`)：
```ts
export function dispatchIPCEvent(
  event: IPCEvent,
  store: typeof useAppStore,
): void
```

`store` 参数只为读 `s.yoloMode` 一次（line 93）。其它所有 store 读 (`useMessagesStore`, `useSessionsStore`, `useRuntimeStore`, `useUiStore`) 都直接 `XxxStore.getState()` 内部 import 调用。

**M6 改成**：
```ts
export function dispatchIPCEvent(event: IPCEvent): void
```

body 内 `const yoloMode = usePrefsStore.getState().yoloMode;`。runtime.ts:496 callsite `onEvent: (event) => dispatchIPCEvent(event)` 不再传 store。

**理由**：dispatchIPCEvent 已经是多 store hub，剔除 param 反映现状 + 删 `typeof useAppStore` 残留 + 消除 useAppStore 在 runtime.ts 的最后一处 import。

### 1.7 useAppStore.ts 整文件命运

**整段删除**。文件位置 `gui/src/stores/useAppStore.ts` 后 M6 不存在。

理由：
1. **playbook T6.6 推荐删除**，B3-I6 "useAppStore @deprecated 不留"
2. M6 ship 后 useAppStore 内已无任何 unique state / action（5 字段全去 prefsStore；6 action 全去 prefsStore；hydrateFromDB 拆成 lib/hydrate.ts + 各 slice action；seedMockSessions forward shim 删）
3. composition shim 是 B3-I3 "no double-track" 反 pattern —— 留 useAppStore re-export 会让组件 import 时不知道该 import 哪 store

DevTools `window.__store` exposure (line 463) 同步删除。新增等价 exposure：
```ts
// gui/src/stores/prefs.ts (DEV only)
(globalThis as { __prefs?: typeof usePrefsStore }).__prefs = usePrefsStore;
```

各 slice 都加 `__sessions` / `__messages` / `__runtime` / `__ui` / `__prefs` exposure（per slice 自己负责），删 `__store` 单一入口。**Optional**（未来 alignment polish）：M6 内只加 `__prefs`，其它 slice 顺手补在同一 commit 或 follow-up commit 内（[O9 NEW](#open-decisions-new) 留这条 retro）。

---

## 2. Commit shape · single commit M6

### 2.1 候选 split seams 评估

| Seam | M6a 内容 | M6b 内容 | 问题 |
|---|---|---|---|
| **C-1 prefs 字段先迁，useAppStore.ts 保留 hydrate** | 5 字段 + 6 action 到 prefsStore | 删 useAppStore.ts + lib/hydrate.ts | M6a 后 useAppStore 持有 hydrateFromDB + seedMockSessions forward，但 5 字段都 forward 到 prefsStore = 双重读路径 = 违反 [B3-I3](./B3-store-slice.md#phase-invariants--b3-特有的硬规则) |
| **C-2 hydrate 先抽出，prefs 后** | lib/hydrate.ts + useAppStore 仍持 5 字段 | 5 字段迁 prefsStore | hydrate orchestrator 依赖 prefsStore.hydratePrefs，prefs 不存在时 lib/hydrate.ts 是 dead code |
| **C-3 setGAConfig 单独迁** | 5 setters + 5 字段到 prefsStore | setGAConfig 迁（保留跨 store fan-out） | setGAConfig 是 prefsStore 的「重头戏 action」，分开违反 capability-completeness |

### 2.2 推荐 · single commit M6

**理由**：
1. M5 1052 LOC 单 commit 已验证类似规模可行（[N14](./B3-store-slice.md#running-notes--gotchas)）—— M6 估更小：prefsStore ~280 LOC + lib/hydrate.ts ~120 LOC + 删 useAppStore.ts -465 LOC + 20-25 call site swap，净 -65 LOC
2. prefsStore 是 **B3 最后一个 slice** —— 拆完后 useAppStore 删除是 B3-I3 "no double-track" 的硬终点
3. 拆 M6a/M6b 都创造 double-track（违反 B3-I3）
4. cross-store callers (5 处 swap) 必须 **同 commit 一起 fix** —— 拆开会留个 commit 里 prefsStore 存在但 callers 仍指向 useAppStore 的中间态

### 2.3 sequencing

```
M6 sub-plan ship (本 session, 单 commit "Docs: B3 M6 sub-plan — prefsStore + useAppStore retire decision")
  ↓ JC review sub-plan
  ↓ M5 dogfood (T5.16) 补足 — V5 auto-scroll + V6 turnIndexOffset PK + V7 mirror correctness + 7 cluster scenario
M6 implementation (fresh session, 单 commit "Refactor: B3 M6 — extract prefsStore + retire useAppStore.ts")
  ↓ dogfood 1 天（V1-V10 verification + 7 cluster scenario）
M7 acceptance + B3 完成 devlog + tag b3-complete
```

---

## 3. M6 详细 sub-task

### T6.1 · 新建 `gui/src/stores/prefs.ts` skeleton

预计 ~280 行（5 字段 + 6 actions + hydratePrefs + module-level DEV exposure）。**G11 不预警** —— prefs slice 不接 per-session map，结构扁平，远低于 600 行硬上限。

State shape:
```ts
import { create } from "zustand";

import type { ApprovalConfig } from "@/components/screens/settings/Settings";

export interface GAConfig {
  python: string;
  gaPath: string;
  bridgeCwd: string;
  useExternalPython: boolean;
}

interface PrefsState {
  gaConfig: GAConfig;
  approvalConfig: ApprovalConfig;
  yoloMode: boolean;
  yoloIntroSeen: boolean;
  conversationWidth: "compact" | "wide";
}

interface PrefsActions {
  // Approval
  setApprovalRequiredTools: (tools: string[]) => void;
  removeAlwaysAllow: (scope: "project" | "global", tool: string) => void;
  // YOLO
  setYoloMode: (enabled: boolean) => Promise<void>;
  acknowledgeYoloIntro: (revertToApproval?: boolean) => Promise<void>;
  // Conversation
  setConversationWidth: (mode: "compact" | "wide") => Promise<void>;
  // GA config
  setGAConfig: (partial: Partial<GAConfig>) => Promise<void>;
  // Hydration
  hydratePrefs: () => Promise<{
    hasGAConfig: boolean;
    cachedLLMs: LLMOption[] | undefined;
  }>;
}

export type PrefsStore = PrefsState & PrefsActions;
```

`hydratePrefs` 返回 `{hasGAConfig, cachedLLMs}` 给 lib/hydrate.ts 用作后续 step gating —— 是 prefs slice 跨 module contract 的明文 surface（不依赖 setState 副作用排序）。

### T6.2 · 实现 GAConfig（最复杂 action）

`setGAConfig` 在 prefsStore 内 verbatim 搬过来，import 路径调整：
- `useRuntimeStore` 从 `@/stores/runtime` 静态 import
- `useUiStore` 从 `@/stores/ui` 静态 import
- `findCandidateByAlias` 静态 import（不再 dynamic）
- `setPref` 静态 import from `@/lib/db`
- `makeAppError` 静态 import from `@/types/app-error`

**Cross-store 调用保留**：`patchRuntimeInfo` + `resetWarmup` + `warmupLLMList` + `pushToast`。注释「TRANSITIONAL (M6 prefsStore)」全部清掉 —— M6 后就是稳态。

### T6.3 · 实现 setYoloMode（遍历 alive bridges）

verbatim 搬过来，`useRuntimeStore.getState().byId` 遍历 keys 不变 + `sendIPCCommand` 调用不变。

### T6.4 · 实现 acknowledgeYoloIntro

`get().setYoloMode(false)` 在 prefsStore 内 = `usePrefsStore.getState().setYoloMode` 自调（intra-store，不再 cross-store）。

### T6.5 · 实现 setConversationWidth + setApprovalRequiredTools + removeAlwaysAllow

直接搬。setConversationWidth 保留 setPref；其它两 setter 无 persistence (per Stage 3 决策，approval rules persist 到 settings 是 future work)。

### T6.6 · 实现 hydratePrefs

整段从 useAppStore.hydrateFromDB 抽：step 6 / 7 / 8 / 10 + python alias resolve。返回值 `{hasGAConfig, cachedLLMs}` 喂给 lib/hydrate.ts 决策路由。

**关键 detail**：`cachedLLMs` 不是 prefsStore 字段（不存 LLM 列表），但 `getPref<LLMOption[]>("llm_list")` 读由 prefsStore 内做最合理（prefs 单点持有 prefs 读路径）。**Refactor option**：把 `getPref llm_list` 留 lib/hydrate.ts 内直接读，prefsStore 不接 LLM 字段 —— prefs slice 边界更紧。本 sub-plan 选 **lib/hydrate.ts 内读**（详 R8）：prefsStore 只接 prefs-owned 字段（5 字段都是 prefs slice 长期持有）；cachedLLMs 是 RuntimeStore 的 short-term hint，不属 prefs。

**最终 hydratePrefs 范围（修正）**：step 6 / 7 / 8 / 10 + python alias resolve，**不含** cachedLLMs（lib/hydrate.ts 单独处理）。返回 `{hasGAConfig: boolean}`。

### T6.7 · 新建 `gui/src/lib/hydrate.ts` orchestrator

完整 sequencing，pure function module（无 export const state，无 store）。

```ts
import { getVersion } from "@tauri-apps/api/app";

import {
  backfillFtsIfEmpty,
  deleteDemoSessions,
  deleteEmptyNewSessions,
  getPref,
} from "@/lib/db";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import type { LLMOption } from "@/stores/runtime";

/**
 * Cold-start orchestrator. Mount-time hydration sequence for App.tsx.
 * Replaces useAppStore.hydrateFromDB (B3 M6).
 *
 * Order:
 *   1. App version → runtimeInfo
 *   2. SQLite cleanup (empty 新对话, demo seed)
 *   3. sessionsStore.hydrate (sessions + projects)
 *   4. FTS backfill
 *   5. prefsStore.hydratePrefs (yolo / conversationWidth / gaConfig)
 *   6. Cached LLM seed → runtimeStore
 *   7. Onboarding routing OR warmup kickoff (gated on hasGAConfig)
 */
export async function hydrateApp(): Promise<void> {
  // 1. App version
  try {
    const v = await getVersion();
    useRuntimeStore.getState().patchRuntimeInfo({ workbenchVersion: v });
  } catch (e) {
    console.debug("[hydrate] app.getVersion failed.", e);
  }

  // 2-4. SQLite cleanup + sessions hydrate + FTS backfill
  try {
    try {
      const removed = await deleteEmptyNewSessions();
      if (removed > 0) {
        console.info(`[hydrate] pruned ${removed} empty 新对话.`);
      }
    } catch (e) {
      console.debug("[hydrate] deleteEmptyNewSessions failed.", e);
    }
    try {
      const removed = await deleteDemoSessions();
      if (removed > 0) {
        console.info(`[hydrate] pruned ${removed} legacy demo session(s).`);
      }
    } catch (e) {
      console.debug("[hydrate] deleteDemoSessions failed.", e);
    }
    await useSessionsStore.getState().hydrate();
    try {
      const indexed = await backfillFtsIfEmpty();
      if (indexed > 0) {
        console.info(`[hydrate] FTS backfilled ${indexed} message(s).`);
      }
    } catch (e) {
      console.debug("[hydrate] backfillFtsIfEmpty failed.", e);
    }
  } catch (e) {
    console.warn("[hydrate] SQLite unavailable, using demo seed.", e);
  }

  // 5. Prefs hydrate
  const { hasGAConfig } = await usePrefsStore.getState().hydratePrefs();

  // 6. Cached LLM seed (lives outside prefsStore — short-term runtime hint)
  try {
    const cached = await getPref<LLMOption[]>("llm_list");
    if (cached && cached.length > 0) {
      useRuntimeStore.getState().seedCachedLLMs(cached);
    }
  } catch (e) {
    console.warn("[hydrate] llm_list pref load failed.", e);
  }

  // 7. Onboarding routing OR warmup
  if (!hasGAConfig) {
    useUiStore.getState().setScreen("onboarding");
    return;
  }
  void useRuntimeStore.getState().warmupLLMList();
}
```

### T6.8 · App.tsx swap (14 hook + import + hydrate call)

| 当前 | 改成 |
|---|---|
| `import { useAppStore } from "@/stores/useAppStore";` | 删 |
| `const approvalConfig = useAppStore((s) => s.approvalConfig)` | `usePrefsStore` |
| `const setApprovalRequiredTools = useAppStore((s) => s.setApprovalRequiredTools)` | `usePrefsStore` |
| `const removeAlwaysAllow = useAppStore((s) => s.removeAlwaysAllow)` | `usePrefsStore` |
| `const yoloMode = useAppStore((s) => s.yoloMode)` | `usePrefsStore` |
| `const setYoloMode = useAppStore((s) => s.setYoloMode)` | `usePrefsStore` |
| `const yoloIntroSeen = useAppStore((s) => s.yoloIntroSeen)` | `usePrefsStore` |
| `const acknowledgeYoloIntro = useAppStore((s) => s.acknowledgeYoloIntro)` | `usePrefsStore` |
| `const conversationWidth = useAppStore((s) => s.conversationWidth)` | `usePrefsStore` |
| `const setConversationWidth = useAppStore((s) => s.setConversationWidth)` | `usePrefsStore` |
| `const setGAConfig = useAppStore((s) => s.setGAConfig)` | `usePrefsStore` |
| `const gaConfig = useAppStore((s) => s.gaConfig)` | `usePrefsStore` |
| `const hydrateFromDB = useAppStore((s) => s.hydrateFromDB)` | 删；`useEffect` 直接 `import { hydrateApp } from "@/lib/hydrate"` |
| `const seedMockSessions = useAppStore((s) => s.seedMockSessions)` | `useSessionsStore((s) => s.seedMockSessions)`（forward shim 删，直读 sessionsStore） |
| `useEffect(() => { hydrateFromDB(); }, [hydrateFromDB])` | `useEffect(() => { void hydrateApp(); }, [])` (空 dep)|

### T6.9 · Onboarding.tsx swap (1 hook + import)

```ts
// before
import { useAppStore } from "@/stores/useAppStore";
const useExternalPython = useAppStore((s) => s.gaConfig.useExternalPython);

// after
import { usePrefsStore } from "@/stores/prefs";
const useExternalPython = usePrefsStore((s) => s.gaConfig.useExternalPython);
```

### T6.10 · runtime.ts swap

| Line | Before | After |
|---|---|---|
| 23 | `import { useAppStore } from "@/stores/useAppStore";` | `import { usePrefsStore } from "@/stores/prefs";` |
| 396 (comment) | `M6 will move gaConfig to prefsStore` | 删注释（M6 落地，no longer transitional） |
| 496 | `onEvent: (event) => dispatchIPCEvent(event, useAppStore)` | `onEvent: (event) => dispatchIPCEvent(event)` |
| 680-686 (`readGAConfigFromAppStore`) | rename → `readGAConfigFromPrefs`，body `return usePrefsStore.getState().gaConfig;` + 注释清掉 TRANSITIONAL |
| 397 (caller) | `const config = readGAConfigFromAppStore();` | `const config = readGAConfigFromPrefs();` |

### T6.11 · sessions.ts swap (dynamic → static import)

`sessions.ts:534-538` 当前：
```ts
// gaConfig lives in useAppStore until M6 prefsStore. Dynamic
// import keeps the static graph free of cycles (useAppStore
// imports sessionsStore via hydrateFromDB orchestration).
const { useAppStore } = await import("@/stores/useAppStore");
const gaConfig = useAppStore.getState().gaConfig;
```

M6 后改成 static import（顶部 import block）：
```ts
import { usePrefsStore } from "@/stores/prefs";
// ...
const gaConfig = usePrefsStore.getState().gaConfig;
```

**Cycle check**：prefsStore 不 import sessionsStore（prefs slice 是叶子，per AD-09 DAG sub-plan §1.8）—— static import 安全。删 dynamic import 是 cleanup，不留 transitional 注释。

### T6.12 · ipc-handlers.ts swap (drop store param)

| Line | Before | After |
|---|---|---|
| 19 | `import type { useAppStore } from "@/stores/useAppStore";` | 删（不再需要 store type） |
| 45-48 | `export function dispatchIPCEvent(event: IPCEvent, store: typeof useAppStore): void` | `export function dispatchIPCEvent(event: IPCEvent): void` |
| 49-53 | comment "s only carries prefs-level state still owned by useAppStore" | 改写为「prefs 读直接调 usePrefsStore.getState()」 |
| 53 | `const s = store.getState();` | 删 |
| 93 | `if (s.yoloMode) {` | `if (usePrefsStore.getState().yoloMode) {` |

新增 import: `import { usePrefsStore } from "@/stores/prefs";`

### T6.13 · 删 useAppStore.ts

`rm gui/src/stores/useAppStore.ts`。

`gui/src/stores/` 后 M6 包含: ui.ts / runtime.ts / sessions.ts / messages.ts (+ messages/rowsToTurns.ts) / prefs.ts / demo.ts。**6 files** + 1 helper subfolder。

### T6.14 · DevTools exposure

prefs.ts 末尾添加：
```ts
if (import.meta.env.DEV) {
  (globalThis as { __prefs?: typeof usePrefsStore }).__prefs = usePrefsStore;
}
```

**Optional polish (可推迟到 M7)**：同 commit 内为 ui.ts / runtime.ts / sessions.ts / messages.ts 各加 `__ui` / `__runtime` / `__sessions` / `__messages` exposure。M6 内**不强制** —— 单加 `__prefs` 不破坏其它 slice 的 DevTools 访问（开发者可在 console `import("./stores/sessions").then(m => m.useSessionsStore.getState())` 临时读）。**JC 自己用 DevTools 较频繁**，可在 M7 acceptance 时一并补。

### T6.15 · TypeScript / Rust / lint / cargo check

- `cd gui && pnpm typecheck` — 0 error
- `cd gui && pnpm lint` — 0 warning
- `cd core && cargo check` — 不应受影响（B3-I4，Rust 0 改动）
- `cd core && cargo test` — 全过

### T6.16 · M6 commit

```
git commit -m "Refactor: B3 M6 — extract prefsStore + retire useAppStore.ts"
```

Commit body：
- 5 字段 + 6 action 迁 prefsStore
- hydrateFromDB 拆 prefsStore.hydratePrefs + lib/hydrate.ts orchestrator
- dispatchIPCEvent signature 简化（删 store param）
- 5 reverse cross-store callers swap (App.tsx / Onboarding.tsx / runtime.ts / sessions.ts / ipc-handlers.ts)
- useAppStore.ts deleted
- 行为 byte-identical 预期

### T6.17 · Dogfood 1 day (V1-V10 + 7 cluster — 见 §5)

---

## 4. Risk register

| ID | Risk | Mitigation | Severity |
|---|---|---|---|
| **R1** | **hydrateApp ordering regression** —— useSessionsStore.hydrate 必须在 setScreen("onboarding") 早 return 之前完成（否则首次启动 onboarding 期间 sidebar 显空 / hydrate 跑半段）；同时 warmupLLMList 必须在 gaConfig 设置后才能 spawn `__warmup__` bridge | T6.7 sequencing **逐行 mirror** useAppStore.hydrateFromDB 当前顺序（1-12）；V5 / V6 dogfood gate 验证 fresh-install 路径 + returning-user 路径 | **High** |
| **R2** | **Onboarding.useExternalPython 订阅 selector path 改变** —— useExternalPython 是 useEffect deps（line 183），swap 后 Zustand subscription 必须保持 reference stable，否则 useEffect 每次 prefs 变都 re-run 健康检查 | useAppStore selector → usePrefsStore selector 都是 `(s) => s.gaConfig.useExternalPython`，路径长度不变（field path），Zustand 行为 byte-identical；effect deps 数组保留 `useExternalPython` 项 | **Low** |
| **R3** | **setGAConfig fan-out 漏 step** —— python alias resolve + patchRuntimeInfo + resetWarmup + setPref + pushToast + warmupLLMList 6 step 必须保留；Settings → Runtime 改 GA path 后任一 step 漏掉行为退化 | T6.2 verbatim 搬代码；V7 dogfood 验证完整 fan-out（toast 出现 + RuntimeInfo 卡片刷新 + warmup 真 spawn 新 bridge） | **Medium** |
| **R4** | **setYoloMode 遍历 byId 顺序未定** —— 多 alive bridge 期间不同顺序 sendIPCCommand 不应有 race；当前实现是 sequential await，M6 保留 | T6.3 verbatim 搬；V8 dogfood 验证 multi-session 期间 toggle YOLO，所有 bridge 都收到 set_yolo_mode 命令 | **Low** |
| **R5** | **dispatchIPCEvent 删 store param** 后所有 caller 必须同步改；漏一处 = TS strict mode error | TS strict mode 编译捕获（runtime.ts:496 是唯一 caller，必改）；V1 gate | **Low** |
| **R6** | **DevTools `__store` 用户习惯断裂** —— JC 大概率有 console muscle memory 输入 `__store.getState()` 看 ga config | (a) M6 内同步 expose `__prefs` —— `__prefs.getState().gaConfig` 是同价值替代 (b) 单独写 README / devlog 一行提醒 (c) 不阻塞 ship | **Low** |
| **R7** | **seedMockSessions forward shim 删后 DevTools 路径变更** —— `__store.getState().seedMockSessions()` 不再工作 | seedMockSessions 当前在 sessionsStore (M4b)；M6 后用户输入 `__sessions.getState().seedMockSessions()` 等价；R6 同 mitigation | **Low** |
| **R8** | **cachedLLMs hydrate 放 lib/hydrate.ts** vs prefsStore 选择 —— hydrateApp 内直接 `getPref<LLMOption[]>("llm_list")` + `seedCachedLLMs` 是跨 module 跨 slice 协调，是否更应该让 runtimeStore 自己有个 `hydrateLLMCache` action？ | M6 内**保持 lib/hydrate.ts 内做**（简化 prefsStore 边界）；如 M7 acceptance 走通发现 runtimeStore 接 hydrateLLMCache 更清，可独立 small follow-up commit refactor。本 sub-plan **不**预设 follow-up | **Low** |
| **R9** | **B3-I3 "no double-track" 违反风险** —— 实施期间 useAppStore.ts 短暂存在但 prefs 字段被 prefsStore 持有，commit 内必须**同时**删 useAppStore.ts —— 单 commit 自然守住 | single commit 决策已守（§2.2）；V3 grep gate 阻止 | **Low** |
| **R10** | **conversationWidth 当前没在 dogfood scenarios 任何 cluster 出现** —— v0.1 ship 后用户使用率未观测 | 加 cluster 6 (conversationWidth 切换 + 持久化跨重启) 到 V10 / dogfood scenarios。本身行为简单 setPref + setState，**Low** | **Low** |

---

## 5. Verification gates

### V1 · TypeScript / lint
- `cd gui && pnpm typecheck` — 0 error
- `cd gui && pnpm lint` — 0 warning

### V2 · Rust no regression
- `cd core && cargo check` + `cargo test` 全过（B3-I4 守，不应受影响）

### V3 · grep no leakage
- `grep -rn "useAppStore" gui/src/` — **0**（含 comments 在内的 leftover 提示 follow-up）
- `grep -rn "stores/useAppStore" gui/src/` — **0**
- `grep -rn "TRANSITIONAL (M6" gui/src/` — **0**
- `ls gui/src/stores/useAppStore.ts` — file does not exist

### V4 · Cross-store stub 清完
- runtime.ts 内不再 import useAppStore
- sessions.ts 内无 dynamic import useAppStore
- ipc-handlers.ts 内无 typeof useAppStore
- Onboarding.tsx 内无 useAppStore import

### V5 · 第一次启动 (fresh install)
1. 删除 sqlite `~/Library/Application Support/app.galley/galley.db`（或备份）
2. 起 `pnpm tauri dev`
3. 应进 Onboarding 而非 main
4. 完成 onboarding（pick gaPath） → main empty state → 设 prefs

### V6 · 重启 (returning user)
1. V5 完成后立即重启 app
2. 应直接进 main empty state（gaConfig 已存在）
3. console 应见 `[hydrate] FTS backfilled N` 或 `[hydrate] pruned ...` 之一（如有清理）
4. LLM warmup 应在 hydrate 完成后 fire（看 `__warmup__` bridge spawn / console `[warmup]` 日志）
5. 第二次以后 launch warmup 应**不再** spawn 新 bridge（warmup completion flag 持久化）

### V7 · setGAConfig 全 fan-out
1. Settings → Runtime → 改 GA path (legit 另一 GA repo)
2. 应弹 toast「已保存路径配置 / 重启 Galley 才能让现有对话生效」
3. RuntimeInfo 卡片应即时显示新 gaPath + Python display
4. console 应见新 `__warmup__` bridge spawn（warmup retrigger）
5. 重启 app → 新 path 持久化 ✓

### V8 · setYoloMode broadcast
1. 起 3 个 session（让 3 个 bridge alive）
2. Settings → 关 YOLO → 3 个 bridge stderr/console 应都见 `set_yolo_mode: false` IPC 命令
3. 再开 YOLO → 3 个 bridge 都见 `set_yolo_mode: true`

### V9 · acknowledgeYoloIntro flow
1. 删 sqlite pref `yolo_intro_seen`（或全 wipe + 重 onboard）
2. cold start → YoloIntroDialog 弹（应只第一次）
3. 点「改回审批模式」 → YOLO off + yoloIntroSeen=true 持久化
4. 重启 app → modal 不再弹 + YOLO 仍 off ✓

### V10 · conversationWidth 持久化
1. Settings → 切 conversationWidth 到 wide
2. Conversation 区域立即变 1400px max-width
3. 重启 app → 仍是 wide ✓
4. 切回 compact → 重启 → 仍是 compact ✓

---

## 6. Dogfood scenarios (M6 启动门 + ship 后 1 天)

### Cluster 1 · Cold start
- [ ] Fresh install（删 db）→ Onboarding screen 路由
- [ ] 完成 onboarding → main empty state
- [ ] Returning user（gaConfig 已存）→ main empty state，console 看 hydrate 完整顺序

### Cluster 2 · Prefs persistence across launches
- [ ] yoloMode toggle → 持久化
- [ ] conversationWidth toggle → 持久化
- [ ] approvalConfig.requiredTools 改动 → in-memory only（per 当前 v0.1 决策，不阻塞 M6）

### Cluster 3 · setGAConfig fan-out
- [ ] Settings → Runtime → swap gaPath → toast + warmup retrigger + RuntimeInfo 卡片刷新
- [ ] Settings → Runtime → swap python → toast + warmup retrigger
- [ ] Settings → Runtime → toggle useExternalPython → onboarding revisit health check 行为变化

### Cluster 4 · setYoloMode broadcast
- [ ] 3 alive bridge 期间 toggle YOLO → 3 bridge 全收 IPC
- [ ] YOLO on 下发 message → tool 直跑无审批
- [ ] YOLO off 下发 message → ApprovalCard 弹出

### Cluster 5 · YoloIntroDialog 一次性
- [ ] Fresh user → modal 弹
- [ ] 点 CTA → modal 消失，pref persists
- [ ] 重启 → modal 不弹

### Cluster 6 · Approval rules editing (no-persist)
- [ ] Settings → 加 always-allow rule for `file_read` → SettingsApproval card 显示
- [ ] 不重启情况下 dispatch file_read → 应不弹审批（rule 生效）
- [ ] 重启 → rule 丢（per current v0.1 决策；不算 M6 regression）

### Cluster 7 · DevTools exposure (R6/R7)
- [ ] DevTools console: `__prefs.getState().gaConfig` 可读
- [ ] DevTools console: `__sessions.getState().sessions` 可读（如果 M6 内顺手加 expose）
- [ ] DevTools console: `__store` —— 应 `undefined` (V3 confirmation)

---

## 7. Transitional comments policy

**M6 是 B3 终点 milestone**。M6 内**禁止**留任何 `TRANSITIONAL` 注释。M6 ship 后所有 transitional 引用都应消失。

剩余 transitional checklist (M6 必须清):
- `runtime.ts:681-684` "TRANSITIONAL (M6 prefsStore)" → 清
- `useAppStore.ts:253-256` "TRANSITIONAL (M6 prefsStore)" → 整文件删
- `sessions.ts:534-538` "gaConfig lives in useAppStore until M6" → 改 static import + 删注释
- `runtime.ts:393-396` "M6 will move gaConfig" → 整段清

**M7 acceptance gate**：`grep -rn "TRANSITIONAL" gui/src/` 应**只剩** B3 范围外的注释（如有）。

---

## 8. Rejected alternatives

### Reject #1 · 拆 M6a (prefsStore 出生 + 字段迁移) + M6b (useAppStore.ts retire)
**理由**：违反 [B3-I3](./B3-store-slice.md#phase-invariants--b3-特有的硬规则) "同 capability 不并存"。M6a 后 useAppStore 持 hydrateFromDB + seedMockSessions forward shim 但 5 字段都搬走 = double-state-track. 5 字段在 M6a commit 之后到 prefsStore 同 commit 又删 useAppStore 的字段 = 必须 single commit。

### Reject #2 · 保留 useAppStore.ts 作 composition shim re-export prefsStore
**理由**：playbook T6.6 已写「**推荐删除**」+ [B3-I6](./B3-store-slice.md#phase-invariants--b3-特有的硬规则) "useAppStore @deprecated 不留"。组件 import 时见到两条 path 的 `gaConfig` 来源 = 永久 cognitive overhead。M6 是 last hop，不删就永远不删。

### Reject #3 · hydrate orchestrator 放 App.tsx mount effect 直接 inline
**理由**：(a) App.tsx 已经 ~880 行，hydrate logic 加进去推到 ~1000 行；(b) hydrate 是 pure function module（无 component scope），React 组件文件持有它违反 separation；(c) lib/hydrate.ts 让 sequencing 单元测试化（B4 / 之后可加 test）；(d) 跨 5 slice 协调放组件内反复 import 凌乱。

### Reject #4 · Rust 端加 `prefs-updated` event (per T6.3 原 playbook)
**理由**：(a) prefs 没 cross-process consumer —— CLI / supervisor 在 B3 内不接 prefs 写（只读 sessions）；(b) 违反 [B3-I4](./B3-store-slice.md#phase-invariants--b3-特有的硬规则) "B3 内不动 Rust 端"；(c) 等 B4 supervisor SOP / CLI feature-complete 时如真需要再加 event channel，加在 B4 设计内更诚实。

### Reject #5 · seedMockSessions forward shim 保留
**理由**：M6 后 useAppStore.ts 整文件删除 = forward shim 无家可归。DevTools 用户改用 `useSessionsStore.getState().seedMockSessions()`（同 `__sessions.getState().seedMockSessions()` 一行）—— 习惯成本 ≤ 30 秒。不为 30 秒习惯成本保留 dead artifact。

### Reject #6 · dispatchIPCEvent 保留 store param 改成 `typeof usePrefsStore`
**理由**：dispatchIPCEvent 内已经多 slice import（useMessagesStore / useRuntimeStore / useSessionsStore / useUiStore 都直 import），单独给 prefs 留个 param 是不对称。直 import `usePrefsStore` 跟其它 slice 统一。

### Reject #7 · cachedLLMs hydrate 搬 runtimeStore.hydrateRuntime action（R8 alternative）
**理由**：M6 实施时新建 runtimeStore.hydrateRuntime action 是 scope creep（runtimeStore 的 hydrate scope 当前 = 0 行 hydrate code，所有 runtime hydrate 都在 useAppStore.hydrateFromDB 内做）。M6 主线是 **prefsStore 出生 + useAppStore 死**，runtime hydrate refactor 是独立 axis —— 留 lib/hydrate.ts 顶层 orchestrator 简洁路径，B4 / 之后可独立 small commit refactor。

### Reject #8 · M6 内同步给所有 slice 加 DevTools exposure (`__sessions` / `__messages` / `__runtime` / `__ui`)
**理由**：M6 主线已经 +200 LOC（prefsStore + lib/hydrate.ts）+ 删 -465 LOC + 5 处 swap。多 slice DevTools exposure 是 polish work，无依赖 M6 scope —— 推 M7 acceptance 一并补或独立 follow-up commit。M6 commit 内只加 `__prefs` 一处（替换 `__store` 入口）。

---

## End of M6 sub-plan
