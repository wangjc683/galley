import { beforeEach, describe, expect, it } from "vitest";

import type { MessageTurnPage } from "@/lib/db";
import { buildRailExchanges } from "@/lib/rail-preview";
import { useMessagesStore } from "@/stores/messages";
import { rowsToTurns } from "@/stores/messages/rowsToTurns";
import { useSessionsStore } from "@/stores/sessions";
import { makeMessageRow, makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type { AgentTurn } from "@/types/conversation";
import type { MessageRow } from "@/types/db";

/**
 * Paged conversation history (main-chat ticket 12): the store reads the
 * latest page of whole turns on restore, prepends earlier pages, and
 * pages back to a ⌘K target. Core's paging rule (whole turns, never
 * inside a run) is pinned by core/tests/message_turn_page_test.rs; the
 * fake Core here serves pages cut the way it would.
 */

const SID = "s-paged";
const tauriMocks = getTauriMocks();

const ASK_USER = JSON.stringify([
  { toolName: "ask_user", args: { question: "A or B?" } },
]);
const READ_FILE = JSON.stringify([
  { toolName: "file_read", args: { path: "notes.md" } },
]);

function row(overrides: Partial<MessageRow>): MessageRow {
  const r = makeMessageRow({ session_id: SID, ...overrides });
  return { ...r, id: `msg_${SID}_${r.turn_index}_${r.role}` };
}

// Three runs: a one-step exchange (turn 0); a run that asks, is
// answered and goes on for two more steps (turns 1–3); a two-step run
// (turns 4–5). Pages: [4, 5], [1, 2, 3], [0].
const RUN_A = [
  row({ role: "user", turn_index: 0, content: "first question" }),
  row({ role: "assistant", turn_index: 0, final_answer: "first answer" }),
];
const RUN_B = [
  row({
    role: "user",
    turn_index: 1,
    content: "second question",
    created_at: "2026-06-18T09:00:00.000Z",
  }),
  row({ role: "assistant", turn_index: 1, tool_calls: ASK_USER }),
  row({ role: "user", turn_index: 2, content: "B" }),
  row({ role: "assistant", turn_index: 2, tool_calls: READ_FILE }),
  row({ role: "assistant", turn_index: 3, final_answer: "second answer" }),
];
const RUN_C = [
  row({ role: "user", turn_index: 4, content: "third question" }),
  row({ role: "assistant", turn_index: 4, tool_calls: READ_FILE }),
  row({ role: "assistant", turn_index: 5, final_answer: "third answer" }),
];
const ALL_ROWS = [...RUN_A, ...RUN_B, ...RUN_C];

const PAGES: Record<string, MessageTurnPage> = {
  latest: {
    rows: RUN_C,
    hasMore: true,
    previousUserCreatedAt: "2026-06-18T09:00:00.000Z",
  },
  "4": {
    rows: RUN_B,
    hasMore: true,
    previousUserCreatedAt: "2026-06-18T08:00:00.000Z",
  },
  "1": { rows: RUN_A, hasMore: false, previousUserCreatedAt: null },
};

/** A Core read the test releases by hand. */
interface PendingRead {
  before: number | undefined;
  release: () => void;
}

let pending: PendingRead[] = [];
let holdReads = false;

function pageCalls(): (number | undefined)[] {
  return tauriMocks.invoke.mock.calls
    .filter(([command]) => command === "session_message_turns_page")
    .map(([, args]) => args?.beforeTurnIndex as number | undefined);
}

function slice() {
  return useMessagesStore.getState().byId[SID];
}

describe("paged conversation history", () => {
  beforeEach(() => {
    resetStores();
    pending = [];
    holdReads = false;
    useSessionsStore.setState({
      sessions: [makeSession({ id: SID, turnCount: 6 })],
      activeSessionId: SID,
    });
    tauriMocks.invoke.mockImplementation(async (command, args) => {
      if (command !== "session_message_turns_page") return undefined;
      const before = args?.beforeTurnIndex as number | undefined;
      const page = PAGES[before === undefined ? "latest" : String(before)];
      if (!holdReads) return page;
      return new Promise((resolve) => {
        pending.push({ before, release: () => resolve(page) });
      });
    });
  });

  it("restores the latest page and prepends earlier ones into the same turns", async () => {
    await useMessagesStore.getState().restoreSessionTurns(SID);
    expect(slice().turns).toEqual(rowsToTurns(RUN_C));
    expect(slice().earlier).toEqual({
      beforeTurnIndex: 4,
      previousUserCreatedAt: "2026-06-18T09:00:00.000Z",
    });
    expect(slice().prependedTurns).toBe(0);
    const restored = slice().turns;

    expect(await useMessagesStore.getState().loadEarlierTurns(SID)).toBe(true);
    // The loaded turns are the same objects, now behind the new page.
    expect(slice().turns.slice(-restored.length)).toEqual(restored);
    expect(slice().turns[slice().turns.length - 1]).toBe(
      restored[restored.length - 1],
    );
    expect(slice().prependedTurns).toBe(rowsToTurns(RUN_B).length);
    expect(slice().earlier?.beforeTurnIndex).toBe(1);

    expect(await useMessagesStore.getState().loadEarlierTurns(SID)).toBe(true);
    // Pages joined: the turns of the whole transcript, step numbers and
    // the ask_user reply included.
    expect(slice().turns).toEqual(rowsToTurns(ALL_ROWS));
    expect(slice().earlier).toBeNull();
    expect(slice().prependedTurns).toBe(slice().turns.length - restored.length);
    const replySteps = slice()
      .turns.filter((t): t is AgentTurn => t.role === "agent")
      .map((t) => t.turnIndex);
    expect(replySteps).toEqual([1, 1, 1, 2, 1, 2]);

    // Nothing earlier: no read.
    expect(await useMessagesStore.getState().loadEarlierTurns(SID)).toBe(false);
    expect(pageCalls()).toEqual([undefined, 4, 1]);
  });

  it("a session with no earlier turns reads one page only", async () => {
    tauriMocks.invoke.mockImplementation(async (command) =>
      command === "session_message_turns_page"
        ? { rows: ALL_ROWS, hasMore: false, previousUserCreatedAt: null }
        : undefined,
    );
    await useMessagesStore.getState().restoreSessionTurns(SID);
    expect(slice().turns).toEqual(rowsToTurns(ALL_ROWS));
    expect(slice().earlier).toBeNull();
    expect(await useMessagesStore.getState().loadEarlierTurns(SID)).toBe(false);
    expect(pageCalls()).toEqual([undefined]);
  });

  it("a second call while a page is read joins it", async () => {
    await useMessagesStore.getState().restoreSessionTurns(SID);
    holdReads = true;
    const first = useMessagesStore.getState().loadEarlierTurns(SID);
    const second = useMessagesStore.getState().loadEarlierTurns(SID);
    expect(second).toBe(first);
    pending[0].release();
    expect(await first).toBe(true);
    expect(pageCalls()).toEqual([undefined, 4]);
  });

  it("live turns keep appending at the tail while a page is read", async () => {
    await useMessagesStore.getState().restoreSessionTurns(SID);
    holdReads = true;
    const read = useMessagesStore.getState().loadEarlierTurns(SID);

    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: SID,
      message: { id: `msg_${SID}_6_user`, content: "fourth", turnIndex: 6 },
      dispatch: "dispatched",
    });
    const step = rowsToTurns([
      row({ role: "user", turn_index: 6 }),
      row({ role: "assistant", turn_index: 6, final_answer: "live" }),
    ])[1] as AgentTurn;
    useMessagesStore.getState().appendAgentTurn(SID, step);
    const live = slice().turns;

    pending[0].release();
    expect(await read).toBe(true);
    expect(slice().turns).toEqual([...rowsToTurns(RUN_B), ...live]);
    // The run the live turns belong to is untouched.
    expect(slice()).toMatchObject({
      agentRunning: true,
      turnIndexOffset: 5,
    });
  });

  it("drops a page that lands after the turns were replaced", async () => {
    await useMessagesStore.getState().restoreSessionTurns(SID);
    holdReads = true;
    const read = useMessagesStore.getState().loadEarlierTurns(SID);
    useMessagesStore.getState().clearConversation(SID);
    pending[0].release();
    expect(await read).toBe(false);
    expect(slice().turns).toEqual([]);
    expect(slice().prependedTurns).toBe(0);
  });

  it("a failed read leaves the turns as they were and can be retried", async () => {
    await useMessagesStore.getState().restoreSessionTurns(SID);
    const before = slice();
    tauriMocks.invoke.mockRejectedValueOnce(new Error("SQLite busy"));
    expect(await useMessagesStore.getState().loadEarlierTurns(SID)).toBe(false);
    expect(slice()).toBe(before);
    expect(await useMessagesStore.getState().loadEarlierTurns(SID)).toBe(true);
  });

  it("pages back to a located message, and only as far as it", async () => {
    await useMessagesStore.getState().restoreSessionTurns(SID);
    const target = RUN_B[2].id; // the ask_user reply, one page back
    expect(
      await useMessagesStore.getState().loadEarlierThrough(SID, target),
    ).toBe(true);
    expect(pageCalls()).toEqual([undefined, 4]);
    expect(slice().earlier?.beforeTurnIndex).toBe(1);

    // Already in: no read.
    expect(
      await useMessagesStore.getState().loadEarlierThrough(SID, RUN_C[0].id),
    ).toBe(true);
    expect(pageCalls()).toEqual([undefined, 4]);

    // Never in: every page, then false.
    expect(
      await useMessagesStore.getState().loadEarlierThrough(SID, "msg_gone"),
    ).toBe(false);
    expect(pageCalls()).toEqual([undefined, 4, 1]);
    expect(slice().earlier).toBeNull();
  });

  it("the question rail holds only the loaded questions", async () => {
    await useMessagesStore.getState().restoreSessionTurns(SID);
    expect(buildRailExchanges(slice().turns)).toEqual([
      { question: "third question", answer: "third answer" },
    ]);
    await useMessagesStore.getState().loadEarlierTurns(SID);
    // The ask_user reply is no question of its own.
    expect(buildRailExchanges(slice().turns)).toEqual([
      { question: "second question", answer: "second answer" },
      { question: "third question", answer: "third answer" },
    ]);
    await useMessagesStore.getState().loadEarlierTurns(SID);
    expect(buildRailExchanges(slice().turns)).toHaveLength(3);
  });
});
