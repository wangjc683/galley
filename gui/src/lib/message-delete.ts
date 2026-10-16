import { invoke } from "@tauri-apps/api/core";

import type { AssistantLinePlan } from "@/lib/assistant-conversation";
import type { RunGroup } from "@/lib/run-groups";
import { isSubtaskReportTurn } from "@/lib/subtasks";
import { useMessagesStore } from "@/stores/messages";
import type { Turn } from "@/types/conversation";

/**
 * Deleting one message of the main chat from the page (main chat ticket
 * 32, PRD ruling 83). Right-click a bubble of the assistant's
 * conversation → 删除 → one click in the confirm. Core decides which rows
 * the message is and deletes them (`delete_main_chat_message`, Rule 5:
 * your row; the greeting; or the reply's whole run, its process and
 * questions included); the page drops exactly the rows Core names, from
 * the answer and from the `message-deleted` broadcast (which reaches
 * every page and the phone).
 */

/** Core's broadcast after a deletion. */
export const MESSAGE_DELETED_EVENT = "message-deleted";

export interface MessageDeletedPayload {
  sessionId: string;
  /** Every row deleted, in conversation order. */
  messageIds: string[];
  via: string;
}

/** Why the 删除 item is greyed: the main chat is replying, it waits for
 * the user's answer, or the reply has subtask cards under it (deleting
 * it would leave them where nothing leads to them). */
export type MessageDeleteBlock = "running" | "asking" | "subtasks";

/** A bubble the menu can offer to delete. */
export interface DeletableMessage {
  /** The row Core is asked about. */
  messageId: string;
  /** For a reply (its answer or a question it asked): its answer's row,
   * where its subtask cards hang; null for your message and the
   * greeting. */
  replyAnswerId: string | null;
}

/**
 * The bubble a right-click on row `messageId` names, or null when it is
 * no bubble of the assistant's conversation (a run drawn the workbench
 * way, a step, a report row, not loaded). `plan` and `groups` are the
 * conversation's own (`assistantLinePlan`, `buildRunGroups` with
 * `splitAfterAnswer`).
 */
export function deletableMessage(
  turns: readonly Turn[],
  plan: AssistantLinePlan,
  groups: readonly RunGroup[],
  messageId: string,
): DeletableMessage | null {
  const index = turns.findIndex(
    (turn) => turn.role !== "system" && turn.messageId === messageId,
  );
  if (index < 0 || !plan.message.has(index) || plan.flat.has(index)) {
    return null;
  }
  const turn = turns[index];
  if (turn.role === "user") {
    return isSubtaskReportTurn(turn)
      ? null
      : { messageId, replyAnswerId: null };
  }
  if (turn.role !== "agent") return null;
  if (turn.greeting) return { messageId, replyAnswerId: null };
  const group = groups.find((g) => g.memberIndices.includes(index));
  const answer =
    group?.finalTurnIndex != null ? turns[group.finalTurnIndex] : undefined;
  return {
    messageId,
    replyAnswerId:
      answer && answer.role === "agent" ? (answer.messageId ?? null) : null,
  };
}

/** The menu's state for `message`: why it is greyed, or null. Running
 * and asking cover every bubble; subtask cards only their reply. */
export function messageDeleteBlock(
  message: DeletableMessage,
  {
    running,
    asking,
    hasSubtasks,
  }: {
    running: boolean;
    asking: boolean;
    hasSubtasks: (answerId: string) => boolean;
  },
): MessageDeleteBlock | null {
  if (running) return "running";
  if (asking) return "asking";
  if (message.replyAnswerId && hasSubtasks(message.replyAnswerId)) {
    return "subtasks";
  }
  return null;
}

export interface DeleteFailure {
  /** What Core refused for, when it said: say so; else a plain failure. */
  kind: "busy" | "subtasks" | "other";
  /** The error as Core sent it, for 复制详情. */
  detail: string;
}

/** Why `delete_main_chat_message` refused or failed, from its rejection
 * (`{"error": "busy" | "has_subtasks" | …, "detail": …}`). */
export function deleteFailure(error: unknown): DeleteFailure {
  const detail =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  try {
    const parsed = JSON.parse(detail) as { error?: unknown } | null;
    if (parsed?.error === "busy") return { kind: "busy", detail };
    if (parsed?.error === "has_subtasks") return { kind: "subtasks", detail };
  } catch {
    // Not Core's JSON.
  }
  return { kind: "other", detail };
}

/** Drop what Core deleted from this page's conversation. */
export function applyMessageDeleted(payload: MessageDeletedPayload): void {
  useMessagesStore
    .getState()
    .applyMessagesDeleted(payload.sessionId, payload.messageIds);
}

/**
 * Delete the message row `messageId` of the main chat `sessionId` is part
 * of, and drop it here at once (the broadcast that follows changes
 * nothing more). Rejects with Core's error ({@link deleteFailure} reads
 * it); nothing changed then.
 */
export async function deleteMainChatMessage(
  sessionId: string,
  messageId: string,
): Promise<void> {
  const deleted = await invoke<MessageDeletedPayload>(
    "delete_main_chat_message",
    { sessionId, messageId },
  );
  applyMessageDeleted(deleted);
}
