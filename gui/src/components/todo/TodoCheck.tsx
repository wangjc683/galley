import { Checkbox, type CheckboxCheckedTone } from "@/components/ui/checkbox";
import type { TodoItem } from "@/lib/assistant-todo";
import { todoCancelled } from "@/lib/todo-panel";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

/**
 * A to-do's box, in the panel and on its card (main chat ticket 42):
 * `ui/checkbox.tsx`'s box — the app's one checkbox, Markdown task items'
 * too — brand-filled with a tick when done. A click ticks or unticks
 * through the store, which holds the row in place for a moment first
 * (stores/assistant-todo.ts); `checked` is what the row shows, the tick
 * on its way included. Named by the to-do's title; the box says whether
 * it is done. A cancelled to-do's box (a card's, main chat ticket 43)
 * stays, unticked and disabled: there is nothing left to tick.
 */
export function TodoCheck({
  item,
  checked,
  saving,
  checkedTone,
  onToggle,
}: {
  item: TodoItem;
  checked: boolean;
  /** Core is writing a tick: the box waits for it. */
  saving: boolean;
  /** TEMP variant switcher (main chat 83): B and C's quiet box. */
  checkedTone?: CheckboxCheckedTone;
  /** TEMP variant switcher (main chat 83): a demo row's box, in place of
   * the store's tick — it asks nothing of Core. */
  onToggle?: () => void;
}) {
  const toggle = useAssistantTodoStore((s) => s.toggle);
  const cancelled = todoCancelled(item);
  return (
    <Checkbox
      checked={checked}
      checkedTone={checkedTone}
      disabled={saving || cancelled}
      aria-label={item.text}
      data-todo-check={item.id}
      onCheckedChange={() => (onToggle ? onToggle() : toggle(item))}
      // A box in a row that answers the pointer: no dimming while Core
      // writes (that would read as "can't"), only no second click.
      className={saving ? "cursor-default opacity-100" : undefined}
    />
  );
}
