import { beforeEach, describe, expect, it } from "vitest";

import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore, type RunnerEnsureFailure } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { resetStores } from "@/test/store-reset";

import { ensureBridgeThenSend } from "./useMessageSend";

const SID = "s-test";

const REPLAY_FAILED: RunnerEnsureFailure = {
  historyReplay: true,
  message: "History restore failed: the runner refused load_history",
};

/** Recorded calls + store fakes for one scenario. The phase machine's
 * dependencies are all store fields, so faking them is a setState. Core's
 * history confirmation answers from `confirm` in order (default: ok). */
function arm(opts: {
  connected: boolean;
  activation?: RunnerEnsureFailure | null;
  confirm?: Array<RunnerEnsureFailure | null>;
}) {
  const phases: string[] = [];
  const sent: string[] = [];
  const activated: string[] = [];
  const confirmed: string[] = [];
  const shutdown: string[] = [];
  const answers = [...(opts.confirm ?? [])];
  useMessagesStore.setState({
    setSendPhase: (_sid: string, phase: string | null) => {
      if (phase) phases.push(phase);
    },
  } as never);
  useRuntimeStore.setState({
    byId: opts.connected ? { [SID]: { bridgeStatus: "connected" } } : {},
    hasBridgeClient: () => opts.connected,
    sendIPCCommand: async (_sid: string, cmd: { kind: string }) => {
      sent.push(cmd.kind);
    },
    confirmSessionHistory: async (sid: string) => {
      confirmed.push(sid);
      return answers.shift() ?? null;
    },
    shutdownBridge: async (sid: string) => {
      shutdown.push(sid);
    },
  } as never);
  useSessionsStore.setState({
    activateSession: async (sid: string) => {
      activated.push(sid);
      return opts.activation ?? null;
    },
  } as never);
  return { phases, sent, activated, confirmed, shutdown };
}

const OPTS = { restoreTimeoutMessage: "restore timed out" };

beforeEach(() => {
  resetStores();
});

describe("ensureBridgeThenSend", () => {
  it("connected bridge: asks Core to confirm the history, then dispatches", async () => {
    const r = arm({ connected: true });

    await ensureBridgeThenSend(
      SID,
      { kind: "user_message", text: "hi", images: [] },
      OPTS,
    );

    expect(r.activated).toEqual([]);
    expect(r.confirmed).toEqual([SID]);
    // "restoring" is Core's to announce (`runner-history-replay`).
    expect(r.phases).toEqual(["waiting_agent", "sent"]);
    expect(r.sent).toEqual(["user_message"]);
  });

  it("cold bridge: activates (Core restores while starting it), confirms, dispatches", async () => {
    const r = arm({ connected: false });

    await ensureBridgeThenSend(
      SID,
      { kind: "user_message", text: "hi", images: [] },
      OPTS,
    );

    expect(r.activated).toEqual([SID]);
    expect(r.confirmed).toEqual([SID]);
    expect(r.phases).toEqual(["starting", "waiting_agent", "sent"]);
    expect(r.sent).toEqual(["user_message"]);
  });

  it("Core could not restore the history: restore-timeout copy, nothing dispatched, no GUI restart", async () => {
    const r = arm({ connected: true, confirm: [REPLAY_FAILED] });

    await expect(
      ensureBridgeThenSend(
        SID,
        { kind: "user_message", text: "hi", images: [] },
        OPTS,
      ),
    ).rejects.toThrow("restore timed out");
    expect(r.sent).toEqual([]);
    // The one quiet restart is Core's; the page neither shuts the bridge
    // down nor asks again.
    expect(r.shutdown).toEqual([]);
    expect(r.activated).toEqual([]);
    expect(r.confirmed).toEqual([SID]);
  });

  it("another confirmation failure keeps its own message", async () => {
    arm({
      connected: true,
      confirm: [{ historyReplay: false, message: "GA path invalid: gone" }],
    });

    await expect(
      ensureBridgeThenSend(
        SID,
        { kind: "user_message", text: "hi", images: [] },
        OPTS,
      ),
    ).rejects.toThrow("GA path invalid: gone");
  });

  it("an activation whose restore failed ends the send without asking again", async () => {
    const r = arm({ connected: false, activation: REPLAY_FAILED });

    await expect(
      ensureBridgeThenSend(
        SID,
        { kind: "user_message", text: "hi", images: [] },
        OPTS,
      ),
    ).rejects.toThrow("restore timed out");
    expect(r.confirmed).toEqual([]);
    expect(r.sent).toEqual([]);
  });

  it("an activation that could not start the runner reports its error", async () => {
    const r = arm({
      connected: false,
      activation: { historyReplay: false, message: "Python not found: x" },
    });

    await expect(
      ensureBridgeThenSend(
        SID,
        { kind: "user_message", text: "hi", images: [] },
        OPTS,
      ),
    ).rejects.toThrow("Python not found: x");
    expect(r.sent).toEqual([]);
  });

  it("ask_user_response skips the history check — the run is live, history is current", async () => {
    const r = arm({ connected: true });

    await ensureBridgeThenSend(
      SID,
      { kind: "ask_user_response", text: "yes" },
      OPTS,
    );

    expect(r.confirmed).toEqual([]);
    expect(r.phases).toEqual(["waiting_agent", "sent"]);
    expect(r.sent).toEqual(["ask_user_response"]);
  });

  it("showPhase false (/btw): history still confirmed, phases silent", async () => {
    const r = arm({ connected: true });

    await ensureBridgeThenSend(
      SID,
      { kind: "user_message", text: "/btw q", images: [] },
      { ...OPTS, showPhase: false },
    );

    expect(r.confirmed).toEqual([SID]);
    expect(r.phases).toEqual([]);
    expect(r.sent).toEqual(["user_message"]);
  });
});
