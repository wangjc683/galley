import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadySnapshot } from "@/lib/bridge";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import { useUiStore } from "@/stores/ui";

/**
 * Ticket 02a: a session's runner comes from Core's `ensure_session_runner`
 * — Core returns the live runner it holds (never replacing it) or starts
 * one. The page attaches its listeners before invoking, applies a live
 * runner's ready snapshot without replaying history, never waits for a
 * `ready` that will not come, and does not attach twice when Core
 * broadcasts `runner-spawned-external` for the page's own ensure.
 *
 * Ticket 02b: Core also restores the session's history inside that
 * ensure; the page never sends `load_history` itself, not even on a real
 * `ready`, and the send path asks Core to confirm the history.
 *
 * The bridge slice keeps its client map at module level, so every test
 * uses its own session ids.
 */

const tauriMocks = getTauriMocks();

interface EnsureResult {
  pid: number;
  spawned: boolean;
  ready: ReadySnapshot | null;
}

function snapshot(sessionId: string): ReadySnapshot {
  return {
    sessionId,
    protocolVersion: "0.1",
    gaCommit: "cafe123",
    gaCommitDate: "2026-10-01T00:00:00+08:00",
    gaPath: "/ga",
    llmName: "B/model-b",
    cwd: "/",
    pid: 4242,
    availableLLMs: [
      { index: 0, name: "A/model-a", displayName: "model-a", isCurrent: false },
      { index: 1, name: "B/model-b", displayName: "model-b", isCurrent: true },
    ],
    imagesSupported: false,
    reasoningEffort: "high",
    configuredReasoningEffort: "medium",
    timestamp: "t",
  };
}

/** Core answers: no live runners, and `ensure_session_runner` with
 * `result` (or a hand-resolved promise). */
function coreEnsures(result: EnsureResult | Promise<EnsureResult>): void {
  tauriMocks.invoke.mockImplementation(async (command) => {
    if (command === "list_live_runners") return [];
    if (command === "ensure_session_runner") return result;
    return undefined;
  });
}

/** `load_history` commands this page sent itself (none, since 02b). */
function pageLoadHistories(): unknown[] {
  return calls("send_to_runner").filter(
    (args) => (args?.command as { kind?: string })?.kind === "load_history",
  );
}

/** Rust's JSON for a history-restore failure. */
const HISTORY_REPLAY_ERROR = JSON.stringify({
  error: "history_replay",
  detail: "the runner refused load_history: boom",
});

