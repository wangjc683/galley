import { invoke } from "@tauri-apps/api/core";

import type { AppCopy } from "@/i18n/types";
import {
  replyMessageId,
  todoToastTitle,
  type TodoTarget,
} from "@/lib/assistant-todo";
import type { ResolvedLanguage } from "@/lib/language";
import {
  formatPastDay,
  formatScheduleDay,
  localDayStart,
} from "@/lib/message-time";

/**
 * The memos (main chat tickets 95 and 97, PRD rulings 140 and 142): what
 * Galley noted about you — information, where a to-do is an action. It
 * notes one in the round you said it, a card under that reply says so
 * (`memosByMessage`), and the to-do panel's 备忘 page lists every one
 * that still holds, grouped by the day it was last noted or changed
 * (`memoPageGroups`). The page is what the main chat reads at the start
 * of each segment (Core's `list_memos`), so what you see is what it
 * sees. Your one action on a memo is to delete it; anything else you say
 * to Galley.
 *
 * The wire shapes mirror Core (`core/src/api/memo.rs`): camelCase,
 * optional fields omitted when empty. Everything here is pure but the
 * Core calls.
 */

/** Core's event after any memo change (a write, the desktop's delete, a
 * run's end filling in its turn, a reset); empty payload, read again. */
export const MEMOS_CHANGED_EVENT = "memos:changed";

/** Mirror of Core `MemoBrief`: what `galley memo` prints and every write
 * returns. `until` is the memo's last day, a local `YYYY-MM-DD`. */
export interface MemoBrief {
  id: string;
  text: string;
  until?: string;
  origin: { via: string; supervisor?: string; reason?: string };
  createdIn?: { sessionId: string; turnIndex?: number };
  createdAt: string;
  /** When its text or its last day last changed: the day the page groups
   * it under. */
  updatedAt: string;
}

/** Mirror of Core `MemoItem` (`list_memos`): a memo that holds today, and
 * where in the main chat it was last noted or changed (the row jumps
 * there; `turnIndex` is the reply, once its run ended). */
export interface MemoItem extends MemoBrief {
  changedIn?: { sessionId: string; turnIndex?: number };
}

/** Mirror of Core `MemoAction`. */
export type MemoAction = "add" | "update" | "delete";

/** Mirror of Core `MemoEventItem` (`list_memo_events`): one write of a memo
 * in the main chat, for the card under its reply. `text` is the memo after
 * the write (before it, for a delete); `memoExists` says whether the memo
 * is still there. */
export interface MemoEventItem {
  id: number;
  memoId: string;
  action: MemoAction;
  text: string;
  until?: string;
  sessionId: string;
  turnIndex?: number;
  memoExists: boolean;
  createdAt: string;
}

/** The memos that hold today, in the order they were noted, each with
 * where it was last noted or changed (`list_memos`). */
export async function listMemos(): Promise<MemoItem[]> {
  return invoke<MemoItem[]>("list_memos");
}

/** Every write of a memo made in the main chat, in the order made
 * (`list_memo_events`): the cards. Empty on the external runtime and
 * before there is a main chat. */
export async function listMemoEvents(): Promise<MemoEventItem[]> {
  return invoke<MemoEventItem[]>("list_memo_events");
}

/** Delete a memo (`delete_memo`, PRD ruling 142 point 5): sent once its
 * undo toast has gone (stores/memo.ts), recorded as the user at the
 * desktop. Core sends `memos:changed`; `not_found` for one already gone. */
export async function deleteMemo(id: string): Promise<MemoBrief> {
  return invoke<MemoBrief>("delete_memo", { id });
}

/** A memo's words as the undo toast quotes them: the to-do toast's cut
 * (`todoToastTitle`). */
export const memoToastText = todoToastTitle;

// ---- The 备忘 page -----------------------------------------------------------

/** One day's memos on the page. */
export interface MemoGroup {
  /** The local midnight the day starts on: its key and its heading. */
  dayMs: number;
  memos: MemoItem[];
}

