import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import {
  attachBridge as attachBridgeProcess,
  spawnBridge as spawnBridgeProcess,
  type BridgeClient,
  type BridgeSpawnArgs,
  type BridgeHandlers,
} from "@/lib/bridge";
import { setPref } from "@/lib/db";
import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import { clearReplyNotifyPending } from "@/lib/notify";
import { logPerf, perfNow } from "@/lib/perf";
import {
  DEFAULT_LLM_DISPLAY_NAME,
  DEFAULT_LLMS,
  DEFAULT_RUNTIME_INFO,
} from "@/stores/defaults";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { RuntimeInfo } from "@/types/inspector";
import type { IPCCommand } from "@/types/ipc";

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

interface RuntimeState {
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
   * Cross-session display-name companion to {@link cachedLLMs}. The
   * "current" entry's displayName when the cached list was captured.
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
   * Which session currently holds the desktop pet subprocess. Global
   * because the pet is single-instance (one OS-level port). Cleared
   * by `pet_detached` IPC; set by `pet_attached` IPC + this action.
   */
  petAttachedSessionId: string | null;
  runtimeInfo: RuntimeInfo;
  /**
   * Idempotence flag for `warmupLLMList` (one-shot bridge spawn at
   * launch to capture the GA mykey.py list before the first user
   * session). Reset by `prefsStore.setGAConfig` cross-store so
   * changing GA path re-runs warmup.
   */
  _warmupComplete: boolean;
}

interface RuntimeActions {
  /**
   * Lazy-create or refresh the LLM-side of a session's runtime. Idempotent —
   * if `byId[sid]` already exists, the seed is ignored (existing values
   * win because they reflect the live bridge's authoritative state).
   * Called from `sessionsStore.setActiveSession`.
   */
  ensureRuntime: (sid: string, seed: RuntimeSeedHints) => void;
  /** Set bridge status. Used by ipc-handlers ready event. */
  setBridgeStatus: (sid: string, status: BridgeStatus) => void;
  /**
   * Spawn a GA bridge subprocess for `args.sessionId`. If that session
   * already has a live bridge, shut it down first. LRU eviction
   * enforced inside this action via the runtime-private
   * `_bridgeClients` / `_lruOrder` maps (LRU_CAP = 20 active bridges).
   */
  spawnBridge: (args: BridgeSpawnArgs) => Promise<void>;
  /**
   * Attach JS listeners to a runner spawned by the socket transport
   * (`galley session new`). The process already exists in Rust; this
   * action just registers event handlers and tracks the client locally.
   */
  attachExternalBridge: (sessionId: string, pid: number) => Promise<void>;
  /** Graceful shutdown. No-op if no bridge alive for `sid`. */
  shutdownBridge: (sid: string) => Promise<void>;
  /** Send an IPC command to `sid`'s bridge over stdin. User-turn commands
   * fail loudly when no live bridge is available; quiet background sync
   * commands remain best-effort. */
  sendIPCCommand: (sid: string, cmd: IPCCommand) => Promise<void>;
  /** True only when this JS runtime has a live client/listener handle. */
  hasBridgeClient: (sid: string) => boolean;
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
  setPetAttachedSession: (sid: string | null) => void;
  patchRuntimeInfo: (patch: Partial<RuntimeInfo>) => void;
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

export type RuntimeStore = RuntimeState & RuntimeActions;

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
// ---- Module-level bridge resources (private to runtime slice) ----
//
// Runtime-internal state: bridge process handles + stderr buffers +
// LRU ordering. Not exported — outside callers go through the
// actions below.
//
// Why module-level (not Zustand state):
// - The `BridgeClient` value carries a tokio handle to a Tauri-side
//   listener; not serialisable (Zustand's preferred shape).
// - `_stderrTails` is pure diagnostic, no rendering reacts.
// - LRU ordering is mutated frequently; keeping it out of Zustand
//   avoids triggering subscribers on every spawn/touch.

const _bridgeClients = new Map<string, BridgeClient>();
const _stderrTails = new Map<string, string[]>();
const _bridgeSpawnStartedAt = new Map<string, number>();
const _STDERR_TAIL_MAX = 8;
const _lruOrder: string[] = [];
const LRU_CAP = 20;
const BRIDGE_CLIENT_WAIT_MS = 15_000;
const CONNECTED_CLIENT_WAIT_MS = 1_000;
const BRIDGE_READY_WAIT_MS = 30_000;

function currentCopy() {
  return copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function _lruTouch(sessionId: string): void {
  const idx = _lruOrder.indexOf(sessionId);
  if (idx !== -1) _lruOrder.splice(idx, 1);
  _lruOrder.push(sessionId);
}

function _lruRemove(sessionId: string): void {
  const idx = _lruOrder.indexOf(sessionId);
  if (idx !== -1) _lruOrder.splice(idx, 1);
}

async function _waitForBridgeClient(
  sessionId: string,
  timeoutMs: number = BRIDGE_CLIENT_WAIT_MS,
): Promise<BridgeClient | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const client = _bridgeClients.get(sessionId);
    if (client) return client;
    const status =
      useRuntimeStore.getState().byId[sessionId]?.bridgeStatus ?? "idle";
    if (status !== "spawning" && status !== "connected") return undefined;
    await sleep(50);
  }
  return _bridgeClients.get(sessionId);
}

