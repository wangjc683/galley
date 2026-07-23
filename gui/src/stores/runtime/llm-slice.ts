import {
  spawnBridge as spawnBridgeProcess,
  type BridgeClient,
} from "@/lib/bridge";
import { setPref } from "@/lib/db";
import {
  DEFAULT_LLM_DISPLAY_NAME,
  DEFAULT_LLMS,
} from "@/stores/defaults";
import { usePrefsStore } from "@/stores/prefs";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

import {
  currentCopy,
  type BridgeStatus,
  type LLMOption,
  type PerSessionRuntime,
  type RuntimeSeedHints,
  type RuntimeSliceCreator,
} from "./shared";

export interface LlmSlice {
  byId: Record<string, PerSessionRuntime>;
  /**
   * Cross-session LLM list cache: populated by `hydrateFromDB` from
   * the `llm_list` pref (a snapshot from any prior bridge's `ready`
   * event), and refreshed on every `replaceLLMs` (since the freshly
   * arrived list is also a valid cross-session snapshot).
   *
   * Used as the seed pool for `ensureRuntime` when a new session is
   * activated and has no byId entry yet. Without this, the picker
   * would have to show DEFAULT_LLMS or wait for bridge ready — both
   * UX regressions captured in the M3a "pre-seed runtime" work.
   */
  cachedLLMs: LLMOption[];
  /**
   * Cross-session display-name companion to {@link LlmSlice.cachedLLMs}.
   * The "current" entry's displayName when the cached list was captured.
   * Falls back into seed when a session has no persisted choice.
   *
   * Seeded by `lib/hydrate.ts` from the `llm_list` pref at cold start.
   */
  cachedLLMDisplayName: string;
  /**
   * EmptyState's inline LLM picker stash. Consumed by
   * `sessionsStore.activateSession` when it spawns the bridge for a
   * fresh session with zero turns. Cleared after consumption so an
   * abandoned pick (user picked LLM then clicked an existing
   * session) doesn't leak into a later unrelated spawn.
   */
  pendingLLMIndex: number | undefined;
  /**
   * EmptyState approval-mode pre-pick — same lifecycle as
   * `pendingLLMIndex`: stashed because no session row exists yet,
   * consumed (and always cleared) by `sessionsStore.createSession`,
   * which writes it as the new session's override.
   */
  pendingApprovalMode: "auto" | "approval" | undefined;
  /**
   * Idempotence flag for `warmupLLMList` (one-shot bridge spawn at
   * launch to capture the GA mykey.py list before the first user
   * session). Reset by `prefsStore.setGAConfig` cross-store so
   * changing GA path re-runs warmup.
   */
  _warmupComplete: boolean;

  /**
   * Lazy-create or refresh the LLM-side of a session's runtime. Idempotent —
   * if `byId[sid]` already exists, the seed is ignored (existing values
   * win because they reflect the live bridge's authoritative state).
   * Called from `sessionsStore.setActiveSession`.
   */
  ensureRuntime: (sid: string, seed: RuntimeSeedHints) => void;
  /**
   * Apply the LLM list reported by a bridge's `ready` / `llm_changed`
   * event. Updates byId[sid], caches the list to `llm_list` pref, and
   * mirrors the user's selected LLM onto the session row in
   * sessionsStore (via `setSessionLlm`) for persistence across app
   * restart.
   */
  replaceLLMs: (sid: string, llms: LLMOption[]) => void;
  /**
   * EmptyState picker stash: pre-bridge LLM choice for the next new
   * session. Bumps `pendingLLMIndex` so activateSession can pass it
   * to `--llm-no` at spawn time.
   */
  selectLLMForNewSession: (index: number) => void;
  /**
   * Optimistically switch the visible LLM for an existing session.
   * Bridge `llm_changed` will later confirm the same state when a
   * live bridge is available.
   */
  selectLLMForSession: (sid: string, index: number) => void;
  /**
   * One-shot bridge spawn at app launch to capture the GA mykey.py
   * LLM list before any user session exists. Caches the list to prefs
   * and shuts the bridge down immediately. Idempotent via
   * `_warmupComplete`.
   */
  warmupLLMList: () => Promise<void>;
  /**
   * Cross-store: prefsStore.setGAConfig calls this when gaPath /
   * python changes so a future `warmupLLMList` re-runs against the
   * new install. A direct call is fine — prefs is the only writer
   * and the relationship is purely intra-process.
   */
  resetWarmup: () => void;
  /**
   * Seed the cross-session LLM cache. Called by `hydrateFromDB`
   * after loading the `llm_list` pref (latest snapshot from a prior
   * bridge spawn). Without this, the first activation in a new app
   * run would have no real LLM list to seed against and fall through
   * to DEFAULT_LLMS.
   */
  seedCachedLLMs: (list: LLMOption[]) => void;
}

