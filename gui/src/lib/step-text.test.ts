// A step's own words, sent before its tools ran (main chat ticket 142): the
// same `tell_user` event and the same kind of row as a line told mid-run
// (ticket 137), with `stepText` and Core's shown-only origin. The page
// draws them as the line, once: the step that wrote them stays a step.

import { beforeEach, describe, expect, it } from "vitest";

import { assistantLinePlan } from "@/lib/assistant-conversation";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { buildRunGroups } from "@/lib/run-groups";
import { useMessagesStore } from "@/stores/messages";
import { rowsToTurns } from "@/stores/messages/rowsToTurns";
import { useSessionsStore } from "@/stores/sessions";
import { makeMessageRow, makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";
import type { AgentTurn } from "@/types/conversation";

const WORDS = "我先看一下这份笔记。";

describe("restoring the step's words", () => {
  const rows = [
    makeMessageRow({ role: "user", turn_index: 10, content: "看看笔记" }),
    makeMessageRow({
      role: "assistant",
      turn_index: 10,
      content: `<summary>读笔记</summary>\n${WORDS}`,
      tool_calls: JSON.stringify([{ toolName: "file_read", args: {} }]),
      final_answer: WORDS,
      summary: "读笔记",
    }),
    makeMessageRow({
      id: "msg_s_10_tell_1",
      role: "assistant",
      turn_index: 10,
      sequence: 2,
      content: WORDS,
      final_answer: WORDS,
      created_via: "system",
      supervisor: "galley-step-text",
    }),
    makeMessageRow({
      role: "assistant",
      turn_index: 11,
      tool_calls: JSON.stringify([{ toolName: "no_tool", args: {} }]),
      final_answer: "笔记里只有一行。",
    }),
  ];

  it("reads the row as the line, not the greeting", () => {
    const turns = rowsToTurns(rows);
    expect(turns[2]).toMatchObject({
      role: "agent",
      interim: true,
      messageId: "msg_s_10_tell_1",
      finalAnswer: WORDS,
      tools: [],
    });
    expect((turns[2] as AgentTurn).greeting).toBeUndefined();
  });

  it("draws the words once: the line, then the reply", () => {
    const turns = rowsToTurns(rows);
    const groups = buildRunGroups(turns, { splitAfterAnswer: true });
    const plan = assistantLinePlan(groups, turns, null);
    expect([...plan.message].sort()).toEqual([0, 2, 3]);
    expect(plan.steps.get(3)?.members).toEqual([1, 3]);
  });
});

describe("live: a step's words", () => {
  const SID = "s-main";

  beforeEach(() => {
    resetStores();
    useSessionsStore.setState({
      sessions: [makeSession({ id: SID, mainChat: true })],
      activeSessionId: SID,
    });
    useMessagesStore.getState().ensureMessages(SID);
  });

  it("land as the line, with Core's row id", () => {
    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: SID,
      message: { id: `msg_${SID}_10_user`, content: "看看笔记", turnIndex: 10 },
      dispatch: "dispatched",
    });
    dispatchIPCEvent({
      kind: "tell_user",
      sessionId: SID,
      message: WORDS,
      turnIndex: 1,
      index: 1,
      absoluteTurnIndex: 10,
      visibility: "visible",
      stepText: true,
      timestamp: "2026-11-03T08:00:09+08:00",
    });
    const turns = useMessagesStore.getState().byId[SID].turns;
    expect(turns[1]).toMatchObject({
      interim: true,
      messageId: `msg_${SID}_10_tell_1`,
      finalAnswer: WORDS,
    });
  });
});
