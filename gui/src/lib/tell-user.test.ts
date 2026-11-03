// A line the main chat's model tells you mid-run (main chat ticket 137,
// its `tell_user` tool): how the run, the conversation's plan, the line
// under the dots, a restore, the card and deleting read it.

import { beforeEach, describe, expect, it } from "vitest";

import { interimTurn } from "@/lib/agent-turn";
import { askUserReplyContent } from "@/lib/ask-user-candidates";
import { lastVisibleMessage } from "@/lib/assistant";
import {
  assistantLinePlan,
  stoppedRunTurns,
} from "@/lib/assistant-conversation";
import { assistantDoing } from "@/lib/assistant-progress";
import { copyForLanguage } from "@/lib/i18n";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { deletableAt, messageRowIds } from "@/lib/message-delete";
import {
  buildRunGroups,
  liveRunGroup,
  pendingReplyStepBase,
  replyUserIndices,
  runStepNumbers,
  stoppedPartway,
} from "@/lib/run-groups";
import { useMessagesStore } from "@/stores/messages";
import {
  derivePendingAskUser,
  rowsToTurns,
} from "@/stores/messages/rowsToTurns";
import { useSessionsStore } from "@/stores/sessions";
import { makeMessageRow, makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

const zh = copyForLanguage("zh-CN");

function tool(
  name: string,
  args: Record<string, unknown> = {},
): ConversationToolEvent {
  return { id: `t-${name}`, name, status: "success-historical", args };
}

function user(content: string, extra: Partial<UserTurn> = {}): UserTurn {
  return { role: "user", content, messageId: `u-${content}`, ...extra };
}

function step(summary: string, id = `s-${summary}`): AgentTurn {
  return {
    role: "agent",
    tools: [tool("file_read")],
    finalAnswer: null,
    summary,
    messageId: id,
  };
}

function told(text: string, step = 1): AgentTurn {
  const turn = interimTurn(text, step);
  turn.messageId = `t-${text}`;
  return turn;
}

function answer(text: string): AgentTurn {
  return {
    role: "agent",
    tools: [tool("no_tool")],
    finalAnswer: text,
    messageId: `a-${text}`,
    telemetry: {
      elapsedMs: 9000,
      inputTokens: 10,
      outputTokens: 5,
      requestCount: 3,
    },
  };
}

function ask(question: string): AgentTurn {
  return {
    role: "agent",
    tools: [
      tool("tell_user", { message: "在查" }),
      tool("ask_user", { question }),
    ],
    finalAnswer: null,
    messageId: `q-${question}`,
  };
}

describe("the line's turn", () => {
  it("is cleaned as a reply is and marked interim", () => {
    const turn = interimTurn(
      "记上了，<summary>告知</summary>天气还在查 [FILE:/tmp/a.md]",
      2,
      "t",
    );
    expect(turn).toMatchObject({
      role: "agent",
      interim: true,
      tools: [],
      turnIndex: 2,
      settledAt: "t",
    });
    expect(turn.finalAnswer).toBe("记上了，天气还在查");
    expect(turn.files).toEqual(["/tmp/a.md"]);
  });
});

describe("a run with a line told mid-run", () => {
  const turns: Turn[] = [
    user("查明天天气"),
    step("先查城市"),
    told("记上了，天气还在查", 2),
    user("顺便提醒我买牛奶", { interjected: true }),
    step("查上海的预报"),
    answer("上海明天晴。"),
  ];

  it("is one run; the line a member and no step", () => {
    const groups = buildRunGroups(turns);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIndices).toEqual([0, 1, 2, 3, 4, 5]);
    expect(groups[0].complete).toBe(true);
    expect(groups[0].finalTurnIndex).toBe(5);
    expect(groups[0].stats.stepCount).toBe(3);
    expect(groups[0].stats.elapsedMs).toBe(9000);
    const numbers = runStepNumbers(groups, turns);
    expect([...numbers.keys()]).toEqual([1, 4, 5]);
    expect([...numbers.values()]).toEqual([1, 2, 3]);
  });

  it("is a bubble of its own; the process card has the steps only", () => {
    const groups = buildRunGroups(turns, { splitAfterAnswer: true });
    const plan = assistantLinePlan(groups, turns, null);
    expect([...plan.message].sort()).toEqual([0, 2, 3, 5]);
    expect(plan.steps.get(5)?.members).toEqual([1, 4, 5]);
  });

  it("while live: the run stays open after the line, which is drawn", () => {
    const live = turns.slice(0, 3);
    const groups = buildRunGroups(live, { splitAfterAnswer: true });
    expect(groups[0].complete).toBe(false);
    const liveGroup = liveRunGroup(groups, true, false);
    expect(liveGroup).toBe(groups[0]);
    const plan = assistantLinePlan(groups, live, liveGroup);
    expect(plan.message.has(2)).toBe(true);
    expect(plan.steps.size).toBe(0);
  });

  it("the line under the dots goes on saying what it was doing", () => {
    expect(assistantDoing(turns.slice(0, 3), "", zh)).toBe("先查城市");
    expect(assistantDoing(turns.slice(0, 4), "", zh)).toBe("先查城市");
  });

  it("a run stopped after a line: its line stays a message, its steps the stopped line", () => {
    const stopped = turns.slice(0, 3);
    const groups = buildRunGroups(stopped, { splitAfterAnswer: true });
    expect(stoppedPartway(groups[0], stopped, null)).toBe(true);
    expect([...stoppedRunTurns(stopped)]).toEqual([1]);
    const plan = assistantLinePlan(groups, stopped, null);
    expect(plan.message.has(2)).toBe(true);
    expect(plan.stopped.get(2)?.members).toEqual([1]);
    // The card's last message at rest is the line.
    expect(lastVisibleMessage(stopped, zh)?.text).toBe("记上了，天气还在查");
  });

  it("deleting the line takes the line; deleting the reply leaves it", () => {
    const groups = buildRunGroups(turns, { splitAfterAnswer: true });
    const plan = assistantLinePlan(groups, turns, null);
    expect(messageRowIds(turns, groups, 2)).toEqual(["t-记上了，天气还在查"]);
    expect(deletableAt(turns, plan, groups, 2)).toEqual({
      messageId: "t-记上了，天气还在查",
      replyAnswerId: null,
    });
    expect(messageRowIds(turns, groups, 5)).toEqual([
      "s-先查城市",
      "s-查上海的预报",
      "a-上海明天晴。",
    ]);
  });
});

