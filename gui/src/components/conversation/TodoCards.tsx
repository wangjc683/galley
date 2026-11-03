import {
  REPLY_CARD_ICON,
  REPLY_CARD_LINE,
  REPLY_CARD_LINE_OPENS,
  ReplyCardTitle,
} from "@/components/conversation/ReplyCards";
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
 * A 24px line in the reply's frame (ReplyCards, ruling 182; spec:
 * docs/design/conversation.md 「回复下的卡片（一框列表）」 and 「待办卡片」):
 * the box, the title (one line, cut, ink-soft), then 8px on when it is
 * due (「逾期 2 天」 in warning) and its reminder in ink-muted, at most
 * 16em (a length: the frame sizes itself to its content). A tick strikes
 * the title through; a failed one puts it back with a line under it.
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
 * `showTodoRow`) — from anywhere on the line but the box, which ticks
 * (`REPLY_CARD_TITLE_REACH`), and the reminder's bell, which keeps its
 * tooltip. Only while the panel lists it — not cancelled, not done more
 * than seven days ago — otherwise the title is words, as a panel title
 * with nowhere to lead is, and the line does not light.
 */
export function TodoCards({ items }: { items: readonly TodoItem[] }) {
  return (
    <div data-role="todo-cards" className="flex flex-col">
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
  const opens = listed && !deleting && Boolean(mainChatId);
  // The name in ink-soft, ink while its line is hovered or it has focus;
  // a ticked or cancelled one keeps its muted strike.
  const titleInk =
    !checked &&
    !cancelled &&
    "text-ink-soft group-hover/line:text-ink focus-visible:text-ink";
  return (
    <div
      data-role="todo-card"
      data-todo-id={item.id}
      data-todo-state={
        cancelled ? "cancelled" : item.state === "done" ? "done" : "open"
      }
      data-todo-checked={checked ? "true" : "false"}
      className="rounded-sm"
    >
      <div className={cn(REPLY_CARD_LINE, opens && REPLY_CARD_LINE_OPENS)}>
        {/* data-card-icon: the glyph a new card flies into the top
            bar's 待办 button (ticket 102, lib/todo-flight-run.ts). The
            box is lifted over the title's reach: it ticks. */}
        <span
          data-card-icon=""
          className={cn(REPLY_CARD_ICON, "[&>label]:relative [&>label]:z-10")}
        >
          <TodoCheck
            item={item}
            checked={checked}
            saving={flip?.phase === "saving"}
            checkedTone={done ? "quiet" : undefined}
          />
        </span>
        {opens && mainChatId ? (
          // Opens from anywhere on the line (ReplyCards).
          <ReplyCardTitle
            text={item.text}
            onClick={() => showTodoRow(item.id, mainChatId)}
            className={cn(todoTitleClass(checked, cancelled), titleInk)}
          />
        ) : (
          <span
            className={cn(
              "min-w-0 truncate leading-5",
              todoTitleClass(checked, cancelled),
              titleInk,
            )}
            onPointerEnter={(e) =>
              syncTruncatedTitle(e.currentTarget, item.text)
            }
          >
            {item.text}
          </span>
        )}
        {parts.length > 0 && (
          // Lets a click through to the title's button; the bell keeps
          // its tooltip (the reminder's time in words).
          <span
            data-role="todo-meta"
            className="pointer-events-none ml-2 max-w-[16em] shrink-0 select-none truncate tabular-nums text-ink-muted [&_[title]]:pointer-events-auto"
          >
            <TodoMetaText parts={parts} />
          </span>
        )}
      </div>
      {failure && (
        <div
          role="alert"
          className="pb-2 pl-[30px] pr-3 text-[12px] leading-[1.45] text-error"
        >
          {todoFailureText(failure, copy)}
        </div>
      )}
    </div>
  );
}
