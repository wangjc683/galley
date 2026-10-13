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
  dispatchIPCEvent,
  notifySubtaskRunnerCrash,
} from "@/lib/ipc-handlers";
import {
  consumeReplyNotifyPending,
  markReplyNotifyPending,
} from "@/lib/notify";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useSubtasksStore } from "@/stores/subtasks";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";
import type { ExitReason, IPCEvent } from "@/types/ipc";

/**
 * Main chat ticket 06a, point 4: an unpromoted subtask notifies when it
 * asks you (always), when it is done (only after two minutes of
 * running) and when it fails (always) — in place of the reply
 * notifications, which only follow runs the user started here.
 */

const SUB = "s-sub";
const DONE: ExitReason = { result: "CURRENT_TASK_DONE", data: null };

function seed(extra: { promoted?: boolean } = {}): void {
  useSessionsStore.setState({
    sessions: [
      makeSession({
        id: "s-main",
        title: "主聊天",
        mainChat: true,
        gaRuntimeKind: "managed",
      }),
      makeSession({
        id: SUB,
        title: "整理 PDF",
        parentSessionId: "s-main",
        gaRuntimeKind: "managed",
        ...extra,
      }),
    ],
    activeSessionId: "s-main",
  });
  usePrefsStore.setState({ languagePreference: "zh-CN" });
  useMessagesStore.getState().ensureMessages(SUB);
  useRuntimeStore.getState().ensureRuntime(SUB, { cachedLLMs: [] });
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

function sent(): Array<[string, Record<string, unknown>]> {
  return notifyMocks.sendGatedSystemNotification.mock.calls as never;
}

beforeEach(() => {
  resetStores();
  useSubtasksStore.setState(useSubtasksStore.getInitialState(), true);
  notifyMocks.sendGatedSystemNotification.mockReset();
  notifyMocks.sendGatedSystemNotification.mockResolvedValue(undefined);
  consumeReplyNotifyPending(SUB);
});

describe("an unpromoted subtask asking you", () => {
  it("always notifies, though nobody started its run here", () => {
    seed();
    startRun(0);
    dispatchIPCEvent({
      kind: "ask_user",
      sessionId: SUB,
      question: "要把发票单独放吗？",
      candidates: ["要", "不要"],
      timestamp: "2026-10-13T08:01:00.000Z",
    });
    expect(sent()).toEqual([
      [
        "askUser",
        {
          title: "子任务在问你",
          body: "整理 PDF · 要把发票单独放吗？",
          throttleKey: `reply:${SUB}`,
          tone: "needsYou",
        },
      ],
    ]);
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

describe("an unpromoted subtask done", () => {
  it("stays silent under two minutes, and takes the reply notification's place", () => {
    seed();
    startRun(1);
    // An answer sent from the card marks the reply flag like any send.
    markReplyNotifyPending(SUB);
    dispatchIPCEvent(finalTurnEnd());
    expect(sent()).toEqual([]);
    expect(consumeReplyNotifyPending(SUB)).toBe(false);
  });

  it("notifies after two minutes of running", () => {
    seed();
    startRun(3);
    dispatchIPCEvent(finalTurnEnd());
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
    ]);
  });
});

describe("an unpromoted subtask failing", () => {
  it("notifies a run error and shows it on the card until the next run", () => {
    seed();
    startRun(0);
    dispatchIPCEvent({
      kind: "error",
      sessionId: SUB,
      message: "quota exceeded",
      category: "runtime",
      severity: "error",
      retryable: false,
      hint: "quota_exceeded",
      context: null,
      traceback: null,
      timestamp: "2026-10-13T08:01:00.000Z",
    });
    expect(sent()).toEqual([
      [
        "subtaskFailed",
        {
          title: "子任务出错",
          body: "整理 PDF · 出错：quota exceeded",
          throttleKey: `subtask-failed:${SUB}`,
          tone: "alert",
        },
      ],
    ]);
    expect(useSubtasksStore.getState().runErrors[SUB]).toBe("quota exceeded");
    dispatchIPCEvent({
      kind: "turn_start",
      sessionId: SUB,
      turnIndex: 1,
      timestamp: "2026-10-13T08:02:00.000Z",
    });
    expect(useSubtasksStore.getState().runErrors[SUB]).toBeUndefined();
  });

  it("ignores business errors and warnings", () => {
    seed();
    for (const [category, severity] of [
      ["business", "error"],
      ["runtime", "warning"],
    ] as const) {
      dispatchIPCEvent({
        kind: "error",
        sessionId: SUB,
        message: "x",
        category,
        severity,
        retryable: false,
        hint: null,
        context: null,
        traceback: null,
        timestamp: "2026-10-13T08:01:00.000Z",
      });
    }
    expect(sent()).toEqual([]);
  });

  it("notifies a runner crash, for a subtask only", () => {
    seed();
    notifySubtaskRunnerCrash(SUB, "Bridge exited with code 1");
    notifySubtaskRunnerCrash("s-main", "Bridge exited with code 1");
    expect(sent().map(([kind, n]) => [kind, n.body])).toEqual([
      ["subtaskFailed", "整理 PDF · 出错：Bridge exited with code 1"],
    ]);
  });

  it("notifies each dispatch of a reply that did not start, and stores them all", () => {
    seed();
    applySubtaskDispatched({
      parentSessionId: "s-main",
      dispatches: [
        {
          parentSessionId: "s-main",
          turnIndex: 4,
          ordinal: 0,
          messageId: "msg_s-main_4_assistant",
          sessionId: SUB,
          title: "整理 PDF",
          failure: null,
          failureDetail: null,
          createdAt: "2026-10-13T08:00:00.000Z",
        },
        {
          parentSessionId: "s-main",
          turnIndex: 4,
          ordinal: 1,
          messageId: "msg_s-main_4_assistant",
          sessionId: null,
          title: "",
          failure: "unclosed",
          failureDetail: null,
          createdAt: "2026-10-13T08:00:00.000Z",
        },
      ],
    });
    expect(useSubtasksStore.getState().byParent["s-main"]).toHaveLength(2);
    expect(sent().map(([, n]) => n.body)).toEqual([
      "子任务 · 没有开始：主对话没写完要做什么",
    ]);
  });
});