function parsed(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * The page's groups (ticket 97, ruling 142 point 5): by the local day a
 * memo was last noted or changed (`updatedAt`), the latest day first, so
 * a memo changed moves to that day and the page reads as what Galley
 * noted each day. In a day, the latest change first; two at the same
 * moment, the one noted later first (Core lists them in the order
 * noted).
 */
export function memoPageGroups(memos: readonly MemoItem[]): MemoGroup[] {
  const sorted = memos
    .map((memo, index) => ({ memo, index, at: parsed(memo.updatedAt) }))
    .sort((a, b) => b.at - a.at || b.index - a.index);
  const groups: MemoGroup[] = [];
  for (const { memo, at } of sorted) {
    const dayMs = localDayStart(at);
    const last = groups[groups.length - 1];
    if (last && last.dayMs === dayMs) last.memos.push(memo);
    else groups.push({ dayMs, memos: [memo] });
  }
  return groups;
}

/** A group's heading: 今天, 昨天, then the date (`formatPastDay`, the
 * time line's day words). */
export function memoDayLabel(
  dayMs: number,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
): string {
  return formatPastDay(dayMs, todayStartMs, language, {
    today: copy.todo.dayToday,
    yesterday: copy.todo.dayYesterday,
  });
}

/** 「到 11月1日」 on the right of a memo with a last day, its day written
 * as a to-do's due day is (`formatScheduleDay`: 今天, 明天, 周五, the
 * date); null without one. */
export function memoUntilLabel(
  memo: Pick<MemoBrief, "until">,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
): string | null {
  if (!memo.until) return null;
  const day =
    formatScheduleDay(memo.until, todayStartMs, language, {
      today: copy.todo.dayToday,
      tomorrow: copy.todo.dayTomorrow,
      yesterday: copy.todo.dayYesterday,
    }) ?? memo.until;
  return copy.memo.until(day);
}

/**
 * Where a memo's words lead: the reply in the main chat it was last
 * noted or changed in (Core's `changedIn`), the 查找聊天记录 jump a to-do's
 * title makes. Null with nowhere to go — noted outside a main chat run
 * (another agent through the CLI), its run not yet ended, another
 * session — and its words are not a button.
 */
export function memoRowTarget(
  memo: Pick<MemoItem, "changedIn">,
  mainChatId: string | undefined,
): TodoTarget | null {
  const anchor = memo.changedIn;
  if (!anchor || anchor.turnIndex == null || anchor.sessionId !== mainChatId) {
    return null;
  }
  return {
    kind: "reply",
    sessionId: anchor.sessionId,
    messageId: replyMessageId(anchor.sessionId, anchor.turnIndex),
  };
}

/** The memos the page draws: the ones deleted here and waiting for
 * their undo left out. */
export function memosWithoutDeleting(
  memos: readonly MemoItem[],
  deleting: Readonly<Record<string, unknown>>,
): readonly MemoItem[] {
  if (Object.keys(deleting).length === 0) return memos;
  return memos.filter((memo) => !(memo.id in deleting));
}

// ---- The cards under a reply ------------------------------------------------

/**
 * The writes of memos in the main chat's replies, by the reply they hang
 * under (ticket 97): a card each, in the order made. Only once the run
 * ended (Core fills `turnIndex` then), only the main chat; `mainChatId`
 * undefined (not the main chat) → an empty map.
 */
export function memosByMessage(
  events: readonly MemoEventItem[],
  mainChatId: string | undefined,
): Map<string, MemoEventItem[]> {
  const byMessage = new Map<string, MemoEventItem[]>();
  if (!mainChatId) return byMessage;
  const carded = events
    .filter(
      (event) => event.sessionId === mainChatId && event.turnIndex != null,
    )
    .sort((a, b) => a.id - b.id);
  for (const event of carded) {
    const key = replyMessageId(mainChatId, event.turnIndex!);
    const group = byMessage.get(key);
    if (group) group.push(event);
    else byMessage.set(key, [event]);
  }
  return byMessage;
}

/** A card's line: 「记下了 · …」, 「改为 · …」, 「不再记 · …」, with the
 * words as they were at that write. */
export function memoCardParts(
  event: Pick<MemoEventItem, "action" | "text">,
  copy: AppCopy,
): { prefix: string; text: string } {
  const prefix =
    event.action === "add"
      ? copy.memo.cardNoted
      : event.action === "update"
        ? copy.memo.cardChanged
        : copy.memo.cardDropped;
  return { prefix, text: event.text };
}

/**
 * Where a card's memo stands now (main chat ticket 99, PRD ruling 144
 * point 2), which is how the card draws:
 *
 *   listed   on the page: the words as they are, a button that opens
 *            the panel at its row (the only state that does: not one
 *            deleted, past its last day, or a 「不再记」 card)
 *   deleted  gone — you deleted it or Galley did (`memoExists` false), or
 *            you deleted it on the page and its undo toast is up: the
 *            words struck, 「已删除」 on the right
 *   dropped  a 「不再记」 card, the write that deleted it: the words
 *            struck, nothing on the right (its prefix says so)
 *   expired  still there but past its last day, so off the page (Core
 *            keeps the row, ticket 95): the words muted, not struck —
 *            it held until that day — 「已过期」 on the right
 */
export type MemoCardState = "listed" | "deleted" | "dropped" | "expired";

export function memoCardState(
  event: Pick<MemoEventItem, "action" | "memoId" | "memoExists">,
  memos: readonly MemoItem[],
  deleting: Readonly<Record<string, unknown>>,
): MemoCardState {
  if (event.action === "delete") return "dropped";
  if (!event.memoExists || event.memoId in deleting) return "deleted";
  return memos.some((memo) => memo.id === event.memoId) ? "listed" : "expired";
}
