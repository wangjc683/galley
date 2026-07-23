import { create } from "zustand";

/**
 * runtimeStore — per-session bridge + LLM runtime state (B3 M3a/M3b).
 *
 * The store body lives in `runtime/` as three StateCreator slices
 * sharing one `create()` — cross-domain writes (bridge handlers
 * patching `byId`, LRU eviction calling `shutdownBridge`) keep working
 * through the shared `(set, get)`:
 *   - llm-slice:    `byId` LLM projection + cross-session cache +
 *                   pending EmptyState pre-picks + warmup
 *   - bridge-slice: subprocess lifecycle (spawn/attach/shutdown/IPC)
 *                   plus the module-private client handles + LRU
 *   - info-slice:   runtimeInfo + desktop-pet attachment
 */

import { createBridgeSlice } from "./runtime/bridge-slice";
import { createInfoSlice } from "./runtime/info-slice";
import { createLlmSlice } from "./runtime/llm-slice";
import type { RuntimeStore } from "./runtime/shared";
import { useSessionsStore } from "@/stores/sessions";

export type {
  BridgeStatus,
  LLMOption,
  PerSessionRuntime,
  RuntimeSeedHints,
  RuntimeStore,
} from "./runtime/shared";

export const useRuntimeStore = create<RuntimeStore>()((...a) => ({
  ...createLlmSlice(...a),
  ...createBridgeSlice(...a),
  ...createInfoSlice(...a),
}));

/**
 * Convenience: read the currently active session's per-runtime entry.
 * Stable identity — Zustand returns the same reference until the
 * underlying byId map's keyed value changes.
 *
 * Reads `activeSessionId` from sessionsStore (M4b owner). Components
 * preferring slice subscribers should use
 * `useSessionsStore(s => s.activeSessionId)` + an explicit
 * `useRuntimeStore(...)` selector rather than calling this helper —
 * it's a getState-time read meant for non-render code paths.
 */
export function getActiveRuntime() {
  const activeId = useSessionsStore.getState().activeSessionId;
  if (!activeId) return undefined;
  return useRuntimeStore.getState().byId[activeId];
}
