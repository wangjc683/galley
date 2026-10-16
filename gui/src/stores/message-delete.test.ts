import { beforeEach, describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import {
  hiddenRowIds,
  UNDO_DELETE_MS,
  useMessageDeleteStore,
} from "@/stores/message-delete";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type { AgentTurn, Turn, UserTurn } from "@/types/conversation";

/**
 * Deleting a message of the main chat with an undo (main chat ticket 38):
 * the bubble is hidden at once and Core hears of it only when the undo
 * toast goes; 撤销 puts it back without Core; several in a row are one
 * toast; a send commits first; Core refusing puts it back and says why;
 * all of it in the store, with no conversation on screen.
 */

const tauriMocks = getTauriMocks();
const SID = "s-main";
const copy = zhCopy.conversation.deleteMessage;

function user(id: string): UserTurn {
  return { role: "user", content: id, messageId: id };
}
function answer(id: string): AgentTurn {
  return {
    role: "agent",
    tools: [],
    finalAnswer: `${id} 的回答`,
    messageId: id,
  };
}

const deletes = () => useMessageDeleteStore.getState();
const toasts = () => useUiStore.getState().toasts;
const coreCalls = () =>
  tauriMocks.invoke.mock.calls.filter(
    ([command]) => command === "delete_main_chat_message",
  );
const ids = () =>
  useMessagesStore
    .getState()
    .byId[SID].turns.map((t: Turn) => (t.role === "system" ? "" : t.messageId));

/** The undo toast runs out (ToastHost: its `onClose`, then away). */
function runOut(): void {
  const toast = toasts()[0];
  toast.onClose?.();
  useUiStore.getState().dismissToast(toast.id);
}

/** Core deletes what it is asked: the row it is named. */
function coreDeletes(): void {
  tauriMocks.invoke.mockImplementation(async (command, args) =>
    command === "delete_main_chat_message"
      ? {
          sessionId: SID,
          messageIds: [(args as { messageId: string }).messageId],
          via: "gui",
        }
      : undefined,
  );
}

beforeEach(() => {
  resetStores();
  usePrefsStore.setState({ languagePreference: "zh-CN" });
  useMessagesStore.getState().ensureMessages(SID);
  useMessagesStore.setState((s) => ({
    byId: {
      ...s.byId,
      [SID]: {
        ...s.byId[SID],
        turns: [user("u0"), answer("a0"), user("u1"), answer("a1")],
      },
    },
  }));
});

describe("删除", () => {
  it("hides the bubble at once and offers 撤销 for five seconds; Core hears nothing yet", () => {
    deletes().stage(SID, "u0", ["u0"]);

    expect([...hiddenRowIds(deletes().staged, SID)]).toEqual(["u0"]);
    expect(hiddenRowIds(deletes().staged, "elsewhere").size).toBe(0);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({
      severity: "info",
      title: copy.deleted,
      autoDismissMs: UNDO_DELETE_MS,
      action: { kind: "undo", label: copy.undo },
    });
    expect(coreCalls()).toHaveLength(0);
    expect(ids()).toEqual(["u0", "a0", "u1", "a1"]);
  });

  it("deletes once the toast goes, with no conversation on screen", async () => {
    coreDeletes();
    deletes().stage(SID, "u0", ["u0"]);
    runOut();
    await deletes().flush(SID);

    expect(coreCalls()).toEqual([
      ["delete_main_chat_message", { sessionId: SID, messageId: "u0" }],
    ]);
    expect(ids()).toEqual(["a0", "u1", "a1"]);
    expect(deletes().staged).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it("its × deletes too", async () => {
    coreDeletes();
    deletes().stage(SID, "a1", ["a1"]);
    // The ×: ToastHost runs `onClose`, then takes it away.
    runOut();
    await deletes().commit();
    expect(coreCalls()).toHaveLength(1);
    expect(ids()).toEqual(["u0", "a0", "u1"]);
  });
});

describe("撤销", () => {
  it("puts the bubble back and Core never hears of it", async () => {
    deletes().stage(SID, "u0", ["u0"]);
    const toast = toasts()[0];
    if (toast.action?.kind === "undo") toast.action.run();

    expect(deletes().staged).toEqual([]);
    expect(toasts()).toEqual([]);
    // A late close of that toast deletes nothing.
    toast.onClose?.();
    await Promise.resolve();
    expect(coreCalls()).toHaveLength(0);
    expect(ids()).toEqual(["u0", "a0", "u1", "a1"]);
  });
});

describe("several in a row", () => {
  it("are one toast, its time from the latest, 撤销 taking them all back", () => {
    deletes().stage(SID, "u0", ["u0"]);
    const first = toasts()[0];
    deletes().stage(SID, "a1", ["a1"]);

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].id).not.toBe(first.id);
    expect(toasts()[0].title).toBe(copy.deletedCount(2));
    // The replaced toast's close deletes nothing.
    first.onClose?.();
    expect(coreCalls()).toHaveLength(0);

    const latest = toasts()[0];
    if (latest.action?.kind === "undo") latest.action.run();
    expect(deletes().staged).toEqual([]);
    expect(coreCalls()).toHaveLength(0);
  });

  it("go to Core one by one, in order, when the toast goes", async () => {
    coreDeletes();
    deletes().stage(SID, "u0", ["u0"]);
    deletes().stage(SID, "a1", ["a1"]);
    runOut();
    await deletes().commit();

    expect(coreCalls().map(([, args]) => args)).toEqual([
      { sessionId: SID, messageId: "u0" },
      { sessionId: SID, messageId: "a1" },
    ]);
    expect(ids()).toEqual(["a0", "u1"]);
  });
});

describe("a send within the five seconds", () => {
  it("commits first and waits for Core; the toast goes with it", async () => {
    let answered = false;
    tauriMocks.invoke.mockImplementation(async (command, args) => {
      if (command !== "delete_main_chat_message") return undefined;
      await new Promise((resolve) => setTimeout(resolve, 5));
      answered = true;
      return {
        sessionId: SID,
        messageIds: [(args as { messageId: string }).messageId],
        via: "gui",
      };
    });
    expect(deletes().flush(SID)).toBeNull();
    deletes().stage(SID, "u0", ["u0"]);

    const flushing = deletes().flush(SID);
    expect(toasts()).toEqual([]);
    // Still hidden while Core answers: past undoing.
    expect(deletes().staged).toMatchObject([{ committing: true }]);
    expect([...hiddenRowIds(deletes().staged, SID)]).toEqual(["u0"]);
    await flushing;
    expect(answered).toBe(true);
    expect(ids()).toEqual(["a0", "u1", "a1"]);
    expect(deletes().staged).toEqual([]);
  });
});

describe("Core refusing", () => {
  it("puts the bubble back and says why, the details to copy", async () => {
    const busy = '{"error":"busy","detail":"the main chat is running"}';
    tauriMocks.invoke.mockRejectedValue(busy);
    deletes().stage(SID, "u0", ["u0"]);
    runOut();
    await deletes().commit();

    expect(deletes().staged).toEqual([]);
    expect(ids()).toEqual(["u0", "a0", "u1", "a1"]);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({
      severity: "warning",
      title: copy.failedTitle,
      message: copy.failedBusy,
      context: "delete_main_chat_message",
      traceback: busy,
    });
  });

  it("running: asks once, puts them all back, one toast", async () => {
    const busy = '{"error":"busy","detail":"running"}';
    tauriMocks.invoke.mockRejectedValue(busy);
    deletes().stage(SID, "u0", ["u0"]);
    deletes().stage(SID, "a1", ["a1"]);
    runOut();
    await deletes().commit();

    expect(coreCalls()).toHaveLength(1);
    expect(deletes().staged).toEqual([]);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].title).toBe(copy.failedTitleCount(2));
  });

  it("any other failure: an error, put back", async () => {
    tauriMocks.invoke.mockRejectedValue('{"error":"failed","detail":"disk"}');
    deletes().stage(SID, "a0", ["a0"]);
    runOut();
    await deletes().commit();
    expect(toasts()[0]).toMatchObject({
      severity: "error",
      message: copy.failed,
    });
    expect(deletes().staged).toEqual([]);
  });

  it("not there any more (a reset meanwhile): nothing to say", async () => {
    tauriMocks.invoke.mockRejectedValue('{"error":"not_found","detail":"x"}');
    deletes().stage(SID, "a0", ["a0"]);
    runOut();
    await deletes().commit();
    expect(toasts()).toEqual([]);
    expect(deletes().staged).toEqual([]);
  });
});
