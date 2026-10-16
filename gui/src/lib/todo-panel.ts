import type { AppCopy } from "@/i18n/types";
import {
  replyMessageId,
  scheduleTime,
  todoRowTarget,
  todoStateLabel,
  type AssistantTodo,
  type TodoDue,
  type TodoItem,
  type TodoTarget,
} from "@/lib/assistant-todo";
import type { ResolvedLanguage } from "@/lib/language";
import {
  calendarDaysBefore,
  formatScheduleDay,
  localDayMs,
} from "@/lib/message-time";
import { repeatSummary } from "@/lib/scheduled-tasks";

/**
 * The to-do panel beside the main chat and the to-do cards under the
 * replies that noted them (main chat ticket 42, PRD ruling 91): what a
 * row says, where its title leads, which cards hang under which reply,
 * when the list must be read again. Pure; the store
 * (stores/assistant-todo.ts) holds the list and the ticks on their way.
 */

/**
 * How long a ticked (or unticked) to-do holds its place, struck through
 * and faded, before it moves to 已完成 (or back): 1.5 s, and a second
 * click in it takes the tick back without a word to Core.
 *
 * Not a motion token: the tokens (globals.css, foundations §2.7) time
 * movement, the longest 240ms; this is a hold, as the undo toast's 5 s
 * is (lib/toast-timing.ts). Long enough to see the strike land and to
 * click again on a misclick (a reaction and a re-aim, about 0.75 s, with
 * the same again in hand), short enough that the list never feels stuck
 * — the hold of Apple Reminders and Things before a done item leaves.
 * The strike and the fade themselves take `--motion-base`, and none
 * under reduced motion; the hold stays, as it is not motion.
 */
export const TODO_SETTLE_MS = 1500;

/** A tick or an untick on its way: `settling` while the row holds its
 * place (a click takes it back), `saving` while Core writes it. */
export interface TodoFlip {
  done: boolean;
  phase: "settling" | "saving";
}

/** Whether a to-do's box shows checked: its tick on the way, else what
 * Core says. */
export function todoChecked(item: TodoItem, flip?: TodoFlip): boolean {
  return flip ? flip.done : item.state === "done";
}

/** A row's second line, in parts: the due date (warning when overdue)
 * and the reminder. */
export interface TodoMetaPart {
  text: string;
  tone: "muted" | "warning";
}

function dueWhen(
  due: TodoDue,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
): string {
  if (due.hasTime && due.at) {
    return scheduleTime(due.at, todayStartMs, language, copy);
  }
  return (
    formatScheduleDay(due.date, todayStartMs, language, {
      today: copy.todo.dayToday,
      tomorrow: copy.todo.dayTomorrow,
      yesterday: copy.todo.dayYesterday,
    }) ?? due.date
  );
}

/**
 * How many days a to-do not done is overdue: 0 for one due earlier
 * today at a time that has passed, null when it is not overdue. Core
 * marks it when it reads the list (`overdue`); a day that has turned
 * since counts too, so a list read last night is right after midnight
 * before it is read again.
 */
export function todoOverdueDays(
  item: TodoItem,
  todayStartMs: number,
): number | null {
  if (item.kind !== "todo" || item.state === "done" || !item.due) return null;
  const days = calendarDaysBefore(item.due.date, todayStartMs);
  if (days !== null && days >= 1) return days;
  return item.overdue ? 0 : null;
}

/**
 * The second line of one of the user's to-dos: when it is due (「截止
 * 周三 15:00」, 「截止 周五」; 「逾期 2 天」 in warning once past), then
 * its reminder (「提醒 周三 14:00」, 「已提醒 …」). A checked one shows
 * its due date quietly and no reminder: a tick cancels a reminder that
 * has not gone off (Core), and a tick still settling hides it as the
 * tick will.
 */
export function todoMetaParts(
  item: TodoItem,
  checked: boolean,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
): TodoMetaPart[] {
  const parts: TodoMetaPart[] = [];
  if (item.due) {
    const overdue = checked ? null : todoOverdueDays(item, todayStartMs);
    const when = dueWhen(item.due, todayStartMs, language, copy);
    if (overdue === null) {
      parts.push({ text: copy.todo.due(when), tone: "muted" });
    } else if (overdue >= 1) {
      parts.push({ text: copy.todo.overdueDays(overdue), tone: "warning" });
    } else {
      parts.push({ text: copy.todo.overdueAt(when), tone: "warning" });
    }
  }
  const reminder = item.reminder;
  if (reminder && !checked) {
    const when = scheduleTime(reminder.at, todayStartMs, language, copy);
    parts.push({
      text:
        reminder.state === "fired"
          ? copy.todo.reminded(when)
          : reminder.state === "paused"
            ? copy.todo.reminderPaused(when)
            : copy.todo.reminderAt(when),
      tone: "muted",
    });
  }
  return parts;
}

/** Whether a to-do's reminder can still be cancelled: it has not gone
 * off. */
export function todoReminderCancellable(item: TodoItem): boolean {
  const state = item.reminder?.state;
  return item.state !== "done" && (state === "scheduled" || state === "paused");
}

/** A line's tone: a session row subline's — the question in warning, a
 * failure in error, work in progress in brand, the rest muted. */
export type TodoLineTone = "muted" | "warning" | "error" | "brand";

