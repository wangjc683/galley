import { useFlipBeat } from "@/hooks/useFlipBeat";
import { cn } from "@/lib/utils";

/**
 * A checked to-do's title — in the panel (held in place after a tick,
 * and under 已完成) and on its card under the reply: struck through in
 * `ink-muted`, Markdown's strike-through (MarkdownView `del`), and
 * nothing more — the row is not faded too (ticket 42's C1, JC's pick,
 * ruling 93; C2 also took the row to 60%). A cancelled one's (a card's,
 * main chat ticket 43) is struck the same way since ticket 99 (PRD
 * ruling 144 point 1): a line through reads as not wanted; the box left
 * unticked and 「已删除」 beside it tell it from one done. The strike
 * takes the text's colour, full `ink-muted`, on a title button too: the
 * buttons give their 60% decoration colour to the hover underline only
 * (`hover:decoration-ink-muted/60`, ticket 99). The colour rides
 * `--motion-base`; none under reduced motion.
 *
 * `drawn` (main chat ticket 160, PRD ruling 208 point 2): the strike
 * came after mount (`useTodoStrikeDrawn`), so the line fades in after
 * the box's tick (globals.css `todo-strike-in`); at rest it is the same
 * line-through. A strike taken away goes at once, the colour easing
 * back.
 */
export function todoTitleClass(
  checked: boolean,
  cancelled = false,
  drawn = false,
): string {
  const struck = checked || cancelled;
  return cn(
    "transition-colors duration-(--motion-base) motion-reduce:transition-none",
    struck ? "text-ink-muted line-through" : "text-ink",
    struck && drawn && "todo-strike-in",
  );
}

/**
 * How long `todo-strike-in` stays on a title: its wait and its fade,
 * `--motion-base` each (320ms), plus margin — then it comes off, so a
 * row moved or shown again does not replay it (`useFlipBeat`).
 */
const TODO_STRIKE_CLEAR_MS = 500;

/** A title's strike that came after mount — a tick, or a card turned
 * 「已删除」 / 「已跳过」 — for `todoTitleClass`'s `drawn`; false for one
 * struck when it mounts (a list loading, 已完成 opening, a card in the
 * history, a to-do landing in 已完成 as a new row). */
export function useTodoStrikeDrawn(struck: boolean): boolean {
  return useFlipBeat(struck, TODO_STRIKE_CLEAR_MS) === "on";
}

/**
 * One part of an open row's time line (main chat ticket 159, PRD ruling
 * 207 point 4) — when it is due, the rule, the reminder, the count of the
 * items: a whole that goes down to the next line together, never broken
 * inside. An inline block that keeps to one line, cut at its end only if
 * it alone is wider than the line; top-aligned, as overflow drops an
 * inline block's baseline to its foot. The line around it breaks nowhere
 * but at `TodoMetaBreak`.
 */
export const TODO_META_SEGMENT = "inline-block max-w-full truncate align-top";
