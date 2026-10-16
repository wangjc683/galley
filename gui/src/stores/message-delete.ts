import { create } from "zustand";

import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import {
  deleteFailure,
  deleteMainChatMessage,
  type DeleteFailure,
} from "@/lib/message-delete";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

/**
 * Deleting a message of the main chat with an undo instead of a confirm
 * (main chat ticket 38, PRD ruling 85, replacing ticket 32's dialog).
 * 删除 hides the bubble at once and puts up 「已删除一条消息 · 撤销」; only
 * when that toast goes — its five seconds run out (paused while the
 * pointer or focus is on it: ToastHost, lib/toast-timing), or its × is
 * clicked — is the deletion sent to Core. 撤销 puts the bubble back and
 * Core hears nothing.
 *
 * - **Several in a row** become one toast, 「已删除 N 条消息 · 撤销」, its
 *   five seconds counted from the latest; 撤销 puts them all back. Gmail's
 *   and Telegram's way: a stack of toasts would need undoing one by one,
 *   and the newest toast is the one the hand is on.
 * - **Sending within the five seconds** (the composer, an answer to its
 *   question, `/btw`) commits first and the send waits for Core
 *   (`flush`, from `sendThroughCore`): the next turn's history must not
 *   hold what was deleted. The toast goes with it.
 * - **Core refusing** (the main chat started running meanwhile — a
 *   subtask woke it, a reminder came due — or any other failure): the
 *   bubble comes back, and an error toast says why (ticket 32's words,
 *   with 复制详情). Several refused make one toast.
 * - **Here, not in a component**: switching to the workbench or closing
 *   the main chat's view meanwhile changes nothing; the toast still runs
 *   out and the deletion still happens.
 * - **Quitting Galley within the five seconds**: nothing was sent, so
 *   nothing was deleted, and the message is there next time — the safe
 *   way round. Deliberately not handled.
 * - The phone and the CLI see the deletion once Core made it.
 */

/** How long 撤销 is offered. */
export const UNDO_DELETE_MS = 5000;

/** A bubble deleted on the page and not yet by Core. */
export interface StagedMessageDelete {
  /** Staging order, unique. */
  id: number;
  sessionId: string;
  /** The row the menu was opened on: Core works the message out from it. */
  messageId: string;
  /** The rows the page hides meanwhile: the same message, worked out the
   * same way (lib/message-delete `messageRowIds`). */
  rowIds: readonly string[];
  /** Sent to Core: past undoing, still hidden until Core answers. */
  committing: boolean;
}

interface MessageDeleteState {
  /** In staging order. */
  staged: StagedMessageDelete[];
  /** The undo toast up now, if any. */
  toastId: string | null;
}

interface MessageDeleteActions {
  /** 删除: hide the bubble (`rowIds`) and offer 撤销. */
  stage: (
    sessionId: string,
    messageId: string,
    rowIds: readonly string[],
  ) => void;
  /** 撤销: put back every bubble not yet sent; Core hears nothing. */
  undo: () => void;
  /** Send every bubble not yet sent to Core, one by one; resolves once
   * Core has answered for them and for any sent before. Never rejects:
   * a refusal puts the bubble back and says so. */
  commit: () => Promise<void>;
  /** Before a send into `sessionId`: commit, and the promise to wait
   * for; null when nothing of that conversation is waiting. */
  flush: (sessionId: string) => Promise<void> | null;
}

export type MessageDeleteStore = MessageDeleteState & MessageDeleteActions;

let staging = 0;
// The commits on their way, one after another: each batch waits for the
// one before (Core works each message out from what is left).
let inflight: Promise<void> | null = null;

function copyNow() {
  return copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  ).conversation.deleteMessage;
}

/** One toast for what Core refused: why the first was refused, the
 * details of all to copy. */
function reportRefused(failures: readonly DeleteFailure[]): void {
  const copy = copyNow();
  const first = failures[0];
  useUiStore.getState().pushToast(
    makeAppError({
      category: "business",
      severity: first.kind === "other" ? "error" : "warning",
      title:
        failures.length === 1
          ? copy.failedTitle
          : copy.failedTitleCount(failures.length),
      message:
        first.kind === "busy"
          ? copy.failedBusy
          : first.kind === "subtasks"
            ? copy.failedSubtasks
            : copy.failed,
      hint: null,
      retryable: false,
      context: "delete_main_chat_message",
      traceback: failures.map((failure) => failure.detail).join("\n"),
    }),
  );
}