/**
 * The second line of what Galley is on: a subtask's state (正在工作 /
 * 等你回复 / 出错 / 停在步数上限 / 没有跑完), a one-off task's time and
 * state (「明天 09:00 · 待提醒」).
 */
export function assistantRowLine(
  item: TodoItem,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
): { text: string; tone: TodoLineTone } {
  const state = todoStateLabel(item, copy);
  const tone: TodoLineTone =
    item.state === "asking"
      ? "warning"
      : item.state === "failed"
        ? "error"
        : item.state === "running"
          ? "brand"
          : "muted";
  if (item.kind === "subtask" || !item.at) return { text: state, tone };
  const when = scheduleTime(item.at, todayStartMs, language, copy);
  return { text: `${when} · ${state}`, tone };
}

/** The second line of a routine: its rule and next time (「每天 08:00 ·
 * 下次 明天 08:00」), or 「已暂停」. */
export function routineRowLine(
  item: TodoItem,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
): string {
  const rule = item.repeat
    ? repeatSummary(copy, item.repeat, item.timeOfDay ?? "")
    : "";
  const tail =
    item.state === "paused"
      ? copy.todo.statePaused
      : item.at
        ? copy.todo.nextAt(scheduleTime(item.at, todayStartMs, language, copy))
        : "";
  return [rule, tail].filter(Boolean).join(" · ");
}

/** The second line of a done item: when (a to-do's tick, a fire, a
 * subtask's finish), and for what was not a to-do its state. */
export function doneRowLine(
  item: TodoItem,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
): string {
  const when = item.at
    ? scheduleTime(item.at, todayStartMs, language, copy)
    : "";
  if (item.kind === "todo") return when;
  return [when, todoStateLabel(item, copy)].filter(Boolean).join(" · ");
}

/**
 * Where a row's title leads from the panel: the reply in this main chat
 * that noted it (the 查找聊天记录 jump), a subtask, a scheduled run's
 * session; null when it has nowhere (made outside a reply, by another
 * agent, or in a main chat since reset).
 */
export function todoTitleTarget(
  item: TodoItem,
  mainChatId: string | undefined,
): TodoTarget | null {
  const target = todoRowTarget(item);
  if (target?.kind === "reply" && target.sessionId !== mainChatId) return null;
  return target;
}

/** Nothing in any group: the panel's empty state. */
export function todoPanelEmpty(todo: AssistantTodo): boolean {
  return (
    todo.yours.today.length === 0 &&
    todo.yours.later.length === 0 &&
    todo.yours.anytime.length === 0 &&
    todo.assistant.length === 0 &&
    todo.routine.length === 0 &&
    todo.done.length === 0
  );
}

/** Every to-do the list holds: the user's not done, then the done ones. */
export function allTodos(todo: AssistantTodo): TodoItem[] {
  return [
    ...todo.yours.today,
    ...todo.yours.later,
    ...todo.yours.anytime,
    ...todo.done.filter((item) => item.kind === "todo"),
  ];
}

function dueOrder(item: TodoItem): number {
  const due = item.due;
  if (!due) return Infinity;
  if (due.hasTime && due.at) {
    const ms = Date.parse(due.at);
    if (!Number.isNaN(ms)) return ms;
  }
  // A day without a time counts to that day's end, as Core orders it.
  const day = localDayMs(due.date);
  return day === null ? Infinity : day + 86_400_000 - 1;
}

/**
 * The to-dos Galley noted in `mainChatId`'s replies, by the reply they
 * hang under (`AgentTurn.messageId`), soonest due first, no due date
 * last. The list carries no time a to-do was noted, so a reply's cards
 * go by due date; a reply notes one or two.
 *
 * From the list, so a card shows what the list holds: a to-do not done,
 * or done within the last seven days. One done longer ago, or cancelled
 * by Galley, is not in it, and its card goes (Core has no read of every
 * to-do for the desktop yet; `TodoListScope::All` serves the CLI). One
 * whose reply has not settled (`turnIndex` absent) has no card until it
 * does.
 */
export function todosByMessage(
  todo: AssistantTodo,
  mainChatId: string | undefined,
): Map<string, TodoItem[]> {
  const byMessage = new Map<string, TodoItem[]>();
  if (!mainChatId) return byMessage;
  const noted = allTodos(todo)
    .filter(
      (item) =>
        item.createdIn?.sessionId === mainChatId &&
        item.createdIn.turnIndex != null,
    )
    .sort((a, b) => dueOrder(a) - dueOrder(b) || a.id.localeCompare(b.id));
  for (const item of noted) {
    const key = replyMessageId(mainChatId, item.createdIn!.turnIndex!);
    const group = byMessage.get(key);
    if (group) group.push(item);
    else byMessage.set(key, [item]);
  }
  return byMessage;
}

/**
 * When the list must be read again though nothing changed in Core: the
 * soonest time a to-do not done falls due (it turns overdue then; Core
 * sends no event for the clock). Midnight is `useDayStamp`'s. Null when
 * none is ahead of `nowMs`.
 */
export function nextTodoRefreshMs(
  todo: AssistantTodo,
  nowMs: number,
): number | null {
  let next: number | null = null;
  for (const item of [...todo.yours.today, ...todo.yours.later]) {
    const at = item.due?.hasTime ? item.due.at : undefined;
    if (!at) continue;
    const ms = Date.parse(at);
    if (Number.isNaN(ms) || ms <= nowMs) continue;
    if (next === null || ms < next) next = ms;
  }
  return next;
}
