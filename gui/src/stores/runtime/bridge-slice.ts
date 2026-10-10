import { invoke } from "@tauri-apps/api/core";

import { applyReadySnapshot, dispatchIPCEvent } from "@/lib/ipc-handlers";
import {
  attachBridge as attachBridgeProcess,
  confirmRunnerHistory,
  ensureBridge as ensureBridgeProcess,
  HistoryReplayError,
  type BridgeClient,
  type BridgeHandlers,
  type EnsureBridgeArgs,
  type ReadySnapshot,
} from "@/lib/bridge";
import { clearReplyNotifyPending } from "@/lib/notify";
import { logPerf, perfNow } from "@/lib/perf";
import {
  DEFAULT_LLM_DISPLAY_NAME,
  DEFAULT_LLMS,
} from "@/stores/defaults";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { IPCCommand } from "@/types/ipc";

import {
  currentCopy,
  type BridgeStatus,
  type PerSessionRuntime,
  type RuntimeSliceCreator,
} from "./shared";

/**
 * Why Core's ensure did not give this page a runner with its history
 * confirmed. `historyReplay`: the runner exists (or did), but Core could
 * not restore the session's history into it even after one restart — the
 * send path reports that with its "restore timed out" copy.
 */
export interface RunnerEnsureFailure {
  historyReplay: boolean;
  message: string;
}

export interface BridgeSlice {
  /** Set bridge status. Used by ipc-handlers ready event. */
  setBridgeStatus: (sid: string, status: BridgeStatus) => void;
  /**
   * Make sure `args.sessionId` has a runner and this page listens to it,
   * through Core's `ensure_session_runner` (ticket 02a): Core returns the
   * runner it already holds — never replacing a running one, so a run in
   * progress survives — or starts one from the session row and prefs.
   * Since ticket 02b Core also restores the session's history into it
   * before answering. Listeners go up before the invoke. A runner Core
   * started reports `ready` as usual; an already-live one does not, so
   * its ready snapshot is applied here (stores only) and the bridge reads
   * as connected at once. LRU eviction runs inside this action via the
   * runtime-private `_bridgeClients` / `_lruOrder` maps (LRU_CAP = 20
   * active bridges). Resolves to the failure, if any (never throws): a
   * spawn failure also leaves the session in `error`; a history-restore
   * failure leaves it `idle` and quiet, like the best-effort replay it
   * replaces — the next send asks again.
   */
  ensureSessionRunner: (
    args: EnsureBridgeArgs,
  ) => Promise<RunnerEnsureFailure | null>;
  /**
   * The send path's gate (ticket 02b): resolve once Core confirms that
   * `sid`'s runner holds the session's history — replaying (and, once,
   * restarting) as needed — or with the failure. With this page already
   * listening it asks Core directly; otherwise it runs (or joins) a full
   * `ensureSessionRunner`.
   */
  confirmSessionHistory: (sid: string) => Promise<RunnerEnsureFailure | null>;
  /**
   * Attach JS listeners to a runner started elsewhere (`galley session
   * new`, a Goal turn, another page). The process already exists in Rust;
   * this action just registers event handlers and tracks the client
   * locally, then fills in the runner's ready state — from `ready` when
   * the caller already has it, else from `list_live_runners` — since its
   * `ready` event may have gone by before the listeners were up.
   */
  attachExternalBridge: (
    sessionId: string,
    pid: number,
    ready?: ReadySnapshot | null,
  ) => Promise<void>;
  /**
   * Attach to the runner Core still holds for `sessionId`, if any —
   * instead of spawning, which would shut that runner down first and
   * kill its run. A session whose run is still open gets its history
   * restored before the listener goes up, then shows as running. True
   * when a live runner was found and attached.
   */
  attachLiveRunner: (sessionId: string) => Promise<boolean>;
  /**
   * After a webview reload: re-attach every runner Core still holds for
   * a session in the sidebar, so running sessions keep rendering live.
   * Core keeps persisting their turns either way; this only restores
   * the view. No-op on a cold start (Core has no runners yet).
   */
  reattachLiveRunners: () => Promise<void>;
  /** Graceful shutdown. No-op if no bridge alive for `sid`. */
  shutdownBridge: (sid: string) => Promise<void>;
  /** Send an IPC command to `sid`'s bridge over stdin. User-turn commands
   * fail loudly when no live bridge is available; quiet background sync
   * commands remain best-effort. */
  sendIPCCommand: (sid: string, cmd: IPCCommand) => Promise<void>;
  /** True only when this JS runtime has a live client/listener handle. */
  hasBridgeClient: (sid: string) => boolean;
}

