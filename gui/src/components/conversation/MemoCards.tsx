import { Notepad } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import { memoCardOpens, memoCardParts, type MemoEventItem } from "@/lib/memo";
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
  const opens = useMemoStore((s) => memoCardOpens(event, s.memos, s.deleting));
  const { prefix, text } = memoCardParts(event, copy);
  const full = `${prefix} · ${text}`;
  const line = (
    <>
      <span className="text-ink-muted">{prefix} · </span>
      {text}
    </>
  );
  return (
    <div
      data-role="memo-card"
      data-memo-id={event.memoId}
      data-memo-action={event.action}
      className="rounded-md border border-line bg-app"
    >
      <div className="flex min-h-10 items-center gap-2.5 py-1.5 pl-4 pr-3">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center text-ink-muted">
          <Notepad size={16} weight="thin" aria-hidden />
        </span>
        {opens ? (
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
            className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink"
            onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, full)}
          >
            {line}
          </span>
        )}
      </div>
    </div>
  );
}
