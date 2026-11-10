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
 *   - info-slice:   runtimeInfo
 */

import { createBridgeSlice } from "./runtime/bridge-slice";
import { createInfoSlice } from "./runtime/info-slice";
import { createLlmSlice } from "./runtime/llm-slice";
import type { RuntimeStore } from "./runtime/shared";

export type {
  BridgeStatus,
  LLMOption,
  PerSessionRuntime,
  RuntimeSeedHints,
  RuntimeStore,
} from "./runtime/shared";
export type { RunnerEnsureFailure } from "./runtime/bridge-slice";

export const useRuntimeStore = create<RuntimeStore>()((...a) => ({
  ...createLlmSlice(...a),
  ...createBridgeSlice(...a),
  ...createInfoSlice(...a),
}));