async function _waitForBridgeReady(
  sessionId: string,
  timeoutMs: number = BRIDGE_READY_WAIT_MS,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status =
      useRuntimeStore.getState().byId[sessionId]?.bridgeStatus ?? "idle";
    if (status === "connected" && _bridgeClients.has(sessionId)) {
      return true;
    }
    if (status === "idle" || status === "closed" || status === "error") {
      return false;
    }
    await sleep(50);
  }
  return (
    (useRuntimeStore.getState().byId[sessionId]?.bridgeStatus ?? "idle") ===
      "connected" && _bridgeClients.has(sessionId)
  );
}

async function bridgeStartupTimeoutMessage(sessionId: string): Promise<string> {
  const base = currentCopy().app.bridgeStartupTimeout;
  try {
    const tail: string[] = await invoke("runner_stderr_tail", { sessionId });
    if (tail.length === 0) return base;
    return `${base}\n${tail.slice(-3).join("\n")}`;
  } catch {
    return base;
  }
}

function missingBridgeMessage(
  status: BridgeStatus,
  bridgeError: string | null,
): string {
  if (bridgeError) return bridgeError;
  switch (status) {
    case "spawning":
      return "Galley 运行时还没有启动完成，请稍后重试。";
    case "error":
      return "Galley 运行时启动失败。";
    case "closed":
      return "Galley 运行时已关闭，请重新发送这条消息。";
    default:
      return "Galley 运行时未启动，请重新发送这条消息。";
  }
}

function actionableBridgeCrashMessage(message: string): string {
  if (!/mykey\.py.*failed to import/i.test(message)) return message;
  const moduleName =
    message.match(/No module named ['"]([^'"]+)['"]/)?.[1] ?? null;
  return currentCopy().errors.externalMyKeyImportFailed(moduleName);
}

function shouldFailWhenBridgeMissing(cmd: IPCCommand): boolean {
  // approval_response and abort are direct user actions on a live run:
  // silently dropping them leaves the UI showing a state (decided /
  // stopping) the bridge never heard about. They must reject so the
  // caller can roll back and tell the user.
  return (
    cmd.kind === "user_message" ||
    cmd.kind === "ask_user_response" ||
    cmd.kind === "approval_response" ||
    cmd.kind === "abort"
  );
}

