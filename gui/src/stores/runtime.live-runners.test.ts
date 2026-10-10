import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { EnsureBridgeArgs } from "@/lib/bridge";
import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";

/**
 * Webview-reload recovery (2026-10-07). A reload drops every
 * `runner-event` listener while Core's runners keep going; the page must
 * re-attach to them, never re-spawn (RunnerManager::spawn shuts the live
 * runner down first — killing its run). Since ticket 02a a session with
 * no live runner goes through Core's `ensure_session_runner` instead of
 * a GUI-side spawn (`runtime.ensure-runner.test.ts`).
 *
 * The bridge slice keeps its client map at module level, so every test
 * uses its own session ids.
 */

const tauriMocks = getTauriMocks();

interface LiveRunner {
  sessionId: string;
  pid: number;
  runOpen: boolean;
}

function coreHolds(runners: LiveRunner[]): void {
  tauriMocks.invoke.mockImplementation(async (command) =>
    command === "list_live_runners" ? runners : undefined,
  );
}

function invoked(command: string): number {
  return tauriMocks.invoke.mock.calls.filter(([c]) => c === command).length;
}

describe("re-attaching to runners Core still holds", () => {
  let ensureSessionRunner: Mock<(args: EnsureBridgeArgs) => Promise<void>>;

  beforeEach(() => {
    resetStores();
    ensureSessionRunner = vi.fn(async (_args: EnsureBridgeArgs) => {});
    useRuntimeStore.setState({ ensureSessionRunner });
  });

  it("activating a session with a live runner attaches instead of spawning", async () => {
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-live-1", turnCount: 0 })],
    });
    coreHolds([{ sessionId: "s-live-1", pid: 4242, runOpen: false }]);

    await useSessionsStore.getState().activateSession("s-live-1");

    expect(ensureSessionRunner).not.toHaveBeenCalled();
    expect(useRuntimeStore.getState().hasBridgeClient("s-live-1")).toBe(true);
    expect(useRuntimeStore.getState().byId["s-live-1"]).toMatchObject({
      bridgeStatus: "connected",
      bridgePid: 4242,
    });
  });

  it("activating a session Core holds no runner for asks Core to ensure one", async () => {
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-live-2", turnCount: 0 })],
    });
    coreHolds([{ sessionId: "someone-else", pid: 1, runOpen: true }]);

    await useSessionsStore.getState().activateSession("s-live-2");

    expect(ensureSessionRunner).toHaveBeenCalledTimes(1);
    expect(ensureSessionRunner.mock.calls[0][0]).toMatchObject({
      sessionId: "s-live-2",
    });
  });

  it("a reload re-attaches sidebar sessions and restores the running ones", async () => {
    useSessionsStore.setState({
      sessions: [
        makeSession({ id: "s-live-run", turnCount: 4 }),
        makeSession({ id: "s-live-idle", turnCount: 2 }),
      ],
    });
    const restored: string[] = [];
    useMessagesStore.setState({
      restoreSessionTurns: async (sid: string) => {
        restored.push(sid);
      },
    });
    coreHolds([
      { sessionId: "s-live-run", pid: 11, runOpen: true },
      { sessionId: "s-live-idle", pid: 12, runOpen: false },
      // Not in this runtime's sidebar (or the LLM warmup): left alone.
      { sessionId: "__warmup__", pid: 13, runOpen: false },
    ]);

    await useRuntimeStore.getState().reattachLiveRunners();

    const runtime = useRuntimeStore.getState();
    expect(runtime.hasBridgeClient("s-live-run")).toBe(true);
    expect(runtime.hasBridgeClient("s-live-idle")).toBe(true);
    expect(runtime.hasBridgeClient("__warmup__")).toBe(false);
    // History first for the running session — its live turns must land
    // after the rows Core wrote while no page was listening.
    expect(restored).toEqual(["s-live-run"]);
    expect(useMessagesStore.getState().byId["s-live-run"]?.agentRunning).toBe(
      true,
    );
    expect(
      useMessagesStore.getState().byId["s-live-idle"]?.agentRunning ?? false,
    ).toBe(false);
    expect(ensureSessionRunner).not.toHaveBeenCalled();
  });

  it("concurrent attaches register one listener set", async () => {
    coreHolds([]);
    const runtime = useRuntimeStore.getState();
    await Promise.all([
      runtime.attachExternalBridge("s-live-dup", 7),
      runtime.attachExternalBridge("s-live-dup", 7),
      runtime.attachExternalBridge("s-live-dup", 7),
    ]);
    // attachBridge listens to runner-event / -malformed / -closed once.
    expect(tauriMocks.listen).toHaveBeenCalledTimes(3);
    expect(invoked("spawn_runner")).toBe(0);
  });
});
