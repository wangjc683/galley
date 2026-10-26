import { Notepad } from "@phosphor-icons/react";

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
 * The to-do card's form (docs/design/conversation.md 「备忘卡片」):
 * hairline `border-line`, `rounded-md`, the page ground, one line of at
 * least 40px, a 16px glyph in the 16px column a to-do card's box takes
 * (`Notepad`, thin, `ink-muted`), the line cut, the hover giving it in
 * full. After the reply's to-do cards — what asks something of you
 * first — and after its reminder cards too: the cards go in the panel's
 * page order, 待办's then 备忘's. 8px under any cards above, 12px off
 * the bubble.
 *
 * The words open the panel on its 备忘 page at the memo's row, lit up
 * (lib/todo-open.ts `showMemoRow`, a to-do card's title's way), while
 * the page lists it; a memo deleted since, past its last day, deleted
 * here and waiting for its undo, or a 「不再记」 card: words, not a
 * button. No delete or undo on a card.
 *
 * What is gone is struck (main chat ticket 99, PRD ruling 144 point 2,
 * `memoCardState`): the words only, never the prefix, in `ink-muted`.
 * A memo deleted since — by you, by Galley, or on the page with its undo
 * toast up — says 「已删除」 on the right, in the to-do card's cell; a
 * 「不再记」 card says nothing more, its prefix has. One past its last
 * day is muted and not struck — it held until then — with 「已过期」.
 */
export function MemoCards({
  events,
  afterCards = false,
}: {
  events: readonly MemoEventItem[];
  /** Under the reply's other cards: their 8px gap instead of the 12px
   * off the bubble. */
  afterCards?: boolean;
}) {
  return (
    <div
      data-role="memo-cards"
      className={cn("flex flex-col gap-2", afterCards ? "mt-2" : "mt-3")}
    >
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
      className="rounded-md border border-line bg-app"
    >
      <div className="flex min-h-10 items-center gap-2.5 py-1.5 pl-4 pr-3">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center text-ink-muted">
          <Notepad size={16} weight="thin" aria-hidden />
        </span>
        {state === "listed" ? (
          // The to-do card's title button: as wide as its words,
          // underlined on hover, a ring on keyboard focus.
          <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">
            <button
              type="button"
              onClick={() => showMemoRow(event.memoId, event.sessionId)}
              onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, full)}
              className={cn(
                "block max-w-full truncate rounded-sm text-left outline-none",
                "decoration-ink-muted/60 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-brand/30",
              )}
            >
              {line}
            </button>
          </span>
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-muted"
            onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, full)}
          >
            {line}
          </span>
        )}
        {side && (
          // The to-do card's right-hand cell, where its 「已删除」 is.
          <span
            data-role="memo-card-state"
            className="shrink-0 select-none text-[12px] tabular-nums text-ink-muted"
          >
            {side}
          </span>
        )}
      </div>
    </div>
  );
}