async function _enforceLRUCap(): Promise<void> {
  while (_lruOrder.length > LRU_CAP) {
    // `agentRunning` lives in messagesStore (B3 M5). Active-running
    // bridges are protected from eviction so we don't kill a streaming
    // agent the user just walked away from.
    const messagesState = useMessagesStore.getState();
    const activeId = useSessionsStore.getState().activeSessionId;
    const victim = _lruOrder.find(
      (id) => id !== activeId && !messagesState.byId[id]?.agentRunning,
    );
    if (!victim) {
      console.info(
        `[lru] no eviction candidate (cap=${LRU_CAP}, alive=${_lruOrder.length}); all alive bridges are active or running`,
      );
      return;
    }
    try {
      await useRuntimeStore.getState().shutdownBridge(victim);
    } catch (e) {
      console.warn(`[lru] shutdown of ${victim} failed:`, e);
      _lruRemove(victim); // force-unblock even if shutdown threw
    }
  }
}

function _bridgeFieldsUpdate(
  rt: PerSessionRuntime | undefined,
  patch: Partial<
    Pick<PerSessionRuntime, "bridgeStatus" | "bridgeError" | "bridgePid">
  >,
): PerSessionRuntime {
  return {
    llms: rt?.llms ?? DEFAULT_LLMS,
    llmDisplayName: rt?.llmDisplayName ?? DEFAULT_LLM_DISPLAY_NAME,
    bridgeStatus: patch.bridgeStatus ?? rt?.bridgeStatus ?? "idle",
    bridgeError:
      patch.bridgeError !== undefined
        ? patch.bridgeError
        : (rt?.bridgeError ?? null),
    bridgePid:
      patch.bridgePid !== undefined ? patch.bridgePid : (rt?.bridgePid ?? null),
  };
}

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

function makeBridgeHandlers(sessionId: string): BridgeHandlers {
  const copy = currentCopy();
  return {
    onEvent: (event) => dispatchIPCEvent(event),
    onStderr: (line) => {
      console.warn(`[bridge ${sessionId} stderr]`, line);
      const buf = _stderrTails.get(sessionId) ?? [];
      buf.push(line);
      if (buf.length > _STDERR_TAIL_MAX) buf.shift();
      _stderrTails.set(sessionId, buf);
    },
    onClose: (code, signal) => {
      console.info(`[bridge ${sessionId}] closed`, { code, signal });
      const abnormalClose = code !== 0;
      const tail = abnormalClose ? (_stderrTails.get(sessionId) ?? []) : [];
      const rawMessage = tail.length
        ? tail.slice(-3).join("\n")
        : code === null
          ? "Galley 运行时意外退出，未返回退出码。"
          : `Bridge exited with code ${code}`;
      const message = abnormalClose
        ? actionableBridgeCrashMessage(rawMessage)
        : rawMessage;
      if (abnormalClose) {
        useUiStore.getState().pushToast(
          makeAppError({
            category: "bridge",
            severity: "error",
            title: copy.errors.bridgeCrashed,
            message,
            hint: null,
            retryable: false,
            context: `session ${sessionId}`,
            traceback: tail.join("\n"),
          }),
        );
      }
      _stderrTails.delete(sessionId);
      _bridgeClients.delete(sessionId);
      _bridgeSpawnStartedAt.delete(sessionId);
      _lruRemove(sessionId);
      useRuntimeStore.setState((state) => ({
        byId: {
          ...state.byId,
          [sessionId]: _bridgeFieldsUpdate(state.byId[sessionId], {
            bridgeStatus: abnormalClose ? "error" : "closed",
            bridgeError: abnormalClose ? message : null,
            bridgePid: null,
          }),
        },
      }));
      useMessagesStore.getState().clearStreamingOnBridgeClose(sessionId);
      // This bridge can emit no further turn_end — a pending
      // reply-notify flag is unfulfillable now and must not survive
      // into the session's next (possibly non-GUI-driven) run.
      clearReplyNotifyPending(sessionId);
    },
    onError: (msg) => {
      console.error(`[bridge ${sessionId}] error`, msg);
      useRuntimeStore.setState((state) => ({
        byId: {
          ...state.byId,
          [sessionId]: _bridgeFieldsUpdate(state.byId[sessionId], {
            bridgeStatus: "error",
            bridgeError: msg,
          }),
        },
      }));
      useUiStore.getState().pushToast(
        makeAppError({
          category: "bridge",
          severity: "error",
          title: copy.errors.bridgeFailed,
          message: msg,
          hint: null,
          retryable: false,
          context: `session ${sessionId}`,
          traceback: null,
        }),
      );
    },
    onMalformedLine: (line) =>
      console.warn(`[bridge ${sessionId}] malformed stdout line:`, line),
  };
}