export const useMessageDeleteStore = create<MessageDeleteStore>((set, get) => {
  /** Ask Core for each of `batch`, in order. */
  const send = async (batch: readonly StagedMessageDelete[]) => {
    const refused: DeleteFailure[] = [];
    let busy: DeleteFailure | null = null;
    for (const entry of batch) {
      if (busy) {
        // Refused for running: so would the rest be, until it stops.
        refused.push(busy);
      } else {
        try {
          // Drops the rows Core names from the conversation.
          await deleteMainChatMessage(entry.sessionId, entry.messageId);
        } catch (error) {
          const failure = deleteFailure(error);
          if (failure.kind === "busy") busy = failure;
          // `gone`: nothing there to delete or to put back.
          if (failure.kind !== "gone") refused.push(failure);
        }
      }
      // Deleted, or refused and so back on screen.
      set((state) => ({
        staged: state.staged.filter((staged) => staged.id !== entry.id),
      }));
    }
    if (refused.length > 0) reportRefused(refused);
  };

  return {
    staged: [],
    toastId: null,

    stage: (sessionId, messageId, rowIds) => {
      // Another conversation's deletions go first (only the main chat
      // has them; this is the main chat replaced by a reset).
      if (
        get().staged.some(
          (entry) => !entry.committing && entry.sessionId !== sessionId,
        )
      ) {
        void get().commit();
      }
      staging += 1;
      const entry: StagedMessageDelete = {
        id: staging,
        sessionId,
        messageId,
        rowIds: [...rowIds],
        committing: false,
      };
      const staged = [...get().staged, entry];
      const waiting = staged.filter((e) => !e.committing).length;
      const previousToast = get().toastId;
      // A fresh toast each time: its five seconds start over.
      const toastId = `message-delete-undo-${entry.id}`;
      set({ staged, toastId });
      const copy = copyNow();
      const ui = useUiStore.getState();
      ui.pushToast(
        makeAppError({
          id: toastId,
          category: "business",
          severity: "info",
          title: waiting === 1 ? copy.deleted : copy.deletedCount(waiting),
          message: "",
          hint: null,
          retryable: false,
          context: "delete_main_chat_message",
          traceback: null,
          autoDismissMs: UNDO_DELETE_MS,
          action: {
            kind: "undo",
            label: copy.undo,
            run: () => get().undo(),
          },
          // Ran out, or its ×: now Core deletes. Only while it is the
          // toast up — a later deletion replaced it otherwise.
          onClose: () => {
            if (get().toastId === toastId) void get().commit();
          },
        }),
      );
      if (previousToast) ui.dismissToast(previousToast);
    },

    undo: () => {
      const { staged, toastId } = get();
      set({
        staged: staged.filter((entry) => entry.committing),
        toastId: null,
      });
      if (toastId) useUiStore.getState().dismissToast(toastId);
    },

    commit: () => {
      const { staged, toastId } = get();
      const batch = staged
        .filter((entry) => !entry.committing)
        .map((entry) => ({ ...entry, committing: true }));
      if (toastId) {
        set({ toastId: null });
        useUiStore.getState().dismissToast(toastId);
      }
      if (batch.length === 0) return inflight ?? Promise.resolve();
      set({
        staged: staged.map(
          (entry) => batch.find((sent) => sent.id === entry.id) ?? entry,
        ),
      });
      const run = (inflight ?? Promise.resolve()).then(() => send(batch));
      inflight = run;
      void run.finally(() => {
        if (inflight === run) inflight = null;
      });
      return run;
    },

    flush: (sessionId) =>
      get().staged.some((entry) => entry.sessionId === sessionId)
        ? get().commit()
        : null,
  };
});

/** The rows of `sessionId` hidden for a deletion on its way (staged or
 * sent, not yet answered). */
export function hiddenRowIds(
  staged: readonly StagedMessageDelete[],
  sessionId: string | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const entry of staged) {
    if (entry.sessionId !== sessionId) continue;
    for (const id of entry.rowIds) ids.add(id);
  }
  return ids;
}
