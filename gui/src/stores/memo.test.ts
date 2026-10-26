import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import {
  memosWithoutDeleting,
  type MemoEventItem,
  type MemoItem,
} from "@/lib/memo";
import { UNDO_DELETE_MS } from "@/stores/message-delete";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";

import { useMemoStore } from "./memo";

/**
 * The memos on the desktop (main chat ticket 97): read together with
 * their writes (the page and the cards agree); deleting one is the
 * to-do's way (ticket 88) — off the page at once under an undo toast,
 * Core asked only when the toast goes, several in a row one toast, a
 * send into the main chat committing first, a refusal back with its
 * reason.
 */

const CILANTRO: MemoItem = {
  id: "memo_1",
  text: "你不吃香菜",
  origin: { via: "supervisor", supervisor: "galley-assistant" },
  createdAt: "2026-10-26T01:00:00Z",
  updatedAt: "2026-10-26T01:00:00Z",
};
const TRIP: MemoItem = {
  ...CILANTRO,
  id: "memo_2",
  text: "这周在上海出差",
  until: "2026-11-01",
};
const NOTED: MemoEventItem = {
  id: 1,
  memoId: "memo_1",
  action: "add",
  text: "你不吃香菜",
  sessionId: "s-main",
  turnIndex: 4,
  memoExists: true,
  createdAt: "2026-10-26T01:00:00Z",
};

const words = zhCopy.memo.deleteMemo;
const READ = ["list_memos", "list_memo_events"];

function answer(lists: MemoItem[][], refuse: Record<string, string> = {}) {
  const { invoke } = getTauriMocks();
  invoke.mockImplementation(async (command, args) => {
    if (command === "list_memos") return lists.shift() ?? [];
    if (command === "list_memo_events") return [NOTED];
    if (command === "delete_memo") {
      const id = (args as { id: string }).id;
      if (refuse[id]) throw refuse[id];
      return { ...CILANTRO, id };
    }
    return undefined;
  });
  return invoke;
}

const memos = () => useMemoStore.getState();
const toasts = () => useUiStore.getState().toasts;
const calls = (invoke: ReturnType<typeof getTauriMocks>["invoke"]) =>
  invoke.mock.calls.map(([command]) => command);
const deletes = (invoke: ReturnType<typeof getTauriMocks>["invoke"]) =>
  invoke.mock.calls
    .filter(([command]) => command === "delete_memo")
    .map(([, args]) => args);
/** What the page draws now. */
const drawn = () =>
  memosWithoutDeleting(memos().memos, memos().deleting).map((m) => m.id);

/** The undo toast runs out (ToastHost: its `onClose`, then away). */
function runOut(): void {
  const toast = toasts()[0];
  toast.onClose?.();
  useUiStore.getState().dismissToast(toast.id);
}

beforeEach(() => {
  vi.useFakeTimers();
  useMemoStore.setState({
    memos: [CILANTRO, TRIP],
    events: [NOTED],
    loaded: true,
    deleting: {},
    failures: {},
    deleteToastId: null,
  });
  useUiStore.setState({ toasts: [] });
  usePrefsStore.setState({ languagePreference: "zh-CN" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reading", () => {
  it("takes the memos and their writes together", async () => {
    useMemoStore.setState({ memos: [], events: [], loaded: false });
    const invoke = answer([[TRIP]]);
    await memos().load();
    expect(calls(invoke)).toEqual(READ);
    expect(memos()).toMatchObject({
      memos: [TRIP],
      events: [NOTED],
      loaded: true,
    });
  });

  it("leaves both as they were when either half fails", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "list_memos") return [];
      throw new Error("db");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await memos().load();
    expect(memos().memos).toEqual([CILANTRO, TRIP]);
    expect(memos().events).toEqual([NOTED]);
    warn.mockRestore();
  });
});

