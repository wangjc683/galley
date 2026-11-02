import { useState } from "react";

import { useDayStamp } from "@/hooks/useDayStamp";
import { todoFailureText, type TodoTarget } from "@/lib/assistant-todo";
import { useCopy, useLanguage } from "@/lib/i18n";
import {
  memoDayLabel,
  memoPageGroups,
  memoRowTarget,
  memosWithoutDeleting,
  memoUntilLabel,
  type MemoItem,
} from "@/lib/memo";
import { cn } from "@/lib/utils";
import { useMemoStore } from "@/stores/memo";

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
 * Grouped by the local day each was last noted or changed, the latest
 * day first (lib/memo.ts `memoPageGroups`; a memo changed moves to that
 * day). The day sits in a left column beside its first memo's first
 * line (ticket 119, PRD ruling 164), not on a line of its own as the
 * to-do page's group labels do (ruling 142 point 5: the two pages kept
 * apart in form): see `MemoDay`. 8px between days. One sentence a row,
 * 13px, never cut: it wraps under itself, not under the day. A memo
 * with a last day says 「到 11月1日」 on the right of its first line,
 * 12px `ink-muted` as a to-do's time; no icon, box or tag (a noticed
 * interest says so in its own words, ruling 140 point 6).
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
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  const listed = useMemoStore((s) => s.memos);
  const deleting = useMemoStore((s) => s.deleting);
  const loaded = useMemoStore((s) => s.loaded);
  // Before the first read, nothing; the rows deleted here wait off the
  // page for their undo.
  if (!loaded) return null;
  const memos = memosWithoutDeleting(listed, deleting);
  if (memos.length === 0) return <MemoEmpty />;
  return (
    <div data-role="memo-groups" className="space-y-2">
      {memoPageGroups(memos).map((group) => (
        <section
          key={group.dayMs}
          data-memo-group=""
          className="flex items-start"
        >
          {/* First in the section, so a screen reader reads the day and
              then its memos, as under the group label before. */}
          <MemoDay
            label={memoDayLabel(group.dayMs, todayStartMs, language, copy)}
          />
          <div className="min-w-0 flex-1">
            {group.memos.map((memo) => (
              <MemoRow
                key={memo.id}
                memo={memo}
                mainChatId={mainChatId}
                onGo={onGo}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * A day's column (ticket 119, PRD ruling 164): the day beside its first
 * memo, in the same 20px line box under the same 6px as the row's words,
 * so the two first lines sit level; the day's other memos leave it
 * empty. Written as the 「到 …」 on the right of a row is (12px, regular,
 * `ink-muted`, tabular figures): one line, one way to write a day.
 *
 * A fixed 76px, whatever the day says: 10px in, as the to-do page's
 * group labels start, then 66px, room for the widest label in common
 * use with a few pixels to spare (measured in Chrome with the app's
 * fonts: 「10月28日」 and 「12月31日」 59.6px, 「Yesterday」 56.3px, 「May
 * 28」 42.9px). A label from an earlier year (「2025年12月31日」 105.8px,
 * 「Dec 31, 2025」 78.9px) folds onto a second line inside the column
 * rather than widen it or be cut: after the year (`memoDayParts`), as
 * the English one folds at its last space. The row's hover ground
 * starts where the column ends: about 6px after the widest day, the
 * words 10px further in.
 */
function MemoDay({ label }: { label: string }) {
  const parts = memoDayParts(label);
  return (
    <div
      data-role="memo-day"
      className="w-[76px] shrink-0 break-words py-1.5 pl-2.5 text-[12px] leading-5 tabular-nums text-ink-muted"
    >
      {parts.length === 1
        ? label
        : parts.map((part) => (
            <span key={part} className="whitespace-nowrap">
              {part}
            </span>
          ))}
    </div>
  );
}

/**
 * A Chinese day from an earlier year in two pieces, the year and the
 * date (「2025年」「12月31日」), each kept whole: left to the line
 * breaker, 「2025年12月31日」 folded inside 「12月」 (「2025年12」 fits the
 * column). Any other label is one piece and wraps as text does: the
 * English 「Dec 31, 2025」 folds at its space.
 */
function memoDayParts(label: string): string[] {
  const year = label.indexOf("年");
  if (year <= 0 || year === label.length - 1) return [label];
  return [label.slice(0, year + 1), label.slice(year + 1)];
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
 * the room and wrapping, the day never shrinking. On hover or keyboard
 * focus the ⋯ floats over the row's right end beside the first line, and
 * the row gives way to it as a to-do's title does; while its menu is
 * open the row stays as the hover left it. The row is the words' cell
 * alone: its hover ground and its flash leave the day's column out, the
 * day belonging to no one memo (ticket 119).
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
  const menu: TodoRowMenuModel = { onDelete: () => deleteMemo(memo) };
  const words = target ? (
    <button
      type="button"
      onClick={() => onGo(target)}
      className={cn(
        "max-w-full break-words rounded-sm text-left outline-none",
        "underline-offset-2 hover:underline hover:decoration-ink-muted/60 focus-visible:ring-2 focus-visible:ring-brand/30",
      )}
    >
      {memo.text}
    </button>
  ) : (
    <span className="break-words">{memo.text}</span>
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
        {/* The row's right padding grows by the ⋯'s room (10px + 32px,
            as a to-do title's pr-8) while it shows. Top-aligned, both in
            20px lines, the day on the words' first line: a baseline
            alignment would take the words button's last line. */}
        <div
          className={cn(
            "relative flex items-start gap-3 px-2.5 py-1.5",
            "group-focus-within/memo-row:pr-[42px] group-hover/memo-row:pr-[42px]",
            menuOpen && "pr-[42px]",
          )}
        >
          <div className="min-w-0 flex-1 text-[13px] leading-5 text-ink">
            {words}
          </div>
          {until && (
            <span
              data-role="memo-until"
              className="shrink-0 text-[12px] leading-5 tabular-nums text-ink-muted"
            >
              {until}
            </span>
          )}
          <div
            className={cn(
              "absolute right-1.5 top-0.5 opacity-0 group-focus-within/memo-row:opacity-100 group-hover/memo-row:opacity-100",
              menuOpen && "opacity-100",
            )}
          >
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
