import { beforeEach, describe, expect, it } from "vitest";

import { deriveSessionStatus } from "@/lib/sessions";
import { DEFAULT_NEW_SESSION_TITLE, useSessionsStore } from "@/stores/sessions";
import { useMessagesStore } from "@/stores/messages";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";

function seedSession(id = "s-test"): void {
  useSessionsStore.setState({
    sessions: [makeSession({ id, title: DEFAULT_NEW_SESSION_TITLE })],
    activeSessionId: id,
  });
}

describe("messages store", () => {
  beforeEach(() => {
    resetStores();
    seedSession();
  });

  it("ensureMessages is idempotent", () => {
    const store = useMessagesStore.getState();

    store.ensureMessages("s-test");
    const first = useMessagesStore.getState().byId["s-test"];
    store.ensureMessages("s-test");

    expect(useMessagesStore.getState().byId["s-test"]).toBe(first);
    expect(first).toMatchObject({
      turns: [],
      agentRunning: false,
      currentTurnIndex: null,
      inFlightContent: "",
      pendingAskUser: null,
      turnIndexOffset: 0,
    });
  });

  it("appendUserTurnExternal appends, derives title, leaves row status durable", () => {
    useMessagesStore
      .getState()
      .appendUserTurnExternal(
        "s-test",
        "Summarize the release notes",
        { via: "supervisor", supervisor: "ga-claude" },
        "2026-06-18T08:02:00.000Z",
        true,
        8,
      );

    const messages = useMessagesStore.getState();
    const session = useSessionsStore.getState().sessions[0];

    expect(messages.userSubmitTick).toBe(1);
    expect(messages.byId["s-test"]).toMatchObject({
      agentRunning: true,
      currentTurnIndex: null,
      sendPhase: "waiting_agent",
      turnIndexOffset: 7,
    });
    expect(messages.byId["s-test"].turns[0]).toMatchObject({
      role: "user",
      content: "Summarize the release notes",
      createdAt: "2026-06-18T08:02:00.000Z",
      origin: { via: "supervisor", supervisor: "ga-claude" },
    });
    // Title is still derived onto the row. Running is NOT mirrored — the
    // row keeps its durable status; running is derived at read time from
    // the slice's agentRunning (see useSessionStatusView).
    expect(session).toMatchObject({
      title: "Summarize the release notes",
      status: "idle",
    });
    expect(deriveSessionStatus(session, { agentRunning: true })).toBe(
      "running",
    );
  });

  it("covers streaming and run terminal cleanup", () => {
    const store = useMessagesStore.getState();

    store.setAgentRunning("s-test", true);
    store.setCurrentTurnIndex("s-test", 2);
    store.setSendPhase("s-test", "waiting_agent");
    store.setStopping("s-test", true);
    store.appendInFlightDelta("s-test", "hel");
    store.appendInFlightDelta("s-test", "lo");

    expect(useMessagesStore.getState().byId["s-test"]).toMatchObject({
      agentRunning: true,
      currentTurnIndex: 2,
      inFlightContent: "hello",
      isStopping: true,
      sendPhase: null,
    });

    store.appendAgentTurn("s-test", {
      role: "agent",
      tools: [],
      finalAnswer: "Done",
      turnIndex: 2,
    });

    expect(useMessagesStore.getState().byId["s-test"]).toMatchObject({
      agentRunning: true,
      currentTurnIndex: null,
      inFlightContent: "",
    });
    expect(useMessagesStore.getState().byId["s-test"].turns).toHaveLength(1);

    store.clearStreamingOnBridgeClose("s-test");

    expect(useMessagesStore.getState().byId["s-test"]).toMatchObject({
      agentRunning: false,
      currentTurnIndex: null,
      inFlightContent: "",
      sendPhase: null,
      isStopping: false,
    });
    expect(useSessionsStore.getState().sessions[0].status).toBe("idle");
  });
});

describe("nextSuggestion (composer ghost text)", () => {
  it("sets, replaces, and clears on new user turns", async () => {
    const store = useMessagesStore.getState();
    store.ensureMessages("s-ghost");
    store.setNextSuggestion("s-ghost", "帮我跑一下测试");
    expect(useMessagesStore.getState().byId["s-ghost"].nextSuggestion).toBe(
      "帮我跑一下测试",
    );

    // A newer final reply without a tag clears the stale suggestion.
    store.setNextSuggestion("s-ghost", null);
    expect(
      useMessagesStore.getState().byId["s-ghost"].nextSuggestion,
    ).toBeNull();

    // External user turn (CLI / supervisor dispatch) spends it too.
    store.setNextSuggestion("s-ghost", "帮我提交");
    useMessagesStore
      .getState()
      .appendUserTurnExternal("s-ghost", "继续", undefined, undefined, true);
    expect(
      useMessagesStore.getState().byId["s-ghost"].nextSuggestion,
    ).toBeNull();
  });
});
