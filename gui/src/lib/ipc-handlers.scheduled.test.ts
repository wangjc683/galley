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
  applySubtaskReportUndelivered,
  dispatchIPCEvent,
  noteSubtaskReportPersisted,
} from "@/lib/ipc-handlers";
import { consumeReplyNotifyPending } from "@/lib/notify";
import type { UserMessagePersistedPayload } from "@/lib/session-send";
import { hiddenReportTurns } from "@/lib/subtasks";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";
import type { ExitReason, IPCEvent } from "@/types/ipc";

/**
 * Main chat ticket 37, part 3: scheduled work has one voice, the
 * assistant's. A reminder's wake is a report row like a subtask's (ticket
 * 33): hidden on the page, and the reply to it notifies. A session a
 * scheduled task started (`target = session`) reports its run to the
 * assistant (Core, ticket 33) and never notified on its own — the
 * desktop's reply notification is only for a run sent from here
 * (scheduled-tasks ruling 7) — nor does it when the report could not be
 * delivered: the fallback is a subtask's only. Pinned so neither grows a
 * second voice.
 */

const MAIN = "s-main";
const RUN = "s-scheduled";
const DONE: ExitReason = { result: "CURRENT_TASK_DONE", data: null };

function seed(): void {
  useSessionsStore.setState({
    sessions: [
      makeSession({
        id: MAIN,
        title: "主聊天",
        mainChat: true,
        gaRuntimeKind: "managed",
      }),
      makeSession({
        id: RUN,
        title: "整理今天的新闻",
        gaRuntimeKind: "managed",
        origin: {
          via: "supervisor",
          supervisor: "galley-scheduler",
          reason: "scheduled task sched_news",
        },
      }),
    ],
    activeSessionId: MAIN,
  });
  usePrefsStore.setState({ languagePreference: "zh-CN" });
  for (const id of [MAIN, RUN]) {
    useMessagesStore.getState().ensureMessages(id);
    useRuntimeStore.getState().ensureRuntime(id, { cachedLLMs: [] });
  }
}

function sent(): unknown[] {
  return notifyMocks.sendGatedSystemNotification.mock.calls;
}

beforeEach(() => {
  resetStores();
  notifyMocks.sendGatedSystemNotification.mockReset();
  notifyMocks.sendGatedSystemNotification.mockResolvedValue(undefined);
  consumeReplyNotifyPending(RUN);
  consumeReplyNotifyPending(MAIN);
});

describe("scheduled work is heard through the assistant", () => {
  it("a scheduled session's run ends without a notification of its own", () => {
    seed();
    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: RUN,
      message: {
        content: "整理今天的新闻",
        turnIndex: 0,
        createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
        origin: {
          via: "supervisor",
          supervisor: "galley-scheduler",
          reason: "scheduled task sched_news",
        },
      },
      dispatch: "dispatched",
    });
    const end: IPCEvent = {
      kind: "turn_end",
      sessionId: RUN,
      turnIndex: 1,
      summary: "五条要闻",
      toolCalls: [],
      toolResults: [],
      responseContent: "整理好了。",
      exitReason: DONE,
      timestamp: "2026-10-16T08:10:00.000Z",
    };
    dispatchIPCEvent(end);
    expect(sent()).toEqual([]);
    // Its report could not reach the assistant: still no second voice.
    applySubtaskReportUndelivered({ mainChatId: MAIN, subtaskIds: [RUN] });
    expect(sent()).toEqual([]);
  });

  it("a reminder's wake row is hidden and the reply to it notifies once", () => {
    seed();
    const payload: UserMessagePersistedPayload = {
      sessionId: MAIN,
      message: {
        id: `msg_${MAIN}_9_user`,
        content:
          "[Galley — not a message from the user] A reminder you set came due.",
        turnIndex: 9,
        createdAt: "2026-10-16T09:00:05.000Z",
        origin: {
          via: "system",
          supervisor: "galley-report",
          reason: "sched_water",
        },
      },
      dispatch: "dispatched",
    };
    useMessagesStore.getState().applyUserMessagePersisted(payload);
    noteSubtaskReportPersisted(payload);
    dispatchIPCEvent({
      kind: "turn_end",
      sessionId: MAIN,
      turnIndex: 10,
      summary: "提醒喝水",
      toolCalls: [],
      toolResults: [],
      responseContent: "该喝水了。",
      exitReason: DONE,
      timestamp: "2026-10-16T09:00:09.000Z",
    });
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toEqual([
      "replyDone",
      expect.objectContaining({ throttleKey: `reply:${MAIN}` }),
    ]);
    const turns = useMessagesStore.getState().byId[MAIN].turns;
    const wake = turns.findIndex(
      (t) => t.role === "user" && t.origin?.supervisor === "galley-report",
    );
    expect(wake).toBeGreaterThan(-1);
    expect(hiddenReportTurns(turns).has(wake)).toBe(true);
  });
});
