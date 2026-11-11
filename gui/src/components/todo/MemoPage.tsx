import { useState } from "react";

import { useDayStamp } from "@/hooks/useDayStamp";
import { todoFailureText, type TodoTarget } from "@/lib/assistant-todo";
import { useCopy, useLanguage } from "@/lib/i18n";
import {
  memoDayLabel,
  memoDayMs,
  memoPageGroups,
  memoRowTarget,
  memoShownText,
  memosWithoutDeleting,
  memoUntilLabel,
  type MemoBucket,
  type MemoItem,
} from "@/lib/memo";
import { cn } from "@/lib/utils";
import { useMemoStore } from "@/stores/memo";

import { GroupLabel } from "./GroupLabel";
import {
  TodoRowContextMenu,
  TodoRowMenuButton,
  type TodoRowMenuModel,
} from "./TodoRowMenu";

/**
 * The to-do panel's 备忘 page (main chat ticket 97, PRD ruling 142 point
 * 5): what Galley noted about you, the memos that hold today — what the
 * main chat reads at the start of each segment (ruling 142 point 3:
 * what you see is what it sees).
 *
 * Grouped by when each was last noted or changed, in the sidebar's time
 * periods — 今天, 本周, 本月, 更早, by the sidebar's rule and in its words
 * (ticket 121, PRD ruling 166; lib/memo.ts `memoPageGroups`; a memo
 * changed moves to the period of its change) — under the to-do page's
 * group labels (GroupLabel) and its 12px between groups; an empty
 * period is not drawn, and with every memo in one period its label is
 * not either (PRD ruling 209 point 2: memos come days apart, so most
 * days the page is one period, and a lone 「本月」 or 「更早」 over the
 * whole page says nothing). The day itself shows on a row's hover, left
 * of its ⋯ (`MemoRow`). One sentence a row, 13px, the panel's width,
 * never cut: it wraps; the full stop that ends it is not drawn (ruling
 * 209 point 1, lib/memo.ts `memoShownText`). A memo with a last day says 「到 11月1日」 on the right
 * of its first line, 12px `ink-muted` as a to-do's time; no icon, box
 * or tag (a noticed interest says so in its own words, ruling 140
 * point 6).
 *
 * Its words lead back to the sentence it was last noted or changed in
 * (Core's `changedIn`, the jump a to-do's title makes); one noted
 * elsewhere (another agent through the CLI) has words, not a button. Its
 * ⋯ and right-click menu hold 「删除」 alone (TodoRowMenu): no confirm,
 * the row off the page at once with five seconds to undo
 * (stores/memo.ts, the to-do's ticket 88 way). No edit: you tell Galley.
 * Nothing it moves lights up here; only the row a card's words point at
 * does (useTodoPanelFlash, `data-memo-row`).
 */
