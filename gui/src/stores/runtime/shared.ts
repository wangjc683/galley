import type { StateCreator } from "zustand";

import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import { usePrefsStore } from "@/stores/prefs";

// The slice interfaces are imported type-only: the runtime import
// direction is strictly slice → shared, so this is erased and no
// runtime cycle exists.
import type { BridgeSlice } from "./bridge-slice";
import type { InfoSlice } from "./info-slice";
import type { LlmSlice } from "./llm-slice";

/**
 * LLM available in the bridge's GA-loaded mykey.py. Mirrors
 * `runner/ipc.py::ReadyEvent.availableLLMs` per-entry shape.
 */
export interface LLMOption {
  index: number;
  /** Raw runtime name when available. External GA uses this as stable key. */
  name?: string;
  /** Stable identity: managed model id or external GA raw LLM name. */
  key?: string;
  displayName: string;
  /** Managed runtime only. Omitted for user-owned external GA model lists. */
  providerDisplayName?: string;
  isCurrent: boolean;
}

/**
 * Bridge subprocess lifecycle status. runtimeStore owns the bridge
 * fields and the lifecycle they describe.
 */
export type BridgeStatus =
  | "idle"
  | "spawning"
  | "connected"
  | "closed"
  | "error";

/**
 * Per-session runtime slot. B3 M3a carried LLM fields only; M3b adds
 * `bridgeStatus / bridgeError / bridgePid`. The map is keyed by
 * sessionId; `ensureRuntime` guarantees an entry exists before any
 * read (so selectors can return `byId[activeId].llms` without `?.`
 * chains in the hot path).
 */
export interface PerSessionRuntime {
  llms: LLMOption[];
  llmDisplayName: string;
  bridgeStatus: BridgeStatus;
  bridgeError: string | null;
  bridgePid: number | null;
}

/**
 * Seed hints fed by `sessionsStore.setActiveSession` when lazy-creating
 * a runtime entry. Carry the session row's persisted `selectedLlm*`
 * fields so the pill renders correctly from t=0 — without these, the
 * picker flashes the cross-session hydrate-cached current LLM (or
 * DEFAULT_LLMS on first-ever startup) until bridge `ready` arrives.
 */
export interface RuntimeSeedHints {
  persistedIndex?: number;
  persistedKey?: string;
  persistedDisplayName?: string;
  /**
   * Cross-session hydrate cache; passed in by setActiveSession so
   * runtimeStore doesn't have to read sessionsStore for the
   * cached list. Used when `persistedIndex` is undefined.
   */
  cachedLLMs?: LLMOption[];
  cachedDisplayName?: string;
}

// ---------------- store composition ----------------

export type RuntimeStore = LlmSlice & BridgeSlice & InfoSlice;

/**
 * All slices share the full store's `(set, get)` — cross-domain writes
 * (bridge handlers patching `byId` LLM fields defaults, LRU eviction
 * calling `shutdownBridge`) stay ordinary `get()` calls, which is why
 * the split lives inside one `create()` rather than separate stores.
 */
export type RuntimeSliceCreator<T> = StateCreator<RuntimeStore, [], [], T>;

export function currentCopy() {
  return copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  );
}
