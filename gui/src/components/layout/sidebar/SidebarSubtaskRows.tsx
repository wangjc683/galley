import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CircleNotch, PauseCircle } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import {
  sidebarSubtaskRowsShown,
  subtaskNeedsYou,
  type SidebarSubtask,
  type SidebarSubtasks,
  type SidebarSubtaskState,
} from "@/lib/sidebar-subtasks";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { truncationFadeRef } from "@/lib/truncation-fade";
import { cn } from "@/lib/utils";

import { SidebarShowMoreRow } from "./SidebarProjectGroup";

/**
 * The subtasks Galley has in hand, under its card in the assistant zone
 * (main chat ticket 128, PRD rulings 176, 177; which and in what order
 * is lib/sidebar-subtasks.ts): one row per subtask running or asking
 * you, then, when more than five run, 「还有 N 件在办」, which unfolds the
 * rest in place and becomes 「收起」 (ruling 197 point 4). Nothing to
 * list, nothing at all: the zone is as it was, to the pixel.
 *
 * A row is a conversation, one line on the session rows' grid: the
 * status glyph in the 16px column on the 18px line, the title on the
 * 42px line, cut with a fade (the whole of it on hover while cut), and,
 * asking, the sidebar's 「等你回复」 at the right end, amber, medium.
 *
 * B3, picked on real hardware (ruling 177 point 5, over A — the
 * workbench's row, B, B2 and C): a size down from a session row, the
 * title 12px in a 28px row. Colour and weight are for what needs you
 * alone: asking, a filled amber pause and a semibold title; running, the
 * session row's spinner, still turning, in muted ink instead of brand,
 * and a medium title, no word — its glyph says it. Every row here runs
 * or asks, so brand spinners and bold titles on every row would single
 * none of them out, only raise the volume. Titles step back to
 * ink-soft, the open one's in full ink, as a session row's.
 *
 * Pressed it opens the subtask in the main area on pointerdown, as a row
 * does (the click that follows is swallowed; Enter and Space open it as
 * any button): Galley's subtask card's 「打开」, the header's 「Galley ›」
 * breadcrumb as before. Open, the row is the sidebar's selected one — a
 * session row's fill, lift and full ink — and the card steps back
 * (Sidebar). No menu and no 「⋯」: archiving and deleting a subtask are
 * Galley's business.
 *
 * Each row is a button named 「子任务：{标题}」, 「，等你回复」 after it
 * when it asks. 「还有 N 件在办」 is a project group's 「显示更多」 row
 * (SidebarShowMoreRow: its look, its caret down, 「收起」 with the caret
 * up at the end of what it unfolded, held under the pointer as it folds
 * back), named by its words: it unfolds the running subtasks past five
 * under the others, and 「收起」 folds them again. Until ruling 197 it
 * opened the to-do panel with them lit; the panel lists no subtask now,
 * and it touches the panel no more. Unfolded or not is the sidebar's
 * (`unfolded`, Sidebar), as an open subtask folded away leaves the
 * selected place on Galley's card; nothing remembers it.
 */
export function SidebarSubtaskRows({
  subtasks,
  unfolded = false,
  onToggleMore,
  activeId,
  onOpen,
}: {
  subtasks: SidebarSubtasks;
  /** The running ones past five are drawn (`sidebarSubtaskRowsShown`). */
  unfolded?: boolean;
  /** 「还有 N 件在办」 and 「收起」: unfold, fold. */
  onToggleMore: () => void;
  /** The session in the main area: its row, if drawn, is selected. */
  activeId?: string;
  /** Open a subtask in the main area. Absent, a row does nothing (the
   * dev switcher's demo rows). */
  onOpen?: (id: string) => void;
}) {
  const copy = useCopy();
  const { rows, more } = subtasks;
  if (rows.length === 0 && more.length === 0) return null;
  const shown = sidebarSubtaskRowsShown(subtasks, unfolded);
  const open = unfolded && more.length > 0;
  return (
    // 6px under the card, as the card block's own foot is 6px over the
    // strong line: the rows sit in the zone, above it.
    <div data-role="sidebar-subtasks" className="mt-1.5">
      {shown.map((row) => (
        <SubtaskRow
          key={row.id}
          row={row}
          selected={row.id === activeId}
          onOpen={onOpen ? () => onOpen(row.id) : undefined}
        />
      ))}
      {/* One slot for both words, so 收起 stays the same instance and
          holds itself under the pointer as it folds (SidebarShowMoreRow). */}
      {more.length > 0 && (
        <SidebarShowMoreRow
          dataRole="sidebar-subtasks-more"
          mode={open ? "less" : "more"}
          label={
            open ? copy.sidebar.showLess : copy.subtask.sidebarMore(more.length)
          }
          onToggle={onToggleMore}
        />
      )}
    </div>
  );
}