export function MemoPage({
  mainChatId,
  onGo,
}: {
  /** The main chat, wherever the panel is: a row's words jump into it. */
  mainChatId: string;
  onGo: (target: TodoTarget) => void;
}) {
  const copy = useCopy();
  const todayStartMs = useDayStamp();
  const listed = useMemoStore((s) => s.memos);
  const deleting = useMemoStore((s) => s.deleting);
  const loaded = useMemoStore((s) => s.loaded);
  // Before the first read, nothing; the rows deleted here wait off the
  // page for their undo.
  if (!loaded) return null;
  const memos = memosWithoutDeleting(listed, deleting);
  if (memos.length === 0) return <MemoEmpty />;
  // The sidebar's words for its periods, read as the sidebar reads them.
  const labels: Record<MemoBucket, string> = {
    today: copy.sidebar.bucketToday,
    week: copy.sidebar.bucketWeek,
    month: copy.sidebar.bucketMonth,
    earlier: copy.sidebar.bucketEarlier,
  };
  const groups = memoPageGroups(memos, todayStartMs);
  // A label tells one period from another: with one period, none.
  const labelled = groups.length > 1;
  return (
    <div data-role="memo-groups" className="space-y-3">
      {groups.map((group) => (
        <section key={group.bucket} data-memo-group={group.bucket}>
          {labelled && <GroupLabel label={labels[group.bucket]} />}
          {group.memos.map((memo) => (
            <MemoRow
              key={memo.id}
              memo={memo}
              mainChatId={mainChatId}
              onGo={onGo}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

/** Empty: one sentence and an example, as the to-do page's, without its
 * button — the header's + is there. */
function MemoEmpty() {
  const copy = useCopy();
  return (
    <div data-role="memo-empty" className="px-4 py-8 text-center">
      <p className="text-[13px] text-ink-soft">{copy.memo.empty}</p>
      <p className="mt-1.5 text-[12px] text-ink-muted">
        {copy.memo.emptyExample}
      </p>
    </div>
  );
}

/**
 * One memo: its words (a button when they lead somewhere: as wide as
 * they are, underlined on hover, a ring on keyboard focus — the to-do
 * title's) and its last day on the first line's right, the words taking
 * the room and wrapping, the last day never shrinking. On hover, keyboard
 * focus or with its menu open, the day it was last noted or changed and
 * the ⋯ show over the first line's right end (ticket 121, PRD ruling
 * 166): see the comment at that cluster. The row gives way to neither:
 * nothing it holds moves when the pointer comes.
 */
function MemoRow({
  memo,
  mainChatId,
  onGo,
}: {
  memo: MemoItem;
  mainChatId: string;
  onGo: (target: TodoTarget) => void;
}) {
  const copy = useCopy();
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  const deleteMemo = useMemoStore((s) => s.deleteMemo);
  const failure = useMemoStore((s) => s.failures[memo.id] ?? null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const menuOpen = dropdownOpen || contextOpen;
  const target = memoRowTarget(memo, mainChatId);
  const until = memoUntilLabel(memo, todayStartMs, language, copy);
  const day = memoDayLabel(memoDayMs(memo), todayStartMs, language, copy);
  const menu: TodoRowMenuModel = { onDelete: () => deleteMemo(memo) };
  const shown = memoShownText(memo.text);
  const words = target ? (
    <button
      type="button"
      onClick={() => onGo(target)}
      className={cn(
        "max-w-full break-words rounded-sm text-left outline-none",
        "underline-offset-2 hover:underline hover:decoration-ink-muted/60 focus-visible:ring-2 focus-visible:ring-brand/30",
      )}
    >
      {shown}
    </button>
  ) : (
    <span className="break-words">{shown}</span>
  );
  return (
    <TodoRowContextMenu
      model={menu}
      disabled={false}
      onOpenChange={setContextOpen}
    >
      <div
        data-memo-row={memo.id}
        className={cn(
          "group/memo-row rounded-sm hover:bg-hover",
          menuOpen && "bg-hover",
        )}
      >
        {/* Top-aligned, both in 20px lines, the last day on the words'
            first line: a baseline alignment would take the words
            button's last line. The same padding however the row is: the
            hover cluster below floats, it takes no width. 4px above and
            below, a 28px row (ruling 168; the to-do page keeps 6px). */}
        <div className="relative flex items-start gap-3 px-2.5 py-1">
          {/* A faint dot where a to-do has its box (ruling 169): the
              to-do row's 16px-by-20px cell and its 10px to the words
              (-mr-0.5 takes the row's 12px gap down to 10px), so the
              words start where a to-do title does and a wrapped line
              stays under the words. The empty box's border colour; not
              a control, so hidden from screen readers. */}
          <span
            data-role="memo-dot"
            aria-hidden="true"
            className="-mr-0.5 flex h-5 w-4 shrink-0 items-center justify-center"
          >
            <span className="size-[5px] rounded-full bg-line-strong" />
          </span>
          <div className="min-w-0 flex-1 text-[13px] leading-5 text-ink">
            {words}
          </div>
          {until && (
            <span
              data-role="memo-until"
              className={cn(
                "shrink-0 text-[12px] leading-5 tabular-nums text-ink-muted",
                // Under the cluster while it shows; hidden with it, so
                // no edge of it shows through the cluster's fade.
                "group-focus-within/memo-row:opacity-0 group-hover/memo-row:opacity-0",
                menuOpen && "opacity-0",
              )}
            >
              {until}
            </span>
          )}
          {/* The day and the ⋯ (ticket 121, PRD ruling 166): on hover,
              keyboard focus or with the menu open, over the first line's
              right end — the first line's 20px box, 6px from the row's
              right as the ⋯ was — on the ground the row has then (its
              hover ground; the panel's under keyboard focus alone),
              fading in over 12px at its left edge. It covers the words'
              end and the 「到 …」 rather than take their width: no line
              of the words folds anew and no row below moves when the
              pointer comes (the to-do page's rows still give way). The
              day as the 「到 …」 is written: 12px, `ink-muted`, tabular
              figures, about 11px from the ⋯'s first dot; 「今天」 too, one
              rule for every row. The ⋯ (28px) overhangs the 20px box. */}
          <div
            data-role="memo-hover"
            className={cn(
              "absolute right-1.5 top-1 flex h-5 items-center gap-0.5 pl-5",
              "bg-[linear-gradient(to_right,transparent,var(--memo-ground)_12px)] [--memo-ground:var(--color-app)]",
              "group-hover/memo-row:[--memo-ground:var(--color-hover)]",
              "opacity-0 group-focus-within/memo-row:opacity-100 group-hover/memo-row:opacity-100",
              menuOpen && "opacity-100 [--memo-ground:var(--color-hover)]",
            )}
          >
            <span
              data-role="memo-day"
              className="whitespace-nowrap text-[12px] leading-5 tabular-nums text-ink-muted"
            >
              {day}
            </span>
            <TodoRowMenuButton
              model={menu}
              open={dropdownOpen}
              onOpenChange={setDropdownOpen}
            />
          </div>
        </div>
        {failure && (
          <p
            role="alert"
            className="pb-1.5 pl-2.5 pr-3 text-[11.5px] leading-[1.45] text-error"
          >
            {todoFailureText(failure, copy)}
          </p>
        )}
      </div>
    </TodoRowContextMenu>
  );
}
