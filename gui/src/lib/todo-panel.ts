import type { AppCopy } from "@/i18n/types";
import {
  isDailyReview,
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
  formatClock,
  formatScheduleDay,
  localDayMs,
  localDayStart,
} from "@/lib/message-time";
import { repeatSummary } from "@/lib/scheduled-tasks";
import { TODO_PLACES, type TodoPlace } from "@/lib/todo-panel-memory";

/**
 * The to-do panel beside a conversation and the to-do cards under the
 * replies that noted them (main chat ticket 42, PRD ruling 91): what a
 * row says, where its title leads, which cards hang under which reply,
 * when the list must be read again. Pure; the store
 * (stores/assistant-todo.ts) holds the list and the ticks on their way.
 */

/**
 * The panel's first width, px, and its id in the reading panel's group
 * (LocalFileWorkspace's `aside`): a dragged split is remembered under
 * the id, apart from the file preview's. 320 is B1 of ticket 42's
 * comparison, JC's pick (ruling 93, ticket 45); 380 was the other.
 */
export const TODO_PANEL_WIDTH = 320;
export const TODO_PANEL_ID = "todo-panel";

/**
 * Which of the to-do panel's places a panel opening in the reading
 * panel's place closes — closed, and remembered so (ticket 45: closed
 * when a file preview replaces it; ticket 46: per place). `shown` is the
 * place whose panel is on screen, null when none is. The Git review is
 * the window's: it stays open across conversations and would stand in
 * the to-do panel's place in both, so it closes both wherever it opens.
 * A file preview is its conversation's and goes when you leave it, so
 * it closes only the place it replaces on screen; with no panel on
 * screen it closes none, and the other place's panel comes back when
 * you go there.
 */
export function readingPanelClosesTodo(
  kind: "preview" | "review",
  shown: TodoPlace | null,
): readonly TodoPlace[] {
  if (kind === "review") return TODO_PLACES;
  return shown ? [shown] : [];
}

/** Whether a place's panel has just been opened (`next` against
 * `previous`): it takes the reading panel's place, which closes the
 * file preview or the review there (LocalFileWorkspace). */
export function todoPanelOpened(
  next: Readonly<Record<TodoPlace, boolean>>,
  previous: Readonly<Record<TodoPlace, boolean>>,
): boolean {
  return TODO_PLACES.some((place) => next[place] && !previous[place]);
}

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

/** Whether a to-do was cancelled (main chat ticket 43): only the cards
 * under the replies hold one, from `listNotedTodos`. */
export function todoCancelled(item: TodoItem): boolean {
  return item.kind === "todo" && Boolean(item.cancelledAt);
}

/** Whether a to-do's box shows checked: its tick on the way, else what
 * Core says. A cancelled one is never checked, whatever it stood at. */
export function todoChecked(item: TodoItem, flip?: TodoFlip): boolean {
  if (todoCancelled(item)) return false;
  return flip ? flip.done : item.state === "done";
}

/** A row's second line, in parts: when it is due (warning when
 * overdue) and the reminder. */
export interface TodoMetaPart {
  text: string;
  tone: "muted" | "warning";
  /** The reminder: drawn as a bell before its text, set apart by a gap,
   * not 「·」 (main chat PRD ruling 97). */
  bell?: boolean;
  /** What the part says in full (「提醒 周三 14:00」), its accessible
   * name and hover text. */
  title?: string;
}

