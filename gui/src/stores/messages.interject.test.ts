// What you say while the main chat's run works (main chat ticket 136): the
// store draws it from Core's queue snapshot at the conversation's end,
// keeps it there while it waits, and lets the row that writes it take it
// over in place.

import { beforeEach, describe, expect, it } from "vitest";

import { buildRunGroups } from "@/lib/run-groups";
import type { QueuedMessage } from "@/lib/session-queue";
import { isPendingInterjection, useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";
import type { AgentTurn, Turn } from "@/types/conversation";

const SID = "s-main";

function step(summary: string, final: string | null = null): AgentTurn {
  return {
    role: "agent",
    tools: [
      {
        id: "t",
        name: final ? "no_tool" : "file_read",
        status: "success-historical",
      },
    ],
    finalAnswer: final,
    summary,
  };
}

function item(queueId: string, text: string): QueuedMessage {
  return {
    queueId,
    text,
    queuedAt: "2026-11-03T08:00:05.000Z",
    interjected: true,
    origin: { via: "gui" },
  };
}

function turns(): Turn[] {
  return useMessagesStore.getState().byId[SID].turns;
}

/** A run that has started and done one step. */
function runningWithAStep(): void {
  const store = useMessagesStore.getState();
  store.applyUserMessagePersisted({
    sessionId: SID,
    message: { id: `msg_${SID}_4_user`, content: "查明天天气", turnIndex: 4 },
    dispatch: "dispatched",
  });
  store.appendAgentTurn(SID, step("先看看城市"));
}

describe("interjections (main chat ticket 136)", () => {
  beforeEach(() => {
    resetStores();
    useSessionsStore.setState({
      sessions: [makeSession({ id: SID, mainChat: true })],
      activeSessionId: SID,
    });
  });

  it("draws an interjected queue item as your message at the end, with the send", () => {
    runningWithAStep();
    const tick = useMessagesStore.getState().userSubmitTick;
    const before = useMessagesStore.getState().byId[SID];

    useMessagesStore
      .getState()
      .syncInterjections(SID, [
        item("qm_1", "上海的"),
        { ...item("qm_x", "排队"), interjected: undefined },
      ]);

    const now = useMessagesStore.getState();
    expect(turns()).toHaveLength(3);
    expect(turns()[2]).toMatchObject({
      role: "user",
      content: "上海的",
      interjected: true,
      queueId: "qm_1",
    });
    expect(isPendingInterjection(turns()[2])).toBe(true);
    expect(now.userSubmitTick).toBe(tick + 1);
    expect(now.lastSubmitSource).toBe("queued");
    // The run goes on as it was.
    expect(now.byId[SID].agentRunning).toBe(true);
    expect(now.byId[SID].currentRunStartedAtMs).toBe(
      before.currentRunStartedAtMs,
    );

    // A later snapshot with the same item draws nothing new, plays nothing.
    useMessagesStore
      .getState()
      .syncInterjections(SID, [item("qm_1", "上海的")]);
    expect(turns()).toHaveLength(3);
    expect(useMessagesStore.getState().userSubmitTick).toBe(tick + 1);
  });

  it("keeps a waiting interjection last: steps that land go in before it", () => {
    runningWithAStep();
    useMessagesStore
      .getState()
      .syncInterjections(SID, [item("qm_1", "上海的")]);
    useMessagesStore.getState().appendAgentTurn(SID, step("查上海"));
    expect(turns().map((t) => t.role)).toEqual([
      "user",
      "agent",
      "agent",
      "user",
    ]);
    expect(isPendingInterjection(turns()[3])).toBe(true);
  });

  it("read mid-run: the row takes it over in place, the run goes on, one run", () => {
    runningWithAStep();
    useMessagesStore
      .getState()
      .syncInterjections(SID, [item("qm_1", "上海的")]);
    const tick = useMessagesStore.getState().userSubmitTick;
    const running = useMessagesStore.getState().byId[SID];

    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: SID,
      message: {
        id: `msg_${SID}_4_user_2`,
        content: "上海的",
        turnIndex: 4,
        createdAt: "2026-11-03T08:00:09.000Z",
      },
      dispatch: "interjected",
      queueId: "qm_1",
    });

    const now = useMessagesStore.getState();
    expect(turns()).toHaveLength(3);
    expect(turns()[2]).toMatchObject({
      messageId: `msg_${SID}_4_user_2`,
      interjected: true,
      createdAt: "2026-11-03T08:00:09.000Z",
    });
    expect(isPendingInterjection(turns()[2])).toBe(false);
    expect(now.userSubmitTick).toBe(tick);
    expect(now.byId[SID]).toMatchObject({
      agentRunning: running.agentRunning,
      sendPhase: running.sendPhase,
      turnIndexOffset: running.turnIndexOffset,
      currentRunStartedAtMs: running.currentRunStartedAtMs,
    });

    // The rest of the run lands after it; the reply answers the run.
    useMessagesStore
      .getState()
      .appendAgentTurn(SID, step("给答案", "上海明天晴。"));
    const groups = buildRunGroups(turns());
    expect(groups).toHaveLength(1);
    expect(groups[0].openerIndex).toBe(0);
    expect(groups[0].memberIndices).toEqual([0, 1, 2, 3]);
    expect(groups[0].finalTurnIndex).toBe(3);
    expect(groups[0].stats.stepCount).toBe(2);
  });

  it("not read: the reply lands above it, and it opens the next turn where it stands", () => {
    runningWithAStep();
    useMessagesStore
      .getState()
      .syncInterjections(SID, [item("qm_1", "顺便说下星期几")]);
    useMessagesStore
      .getState()
      .appendAgentTurn(SID, step("给答案", "三点了。"));
    useMessagesStore.getState().setAgentRunning(SID, false);
    const tick = useMessagesStore.getState().userSubmitTick;

    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: SID,
      message: {
        id: `msg_${SID}_6_user`,
        content: "顺便说下星期几",
        turnIndex: 6,
        createdAt: "2026-11-03T08:00:20.000Z",
      },
      dispatch: "dispatched",
      queueId: "qm_1",
    });

    const now = useMessagesStore.getState();
    expect(turns().map((t) => t.role)).toEqual([
      "user",
      "agent",
      "agent",
      "user",
    ]);
    expect(turns()[3]).toMatchObject({ messageId: `msg_${SID}_6_user` });
    expect(turns()[3]).not.toHaveProperty("interjected");
    expect(now.userSubmitTick).toBe(tick);
    expect(now.byId[SID]).toMatchObject({
      agentRunning: true,
      sendPhase: "waiting_agent",
      turnIndexOffset: 5,
    });
    const groups = buildRunGroups(turns());
    expect(groups.map((g) => g.openerIndex)).toEqual([0, 3]);
    expect(groups[0].finalTurnIndex).toBe(2);
  });

  it("an interjected row this page never drew joins the run without touching it", () => {
    runningWithAStep();
    const running = useMessagesStore.getState().byId[SID];
    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: SID,
      message: {
        id: `msg_${SID}_4_user_2`,
        content: "算了，查后天",
        turnIndex: 4,
      },
      dispatch: "interjected",
      queueId: "qm_cli",
    });
    expect(turns()[2]).toMatchObject({
      interjected: true,
      content: "算了，查后天",
    });
    expect(useMessagesStore.getState().byId[SID].sendPhase).toBe(
      running.sendPhase,
    );
    expect(useMessagesStore.getState().byId[SID].agentRunning).toBe(true);
  });
});
