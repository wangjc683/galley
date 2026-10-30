import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the send is mocked: a reply that notifies must not reach the OS.
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

import type { MessageTurnPage } from "@/lib/db";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { useMessagesStore } from "@/stores/messages";
import { rowsToTurns } from "@/stores/messages/rowsToTurns";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { makeMessageRow, makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type { Turn } from "@/types/conversation";
import type { MessageRow } from "@/types/db";
import type { ExitReason } from "@/types/ipc";

/**
 * Ticket 113: a session that gets live turns before this page first
 * opens it (the morning review woke the main chat seconds after launch)
 * still reads its history when it is opened. Whether to read is "this
 * page read the history", not "the transcript in memory is empty"; the
 * read merges what arrived live — rows the page holds once, what is not
 * persisted yet kept.
 */

const MAIN = "s-main";
const SIDE = "s-side";
const DONE: ExitReason = { result: "CURRENT_TASK_DONE", data: null };
const tauriMocks = getTauriMocks();

function row(overrides: Partial<MessageRow>): MessageRow {
  const r = makeMessageRow({ session_id: MAIN, ...overrides });
  return { ...r, id: `msg_${MAIN}_${r.turn_index}_${r.role}` };
}

// What Core holds before the wake: the greeting and one exchange.
const HISTORY = [
  row({
    role: "assistant",
    turn_index: -1,
    content: "你好，我是 Galley。",
    final_answer: "你好，我是 Galley。",
    created_via: "system",
    supervisor: "galley-greeting",
  }),
  row({ role: "user", turn_index: 0, content: "明天十点开会，帮我记一下" }),
  row({
    role: "assistant",
    turn_index: 0,
    content: "记下了。",
    final_answer: "记下了。",
  }),
];
// The wake: its report row, a step, and the silent reply.
const REPORT_ROW = row({
  role: "user",
  turn_index: 1,
  content: "早上的巡看",
  created_via: "system",
  supervisor: "galley-report",
  origin_note: "review",
});
const STEP_1 = row({
  role: "assistant",
  turn_index: 1,
  content: "看一下今天的待办。",
});
const STEP_2 = row({
  role: "assistant",
  turn_index: 2,
  content: "开会的事已经在待办里了。",
});
const SILENT_REPLY = row({
  role: "assistant",
  turn_index: 3,
  content: "<no-reply/>",
});

function page(rows: MessageRow[]): MessageTurnPage {
  return { rows, hasMore: false, previousUserCreatedAt: null };
}

/** The latest page Core serves, read when the invoke arrives. */
let served: MessageTurnPage = page([]);
/** Reads the test releases by hand (`holdReads`). */
let pending: (() => void)[] = [];
let holdReads = false;
let failReads = 0;

function pageCalls(sid: string): number {
  return tauriMocks.invoke.mock.calls.filter(
    ([command, args]) =>
      command === "session_message_turns_page" && args?.sessionId === sid,
  ).length;
}

function slice() {
  return useMessagesStore.getState().byId[MAIN];
}

function messageIds(turns: Turn[]): (string | undefined)[] {
  return turns.map((turn) =>
    turn.role === "system" ? "system" : turn.messageId,
  );
}

/** Core's broadcast of the wake's report row. */
function reportRowLands(): void {
  useMessagesStore.getState().applyUserMessagePersisted({
    sessionId: MAIN,
    message: {
      id: REPORT_ROW.id,
      content: REPORT_ROW.content,
      turnIndex: 1,
      createdAt: REPORT_ROW.created_at,
      origin: { via: "system", supervisor: "galley-report", reason: "review" },
    },
    dispatch: "dispatched",
  });
}

/** The runner's `turn_end` for absolute turn `turn`. */
function stepLands(
  turn: number,
  responseContent: string,
  exitReason: ExitReason | null = null,
): void {
  dispatchIPCEvent({
    kind: "turn_end",
    sessionId: MAIN,
    turnIndex: turn,
    absoluteTurnIndex: turn,
    summary: "",
    toolCalls: [],
    toolResults: [],
    responseContent,
    exitReason,
    timestamp: "2026-10-30T04:21:00.000Z",
  });
}

describe("opening a session after live turns landed (ticket 113)", () => {
  beforeEach(() => {
    resetStores();
    served = page([]);
    pending = [];
    holdReads = false;
    failReads = 0;
    notifyMocks.sendGatedSystemNotification.mockReset();
    notifyMocks.sendGatedSystemNotification.mockResolvedValue(undefined);
    useRuntimeStore.setState({
      ensureSessionRunner: async () => null,
      hasBridgeClient: () => false,
    });
    useSessionsStore.setState({
      sessions: [
        makeSession({
          id: MAIN,
          title: "主聊天",
          mainChat: true,
          gaRuntimeKind: "managed",
          turnCount: 1,
        }),
        makeSession({ id: SIDE, turnCount: 0 }),
      ],
      activeSessionId: undefined,
    });
    tauriMocks.invoke.mockImplementation(async (command) => {
      if (command !== "session_message_turns_page") return undefined;
      if (failReads > 0) {
        failReads -= 1;
        throw new Error("database is locked");
      }
      const answer = served;
      if (!holdReads) return answer;
      return new Promise((resolve) => {
        pending.push(() => resolve(answer));
      });
    });
  });

  it("reads the history when a silent wake landed first: history and the wake, nothing twice", async () => {
    // The wake runs before the page opens the main chat: Core persists
    // each row as it goes, the page hears each one live.
    reportRowLands();
    stepLands(1, STEP_1.content);
    stepLands(3, SILENT_REPLY.content, DONE);
    dispatchIPCEvent({
      kind: "run_complete",
      sessionId: MAIN,
      exitReason: DONE,
      finalContent: "<no-reply/>",
      totalTurns: 2,
      timestamp: "2026-10-30T04:21:34.000Z",
    });
    const live = slice().turns;
    expect(messageIds(live)).toEqual([
      REPORT_ROW.id,
      STEP_1.id,
      SILENT_REPLY.id,
    ]);
    served = page([...HISTORY, REPORT_ROW, STEP_1, SILENT_REPLY]);

    await useSessionsStore
      .getState()
      .activateSession(MAIN, { ensureRunner: false });

    expect(pageCalls(MAIN)).toBe(1);
    const turns = slice().turns;
    expect(messageIds(turns)).toEqual(messageIds(rowsToTurns(served.rows)));
    // The wake's turns on screen are the ones that arrived live.
    expect(turns.slice(-3)).toEqual(live);
    expect(turns[turns.length - 1]).toBe(live[live.length - 1]);
    expect(slice().historyRead).toBe(true);
    expect(slice().agentRunning).toBe(false);
  });

  it("keeps a step still running, and a step the read did not see, when it opens mid-run", async () => {
    reportRowLands();
    stepLands(1, STEP_1.content);
    dispatchIPCEvent({
      kind: "turn_start",
      sessionId: MAIN,
      turnIndex: 2,
      timestamp: "2026-10-30T04:20:55.000Z",
    });
    // Core read the page before step 2 was written.
    served = page([...HISTORY, REPORT_ROW, STEP_1]);
    holdReads = true;

    const opening = useSessionsStore
      .getState()
      .activateSession(MAIN, { ensureRunner: false });
    // While the read is out: step 2 lands, step 3 starts streaming.
    stepLands(2, STEP_2.content);
    dispatchIPCEvent({
      kind: "turn_start",
      sessionId: MAIN,
      turnIndex: 3,
      timestamp: "2026-10-30T04:21:10.000Z",
    });
    dispatchIPCEvent({
      kind: "turn_progress",
      sessionId: MAIN,
      delta: "再看一眼日历",
      source: "llm",
      timestamp: "2026-10-30T04:21:11.000Z",
    });
    expect(pending).toHaveLength(1);
    pending[0]();
    await opening;

    expect(messageIds(slice().turns)).toEqual([
      ...messageIds(rowsToTurns(HISTORY)),
      REPORT_ROW.id,
      STEP_1.id,
      STEP_2.id,
    ]);
    expect(slice()).toMatchObject({
      agentRunning: true,
      currentTurnIndex: 3,
      inFlightContent: "再看一眼日历",
      historyRead: true,
    });
  });

  it("does not read again when the same session is opened a second time", async () => {
    reportRowLands();
    served = page([...HISTORY, REPORT_ROW]);
    await useSessionsStore
      .getState()
      .activateSession(MAIN, { ensureRunner: false });
    const turns = slice().turns;
    await useSessionsStore
      .getState()
      .activateSession(SIDE, { ensureRunner: false });

    const reopening = useSessionsStore
      .getState()
      .activateSession(MAIN, { ensureRunner: false });
    // Nothing to wait for: the pointer moves in the same tick, no frame
    // of a restore in between.
    expect(useSessionsStore.getState().activeSessionId).toBe(MAIN);
    await reopening;

    expect(pageCalls(MAIN)).toBe(1);
    expect(slice().turns).toBe(turns);
    expect(slice().restoring).toBe(false);
  });

  it("reads it on a later activation when the first read failed", async () => {
    failReads = 1;
    served = page([...HISTORY]);
    await useSessionsStore
      .getState()
      .activateSession(MAIN, { ensureRunner: false });
    expect(slice().turns).toEqual([]);

    // The wake lands while nothing is read.
    reportRowLands();
    served = page([...HISTORY, REPORT_ROW]);
    await useSessionsStore
      .getState()
      .activateSession(SIDE, { ensureRunner: false });
    await useSessionsStore
      .getState()
      .activateSession(MAIN, { ensureRunner: false });

    expect(pageCalls(MAIN)).toBe(2);
    expect(messageIds(slice().turns)).toEqual(
      messageIds(rowsToTurns(served.rows)),
    );
    expect(slice().historyRead).toBe(true);
  });
});