// ---- Module-level bridge resources (private to this slice) ----
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
// In-flight attaches and ensures, so a reload's bulk re-attach, an
// activation, and the `runner-spawned-external` broadcast — including
// the one Core sends for this page's own ensure (`via: "gui"`) — cannot
// register two listener sets for one runner (every event would then
// render twice).
const _attachesInFlight = new Map<
  string,
  Promise<RunnerEnsureFailure | null>
>();
const _stderrTails = new Map<string, string[]>();
const _bridgeSpawnStartedAt = new Map<string, number>();
const _STDERR_TAIL_MAX = 8;
const _lruOrder: string[] = [];
const LRU_CAP = 20;
const BRIDGE_CLIENT_WAIT_MS = 15_000;
const CONNECTED_CLIENT_WAIT_MS = 1_000;
const BRIDGE_READY_WAIT_MS = 30_000;

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
  // Sends, ask_user replies and abort are direct user actions on a live
  // run: silently dropping them leaves the UI showing a state (sent /
  // stopping) the bridge never heard about. They must reject so the
  // caller can roll back and tell the user.
  return (
    cmd.kind === "user_message" ||
    cmd.kind === "ask_user_response" ||
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

/** One runner Core still holds — `runner_commands::LiveRunnerPayload`. */
interface LiveRunner {
  sessionId: string;
  pid: number;
  /** A run is open or the agent is mid-turn. */
  runOpen: boolean;
  /** Its latest `ready` state; null until it reports (older Cores omit
   * the field). */
  ready?: ReadySnapshot | null;
}

async function _listLiveRunners(): Promise<LiveRunner[]> {
  try {
    const runners = await invoke<LiveRunner[] | null>("list_live_runners");
    return Array.isArray(runners) ? runners : [];
  } catch (e) {
    console.debug("[runtime] list_live_runners failed.", e);
    return [];
  }
}

async function _attachLive(runner: LiveRunner): Promise<void> {
  const { sessionId } = runner;
  if (_bridgeClients.has(sessionId)) return;
  if (runner.runOpen) {
    // Restore before the listener goes up: once live turns land in an
    // empty transcript, activation no longer restores (it reads a
    // non-empty transcript as already loaded) and the history before
    // the reload would stay missing. Core persisted every turn, so the
    // read is complete up to now.
    const messages = useMessagesStore.getState();
    if ((messages.byId[sessionId]?.turns.length ?? 0) === 0) {
      await messages.restoreSessionTurns(sessionId);
    }
  }
  await useRuntimeStore
    .getState()
    .attachExternalBridge(sessionId, runner.pid, runner.ready ?? null);
  if (runner.runOpen && _bridgeClients.has(sessionId)) {
    useMessagesStore.getState().setAgentRunning(sessionId, true);
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
    // Reported by the runner, not by the bridge lifecycle — carried
    // over untouched (a reconnect re-reports on `ready`).
    reasoningEffort: rt?.reasoningEffort ?? null,
    configuredReasoningEffort: rt?.configuredReasoningEffort ?? null,
    reasoningEffortKnown: rt?.reasoningEffortKnown ?? false,
  };
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

export const createBridgeSlice: RuntimeSliceCreator<BridgeSlice> = (
  set,
  get,
) => ({
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

  ensureSessionRunner: async (args) => {
    const { sessionId } = args;
    if (_bridgeClients.has(sessionId)) {
      // This page already listens to the session; Core keeps whatever
      // runner it holds. Nothing to attach.
      console.warn(
        `[runtime] ensureSessionRunner(${sessionId}) called while this page already holds its bridge; keeping it.`,
      );
      return null;
    }
    const inFlight = _attachesInFlight.get(sessionId);
    if (inFlight) {
      return await inFlight;
    }
    const run = (async (): Promise<RunnerEnsureFailure | null> => {
      const startedAt = perfNow();
      _bridgeSpawnStartedAt.set(sessionId, startedAt);
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
        const { client, spawned, ready } = await ensureBridgeProcess(
          args,
          makeBridgeHandlers(sessionId),
        );
        _bridgeClients.set(sessionId, client);
        _lruTouch(sessionId);
        if (spawned) {
          // Status flips to "connected" only after the runner sends its
          // `ready` event (handled in ipc-handlers, which may already
          // have happened). Keep "spawning" so the UI shows a loading
          // affordance.
          set((state) => ({
            byId: {
              ...state.byId,
              [sessionId]: _bridgeFieldsUpdate(state.byId[sessionId], {
                bridgePid: client.pid,
              }),
            },
          }));
        } else {
          // Already alive: its `ready` went by long ago and will not
          // come again — nothing may wait for it. Connected now, ready
          // state from Core's snapshot (stores only, never a replay).
          _bridgeSpawnStartedAt.delete(sessionId);
          set((state) => ({
            byId: {
              ...state.byId,
              [sessionId]: _bridgeFieldsUpdate(state.byId[sessionId], {
                bridgeStatus: "connected",
                bridgeError: null,
                bridgePid: client.pid,
              }),
            },
          }));
          if (ready) applyReadySnapshot(sessionId, ready);
        }
        void _enforceLRUCap();
        logPerf("runtime.ensureSessionRunner", startedAt, {
          sessionId,
          pid: client.pid,
          result: spawned ? "spawned" : "attached",
        });
        return null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const historyReplay = e instanceof HistoryReplayError;
        _bridgeClients.delete(sessionId);
        _bridgeSpawnStartedAt.delete(sessionId);
        set((state) => ({
          byId: {
            ...state.byId,
            // A history-restore failure is no bridge error: Core may well
            // hold a live runner, which the next activation attaches to.
            [sessionId]: _bridgeFieldsUpdate(state.byId[sessionId], {
              bridgeStatus: historyReplay ? "idle" : "error",
              bridgeError: historyReplay ? null : msg,
              bridgePid: null,
            }),
          },
        }));
        logPerf("runtime.ensureSessionRunner", startedAt, {
          sessionId,
          result: historyReplay ? "history_replay_failed" : "failed",
        });
        return { historyReplay, message: msg };
      }
    })();
    _attachesInFlight.set(sessionId, run);
    try {
      return await run;
    } finally {
      _attachesInFlight.delete(sessionId);
    }
  },

  confirmSessionHistory: async (sessionId) => {
    const gaConfig = usePrefsStore.getState().gaConfig;
    if (!_bridgeClients.has(sessionId)) {
      return await get().ensureSessionRunner({ sessionId, gaConfig });
    }
    try {
      await confirmRunnerHistory({ sessionId, gaConfig });
      return null;
    } catch (e) {
      return {
        historyReplay: e instanceof HistoryReplayError,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },

  attachExternalBridge: async (sessionId, pid, ready) => {
    if (_bridgeClients.has(sessionId)) {
      return;
    }
    const inFlight = _attachesInFlight.get(sessionId);
    if (inFlight) {
      await inFlight;
      return;
    }
    const attach = (async (): Promise<null> => {
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
        // The runner's `ready` may have gone by before the listeners
        // above were up (a late `runner-spawned-external`, a reload).
        // A ready that arrives from here on is handled as an event.
        const snapshot =
          ready !== undefined
            ? ready
            : ((await _listLiveRunners()).find((r) => r.sessionId === sessionId)
                ?.ready ?? null);
        if (snapshot) applyReadySnapshot(sessionId, snapshot);
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
      return null;
    })();
    _attachesInFlight.set(sessionId, attach);
    try {
      await attach;
    } finally {
      _attachesInFlight.delete(sessionId);
    }
  },

  attachLiveRunner: async (sessionId) => {
    const runner = (await _listLiveRunners()).find(
      (r) => r.sessionId === sessionId,
    );
    if (!runner) return false;
    await _attachLive(runner);
    return _bridgeClients.has(sessionId);
  },

  reattachLiveRunners: async () => {
    const runners = await _listLiveRunners();
    if (runners.length === 0) return;
    const known = new Set(
      useSessionsStore.getState().sessions.map((session) => session.id),
    );
    await Promise.all(
      runners.filter((r) => known.has(r.sessionId)).map(_attachLive),
    );
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
});
