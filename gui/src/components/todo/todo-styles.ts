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
 * (`hover:decoration-ink-muted/60`, ticket 99). The change rides
 * `--motion-base`; none under reduced motion.
 */
export function todoTitleClass(checked: boolean, cancelled = false): string {
  return cn(
    "transition-colors duration-(--motion-base) motion-reduce:transition-none",
    checked || cancelled ? "text-ink-muted line-through" : "text-ink",
  );
}
