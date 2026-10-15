import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the send is mocked: the pending-flag bookkeeping stays real.
const notifyMocks = vi.hoisted(() => ({
  sendGatedSystemNotification: vi.fn(),
}));

vi.mock("@/lib/notify", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sendGatedSystemNotification: notifyMocks.sendGatedSystemNotification,
  };
});

import {
  applySubtaskDispatched,
  applySubtaskReportUndelivered,
  dispatchIPCEvent,
  noteSubtaskReportPersisted,
} from "@/lib/ipc-handlers";
import {
  consumeReplyNotifyPending,
  markReplyNotifyPending,
} from "@/lib/notify";
import type { UserMessagePersistedPayload } from "@/lib/session-send";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useSubtasksStore } from "@/stores/subtasks";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";
import type { ExitReason, IPCEvent } from "@/types/ipc";

/**
 * Main chat ticket 31, point 4: one voice. An unpromoted subtask no
 * longer notifies on its own — Core wakes the main chat when its run
 * ends (ticket 29), and the assistant's reply to that report notifies
 * like a reply to the user's own message; a reply that says nothing
 * (`<no-reply/>`) notifies nobody. A subtask's own notifications (ticket
 * 06a) come back only when the report could not be delivered.
 */

const MAIN = "s-main";
const SUB = "s-sub";
const DONE: ExitReason = { result: "CURRENT_TASK_DONE", data: null };

function seed(extra: { promoted?: boolean } = {}): void {
  useSessionsStore.setState({
    sessions: [
      makeSession({
        id: MAIN,
        title: "主聊天",
        mainChat: true,
        gaRuntimeKind: "managed",
      }),
      makeSession({
        id: SUB,
        title: "整理 PDF",
        parentSessionId: MAIN,
        gaRuntimeKind: "managed",
        ...extra,
      }),
    ],
    activeSessionId: MAIN,
  });
  usePrefsStore.setState({ languagePreference: "zh-CN" });
  for (const id of [MAIN, SUB]) {
    useMessagesStore.getState().ensureMessages(id);
    useRuntimeStore.getState().ensureRuntime(id, { cachedLLMs: [] });
  }
}

/** Core dispatched the subtask's run, `minutesAgo` minutes ago. */
function startRun(minutesAgo: number): void {
  useMessagesStore.getState().applyUserMessagePersisted({
    sessionId: SUB,
    message: {
      content: "把下载文件夹里的 PDF 按内容分类",
      turnIndex: 0,
      createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      origin: { via: "subtask" },
    },
    dispatch: "dispatched",
  });
}

function finalTurnEnd(
  extra: Partial<Extract<IPCEvent, { kind: "turn_end" }>> = {},
): IPCEvent {
  return {
    kind: "turn_end",
    sessionId: SUB,
    turnIndex: 1,
    summary: "30 个 PDF 分成 5 类",
    toolCalls: [],
    toolResults: [],
    responseContent: "分好了。",
    exitReason: DONE,
    timestamp: "2026-10-13T08:30:00.000Z",
    ...extra,
  };
}

function runError(sessionId = SUB): IPCEvent {
  return {
    kind: "error",
    sessionId,
    message: "quota exceeded",
    category: "runtime",
    severity: "error",
    retryable: false,
    hint: "quota_exceeded",
    context: null,
    traceback: null,
    timestamp: "2026-10-13T08:01:00.000Z",
  };
}

/** Core woke the main chat with a report on the subtask (ticket 29). */
function report(
  dispatch: UserMessagePersistedPayload["dispatch"] = "dispatched",
): UserMessagePersistedPayload {
  const payload: UserMessagePersistedPayload = {
    sessionId: MAIN,
    message: {
      id: `msg_${MAIN}_9_user`,
      content: "[Galley — not a message from the user] …",
      turnIndex: 9,
      createdAt: "2026-10-13T08:31:00.000Z",
      origin: { via: "system", supervisor: "galley-report", reason: SUB },
    },
    dispatch,
  };
  useMessagesStore.getState().applyUserMessagePersisted(payload);
  noteSubtaskReportPersisted(payload);
  return payload;
}

/** The run is over (Core reports it to the main chat after this). */
function runComplete(sessionId = SUB): IPCEvent {
  return {
    kind: "run_complete",
    sessionId,
    exitReason: DONE,
    finalContent: "",
    totalTurns: 1,
    timestamp: "2026-10-13T08:30:01.000Z",
  };
}