describe("a line told in the step that asked", () => {
  // The line's row sorts after the asking step's.
  const turns: Turn[] = [
    user("查天气"),
    ask("哪个城市？"),
    told("在查"),
    user("上海"),
  ];

  it("your answer still answers the question", () => {
    const groups = buildRunGroups(turns);
    expect(groups).toHaveLength(1);
    expect([...replyUserIndices(groups, turns)]).toEqual([3]);
    expect(askUserReplyContent(turns, 1, replyUserIndices(groups, turns))).toBe(
      "上海",
    );
    // Before the answer the question is pending, the line notwithstanding.
    expect(derivePendingAskUser(turns.slice(0, 3))).toEqual({
      question: "哪个城市？",
      candidates: [],
    });
    expect(pendingReplyStepBase(turns.slice(0, 3))).toBe(1);
  });
});

describe("restoring", () => {
  it("reads an assistant row past sequence 1 as the line, after its step", () => {
    const rows = [
      makeMessageRow({ role: "user", turn_index: 10, content: "查明天天气" }),
      makeMessageRow({
        role: "assistant",
        turn_index: 10,
        tool_calls: JSON.stringify([{ toolName: "file_read", args: {} }]),
        summary: "先查城市",
      }),
      makeMessageRow({
        role: "assistant",
        turn_index: 11,
        tool_calls: JSON.stringify([
          { toolName: "tell_user", args: { message: "在查" } },
        ]),
        summary: "先回一句",
      }),
      makeMessageRow({
        id: "msg_s_11_tell_1",
        role: "assistant",
        turn_index: 11,
        sequence: 2,
        content: "记上了，<summary>x</summary>天气还在查",
        final_answer: "记上了，天气还在查",
        created_at: "2026-11-03T08:00:09.000Z",
      }),
      makeMessageRow({
        role: "assistant",
        turn_index: 12,
        tool_calls: JSON.stringify([{ toolName: "no_tool", args: {} }]),
        final_answer: "上海明天晴。",
      }),
    ];
    const turns = rowsToTurns(rows);
    const line = turns[3] as AgentTurn;
    expect(line).toMatchObject({
      role: "agent",
      interim: true,
      messageId: "msg_s_11_tell_1",
      finalAnswer: "记上了，天气还在查",
      turnIndex: 2,
      settledAt: "2026-11-03T08:00:09.000Z",
      tools: [],
    });
    // The live path builds the same turn.
    const live = interimTurn(
      "记上了，<summary>x</summary>天气还在查",
      2,
      "2026-11-03T08:00:09.000Z",
    );
    live.messageId = "msg_s_11_tell_1";
    expect(line).toEqual(live);
    // The steps around it keep their numbers.
    expect((turns[4] as AgentTurn).turnIndex).toBe(3);
    expect(buildRunGroups(turns)[0].stats.stepCount).toBe(3);
  });
});