function SubtaskRow({
  row,
  selected,
  onOpen,
}: {
  row: SidebarSubtask;
  selected: boolean;
  onOpen?: () => void;
}) {
  const copy = useCopy();
  const title = row.title || copy.subtask.label;
  const needsYou = subtaskNeedsYou(row.state);
  const word = needsYou ? copy.sidebar.waitingForYou : null;
  // The glyph pops on entering a question, never for the state a row
  // mounted in (SidebarSessionRow's latch).
  const [prevState, setPrevState] = useState(row.state);
  const [popEnabled, setPopEnabled] = useState(false);
  if (row.state !== prevState) {
    setPrevState(row.state);
    setPopEnabled(true);
  }
  // Opens on pointerdown, as a session row does; the click that press
  // produces is swallowed. A plain flag: every click follows a
  // pointerdown that re-arms it.
  const ignoreNextClickRef = useRef(false);
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // macOS Ctrl-click is the context-menu gesture.
    if (event.button !== 0 || event.ctrlKey) return;
    ignoreNextClickRef.current = true;
    onOpen?.();
  };
  const handleClick = () => {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }
    onOpen?.();
  };
  return (
    <button
      type="button"
      data-role="sidebar-subtask"
      data-subtask-id={row.id}
      data-state={row.state}
      aria-label={copy.subtask.sidebarRowLabel(title, word ?? undefined)}
      aria-current={selected ? "page" : undefined}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={cn(
        // The session rows' grid: the glyph's 16px column on the 18px
        // line (mx-1.5 + px-3), the title from 42px, the word on the
        // right text edge. 28px high (B3).
        "mx-1.5 grid min-h-7 w-[calc(100%-12px)] items-center gap-2 rounded-sm px-3 py-1 text-left",
        word
          ? "grid-cols-[16px_minmax(0,1fr)_auto]"
          : "grid-cols-[16px_minmax(0,1fr)]",
        "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        // Selected: a session row's fill and lift; it does not answer
        // hover (selected must outweigh hover, globals.css 08-21).
        selected
          ? "bg-selected shadow-[var(--shadow-selected)]"
          : "hover:bg-hover",
      )}
    >
      <span
        key={`glyph:${row.state}`}
        className={cn(
          "flex h-5 w-4 items-center justify-center",
          needsYou && popEnabled && "sidebar-state-pop",
        )}
      >
        <SubtaskGlyph state={row.state} />
      </span>
      <span
        data-role="sidebar-subtask-title"
        ref={truncationFadeRef}
        onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, title)}
        className={cn(
          "truncate-fade min-w-0 text-[12px]",
          // Subtractive focus, as a session row: full ink selected, the
          // rest step back to ink-soft.
          selected ? "text-ink" : "text-ink-soft",
          // Weight is for what needs you (B3): asking semibold, running
          // medium.
          needsYou ? "font-semibold" : "font-medium",
        )}
      >
        {title}
      </span>
      {word && (
        <span
          data-role="sidebar-subtask-state"
          className="shrink-0 whitespace-nowrap text-[11px] font-medium text-warning"
        >
          {word}
        </span>
      )}
    </button>
  );
}

/** The session rows' glyphs (lib/status-icon.tsx; the to-do panel's
 * 「Galley 在办」 drew its subtasks with them until ruling 197): asking,
 * the filled amber pause; running, the spinner —
 * the same bold `CircleNotch`, turning — in muted ink, not brand (B3,
 * ruling 177 point 5). Drawn here: StatusIcon keeps the workbench rows'
 * brand spinner and takes no colour. */
function SubtaskGlyph({ state }: { state: SidebarSubtaskState }) {
  if (state === "asking") {
    return <PauseCircle size={14} weight="fill" className="text-warning" />;
  }
  return (
    <span className="inline-flex shrink-0 spin">
      <CircleNotch size={14} weight="bold" className="text-ink-muted" />
    </span>
  );
}
