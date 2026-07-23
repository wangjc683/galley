import { invoke } from "@tauri-apps/api/core";

import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import {
  attachBridge as attachBridgeProcess,
  spawnBridge as spawnBridgeProcess,
  type BridgeClient,
  type BridgeSpawnArgs,
  type BridgeHandlers,
} from "@/lib/bridge";
import { clearReplyNotifyPending } from "@/lib/notify";
import { logPerf, perfNow } from "@/lib/perf";
import {
  DEFAULT_LLM_DISPLAY_NAME,
  DEFAULT_LLMS,
} from "@/stores/defaults";
import { useMessagesStore } from "@/stores/messages";
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

export interface BridgeSlice {
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
});