/**
 * Build a fresh per-session runtime from seed hints. Centralised so
 * `ensureRuntime` and any future setters use identical semantics:
 *
 *   1. If the session has a persisted stable LLM key, re-flag `isCurrent`
 *      on the cached list to match it.
 *   2. Else if it only has the legacy persisted index, re-flag by index.
 *   3. Otherwise honour the cached list's own `isCurrent` (cross-
 *      session hydrate cache = whichever LLM was current last).
 *   4. If no cached list exists at all (first-ever cold start with
 *      no `llm_list` pref), fall through to DEFAULT_LLMS so the picker
 *      isn't empty during onboarding.
 */
function buildSeedRuntime(seed: RuntimeSeedHints): PerSessionRuntime {
  const cached = seed.cachedLLMs ?? [];
  const baseBridge = {
    bridgeStatus: "idle" as BridgeStatus,
    bridgeError: null,
    bridgePid: null,
  };
  if (cached.length === 0) {
    return {
      llms: DEFAULT_LLMS,
      llmDisplayName: DEFAULT_LLM_DISPLAY_NAME,
      ...baseBridge,
    };
  }
  const hasPersistedIndex =
    !seed.persistedKey &&
    seed.persistedIndex !== undefined &&
    cached.some((l) => l.index === seed.persistedIndex);
  const hasPersistedKey =
    seed.persistedKey !== undefined &&
    cached.some((l) => llmStableKey(l) === seed.persistedKey);
  const llms = hasPersistedKey
    ? cached.map((l) => ({
        ...l,
        isCurrent: llmStableKey(l) === seed.persistedKey,
      }))
    : hasPersistedIndex
      ? cached.map((l) => ({
          ...l,
          isCurrent: l.index === seed.persistedIndex,
        }))
      : cached;
  const llmDisplayName =
    seed.persistedDisplayName ??
    llms.find((l) => l.isCurrent)?.displayName ??
    seed.cachedDisplayName ??
    DEFAULT_LLM_DISPLAY_NAME;
  return { llms, llmDisplayName, ...baseBridge };
}

function selectLLMInList(
  list: LLMOption[],
  index: number,
): { llms: LLMOption[]; current: LLMOption } | null {
  const current = list.find((l) => l.index === index);
  if (!current) return null;
  return {
    current,
    llms: list.map((l) => ({
      ...l,
      isCurrent: l.index === index,
    })),
  };
}

function llmStableKey(llm: LLMOption): string {
  return llm.key ?? llm.name ?? llm.displayName;
}

// ---- Cross-store helpers ----
//
// Read-only or single-direction-write reaches into prefsStore /
// sessionsStore. Per AD-09 slice DAG, runtimeStore is allowed to
// depend on prefsStore (leaf-like) and sessionsStore for these
// specific paths.

function readGAConfigFromPrefs() {
  // Function name avoids the `use*` prefix so eslint-plugin-react-hooks
  // doesn't classify it as a hook call inside non-component code.
  return usePrefsStore.getState().gaConfig;
}

async function mirrorSelectedLLMOnSession(sid: string, current: LLMOption) {
  // Route through sessionsStore.setSessionLlm which invokes the
  // Rust `set_session_llm` trait method. The store action mutates the
  // in-memory row + fires the invoke; we don't have to round-trip a
  // separate persistSession call.
  await useSessionsStore
    .getState()
    .setSessionLlm(
      sid,
      current.index,
      llmStableKey(current),
      current.displayName,
    );
}

