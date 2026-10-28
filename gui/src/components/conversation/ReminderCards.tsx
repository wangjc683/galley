import { Alarm } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useDayStamp } from "@/hooks/useDayStamp";
import {
  cancelScheduledTask,
  reminderCardState,
  reminderStateLabel,
  reminderTimeLabel,
  todoActionFailure,
} from "@/lib/assistant-todo";
import { useCopy, useLanguage } from "@/lib/i18n";
import type { ScheduledTask } from "@/lib/scheduled-tasks";
import { showTodoRow } from "@/lib/todo-open";
import { reminderListed } from "@/lib/todo-panel";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { cn } from "@/lib/utils";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

/**
 * The reminders the assistant set in one reply, one card each, under
 * that reply (main chat ticket 37, assistant PRD ruling 9): drawn from
 * the database, not from what the model wrote, so a card is a promise
 * Galley holds. After the reply's subtask cards when it has both — the
 * work it handed off first, then what it will come back to.
 *
 * The form is the subtask card's (spec: docs/design/conversation.md
 * 「提醒卡片」): hairline `border-line`, `rounded-md`, the page ground,
 * no state bar — a reminder asks nothing of the user. One line: the
 * alarm glyph, the time (「明天 09:00」, or a rule, 「每天 08:00」), the
 * words it noted (one line, cut), the state (待提醒 / 已提醒 / 已取消 /
 * 已暂停) and 「取消」 while it may still go off. A cancel needs no
 * confirm (it touches this one thing) and is not told to the assistant;
 * the card stays, saying 已取消, its time and words struck through
 * (ticket 99). A cancel that fails says why on a line under it.
 *
 * Its words open the to-do panel at the task's row (main chat ticket
 * 101, PRD ruling 147 point 5), as a to-do card's title does
 * (lib/todo-open.ts `showTodoRow`): beside this conversation, the row
 * lit up, 已完成 unfolded for one that went off. Only while the panel
 * lists it (`reminderListed`) — not cancelled, not gone off more than
 * seven days ago — otherwise words; the three cards alike.
 */
export function ReminderCards({
  tasks,
  afterSubtasks = false,
}: {
  tasks: readonly ScheduledTask[];
  /** Under the reply's subtask cards: their 8px gap instead of the 12px
   * off the bubble. */
  afterSubtasks?: boolean;
}) {
  return (
    <div
      data-role="reminder-cards"
      className={cn("flex flex-col gap-2", afterSubtasks ? "mt-2" : "mt-3")}
    >
      {tasks.map((task) => (
        <ReminderCard key={task.id} task={task} />
      ))}
    </div>
  );
}

function ReminderCard({ task }: { task: ScheduledTask }) {
  const copy = useCopy();
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = reminderCardState(task);
  const time = reminderTimeLabel(task, todayStartMs, language, copy);
  const settled = state === "fired" || state === "cancelled";
  // Cancelled is struck, as a deleted to-do or memo is (ticket 99, PRD
  // ruling 144 point 2): one meaning, the three cards alike.
  const struck = state === "cancelled";
  const canCancel = state === "scheduled" || state === "paused";
  const listed = useAssistantTodoStore((s) => reminderListed(s.todo, task.id));
  const mainChatId = task.createdIn?.sessionId;

  const cancel = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    // The card turns into 已取消 on Core's `scheduled-tasks:changed`.
    cancelScheduledTask(task.id)
      .catch((e: unknown) => setError(todoActionFailure(e, copy)))
      .finally(() => setBusy(false));
  };

  return (
    <div
      data-role="reminder-card"
      data-reminder-state={state}
      aria-label={`${copy.todo.reminder} · ${task.prompt}`}
      className="rounded-md border border-line bg-app"
    >
      {/* min-h-10: the same height with 「取消」 or without it. */}
      <div className="flex min-h-10 select-none items-center gap-2.5 py-1.5 pl-4 pr-2.5">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center text-ink-muted">
          <Alarm size={14} weight="regular" aria-hidden />
        </span>
        <span
          className={cn(
            "shrink-0 text-[12.5px] tabular-nums",
            settled ? "text-ink-muted" : "text-ink-soft",
            struck && "line-through",
          )}
        >
          {time}
        </span>
        {listed && mainChatId ? (
          // A to-do card's title button (ticket 101): as wide as its
          // words, underlined on hover at 60%, a ring on keyboard focus;
          // the colour and any strike take the words' own, as there.
          <span className="min-w-0 flex-1 text-[13px] leading-5">
            <button
              type="button"
              onClick={() => showTodoRow(task.id, mainChatId)}
              onPointerEnter={(e) =>
                syncTruncatedTitle(e.currentTarget, task.prompt)
              }
              className={cn(
                "block max-w-full truncate rounded-sm text-left outline-none",
                "underline-offset-2 hover:underline hover:decoration-ink-muted/60 focus-visible:ring-2 focus-visible:ring-brand/30",
                settled ? "text-ink-muted" : "text-ink",
                struck && "line-through",
              )}
            >
              {task.prompt}
            </button>
          </span>
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] leading-5",
              settled ? "text-ink-muted" : "text-ink",
              struck && "line-through",
            )}
            onPointerEnter={(e) =>
              syncTruncatedTitle(e.currentTarget, task.prompt)
            }
          >
            {task.prompt}
          </span>
        )}
        <span className="shrink-0 text-[12px] text-ink-muted">
          {reminderStateLabel(task, copy)}
        </span>
        {canCancel && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={cancel}
          >
            {copy.todo.cancel}
          </Button>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="pb-2 pl-[42px] pr-3 text-[12px] leading-[1.45] text-error"
        >
          {error}
        </div>
      )}
    </div>
  );
}
