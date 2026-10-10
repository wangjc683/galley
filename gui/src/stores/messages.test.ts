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

  it("a socket row (one broadcast) appends, leaves the title and row status to Core", () => {
    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: "s-test",
      message: {
        content: "Summarize the release notes",
        origin: { via: "supervisor", supervisor: "ga-claude" },
        createdAt: "2026-06-18T08:02:00.000Z",
        turnIndex: 8,
      },
      dispatch: "dispatched",
    });

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
      messageId: "msg_s-test_8_user",
      createdAt: "2026-06-18T08:02:00.000Z",
      origin: { via: "supervisor", supervisor: "ga-claude" },
    });
    // The seed title is Core's to derive (ticket 02c): it arrives as
    // `session-updated-external`, never written from here. Running is
    // NOT mirrored either — the row keeps its durable status; running is
    // derived at read time from the slice's agentRunning (see
    // useSessionStatusView).
    expect(session).toMatchObject({
      title: DEFAULT_NEW_SESSION_TITLE,
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
    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: "s-ghost",
      message: { content: "继续" },
      dispatch: "dispatched",
    });
    expect(
      useMessagesStore.getState().byId["s-ghost"].nextSuggestion,
    ).toBeNull();
  });
});

describe("applyUserMessagePersisted — a row's broadcasts (ticket 02c)", () => {
  const SID = "s-test";
  const row = (turnIndex: number, content: string) => ({
    id: `msg_${SID}_${turnIndex}_user`,
    sessionId: SID,
    role: "user" as const,
    content,
    createdAt: "2026-10-10T08:00:00.000Z",
    turnIndex,
    origin: { via: "gui" as const },
  });

  beforeEach(() => {
    resetStores();
    seedSession();
  });

  function slice() {
    return useMessagesStore.getState().byId[SID];
  }

  it("another page's send: pending appends once (starting), dispatched only moves it on", () => {
    const store = useMessagesStore.getState();
    // Another frontend's send carries its own clientRequestId — not ours.
    store.applyUserMessagePersisted({
      sessionId: SID,
      message: row(3, "from the phone"),
      dispatch: "pending",
      clientRequestId: "someone-else",
    });
    expect(slice()).toMatchObject({
      agentRunning: true,
      sendPhase: "starting",
      turnIndexOffset: 2,
    });

    store.applyUserMessagePersisted({
      sessionId: SID,
      message: row(3, "from the phone"),
      dispatch: "dispatched",
      clientRequestId: "someone-else",
    });

    expect(slice().turns).toHaveLength(1);
    expect(slice()).toMatchObject({
      agentRunning: true,
      sendPhase: "waiting_agent",
    });
    expect(useMessagesStore.getState().userSubmitTick).toBe(1);
  });

  it("pending then persisted_only: shown once, the run that never started ends", () => {
    const store = useMessagesStore.getState();
    store.applyUserMessagePersisted({
      sessionId: SID,
      message: row(1, "hi"),
      dispatch: "pending",
    });
    store.applyUserMessagePersisted({
      sessionId: SID,
      message: row(1, "hi"),
      dispatch: "persisted_only",
    });

    expect(slice().turns).toHaveLength(1);
    expect(slice()).toMatchObject({ agentRunning: false, sendPhase: null });
  });

  it("a late broadcast for an older row leaves the current run alone", () => {
    const store = useMessagesStore.getState();
    store.applyUserMessagePersisted({
      sessionId: SID,
      message: row(1, "first"),
      dispatch: "dispatched",
    });
    store.applyUserMessagePersisted({
      sessionId: SID,
      message: row(2, "second"),
      dispatch: "pending",
    });
    store.applyUserMessagePersisted({
      sessionId: SID,
      message: row(1, "first"),
      dispatch: "persisted_only",
    });

    expect(slice().turns).toHaveLength(2);
    expect(slice()).toMatchObject({
      agentRunning: true,
      sendPhase: "starting",
    });
  });

  it("a claimed echo is no longer retractable", () => {
    const store = useMessagesStore.getState();
    store.appendUserTurn(SID, "hi", "req-1");
    store.applyUserMessagePersisted({
      sessionId: SID,
      message: row(1, "hi"),
      dispatch: "pending",
      clientRequestId: "req-1",
    });

    useMessagesStore.getState().retractUserTurn(SID, "req-1");

    expect(slice().turns).toHaveLength(1);
    expect(slice()).toMatchObject({
      agentRunning: true,
      sendPhase: "starting",
    });
  });
});
