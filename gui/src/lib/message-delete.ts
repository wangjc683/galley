import { invoke } from "@tauri-apps/api/core";

import type { AssistantLinePlan } from "@/lib/assistant-conversation";
import type { RunGroup } from "@/lib/run-groups";
import { isSubtaskReportTurn } from "@/lib/subtasks";
import { turnOrdinals } from "@/lib/turn-ordinals";
import { useMessagesStore } from "@/stores/messages";
import type { Turn } from "@/types/conversation";

/**
 * Deleting one message of the main chat from the page (main chat ticket
 * 32, PRD ruling 83; ticket 38, ruling 85). 删除 in a bubble's message
 * menu (right-click, or the reply bar's ⋯) hides the bubble at once and
 * offers 「撤销」 for five seconds; only when that toast goes does Core
 * delete (stores/message-delete.ts). Core decides which rows the message
 * is and deletes them (`delete_main_chat_message`, Rule 5: your row; the
 * greeting; or the reply's whole run, its process and questions
 * included); the page hides the same rows meanwhile, worked out the same
 * way ({@link messageRowIds}), and drops exactly the rows Core names,
 * from the answer and from the `message-deleted` broadcast (which
 * reaches every page and the phone).
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
 * Whether the turn at `index` is a bubble of the assistant's conversation
 * with a message menu: drawn as a message (yours, the greeting, a
 * question it asked, a reply's answer), persisted, and not a report row.
 * `plan` is the conversation's own (`assistantLinePlan`).
 */
export function isMenuBubble(
  turns: readonly Turn[],
  plan: AssistantLinePlan,
  index: number,
): boolean {
  const turn = turns[index];
  if (!turn || turn.role === "system" || !turn.messageId) return false;
  if (!plan.message.has(index) || plan.flat.has(index)) return false;
  return turn.role === "agent" || !isSubtaskReportTurn(turn);
}

/** The run group holding the turn at `index`. */
function groupAt(
  groups: readonly RunGroup[],
  index: number,
): RunGroup | undefined {
  return groups.find((g) => g.memberIndices.includes(index));
}

/**
 * The bubble at `index` as the menu offers to delete it, or null when it
 * is no bubble of the assistant's conversation ({@link isMenuBubble}).
 * `plan` and `groups` are the conversation's own (`assistantLinePlan`,
 * `buildRunGroups` with `splitAfterAnswer`).
 */
export function deletableAt(
  turns: readonly Turn[],
  plan: AssistantLinePlan,
  groups: readonly RunGroup[],
  index: number,
): DeletableMessage | null {
  if (!isMenuBubble(turns, plan, index)) return null;
  const turn = turns[index];
  if (turn.role === "system" || !turn.messageId) return null;
  const messageId = turn.messageId;
  if (turn.role === "user" || turn.greeting) {
    return { messageId, replyAnswerId: null };
  }
  const group = groupAt(groups, index);
  const answer =
    group?.finalTurnIndex != null ? turns[group.finalTurnIndex] : undefined;
  return {
    messageId,
    replyAnswerId:
      answer && answer.role === "agent" ? (answer.messageId ?? null) : null,
  };
}

/**
 * The bubble a right-click on row `messageId` names: {@link deletableAt}
 * by the row's id.
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
  return index < 0 ? null : deletableAt(turns, plan, groups, index);
}

/**
 * The rows deleting the bubble at `index` takes out, in conversation
 * order: what the page hides until Core has deleted them. The same unit
 * Core works out from the row (`message_unit`, core/src/message_delete.rs):
 * your row, or the greeting's; for a reply, every row of its run that it
 * said (answer, questions, steps; your answers in the run stay), with the
 * hidden report row of a round Core woke it for. Only the loaded turns:
 * Core's answer names the rest, if any.
 */
export function messageRowIds(
  turns: readonly Turn[],
  groups: readonly RunGroup[],
  index: number,
): string[] {
  const turn = turns[index];
  if (!turn || turn.role === "system" || !turn.messageId) return [];
  if (turn.role === "user" || turn.greeting) return [turn.messageId];
  const group = groupAt(groups, index);
  if (!group) return [turn.messageId];
  const ids: string[] = [];
  for (const i of group.memberIndices) {
    const member = turns[i];
    if (member.role === "system" || !member.messageId) continue;
    const reply = member.role === "agent" && !member.greeting;
    const report = i === group.openerIndex && isSubtaskReportTurn(member);
    if (reply || report) ids.push(member.messageId);
  }
  return ids;
}

/**
 * The conversation with the rows `hidden` takes out, for a deletion that
 * is waiting on its undo (stores/message-delete.ts): the turns left, and
 * the places (lib/turn-ordinals) of those taken out added to
 * `removedOrdinals`, so every row keeps its key and an open process card
 * stays on its reply — as if Core had deleted them already. With
 * nothing hidden, the same arrays back.
 */
export function withoutHiddenTurns(
  turns: Turn[],
  keyBase: number,
  removedOrdinals: readonly number[],
  hidden: ReadonlySet<string>,
): { turns: Turn[]; removedOrdinals: readonly number[] } {
  const hides = (turn: Turn) =>
    turn.role !== "system" &&
    turn.messageId !== undefined &&
    hidden.has(turn.messageId);
  if (hidden.size === 0 || !turns.some(hides)) {
    return { turns, removedOrdinals };
  }
  const ordinals = turnOrdinals(turns.length, keyBase, removedOrdinals);
  const kept: Turn[] = [];
  const removed = [...removedOrdinals];
  turns.forEach((turn, i) => {
    if (hides(turn)) removed.push(ordinals[i]);
    else kept.push(turn);
  });
  return { turns: kept, removedOrdinals: removed.sort((a, b) => a - b) };
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
  /** What Core refused for, when it said: say so; else a plain failure.
   * `gone`: Core has no such message (`not_found`) — deleted already,
   * or the main chat was reset meanwhile: nothing to delete or put back. */
  kind: "busy" | "subtasks" | "gone" | "other";
  /** The error as Core sent it, for 复制详情. */
  detail: string;
}

/** Why `delete_main_chat_message` refused or failed, from its rejection
 * (`{"error": "busy" | "has_subtasks" | "not_found" | …, "detail": …}`). */
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
    if (parsed?.error === "not_found") return { kind: "gone", detail };
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
