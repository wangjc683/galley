import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureHistoryReplayComplete } from "@/lib/ipc/history-replay";
import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { resetStores } from "@/test/store-reset";

import { ensureBridgeThenSend } from "./useMessageSend";

vi.mock("@/lib/ipc/history-replay", () => ({
  ensureHistoryReplayComplete: vi.fn(),
}));

const replayMock = vi.mocked(ensureHistoryReplayComplete);

const SID = "s-test";

/** Recorded calls + store fakes for one scenario. The phase machine's
 * dependencies are all store fields, so faking them is a setState. */
function arm(opts: { connected: boolean }) {
  const phases: string[] = [];
  const sent: string[] = [];
  const activated: string[] = [];
  const shutdown: string[] = [];
  useMessagesStore.setState({
    setSendPhase: (_sid: string, phase: string | null) => {
      if (phase) phases.push(phase);
    },
  } as never);
  useRuntimeStore.setState({
    byId: opts.connected
      ? { [SID]: { bridgeStatus: "connected" } }
      : {},
    hasBridgeClient: () => opts.connected,
    sendIPCCommand: async (_sid: string, cmd: { kind: string }) => {
      sent.push(cmd.kind);
    },
    shutdownBridge: async (sid: string) => {
      shutdown.push(sid);
    },
  } as never);
  useSessionsStore.setState({
    activateSession: async (sid: string) => {
      activated.push(sid);
    },
  } as never);
  return { phases, sent, activated, shutdown };
}

const OPTS = { restoreTimeoutMessage: "restore timed out" };

beforeEach(() => {
  resetStores();
  replayMock.mockReset();
});

describe("ensureBridgeThenSend", () => {
  it("connected bridge + confirmed replay: restore → dispatch, no activation", async () => {
    const r = arm({ connected: true });
    replayMock.mockResolvedValue(true);

    await ensureBridgeThenSend(
      SID,
      { kind: "user_message", text: "hi", images: [] },
      OPTS,
    );

    expect(r.activated).toEqual([]);
    expect(r.phases).toEqual(["restoring", "waiting_agent", "sent"]);
    expect(r.sent).toEqual(["user_message"]);
  });

  it("cold bridge: acquires one before replaying", async () => {
    const r = arm({ connected: false });
    replayMock.mockResolvedValue(true);

    await ensureBridgeThenSend(
      SID,
      { kind: "user_message", text: "hi", images: [] },
      OPTS,
    );

    expect(r.activated).toEqual([SID]);
    expect(r.phases).toEqual(["starting", "restoring", "waiting_agent", "sent"]);
  });

  it("unconfirmed replay: one silent bridge restart, then dispatch", async () => {
    const r = arm({ connected: true });
    replayMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await ensureBridgeThenSend(
      SID,
      { kind: "user_message", text: "hi", images: [] },
      OPTS,
    );

    expect(r.shutdown).toEqual([SID]);
    expect(r.activated).toEqual([SID]);
    expect(r.phases).toEqual([
      "restoring",
      "starting",
      "restoring",
      "waiting_agent",
      "sent",
    ]);
    expect(r.sent).toEqual(["user_message"]);
  });

  it("replay unconfirmed after the restart too: throws, nothing dispatched", async () => {
    const r = arm({ connected: true });
    replayMock.mockResolvedValue(false);

    await expect(
      ensureBridgeThenSend(
        SID,
        { kind: "user_message", text: "hi", images: [] },
        OPTS,
      ),
    ).rejects.toThrow("restore timed out");
    expect(r.sent).toEqual([]);
  });

  it("ask_user_response skips replay — the run is live, history is current", async () => {
    const r = arm({ connected: true });

    await ensureBridgeThenSend(
      SID,
      { kind: "ask_user_response", text: "yes" },
      OPTS,
    );

    expect(replayMock).not.toHaveBeenCalled();
    expect(r.phases).toEqual(["waiting_agent", "sent"]);
    expect(r.sent).toEqual(["ask_user_response"]);
  });

  it("showPhase false (/btw): full machine, silent phases", async () => {
    const r = arm({ connected: true });
    replayMock.mockResolvedValue(true);

    await ensureBridgeThenSend(
      SID,
      { kind: "user_message", text: "/btw q", images: [] },
      { ...OPTS, showPhase: false },
    );

    expect(r.phases).toEqual([]);
    expect(r.sent).toEqual(["user_message"]);
  });
});
