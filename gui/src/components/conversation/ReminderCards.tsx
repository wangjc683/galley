import { Alarm } from "@phosphor-icons/react";
import { useState } from "react";

import {
  REPLY_CARD_ICON,
  REPLY_CARD_LINE,
  REPLY_CARD_LINE_OPENS,
  ReplyCardTitle,
} from "@/components/conversation/ReplyCards";
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
import { reminderFirstLine } from "@/lib/reminder-first-line";
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
 * A 24px line in the reply's frame (ReplyCards, ruling 182; spec:
 * docs/design/conversation.md 「回复下的卡片（一框列表）」 and 「提醒卡片」),
 * no state bar — a reminder asks nothing of the user: the alarm glyph,
 * the first line of the words it noted (one line, cut, ink-soft), then
 * 8px on in ink-muted the time (「明天 09:00」, or a rule, 「每天 08:00」)
 * and the state (待提醒 / 已提醒 / 已取消 / 已暂停), and at the line's
 * end 「取消」 while it may still go off (20px, `h-5`). A cancel needs no
 * confirm (it touches this one thing) and is not told to the assistant;
 * the card stays, saying 已取消, its time and words struck through
 * (ticket 99). A cancel that fails says why on a line under it.
 *
 * Its words open the to-do panel at the task's row (main chat ticket
 * 101, PRD ruling 147 point 5), as a to-do card's title does
 * (lib/todo-open.ts `showTodoRow`): beside this conversation, the row
 * lit up, 已完成 unfolded for one that went off — from anywhere on the
 * line but 「取消」 (`REPLY_CARD_TITLE_REACH`). Only while the panel
 * lists it (`reminderListed`) — not cancelled, not gone off more than
 * seven days ago — otherwise words, and the line does not light; the
 * three cards alike.
 *
 * Only the first line of its words, everywhere the card shows them —
 * the line, its accessible name, the hover on a cut line (main chat
 * ticket 105, PRD ruling 151): that line is written for the user; what
 * follows the blank line is the assistant's notes to itself, for when
 * it comes due (lib/reminder-first-line.ts).
 */
export function ReminderCards({ tasks }: { tasks: readonly ScheduledTask[] }) {
  return (
    <div data-role="reminder-cards" className="flex flex-col">
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
  const words = reminderFirstLine(task.prompt);
  const opens = listed && Boolean(mainChatId);
  // The words in ink-soft, ink while the line is hovered or they have
  // focus; gone off or cancelled, muted (and struck when cancelled).
  const wordsInk = cn(
    settled
      ? "text-ink-muted"
      : "text-ink-soft group-hover/line:text-ink focus-visible:text-ink",
    struck && "line-through",
  );

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
      data-reminder-id={task.id}
      aria-label={`${copy.todo.reminder} · ${words}`}
      className="rounded-sm"
    >
      <div
        className={cn(
          REPLY_CARD_LINE,
          "select-none",
          opens && REPLY_CARD_LINE_OPENS,
        )}
      >
        {/* data-card-icon: what flies into the top bar's 待办 button
            (ticket 102, lib/todo-flight-run.ts). */}
        <span
          data-card-icon=""
          className={cn(REPLY_CARD_ICON, "text-ink-muted")}
        >
          <Alarm size={14} weight="regular" aria-hidden />
        </span>
        {opens && mainChatId ? (
          // Opens from anywhere on the line (ReplyCards); the colour and
          // any strike take the words' own.
          <ReplyCardTitle
            text={words}
            onClick={() => showTodoRow(task.id, mainChatId)}
            className={wordsInk}
          />
        ) : (
          <span
            className={cn("min-w-0 truncate leading-5", wordsInk)}
            onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, words)}
          >
            {words}
          </span>
        )}
        {/* The time and the state let a click through to the words. */}
        <span
          className={cn(
            "pointer-events-none ml-2 shrink-0 tabular-nums text-ink-muted",
            struck && "line-through",
          )}
        >
          {time}
        </span>
        <span
          className={cn(
            "pointer-events-none ml-2 shrink-0 text-ink-muted",
            canCancel && "mr-2",
          )}
        >
          {reminderStateLabel(task, copy)}
        </span>
        {canCancel && (
          // At the line's end, 20px: as tall with it as without.
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-5 shrink-0 px-1.5 py-0 text-[length:var(--conversation-step-size)]"
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
          className="pb-2 pl-[30px] pr-3 text-[12px] leading-[1.45] text-error"
        >
          {error}
        </div>
      )}
    </div>
  );
}