describe("live: the tell_user event", () => {
  const SID = "s-main";

  beforeEach(() => {
    resetStores();
    useSessionsStore.setState({
      sessions: [makeSession({ id: SID, mainChat: true })],
      activeSessionId: SID,
    });
    useMessagesStore.getState().ensureMessages(SID);
  });

  function turns(): Turn[] {
    return useMessagesStore.getState().byId[SID].turns;
  }

  it("lands as the line with Core's row id; its step lands before it", () => {
    const store = useMessagesStore.getState();
    store.applyUserMessagePersisted({
      sessionId: SID,
      message: {
        id: `msg_${SID}_10_user`,
        content: "查明天天气",
        turnIndex: 10,
      },
      dispatch: "dispatched",
    });
    store.appendAgentTurn(SID, { ...step("先查城市"), turnIndex: 1 });
    store.setAgentRunning(SID, true);
    store.appendInFlightDelta(SID, "<summary>先回一句</summary>");
    // A pending interjection waits at the end.
    store.syncInterjections(SID, [
      {
        queueId: "qm_1",
        text: "买牛奶",
        queuedAt: "2026-11-03T08:00:05.000Z",
        interjected: true,
      },
    ]);

    dispatchIPCEvent({
      kind: "tell_user",
      sessionId: SID,
      message: "记上了，天气还在查",
      turnIndex: 2,
      index: 1,
      absoluteTurnIndex: 11,
      visibility: "visible",
      timestamp: "2026-11-03T08:00:09+08:00",
    });

    let now = turns();
    expect(now.map((t) => t.role)).toEqual(["user", "agent", "agent", "user"]);
    expect(now[2]).toMatchObject({
      interim: true,
      messageId: `msg_${SID}_11_tell_1`,
      finalAnswer: "记上了，天气还在查",
      turnIndex: 2,
    });
    // The step streaming now is left as it was.
    const m = useMessagesStore.getState().byId[SID];
    expect(m.agentRunning).toBe(true);
    expect(m.inFlightContent).toBe("<summary>先回一句</summary>");

    // Its step's turn_end lands before it; the next step after it.
    useMessagesStore
      .getState()
      .appendAgentTurn(SID, { ...step("先回一句"), turnIndex: 2 });
    useMessagesStore
      .getState()
      .appendAgentTurn(SID, { ...step("再查"), turnIndex: 3 });
    now = turns();
    expect(
      now.map((t) =>
        t.role === "agent" ? (t.interim ? "line" : t.summary) : t.content,
      ),
    ).toEqual(["查明天天气", "先查城市", "先回一句", "line", "再查", "买牛奶"]);
  });

  it("an internal run's line is not drawn", () => {
    dispatchIPCEvent({
      kind: "tell_user",
      sessionId: SID,
      message: "x",
      turnIndex: 1,
      index: 1,
      absoluteTurnIndex: 3,
      visibility: "internal",
      timestamp: "t",
    });
    expect(turns()).toEqual([]);
  });
});
