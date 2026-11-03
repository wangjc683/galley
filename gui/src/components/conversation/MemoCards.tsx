import { Notepad } from "@phosphor-icons/react";

import {
  REPLY_CARD_ICON,
  REPLY_CARD_LINE,
  REPLY_CARD_LINE_OPENS,
  ReplyCardTitle,
} from "@/components/conversation/ReplyCards";
import { useCopy } from "@/lib/i18n";
import { memoCardParts, memoCardState, type MemoEventItem } from "@/lib/memo";
import { showMemoRow } from "@/lib/todo-open";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { cn } from "@/lib/utils";
import { useMemoStore } from "@/stores/memo";

/**
 * What Galley noted about you in one reply, a card for each write, under
 * that reply (main chat ticket 97, PRD rulings 140 and 142 point 5): it
 * notes in the round you said it, and says so to your face. Drawn from
 * Core's record of every write (`list_memo_events`, stores/memo.ts), not
 * from what the model wrote: 「记下了 · 你不吃香菜」, 「改为 · …」 for a
 * change, 「不再记 · …」 when it deleted one — the words as they were at
 * that write.
 *
 * A 24px line in the reply's frame (ReplyCards, ruling 182; spec:
 * docs/design/conversation.md 「回复下的卡片（一框列表）」 and 「备忘卡片」):
 * a 16px glyph in the 16px column a to-do card's box takes (`Notepad`,
 * thin, `ink-muted`), the line cut, the hover giving it in full. Last in
 * the frame, after the reply's to-do cards — what asks something of you
 * first — and after its reminder cards too: the cards go in the panel's
 * page order, 待办's then 备忘's.
 *
 * The words open the panel on its 备忘 page at the memo's row, lit up
 * (lib/todo-open.ts `showMemoRow`, a to-do card's title's way), from
 * anywhere on the line (`REPLY_CARD_TITLE_REACH`), while the page lists
 * it; a memo deleted since, past its last day, deleted here and waiting
 * for its undo, or a 「不再记」 card: words, not a button, and the line
 * does not light. No delete or undo on a card.
 *
 * What is gone is struck (main chat ticket 99, PRD ruling 144 point 2,
 * `memoCardState`): the words only, never the prefix, in `ink-muted`.
 * A memo deleted since — by you, by Galley, or on the page with its undo
 * toast up — says 「已删除」 on the right, in the to-do card's cell; a
 * 「不再记」 card says nothing more, its prefix has. One past its last
 * day is muted and not struck — it held until then — with 「已过期」.
 */
export function MemoCards({ events }: { events: readonly MemoEventItem[] }) {
  return (
    <div data-role="memo-cards" className="flex flex-col">
      {events.map((event) => (
        <MemoCard key={event.id} event={event} />
      ))}
    </div>
  );
}

function MemoCard({ event }: { event: MemoEventItem }) {
  const copy = useCopy();
  const state = useMemoStore((s) => memoCardState(event, s.memos, s.deleting));
  const { prefix, text } = memoCardParts(event, copy);
  const full = `${prefix} · ${text}`;
  const listed = state === "listed";
  // Only the words are struck, never the prefix (ruling 144 point 2).
  const struck = state === "deleted" || state === "dropped";
  const side =
    state === "deleted"
      ? copy.todo.stateDeleted
      : state === "expired"
        ? copy.memo.stateExpired
        : null;
  const line = (
    <>
      <span className="text-ink-muted">{prefix} · </span>
      <span className={struck ? "line-through" : undefined}>{text}</span>
    </>
  );
  return (
    <div
      data-role="memo-card"
      data-memo-id={event.memoId}
      data-memo-action={event.action}
      data-memo-state={state}
      data-memo-event={event.id}
      className="rounded-sm"
    >
      <div className={cn(REPLY_CARD_LINE, listed && REPLY_CARD_LINE_OPENS)}>
        {/* data-card-icon: what flies into the top bar's 待办 button
            (ticket 102, lib/todo-flight-run.ts). */}
        <span
          data-card-icon=""
          className={cn(REPLY_CARD_ICON, "text-ink-muted")}
        >
          <Notepad size={16} weight="thin" aria-hidden />
        </span>
        {listed ? (
          // Opens from anywhere on the line (ReplyCards).
          <ReplyCardTitle
            text={full}
            onClick={() => showMemoRow(event.memoId, event.sessionId)}
            className="text-ink-soft group-hover/line:text-ink focus-visible:text-ink"
          >
            {line}
          </ReplyCardTitle>
        ) : (
          <span
            className="min-w-0 truncate leading-5 text-ink-muted"
            onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, full)}
          >
            {line}
          </span>
        )}
        {side && (
          // 8px after the words, where a to-do card's 「已删除」 is.
          <span
            data-role="memo-card-state"
            className="pointer-events-none ml-2 shrink-0 select-none tabular-nums text-ink-muted"
          >
            {side}
          </span>
        )}
      </div>
    </div>
  );
}