function calls(command: string): Array<Record<string, unknown> | undefined> {
  return tauriMocks.invoke.mock.calls
    .filter(([c]) => c === command)
    .map(([, args]) => args);
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("activateSession → Core's ensure_session_runner", () => {
  beforeEach(() => {
    resetStores();
    useMessagesStore.setState({ restoreSessionTurns: async () => {} });
  });

  it("asks Core with listeners already up and the page's gaConfig; never spawns itself", async () => {
    useSessionsStore.setState({
      sessions: [
        makeSession({
          id: "s-ens-1",
          turnCount: 2,
          selectedLlmKey: "A/model-a",
          selectedLlmIndex: 0,
        }),
      ],
    });
    coreEnsures({ pid: 31, spawned: true, ready: null });

    await useSessionsStore.getState().activateSession("s-ens-1");

    expect(calls("spawn_runner")).toHaveLength(0);
    const ensure = calls("ensure_session_runner");
    expect(ensure).toHaveLength(1);
    // The persisted model choice is Core's to read from the row.
    expect(ensure[0]).toEqual({
      sessionId: "s-ens-1",
      llmIndex: undefined,
      llmKey: undefined,
      activeSessionId: undefined,
      gaConfig: usePrefsStore.getState().gaConfig,
    });
    // runner-event / -malformed / -closed listeners, registered before
    // the invoke resolved.
    const firstListen = tauriMocks.listen.mock.invocationCallOrder[0];
    const ensureCall = tauriMocks.invoke.mock.calls.findIndex(
      ([c]) => c === "ensure_session_runner",
    );
    expect(tauriMocks.listen).toHaveBeenCalledTimes(3);
    expect(firstListen).toBeLessThan(
      tauriMocks.invoke.mock.invocationCallOrder[ensureCall],
    );
    // A runner Core just started: wait for its real `ready`.
    const runtime = useRuntimeStore.getState();
    expect(runtime.hasBridgeClient("s-ens-1")).toBe(true);
    expect(runtime.byId["s-ens-1"]).toMatchObject({
      bridgeStatus: "spawning",
      bridgePid: 31,
    });
  });

  it("a brand-new session consumes the EmptyState pick as an override", async () => {
    useSessionsStore.setState({
      sessions: [
        makeSession({ id: "s-ens-pick", turnCount: 0, selectedLlmKey: "B/b" }),
      ],
    });
    useRuntimeStore.setState({ pendingLLMIndex: 3 });
    coreEnsures({ pid: 32, spawned: true, ready: null });

    await useSessionsStore.getState().activateSession("s-ens-pick");

    expect(calls("ensure_session_runner")[0]).toMatchObject({
      sessionId: "s-ens-pick",
      llmIndex: 3,
      llmKey: "B/b",
    });
    expect(useRuntimeStore.getState().pendingLLMIndex).toBeUndefined();
  });

  it("an already-live runner: connected at once, snapshot applied, no replay, no waiting", async () => {
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-ens-live", turnCount: 4 })],
    });
    coreEnsures({ pid: 4242, spawned: false, ready: snapshot("s-ens-live") });

    await useSessionsStore.getState().activateSession("s-ens-live");

    const runtime = useRuntimeStore.getState();
    expect(runtime.byId["s-ens-live"]).toMatchObject({
      bridgeStatus: "connected",
      bridgePid: 4242,
      reasoningEffort: "high",
      configuredReasoningEffort: "medium",
      reasoningEffortKnown: true,
    });
    expect(
      runtime.byId["s-ens-live"]?.llms.find((llm) => llm.isCurrent)?.name,
    ).toBe("B/model-b");
    expect(
      useSessionsStore.getState().sessions.find((s) => s.id === "s-ens-live")
        ?.imagesSupported,
    ).toBe(false);
    // History is Core's to restore: the page sends no load_history.
    expect(pageLoadHistories()).toHaveLength(0);

    // No `ready` will come — a user-visible send goes straight through
    // (the 30s ready wait would hit `window.setTimeout`, absent here).
    await useRuntimeStore.getState().sendIPCCommand("s-ens-live", {
      kind: "user_message",
      text: "hi",
      images: [],
    });
    expect(calls("send_to_runner")).toContainEqual({
      sessionId: "s-ens-live",
      command: { kind: "user_message", text: "hi", images: [] },
    });
  });

  it("a real `ready` only updates the stores — Core replays, not the page", async () => {
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-ens-ctrl", turnCount: 4 })],
    });
    dispatchIPCEvent({ kind: "ready", ...snapshot("s-ens-ctrl") });
    await Promise.resolve();

    expect(useRuntimeStore.getState().byId["s-ens-ctrl"]?.bridgeStatus).toBe(
      "connected",
    );
    expect(calls("session_message_rows")).toHaveLength(0);
    expect(pageLoadHistories()).toHaveLength(0);
  });

  it("Core failing to restore the history leaves the session idle and quiet", async () => {
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-ens-rp", turnCount: 3 })],
    });
    tauriMocks.invoke.mockImplementation(async (command) => {
      if (command === "list_live_runners") return [];
      if (command === "ensure_session_runner") throw HISTORY_REPLAY_ERROR;
      return undefined;
    });
    const unlisten = vi.fn();
    tauriMocks.listen.mockResolvedValue(unlisten);

    const failure = await useSessionsStore
      .getState()
      .activateSession("s-ens-rp");

    expect(failure).toMatchObject({ historyReplay: true });
    const runtime = useRuntimeStore.getState();
    expect(runtime.hasBridgeClient("s-ens-rp")).toBe(false);
    // Not a bridge failure: no error state, no bridge-failed toast — the
    // next activation attaches to Core's runner, the next send asks again.
    expect(runtime.byId["s-ens-rp"]).toMatchObject({
      bridgeStatus: "idle",
      bridgeError: null,
    });
    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(unlisten).toHaveBeenCalledTimes(3);
  });

  it("an ensure failure leaves the session in error with no listeners kept", async () => {
    // (and reports it to the caller as a non-history failure)
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-ens-fail", turnCount: 0 })],
    });
    tauriMocks.invoke.mockImplementation(async (command) => {
      if (command === "list_live_runners") return [];
      if (command === "ensure_session_runner") {
        // Rust command errors arrive as the typed error's JSON string.
        throw JSON.stringify({
          error: "ga_path_invalid",
          detail: "ga_path is empty",
        });
      }
      return undefined;
    });
    const unlisten = vi.fn();
    tauriMocks.listen.mockResolvedValue(unlisten);

    const failure = await useSessionsStore
      .getState()
      .activateSession("s-ens-fail");
    expect(failure).toMatchObject({ historyReplay: false });

    const runtime = useRuntimeStore.getState();
    expect(runtime.hasBridgeClient("s-ens-fail")).toBe(false);
    expect(runtime.byId["s-ens-fail"]?.bridgeStatus).toBe("error");
    expect(runtime.byId["s-ens-fail"]?.bridgeError).toContain("GenericAgent");
    expect(unlisten).toHaveBeenCalledTimes(3);
  });
});

