import { TodoCheck } from "@/components/todo/TodoCheck";
import { todoDoneClass, todoTitleClass } from "@/components/todo/todo-styles";
// TEMP variant switcher (main chat 42): comparison C, the done fade.
import { useTodoVariants } from "@/components/todo/todo-variants/todo-variants";
import { useDayStamp } from "@/hooks/useDayStamp";
import { todoFailureText, type TodoItem } from "@/lib/assistant-todo";
import { useCopy, useLanguage } from "@/lib/i18n";
import { todoCancelled, todoChecked, todoMetaParts } from "@/lib/todo-panel";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { cn } from "@/lib/utils";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

/**
 * The to-dos Galley noted in one reply, a card each, under that reply
 * (main chat ticket 42, PRD ruling 91 point 1): drawn from the to-do
 * list (stores/assistant-todo.ts), not from what the model wrote, so it
 * is the same to-do the panel shows — tick it here and the panel's box
 * ticks too. In place of ticket 37's reminder card for a to-do (a
 * to-do's reminder records no reply of its own, so no reminder card
 * repeats it); what Galley will come back to by itself keeps that card.
 *
 * The reminder card's form (docs/design/conversation.md 「待办卡片」):
 * hairline `border-line`, `rounded-md`, the page ground, one line of at
 * least 40px — the box, the title (one line, cut), then when it is due
 * (「逾期 2 天」 in warning) and its reminder, 12px `ink-muted`. A tick
 * strikes the title through; a failed one puts it back with a line
 * under it.
 *
 * A card stays under its reply for good (ticket 43; the to-dos come from
 * every one noted in the main chat, not the list): done however long
 * ago, it looks as 已完成 does in the panel and can be unticked;
 * cancelled, its box stays unticked and takes no click, its title goes
 * `ink-muted` (not struck: it was not done) and 「已取消」 takes the
 * place of when it was due.
 */
export function TodoCards({
  items,
  afterSubtasks = false,
}: {
  items: readonly TodoItem[];
  /** Under the reply's subtask cards: their 8px gap instead of the 12px
   * off the bubble. */
  afterSubtasks?: boolean;
}) {
  return (
    <div
      data-role="todo-cards"
      className={cn("flex flex-col gap-2", afterSubtasks ? "mt-2" : "mt-3")}
    >
      {items.map((item) => (
        <TodoCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function TodoCard({ item }: { item: TodoItem }) {
  const copy = useCopy();
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  // TEMP variant switcher (main chat 42): comparison C.
  const fade = useTodoVariants((s) => s.done);
  const flip = useAssistantTodoStore((s) => s.flips[item.id]);
  const failure = useAssistantTodoStore((s) => s.failures[item.id] ?? null);
  const cancelled = todoCancelled(item);
  const checked = todoChecked(item, flip);
  const parts = cancelled
    ? [{ text: copy.todo.stateCancelled, tone: "muted" as const }]
    : todoMetaParts(item, checked, todayStartMs, language, copy);
  return (
    <div
      data-role="todo-card"
      data-todo-id={item.id}
      data-todo-state={
        cancelled ? "cancelled" : item.state === "done" ? "done" : "open"
      }
      data-todo-checked={checked ? "true" : "false"}
      className="rounded-md border border-line bg-app"
    >
      <div
        className={cn(
          "flex min-h-10 items-center gap-2.5 py-1.5 pl-4 pr-3",
          todoDoneClass(checked, fade),
        )}
      >
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          <TodoCheck
            item={item}
            checked={checked}
            saving={flip?.phase === "saving"}
          />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] leading-5",
            todoTitleClass(checked, cancelled),
          )}
          onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, item.text)}
        >
          {item.text}
        </span>
        {parts.length > 0 && (
          <span
            data-role="todo-meta"
            className="shrink-0 select-none text-[12px] tabular-nums text-ink-muted"
          >
            {parts.map((part, index) => (
              <span key={index}>
                {index > 0 && " · "}
                <span
                  className={
                    part.tone === "warning"
                      ? "font-medium text-warning"
                      : undefined
                  }
                >
                  {part.text}
                </span>
              </span>
            ))}
          </span>
        )}
      </div>
      {failure && (
        <div
          role="alert"
          className="pb-2 pl-[42px] pr-3 text-[12px] leading-[1.45] text-error"
        >
          {todoFailureText(failure, copy)}
        </div>
      )}
    </div>
  );
}
