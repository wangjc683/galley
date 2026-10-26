import { TodoCheck } from "@/components/todo/TodoCheck";
import { todoTitleClass } from "@/components/todo/todo-styles";
import { useDayStamp } from "@/hooks/useDayStamp";
import { todoFailureText, type TodoItem } from "@/lib/assistant-todo";
import { useCopy, useLanguage } from "@/lib/i18n";
import { TodoMetaText } from "@/components/todo/TodoMetaText";
import { showTodoRow } from "@/lib/todo-open";
import {
  todoCancelled,
  todoChecked,
  todoListed,
  todoMetaParts,
} from "@/lib/todo-panel";
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
 * ago, it looks as 已完成 does in the panel — its box ticked in neutral
 * grey, not brand (ticket 84) — and can be unticked;
 * cancelled, its box stays unticked and takes no click, its title is
 * struck through in `ink-muted` as a ticked one's is (ticket 99, PRD
 * ruling 144 point 1: a line through reads as not wanted, where it was
 * not struck before — it was not done; the unticked box and the words
 * beside it tell the two apart) and 「已删除」 takes the place of when
 * it was due — deleted at the desktop or by Galley, one
 * thing, one word (main chat ticket 88, PRD ruling 132 point 5; a
 * reminder card's 「已取消」 is cancelling a reminder, and stays). A
 * to-do deleted from the panel reads so at once, while its undo toast is
 * up (`deleting`), and back as it was on 撤销.
 *
 * Its title opens the to-do panel at its row (main chat ticket 87, PRD
 * ruling 131 point 3), as the panel's title leads back to the sentence:
 * beside this conversation, the row lit up (lib/todo-open.ts
 * `showTodoRow`). Only while the panel lists it — not cancelled, not
 * done more than seven days ago — otherwise the title is words, as a
 * panel title with nowhere to lead is.
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
  const flip = useAssistantTodoStore((s) => s.flips[item.id]);
  const failure = useAssistantTodoStore((s) => s.failures[item.id] ?? null);
  const listed = useAssistantTodoStore((s) => todoListed(s.todo, item.id));
  const deleting = useAssistantTodoStore((s) => item.id in s.deleting);
  const mainChatId = item.createdIn?.sessionId;
  const cancelled = todoCancelled(item) || deleting;
  const checked = !deleting && todoChecked(item, flip);
  // Done in Core: the box neutral, as under 已完成 (ticket 84). A card
  // being ticked stays brand through the hold; a cancelled one is never
  // ticked.
  const done = item.state === "done" && !cancelled;
  const parts = cancelled
    ? [{ text: copy.todo.stateDeleted, tone: "muted" as const }]
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
      <div className="flex min-h-10 items-center gap-2.5 py-1.5 pl-4 pr-3">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          <TodoCheck
            item={item}
            checked={checked}
            saving={flip?.phase === "saving"}
            checkedTone={done ? "quiet" : undefined}
          />
        </span>
        {listed && !deleting && mainChatId ? (
          // The panel's title button (TodoPanel's RowShell): as wide as
          // its words, underlined on hover, a ring on keyboard focus.
          <span className="min-w-0 flex-1 text-[13px] leading-5">
            <button
              type="button"
              onClick={() => showTodoRow(item.id, mainChatId)}
              onPointerEnter={(e) =>
                syncTruncatedTitle(e.currentTarget, item.text)
              }
              className={cn(
                "block max-w-full truncate rounded-sm text-left outline-none",
                "underline-offset-2 hover:underline hover:decoration-ink-muted/60 focus-visible:ring-2 focus-visible:ring-brand/30",
                todoTitleClass(checked, cancelled),
              )}
            >
              {item.text}
            </button>
          </span>
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] leading-5",
              todoTitleClass(checked, cancelled),
            )}
            onPointerEnter={(e) =>
              syncTruncatedTitle(e.currentTarget, item.text)
            }
          >
            {item.text}
          </span>
        )}
        {parts.length > 0 && (
          <span
            data-role="todo-meta"
            className="shrink-0 select-none text-[12px] tabular-nums text-ink-muted"
          >
            <TodoMetaText parts={parts} />
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
