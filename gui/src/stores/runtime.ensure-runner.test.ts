import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadySnapshot } from "@/lib/bridge";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import {
  ensureHistoryReplayComplete,
  markHistoryReplayStale,
} from "@/lib/ipc/history-replay";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";

/**
 * Ticket 02a: a session's runner comes from Core's `ensure_session_runner`
 * — Core returns the live runner it holds (never replacing it) or starts
 * one. The page attaches its listeners before invoking, applies a live
 * runner's ready snapshot without replaying history, never waits for a
 * `ready` that will not come, and does not attach twice when Core
 * broadcasts `runner-spawned-external` for the page's own ensure.
 *
 * The bridge slice keeps its client map at module level, so every test
 * uses its own session ids.
 */

vi.mock("@/lib/ipc/history-replay", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ipc/history-replay")>();
  return {
    ...actual,
    ensureHistoryReplayComplete: vi.fn(async () => true),
    markHistoryReplayStale: vi.fn(),
  };
});

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
    vi.mocked(ensureHistoryReplayComplete).mockClear();
    vi.mocked(markHistoryReplayStale).mockClear();
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
    // The snapshot is NOT a `ready`: the runner may be mid-run, and
    // load_history would replace its GA history wholesale.
    expect(markHistoryReplayStale).not.toHaveBeenCalled();
    expect(ensureHistoryReplayComplete).not.toHaveBeenCalled();
    expect(
      calls("send_to_runner").filter(
        (args) => (args?.command as { kind?: string })?.kind === "load_history",
      ),
    ).toHaveLength(0);

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

  it("the replay spies do fire for a real `ready` (control)", () => {
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-ens-ctrl", turnCount: 4 })],
    });
    dispatchIPCEvent({ kind: "ready", ...snapshot("s-ens-ctrl") });
    expect(markHistoryReplayStale).toHaveBeenCalledWith("s-ens-ctrl");
    expect(ensureHistoryReplayComplete).toHaveBeenCalledWith("s-ens-ctrl");
  });

  it("an ensure failure leaves the session in error with no listeners kept", async () => {
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

    await useSessionsStore.getState().activateSession("s-ens-fail");

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
    vi.mocked(markHistoryReplayStale).mockClear();
    vi.mocked(ensureHistoryReplayComplete).mockClear();
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
    expect(markHistoryReplayStale).not.toHaveBeenCalled();
    expect(ensureHistoryReplayComplete).not.toHaveBeenCalled();
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
    expect(markHistoryReplayStale).not.toHaveBeenCalled();
  });
});
