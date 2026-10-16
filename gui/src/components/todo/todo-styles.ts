import { cn } from "@/lib/utils";

/**
 * A checked to-do's title — in the panel (held in place after a tick,
 * and under 已完成) and on its card under the reply: struck through in
 * `ink-muted`, Markdown's strike-through (MarkdownView `del`), and
 * nothing more — the row is not faded too (ticket 42's C1, JC's pick,
 * ruling 93; C2 also took the row to 60%). A cancelled one's (a card's,
 * main chat ticket 43) is `ink-muted` and not struck: it was not done.
 * The change rides `--motion-base`; none under reduced motion.
 */
export function todoTitleClass(checked: boolean, cancelled = false): string {
  return cn(
    "transition-colors duration-(--motion-base) motion-reduce:transition-none",
    cancelled
      ? "text-ink-muted"
      : checked
        ? "text-ink-muted line-through"
        : "text-ink",
  );
}
