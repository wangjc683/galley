import { cn } from "@/lib/utils";

// TEMP variant switcher (main chat 42): the type of C's two options.
import type { DoneVariant } from "./todo-variants/todo-variants";

/**
 * A checked to-do's title — in the panel (held in place after a tick,
 * and under 已完成) and on its card under the reply: struck through in
 * `ink-muted`, Markdown's strike-through (MarkdownView `del`). The
 * change rides `--motion-base`; none under reduced motion.
 */
export function todoTitleClass(checked: boolean): string {
  return cn(
    "transition-colors duration-(--motion-base) motion-reduce:transition-none",
    checked ? "text-ink-muted line-through" : "text-ink",
  );
}

/**
 * A checked to-do's whole row. TEMP variant switcher (main chat 42),
 * comparison C: C1 adds nothing to the title's strike-through, C2 fades
 * the row (box, title, second line) to 60% as well.
 */
export function todoDoneClass(checked: boolean, fade: DoneVariant): string {
  return cn(
    "transition-opacity duration-(--motion-base) motion-reduce:transition-none",
    checked && fade === "C2" && "opacity-60",
  );
}