function sent(): Array<[string, Record<string, unknown>]> {
  return notifyMocks.sendGatedSystemNotification.mock.calls as never;
}

beforeEach(() => {
  resetStores();
  useSubtasksStore.setState(useSubtasksStore.getInitialState(), true);
  notifyMocks.sendGatedSystemNotification.mockReset();
  notifyMocks.sendGatedSystemNotification.mockResolvedValue(undefined);
  consumeReplyNotifyPending(SUB);
  consumeReplyNotifyPending(MAIN);
});

describe("an unpromoted subtask is heard through the assistant", () => {
  it("does not notify its question, and drops a card answer's flag", () => {
    seed();
    startRun(0);
    markReplyNotifyPending(SUB);
    dispatchIPCEvent({
      kind: "ask_user",
      sessionId: SUB,
      question: "要把发票单独放吗？",
      candidates: ["要", "不要"],
      timestamp: "2026-10-13T08:01:00.000Z",
    });
    expect(sent()).toEqual([]);
    expect(consumeReplyNotifyPending(SUB)).toBe(false);
    // The card still asks.
    expect(useMessagesStore.getState().byId[SUB].pendingAskUser?.question).toBe(
      "要把发票单独放吗？",
    );
  });

  it("does not notify its answer, however long it ran", () => {
    seed();
    startRun(30);
    markReplyNotifyPending(SUB);
    dispatchIPCEvent(finalTurnEnd());
    expect(sent()).toEqual([]);
    expect(consumeReplyNotifyPending(SUB)).toBe(false);
  });

  it("does not notify an error, and still shows it on the card until the next run", () => {
    seed();
    startRun(0);
    dispatchIPCEvent(runError());
    expect(sent()).toEqual([]);
    expect(useSubtasksStore.getState().runErrors[SUB]).toBe("quota exceeded");
    dispatchIPCEvent({
      kind: "turn_start",
      sessionId: SUB,
      turnIndex: 1,
      timestamp: "2026-10-13T08:02:00.000Z",
    });
    expect(useSubtasksStore.getState().runErrors[SUB]).toBeUndefined();
  });

  it("stores dispatches that did not start without notifying them", () => {
    seed();
    applySubtaskDispatched({
      parentSessionId: MAIN,
      dispatches: [
        {
          parentSessionId: MAIN,
          turnIndex: 4,
          ordinal: 0,
          messageId: `msg_${MAIN}_4_assistant`,
          sessionId: null,
          title: "",
          failure: "unclosed",
          failureDetail: null,
          createdAt: "2026-10-13T08:00:00.000Z",
        },
      ],
    });
    expect(useSubtasksStore.getState().byParent[MAIN]).toHaveLength(1);
    expect(sent()).toEqual([]);
  });

  it("follows the ordinary rule once promoted: silent for a run it did not start here", () => {
    seed({ promoted: true });
    startRun(0);
    dispatchIPCEvent({
      kind: "ask_user",
      sessionId: SUB,
      question: "要把发票单独放吗？",
      candidates: [],
      timestamp: "2026-10-13T08:01:00.000Z",
    });
    expect(sent()).toEqual([]);
  });
});