function maybeToastMissingSelectedLLM(
  sid: string,
  llms: LLMOption[],
  current: LLMOption,
) {
  const session = useSessionsStore
    .getState()
    .sessions.find((s) => s.id === sid);
  const expectedKey = session?.selectedLlmKey;
  if (!expectedKey) return;
  const expectedStillExists = llms.some(
    (llm) => llmStableKey(llm) === expectedKey,
  );
  if (expectedStillExists || llmStableKey(current) === expectedKey) return;
  const copy = currentCopy();
  useUiStore.getState().pushToast(
    makeAppError({
      id: `llm-selection-fallback-${sid}`,
      category: "business",
      severity: "info",
      title: copy.toasts.modelSelectionChanged,
      message: copy.toasts.modelSelectionChangedMessage,
      hint: null,
      retryable: false,
      context: "replace_llms",
      traceback: null,
    }),
  );
}

function shouldCacheLLMListForSession(sid: string): boolean {
  if (sid === "__warmup__") return true;
  const session = useSessionsStore
    .getState()
    .sessions.find((candidate) => candidate.id === sid);
  return session?.gaRuntimeKind === "external";
}

export const createLlmSlice: RuntimeSliceCreator<LlmSlice> = (set, get) => ({
  byId: {},
  cachedLLMs: [],
  cachedLLMDisplayName: "",
  pendingLLMIndex: undefined,
  pendingApprovalMode: undefined,
  _warmupComplete: false,

  ensureRuntime: (sid, seed) =>
    set((state) =>
      state.byId[sid]
        ? {}
        : { byId: { ...state.byId, [sid]: buildSeedRuntime(seed) } },
    ),

  replaceLLMs: (sid, llms) => {
    const current = llms.find((l) => l.isCurrent);
    const shouldCache = shouldCacheLLMListForSession(sid);
    set((state) => {
      const existing = state.byId[sid];
      const next: PerSessionRuntime = {
        llms,
        // displayName follows isCurrent. If for some reason no entry
        // is flagged current, keep the previous displayName to avoid
        // a flash of empty string in the Composer.
        llmDisplayName: current?.displayName ?? existing?.llmDisplayName ?? "",
        bridgeStatus: existing?.bridgeStatus ?? "idle",
        bridgeError: existing?.bridgeError ?? null,
        bridgePid: existing?.bridgePid ?? null,
      };
      // Refresh the cross-session cache too — the freshly arrived
      // list is also a valid snapshot for any future un-seeded
      // session activation.
      return {
        byId: { ...state.byId, [sid]: next },
        cachedLLMs: shouldCache ? llms : state.cachedLLMs,
        cachedLLMDisplayName: shouldCache
          ? (current?.displayName ?? state.cachedLLMDisplayName)
          : state.cachedLLMDisplayName,
      };
    });
    // Cache external GA's LLM list to prefs so future cold-starts (before any
    // bridge has spawned) can show the real model names instead
    // of the DEFAULT_LLMS seed. Managed model options come from
    // Galley's model store instead; caching them here would leak one
    // runtime's model list into the other runtime's empty state.
    if (shouldCache) {
      void setPref("llm_list", llms).catch((e) => {
        console.debug("[runtime] replaceLLMs llm_list cache failed.", e);
      });
    }
    // Mirror the user's current LLM onto the session row via
    // sessionsStore.setSessionLlm so the choice survives app
    // restart (routes through the Rust `set_session_llm` trait
    // method for SQLite persistence).
    if (current) {
      maybeToastMissingSelectedLLM(sid, llms, current);
      void mirrorSelectedLLMOnSession(sid, current).catch((e) => {
        console.debug("[runtime] replaceLLMs session mirror failed.", e);
      });
    }
  },

  selectLLMForNewSession: (index) =>
    set((state) => {
      if (usePrefsStore.getState().activeRuntimeKind === "managed") {
        return { pendingLLMIndex: index };
      }
      // EmptyState has no session runtime yet, so its Composer reads
      // the cross-session cache. Flip that cache immediately for UI
      // feedback; activateSession later consumes pendingLLMIndex and
      // passes it to the fresh bridge as `--llm-no`.
      const selected = selectLLMInList(
        state.cachedLLMs.length > 0 ? state.cachedLLMs : DEFAULT_LLMS,
        index,
      );
      if (!selected) return { pendingLLMIndex: index };
      return {
        cachedLLMs: selected.llms,
        cachedLLMDisplayName: selected.current.displayName,
        pendingLLMIndex: selected.current.index,
      };
    }),

  selectLLMForSession: (sid, index) => {
    let picked: LLMOption | null = null;
    set((state) => {
      const existing = state.byId[sid];
      const shouldCache = shouldCacheLLMListForSession(sid);
      const selected = selectLLMInList(
        existing?.llms?.length
          ? existing.llms
          : state.cachedLLMs.length > 0
            ? state.cachedLLMs
            : DEFAULT_LLMS,
        index,
      );
      if (!selected) return {};
      picked = selected.current;
      const next: PerSessionRuntime = {
        llms: selected.llms,
        llmDisplayName: selected.current.displayName,
        bridgeStatus: existing?.bridgeStatus ?? "idle",
        bridgeError: existing?.bridgeError ?? null,
        bridgePid: existing?.bridgePid ?? null,
      };
      return {
        byId: { ...state.byId, [sid]: next },
        cachedLLMs: shouldCache ? selected.llms : state.cachedLLMs,
        cachedLLMDisplayName: shouldCache
          ? selected.current.displayName
          : state.cachedLLMDisplayName,
      };
    });
    if (picked) {
      void mirrorSelectedLLMOnSession(sid, picked).catch((e) => {
        console.debug("[runtime] selectLLMForSession mirror failed.", e);
      });
    }
  },

  warmupLLMList: async () => {
    if (get()._warmupComplete) return;
    // Read the GA config from prefsStore. Cross-store read is allowed
    // per AD-09 DAG (runtimeStore depends on prefsStore for gaConfig).
    const config = readGAConfigFromPrefs();
    if (!config.gaPath) return;
    set({ _warmupComplete: true });

    let client: BridgeClient | null = null;
    let pendingShutdown = false;
    let readyHandled = false;

    try {
      client = await spawnBridgeProcess(
        { ...config, sessionId: "__warmup__" },
        {
          onEvent: (event) => {
            if (event.kind !== "ready" || readyHandled) return;
            readyHandled = true;
            const llms: LLMOption[] = event.availableLLMs.map((l) => ({
              index: l.index,
              name: l.name,
              key: l.name,
              displayName: l.displayName,
              isCurrent: l.isCurrent,
            }));
            // Warmup populates EVERY future-existing session's seed
            // through the `llm_list` pref hydrate path. We don't
            // populate byId here because warmup runs before any
            // session is active — there's no sid to key by.
            void setPref("llm_list", llms).catch((e) => {
              console.debug("[warmup] llm_list cache failed.", e);
            });
            if (client) {
              void client.shutdown(5000);
            } else {
              pendingShutdown = true;
            }
          },
          onStderr: (line) => console.debug("[warmup stderr]", line),
          onClose: () => console.debug("[warmup] closed"),
          onError: (msg) => console.warn("[warmup] error:", msg),
        },
      );
      if (pendingShutdown) {
        void client.shutdown(5000);
      }
      setTimeout(() => {
        if (!readyHandled && client) {
          console.warn("[warmup] ready timeout, shutting down");
          void client.shutdown(5000);
        }
      }, 15000);
    } catch (e) {
      console.warn("[runtime] warmupLLMList spawn failed:", e);
      set({ _warmupComplete: false });
    }
  },

  resetWarmup: () => set({ _warmupComplete: false }),

  seedCachedLLMs: (list) => {
    const current = list.find((l) => l.isCurrent);
    set({
      cachedLLMs: list,
      cachedLLMDisplayName: current?.displayName ?? "",
    });
  },
});