describe("deleting a memo", () => {
  it("takes the row off at once and offers 撤销 for five seconds; Core hears nothing yet", async () => {
    const invoke = answer([]);
    useMemoStore.setState({ failures: { memo_1: "failed" } });
    memos().deleteMemo(CILANTRO);

    expect(drawn()).toEqual(["memo_2"]);
    expect(memos().failures).toEqual({});
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({
      severity: "info",
      title: words.deleted("你不吃香菜"),
      autoDismissMs: UNDO_DELETE_MS,
      action: { kind: "undo", label: words.undo },
    });
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS * 2);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("撤销 puts it back and Core never hears of it", async () => {
    const invoke = answer([]);
    memos().deleteMemo(CILANTRO);
    const toast = toasts()[0];
    if (toast.action?.kind === "undo") toast.action.run();

    expect(memos().deleting).toEqual({});
    expect(drawn()).toEqual(["memo_1", "memo_2"]);
    expect(toasts()).toEqual([]);
    // A late close of that toast deletes nothing.
    toast.onClose?.();
    await vi.runAllTimersAsync();
    expect(invoke).not.toHaveBeenCalled();
    expect(memos().flushDeletes()).toBeNull();
  });

  it("asks Core once the toast goes, and lets it go with the fresh read in one set", async () => {
    const invoke = answer([[TRIP]]);
    memos().deleteMemo(CILANTRO);
    const states: ReturnType<typeof useMemoStore.getState>[] = [];
    const unsubscribe = useMemoStore.subscribe((state) => states.push(state));
    runOut();
    await memos().commitDeletes();
    unsubscribe();

    expect(deletes(invoke)).toEqual([{ id: "memo_1" }]);
    expect(calls(invoke)).toEqual(["delete_memo", ...READ]);
    // Never drawn between.
    for (const state of states) {
      expect(
        memosWithoutDeleting(state.memos, state.deleting).map((m) => m.id),
      ).not.toContain("memo_1");
    }
    expect(memos().deleting).toEqual({});
    expect(memos().memos).toEqual([TRIP]);
    expect(toasts()).toEqual([]);
  });

  it("several in a row are one toast, its time from the latest, 撤销 taking them all back", () => {
    answer([]);
    memos().deleteMemo(CILANTRO);
    const first = toasts()[0];
    memos().deleteMemo(TRIP);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].id).not.toBe(first.id);
    expect(toasts()[0].title).toBe(words.deletedCount(2));
    expect(drawn()).toEqual([]);
    const toast = toasts()[0];
    if (toast.action?.kind === "undo") toast.action.run();
    expect(drawn()).toEqual(["memo_1", "memo_2"]);
  });

  it("go to Core one by one, in the order deleted", async () => {
    const invoke = answer([[]]);
    memos().deleteMemo(TRIP);
    memos().deleteMemo(CILANTRO);
    runOut();
    await memos().commitDeletes();
    expect(deletes(invoke)).toEqual([{ id: "memo_2" }, { id: "memo_1" }]);
  });

  it("a send into the main chat commits first: the promise to wait for, the toast gone with it", async () => {
    const invoke = answer([[TRIP]]);
    memos().deleteMemo(CILANTRO);
    const waiting = memos().flushDeletes();
    expect(waiting).not.toBeNull();
    expect(toasts()).toEqual([]);
    await waiting;
    expect(deletes(invoke)).toEqual([{ id: "memo_1" }]);
    expect(memos().flushDeletes()).toBeNull();
  });

  it("comes back with the reason when Core refuses", async () => {
    answer([[CILANTRO, TRIP]], {
      memo_1: JSON.stringify({ error: "db_unavailable", message: "busy" }),
    });
    memos().deleteMemo(CILANTRO);
    runOut();
    await memos().commitDeletes();
    expect(drawn()).toEqual(["memo_1", "memo_2"]);
    expect(memos().failures).toEqual({ memo_1: "failed" });
  });

  it("takes a memo once", () => {
    answer([]);
    memos().deleteMemo(CILANTRO);
    memos().deleteMemo(CILANTRO);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].title).toBe(words.deleted("你不吃香菜"));
  });
});