export const useRuntimeStore = create<RuntimeStore>((set, get) => ({
  byId: {},
  cachedLLMs: [],
  cachedLLMDisplayName: "",
  pendingLLMIndex: undefined,
  pendingApprovalMode: undefined,
  petAttachedSessionId: null,
  runtimeInfo: DEFAULT_RUNTIME_INFO,
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

  setPetAttachedSession: (sid) => set({ petAttachedSessionId: sid }),

  setBridgeStatus: (sid, status) => {
    if (status === "connected") {
      const startedAt = _bridgeSpawnStartedAt.get(sid);
      if (startedAt !== undefined) {
        logPerf("runtime.bridgeReady", startedAt, { sessionId: sid });
        _bridgeSpawnStartedAt.delete(sid);
      }
    }
    set((state) => ({
      byId: {
        ...state.byId,
        [sid]: _bridgeFieldsUpdate(state.byId[sid], { bridgeStatus: status }),
      },
    }));
  },

  spawnBridge: async (args) => {
    const sessionId = args.sessionId;
    let spawnStartedAt = perfNow();
    if (_bridgeClients.has(sessionId)) {
      console.warn(
        `[runtime] spawnBridge(${sessionId}) called while a bridge for that session is alive; shutting down first.`,
      );
      await useRuntimeStore.getState().shutdownBridge(sessionId);
      spawnStartedAt = perfNow();
    }
    _bridgeSpawnStartedAt.set(sessionId, spawnStartedAt);
    set((state) => ({
      byId: {
        ...state.byId,
        [sessionId]: _bridgeFieldsUpdate(state.byId[sessionId], {
          bridgeStatus: "spawning",
          bridgeError: null,
        }),
      },
    }));

    try {
      const processStartedAt = perfNow();
      const client = await spawnBridgeProcess(
        args,
        makeBridgeHandlers(sessionId),
      );
      logPerf("runtime.spawnBridge.process", processStartedAt, {
        sessionId,
        pid: client.pid,
      });
      _bridgeClients.set(sessionId, client);
      _lruTouch(sessionId);
      // Status flips to "connected" only after the bridge sends its
      // `ready` event (handled in ipc-handlers). Keep "spawning"
      // here so the UI knows to show a loading affordance.
      set((state) => ({
        byId: {
          ...state.byId,
          [sessionId]: _bridgeFieldsUpdate(state.byId[sessionId], {
            bridgePid: client.pid,
          }),
        },
      }));
      void _enforceLRUCap();
      logPerf("runtime.spawnBridge", spawnStartedAt, {
        sessionId,
        pid: client.pid,
        result: "spawned",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      _bridgeClients.delete(sessionId);
      _bridgeSpawnStartedAt.delete(sessionId);
      set((state) => ({
        byId: {
          ...state.byId,
          [sessionId]: _bridgeFieldsUpdate(state.byId[sessionId], {
            bridgeStatus: "error",
            bridgeError: msg,
            bridgePid: null,
          }),
        },
      }));
      logPerf("runtime.spawnBridge", spawnStartedAt, {
        sessionId,
        result: "failed",
      });
    }
  },

  attachExternalBridge: async (sessionId, pid) => {
    if (_bridgeClients.has(sessionId)) {
      return;
    }
    try {
      const client = await attachBridgeProcess(
        sessionId,
        pid,
        makeBridgeHandlers(sessionId),
      );
      _bridgeClients.set(sessionId, client);
      _lruTouch(sessionId);
      set((state) => ({
        byId: {
          ...state.byId,
          [sessionId]: _bridgeFieldsUpdate(state.byId[sessionId], {
            bridgeStatus: "connected",
            bridgeError: null,
            bridgePid: pid,
          }),
        },
      }));
      void _enforceLRUCap();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set((state) => ({
        byId: {
          ...state.byId,
          [sessionId]: _bridgeFieldsUpdate(state.byId[sessionId], {
            bridgeStatus: "error",
            bridgeError: msg,
            bridgePid: null,
          }),
        },
      }));
    }
  },

  shutdownBridge: async (sessionId) => {
    const client = _bridgeClients.get(sessionId);
    try {
      if (client) {
        await client.shutdown();
      } else {
        await invoke("shutdown_runner", {
          sessionId,
          timeoutMs: 3000,
        }).catch(() => {
          // Already gone or owned by a previous dev-HMR listener.
        });
      }
    } finally {
      _bridgeClients.delete(sessionId);
      _bridgeSpawnStartedAt.delete(sessionId);
      _lruRemove(sessionId);
      set((state) => ({
        byId: {
          ...state.byId,
          [sessionId]: _bridgeFieldsUpdate(state.byId[sessionId], {
            bridgeStatus: "closed",
            bridgePid: null,
          }),
        },
      }));
    }
  },

  sendIPCCommand: async (sessionId, cmd) => {
    const sendStartedAt = perfNow();
    const userVisibleCommand = shouldFailWhenBridgeMissing(cmd);
    let client = _bridgeClients.get(sessionId);
    let clientWaitMs = 0;
    let readyWaitMs = 0;
    if (!client) {
      const status = get().byId[sessionId]?.bridgeStatus ?? "idle";
      if (status === "spawning" || status === "connected") {
        const clientWaitStartedAt = perfNow();
        client = await _waitForBridgeClient(
          sessionId,
          status === "connected"
            ? CONNECTED_CLIENT_WAIT_MS
            : BRIDGE_CLIENT_WAIT_MS,
        );
        clientWaitMs = Math.round((perfNow() - clientWaitStartedAt) * 10) / 10;
      }
    }
    if (!client) {
      const slot = get().byId[sessionId];
      const status = slot?.bridgeStatus ?? "idle";
      const message = missingBridgeMessage(status, slot?.bridgeError ?? null);
      console.warn(
        `[runtime] sendIPCCommand(${sessionId}) called but no bridge is alive:`,
        cmd,
      );
      if (userVisibleCommand) {
        throw new Error(message);
      }
      return;
    }
    if (userVisibleCommand) {
      const readyWaitStartedAt = perfNow();
      const ready = await _waitForBridgeReady(sessionId);
      readyWaitMs = Math.round((perfNow() - readyWaitStartedAt) * 10) / 10;
      if (!ready) {
        const slot = get().byId[sessionId];
        if (slot?.bridgeError) {
          throw new Error(slot.bridgeError);
        }
        throw new Error(await bridgeStartupTimeoutMessage(sessionId));
      }
      client = _bridgeClients.get(sessionId);
      if (!client) {
        const slot = get().byId[sessionId];
        throw new Error(
          missingBridgeMessage(
            slot?.bridgeStatus ?? "idle",
            slot?.bridgeError ?? null,
          ),
        );
      }
    }
    await client.send(cmd);
    logPerf("runtime.sendIPCCommand", sendStartedAt, {
      sessionId,
      command: cmd.kind,
      userVisibleCommand,
      clientWaitMs,
      readyWaitMs,
    });
  },

  hasBridgeClient: (sid) => _bridgeClients.has(sid),

  patchRuntimeInfo: (patch) =>
    set((state) => ({ runtimeInfo: { ...state.runtimeInfo, ...patch } })),

  resetWarmup: () => set({ _warmupComplete: false }),

  seedCachedLLMs: (list) => {
    const current = list.find((l) => l.isCurrent);
    set({
      cachedLLMs: list,
      cachedLLMDisplayName: current?.displayName ?? "",
    });
  },
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
export function getActiveRuntime(): PerSessionRuntime | undefined {
  const activeId = useSessionsStore.getState().activeSessionId;
  if (!activeId) return undefined;
  return useRuntimeStore.getState().byId[activeId];
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
