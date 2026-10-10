import { beforeEach, describe, expect, it } from "vitest";

import { useMessagesStore } from "@/stores/messages";
import { resetStores } from "@/test/store-reset";

import { applyRunnerHistoryReplay } from "./history-replay";

// Core's `runner-history-replay` drives the "restoring" send phase
// (ticket 02b), under the rule the GUI's own replay used: only for a
// session whose run the page already shows as started.

function phase(sid: string) {
  return useMessagesStore.getState().byId[sid]?.sendPhase ?? null;
}

function sending(sid: string) {
  const messages = useMessagesStore.getState();
  messages.ensureMessages(sid);
  messages.setAgentRunning(sid, true);
  messages.setSendPhase(sid, "starting");
}

describe("applyRunnerHistoryReplay", () => {
  beforeEach(() => {
    resetStores();
  });

  it("started, for a send in flight: restoring", () => {
    sending("s-a");
    applyRunnerHistoryReplay({ sessionId: "s-a", phase: "started" });
    expect(phase("s-a")).toBe("restoring");
  });

  it("started, with no run shown (activation, /btw): nothing", () => {
    useMessagesStore.getState().ensureMessages("s-b");
    applyRunnerHistoryReplay({ sessionId: "s-b", phase: "started" });
    expect(phase("s-b")).toBeNull();
  });

  it("done / failed leave the phase to the send path", () => {
    sending("s-c");
    applyRunnerHistoryReplay({ sessionId: "s-c", phase: "started" });
    applyRunnerHistoryReplay({ sessionId: "s-c", phase: "failed" });
    applyRunnerHistoryReplay({ sessionId: "s-c", phase: "done" });
    expect(phase("s-c")).toBe("restoring");
  });

  it("touches only its own session", () => {
    sending("s-d");
    sending("s-e");
    applyRunnerHistoryReplay({ sessionId: "s-d", phase: "started" });
    expect(phase("s-e")).toBe("starting");
  });
});