describe("runner-spawned-external for the page's own ensure", () => {
  beforeEach(() => {
    resetStores();
  });

  it("arriving while the ensure is in flight attaches nothing more", async () => {
    const answer = deferred<EnsureResult>();
    coreEnsures(answer.promise);
    const runtime = useRuntimeStore.getState();

    const ensuring = runtime.ensureSessionRunner({ sessionId: "s-dup-1" });
    // Core broadcasts `runner-spawned-external` (via "gui") before the
    // invoke returns; the event handler calls attachExternalBridge.
    await Promise.resolve();
    const fromEvent = runtime.attachExternalBridge("s-dup-1", 77);
    answer.resolve({ pid: 77, spawned: true, ready: null });
    await Promise.all([ensuring, fromEvent]);

    expect(tauriMocks.listen).toHaveBeenCalledTimes(3);
    expect(useRuntimeStore.getState().hasBridgeClient("s-dup-1")).toBe(true);
    expect(calls("ensure_session_runner")).toHaveLength(1);
  });

  it("arriving after the ensure finished attaches nothing more", async () => {
    coreEnsures({ pid: 78, spawned: true, ready: null });
    const runtime = useRuntimeStore.getState();

    await runtime.ensureSessionRunner({ sessionId: "s-dup-2" });
    await runtime.attachExternalBridge("s-dup-2", 78);

    expect(tauriMocks.listen).toHaveBeenCalledTimes(3);
  });
});

describe("attaching to a runner started elsewhere fills in its ready state", () => {
  beforeEach(() => {
    resetStores();
  });

  it("a runner-spawned-external attach reads the snapshot from list_live_runners", async () => {
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-ext-1", turnCount: 3 })],
    });
    tauriMocks.invoke.mockImplementation(async (command) =>
      command === "list_live_runners"
        ? [
            {
              sessionId: "s-ext-1",
              pid: 9,
              runOpen: false,
              ready: snapshot("s-ext-1"),
            },
          ]
        : undefined,
    );

    await useRuntimeStore.getState().attachExternalBridge("s-ext-1", 9);

    expect(
      useRuntimeStore
        .getState()
        .byId["s-ext-1"]?.llms.find((llm) => llm.isCurrent)?.name,
    ).toBe("B/model-b");
    expect(pageLoadHistories()).toHaveLength(0);
  });

  it("a reload's re-attach applies each live runner's snapshot", async () => {
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-ext-2", turnCount: 1 })],
    });
    tauriMocks.invoke.mockImplementation(async (command) =>
      command === "list_live_runners"
        ? [
            {
              sessionId: "s-ext-2",
              pid: 10,
              runOpen: false,
              ready: snapshot("s-ext-2"),
            },
          ]
        : undefined,
    );

    await useRuntimeStore.getState().reattachLiveRunners();

    expect(useRuntimeStore.getState().byId["s-ext-2"]).toMatchObject({
      bridgeStatus: "connected",
      reasoningEffort: "high",
    });
    expect(
      useSessionsStore.getState().sessions.find((s) => s.id === "s-ext-2")
        ?.imagesSupported,
    ).toBe(false);
    // One list call: the row already carried the snapshot.
    expect(calls("list_live_runners")).toHaveLength(1);
    expect(pageLoadHistories()).toHaveLength(0);
  });
});

describe("confirmSessionHistory — the send path's gate (ticket 02b)", () => {
  beforeEach(() => {
    resetStores();
  });

  it("with this page listening, asks Core's ensure directly — no second listener set", async () => {
    coreEnsures({ pid: 81, spawned: true, ready: null });
    const runtime = useRuntimeStore.getState();
    await runtime.ensureSessionRunner({ sessionId: "s-conf-1" });
    expect(tauriMocks.listen).toHaveBeenCalledTimes(3);

    coreEnsures({ pid: 81, spawned: false, ready: null });
    const failure = await runtime.confirmSessionHistory("s-conf-1");

    expect(failure).toBeNull();
    expect(calls("ensure_session_runner")).toHaveLength(2);
    expect(calls("ensure_session_runner")[1]).toEqual({
      sessionId: "s-conf-1",
      gaConfig: usePrefsStore.getState().gaConfig,
    });
    expect(tauriMocks.listen).toHaveBeenCalledTimes(3);
    expect(runtime.hasBridgeClient("s-conf-1")).toBe(true);
  });

  it("reports Core's history_replay error as a history failure", async () => {
    coreEnsures({ pid: 82, spawned: true, ready: null });
    const runtime = useRuntimeStore.getState();
    await runtime.ensureSessionRunner({ sessionId: "s-conf-2" });
    tauriMocks.invoke.mockImplementation(async (command) => {
      if (command === "ensure_session_runner") throw HISTORY_REPLAY_ERROR;
      return undefined;
    });

    const failure = await runtime.confirmSessionHistory("s-conf-2");

    expect(failure).toMatchObject({ historyReplay: true });
    expect(failure?.message).toContain("History restore failed");
    // The listeners stay: Core's runner (or its quiet replacement) still
    // belongs to this session.
    expect(runtime.hasBridgeClient("s-conf-2")).toBe(true);
  });

  it("without a listening page, runs a full ensure with listeners", async () => {
    coreEnsures({ pid: 83, spawned: true, ready: null });

    const failure = await useRuntimeStore
      .getState()
      .confirmSessionHistory("s-conf-3");

    expect(failure).toBeNull();
    expect(tauriMocks.listen).toHaveBeenCalledTimes(3);
    expect(useRuntimeStore.getState().hasBridgeClient("s-conf-3")).toBe(true);
  });
});