/** When a to-do is due, without a word before it: 「周三 15:00」, 「明天」. */
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
 * The second line of one of the user's to-dos (main chat PRD ruling 97,
 * after Apple's Reminders: one time, the reminder a bell): when it is
 * due, with no word before it (「周三 15:00」, 「明天」; 「逾期 2 天」 in
 * warning once past), then the reminder, a bell and its time — the clock
 * alone on the due day (「周三 15:00 🔔 14:00」, 「明天 🔔 10:00」), the
 * day too on another (「🔔 周二 20:00」). `inToday`: the row sits under
 * 今天, so the day word goes (「18:00」; a day without a time leaves
 * nothing, and today's reminder is its clock). A reminder that has gone
 * off is not written; a paused one says so. The day it was noted is not
 * on the line: its title leads back to the sentence, and the card hangs
 * under that reply. A checked one shows its due date quietly and no
 * reminder: a tick cancels a reminder that has not gone off (Core), and
 * a tick still settling hides it as the tick will.
 */
export function todoMetaParts(
  item: TodoItem,
  checked: boolean,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
  { inToday = false }: { inToday?: boolean } = {},
): TodoMetaPart[] {
  const parts: TodoMetaPart[] = [];
  const due = item.due;
  if (due) {
    const overdue = checked ? null : todoOverdueDays(item, todayStartMs);
    const clock = due.hasTime && due.at ? formatClock(due.at, language) : null;
    const when = dueWhen(due, todayStartMs, language, copy);
    if (overdue !== null && overdue >= 1) {
      parts.push({ text: copy.todo.overdueDays(overdue), tone: "warning" });
    } else if (overdue === 0) {
      parts.push({
        text: copy.todo.overdueAt(inToday && clock ? clock : when),
        tone: "warning",
      });
    } else if (!inToday) {
      parts.push({ text: when, tone: "muted" });
    } else if (clock) {
      parts.push({ text: clock, tone: "muted" });
    }
  }
  const reminder = item.reminder;
  if (!reminder || checked || reminder.state === "fired") return parts;
  const full = scheduleTime(reminder.at, todayStartMs, language, copy);
  const at = Date.parse(reminder.at);
  const day = Number.isNaN(at) ? null : localDayStart(at);
  const dueDay = due ? localDayMs(due.date) : null;
  const sameDay =
    day !== null &&
    (day === dueDay || (inToday && day === localDayStart(todayStartMs)));
  const short = (sameDay ? formatClock(reminder.at, language) : null) ?? full;
  const paused = reminder.state === "paused";
  parts.push({
    text: paused ? `${short} · ${copy.todo.statePaused}` : short,
    tone: "muted",
    bell: true,
    title: paused ? copy.todo.reminderPaused(full) : copy.todo.reminderAt(full),
  });
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

/** The daily review's time when its row has none: the seed's (ticket
 * 73). */
const DAILY_REVIEW_SEED_TIME = "09:00";

/**
 * What a row is called (its title, and what 「说说这件」 quotes): the
 * words it carries, 「子任务」 for a subtask without a title, and for the
 * daily review a name of its own (main chat ticket 74) — its `prompt` is
 * English for the model, never shown. The name's time is the task's
 * own `timeOfDay` without the hour's leading zero (「每天 9:00 过一遍在办的
 * 事」), so it follows when the user has it moved; the rule and the next
 * time stay on the second line, as every routine's (`routineRowLine`).
 */
export function todoRowText(item: TodoItem, copy: AppCopy): string {
  if (isDailyReview(item)) {
    const time = item.timeOfDay || DAILY_REVIEW_SEED_TIME;
    return copy.todo.dailyReview(time.replace(/^0(\d):/, "$1:"));
  }
  return item.text || (item.kind === "subtask" ? copy.subtask.label : "");
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
 * Where a row's title leads from the panel: the reply in the main chat
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

/**
 * The to-dos Galley noted in `mainChatId`'s replies, by the reply they
 * hang under (`AgentTurn.messageId`), each reply's in the order they
 * were noted (Core's order: `createdAt`, then id), as the reminder cards
 * go (`remindersByMessage`).
 *
 * From every to-do noted in the main chat (`listNotedTodos`, main chat
 * ticket 43), not the list: a card stays under its reply done however
 * long ago, or cancelled (it says so), where 已完成 lets a to-do go after
 * seven days. One whose reply has not settled (`turnIndex` absent) has
 * no card until it does.
 */
export function todosByMessage(
  items: readonly TodoItem[],
  mainChatId: string | undefined,
): Map<string, TodoItem[]> {
  const byMessage = new Map<string, TodoItem[]>();
  if (!mainChatId) return byMessage;
  const noted = items
    .filter(
      (item) =>
        item.kind === "todo" &&
        item.createdIn?.sessionId === mainChatId &&
        item.createdIn.turnIndex != null,
    )
    .sort(
      (a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
        a.id.localeCompare(b.id),
    );
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