describe("a report that could not wake the main chat", () => {
  it("falls back to each subtask's own notification, from how it stands now", () => {
    seed();
    useSessionsStore.setState({
      sessions: [
        ...useSessionsStore.getState().sessions,
        makeSession({ id: "s-ask", title: "订机票", parentSessionId: MAIN }),
        makeSession({ id: "s-err", title: "查报价", parentSessionId: MAIN }),
        makeSession({ id: "s-run", title: "写周报", parentSessionId: MAIN }),
      ],
    });
    // Done after three minutes of running (the run's telemetry).
    startRun(0);
    dispatchIPCEvent(finalTurnEnd({ telemetry: { elapsedMs: 180_000 } }));
    dispatchIPCEvent(runComplete());
    useSessionsStore
      .getState()
      .bumpSessionAfterTurn(SUB, "30 个 PDF 分成 5 类");
    useMessagesStore.getState().setPendingAskUser("s-ask", {
      question: "坐窗边还是过道？",
      candidates: [],
    });
    useMessagesStore.getState().ensureMessages("s-err");
    useMessagesStore.getState().ensureMessages("s-run");
    dispatchIPCEvent(runError("s-err"));
    useMessagesStore.getState().setAgentRunning("s-run", true);
    expect(sent()).toEqual([]);

    applySubtaskReportUndelivered({
      mainChatId: MAIN,
      subtaskIds: [SUB, "s-ask", "s-err", "s-run", "s-gone"],
    });
    expect(sent()).toEqual([
      [
        "replyDone",
        {
          title: "子任务完成",
          body: "整理 PDF · 30 个 PDF 分成 5 类",
          throttleKey: `reply:${SUB}`,
          tone: "done",
        },
      ],
      [
        "askUser",
        {
          title: "子任务在问你",
          body: "订机票 · 坐窗边还是过道？",
          throttleKey: "reply:s-ask",
          tone: "needsYou",
        },
      ],
      [
        "subtaskFailed",
        {
          title: "子任务出错",
          body: "查报价 · 出错：quota exceeded",
          throttleKey: "subtask-failed:s-err",
          tone: "alert",
        },
      ],
    ]);
  });

  it("keeps the two-minute rule for done", () => {
    seed();
    startRun(0);
    dispatchIPCEvent(finalTurnEnd({ telemetry: { elapsedMs: 20_000 } }));
    dispatchIPCEvent(runComplete());
    applySubtaskReportUndelivered({ mainChatId: MAIN, subtaskIds: [SUB] });
    expect(sent()).toEqual([]);
  });
});

describe("the assistant's reply to a report", () => {
  function mainTurnEnd(responseContent: string): IPCEvent {
    return {
      kind: "turn_end",
      sessionId: MAIN,
      turnIndex: 1,
      summary: "汇报子任务结果",
      toolCalls: [],
      toolResults: [],
      responseContent,
      exitReason: DONE,
      absoluteTurnIndex: 10,
      timestamp: "2026-10-13T08:31:30.000Z",
    };
  }

  it("notifies as a finished reply when it says something", () => {
    seed();
    report();
    expect(consumeReplyNotifyPending(MAIN)).toBe(true);
    report();
    dispatchIPCEvent(mainTurnEnd("PDF 分好了：发票、合同、论文各一类。"));
    expect(sent()).toEqual([
      [
        "replyDone",
        {
          title: "回复完成",
          body: "主聊天 · 汇报子任务结果",
          throttleKey: `reply:${MAIN}`,
        },
      ],
    ]);
  });

  it("says nothing when it said nothing: no notification, no unread, the ghost suggestion stays", () => {
    seed();
    useSessionsStore.setState({ activeSessionId: undefined });
    useMessagesStore.getState().setNextSuggestion(MAIN, "分类做到哪了");
    const tick = useMessagesStore.getState().userSubmitTick;
    report();
    // The report runs the main chat, as any dispatched row does …
    expect(useMessagesStore.getState().byId[MAIN].agentRunning).toBe(true);
    dispatchIPCEvent(mainTurnEnd("<no-reply/>"));
    expect(sent()).toEqual([]);
    expect(consumeReplyNotifyPending(MAIN)).toBe(false);
    const main = useSessionsStore
      .getState()
      .sessions.find((s) => s.id === MAIN);
    expect(main?.hasUnread).toBeFalsy();
    expect(useMessagesStore.getState().byId[MAIN].nextSuggestion).toBe(
      "分类做到哪了",
    );
    // … but moves no viewport: the user sent nothing.
    expect(useMessagesStore.getState().userSubmitTick).toBe(tick);
  });

  it("leaves no flag for a report that was not dispatched", () => {
    seed();
    report("persisted_only");
    expect(consumeReplyNotifyPending(MAIN)).toBe(false);
  });

  it("treats <no-reply/> outside a report round as a reply that was only tags", () => {
    seed();
    useSessionsStore.setState({ activeSessionId: undefined });
    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: MAIN,
      message: {
        id: `msg_${MAIN}_9_user`,
        content: "帮我把 PDF 分类",
        turnIndex: 9,
        createdAt: "2026-10-13T08:31:00.000Z",
      },
      dispatch: "dispatched",
    });
    markReplyNotifyPending(MAIN);
    dispatchIPCEvent(mainTurnEnd("<no-reply/>"));
    expect(sent().map(([kind]) => kind)).toEqual(["replyDone"]);
    expect(
      useSessionsStore.getState().sessions.find((s) => s.id === MAIN)
        ?.hasUnread,
    ).toBe(true);
  });
});
