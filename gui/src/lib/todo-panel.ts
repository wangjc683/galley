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
import type { TodoGlance } from "@/lib/todo-open";
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
 * you go there. In a narrow main area (`narrow`, under 760px) none:
 * nothing there reads or writes what is remembered (main chat ticket 87,
 * PRD ruling 131 point 2) — the look it replaces just folds.
 */
export function readingPanelClosesTodo(
  kind: "preview" | "review",
  shown: TodoPlace | null,
  narrow: boolean,
): readonly TodoPlace[] {
  if (narrow) return [];
  if (kind === "review") return TODO_PLACES;
  return shown ? [shown] : [];
}

/**
 * Which places a narrow main area widening closes (main chat ticket 87):
 * a preview or review opened while narrow wrote nothing
 * (`readingPanelClosesTodo`), so a place remembered open there would
 * come back beside the conversation with the reading panel already in
 * its place — the button selected, no panel drawn. The reading panel is
 * the later of the two and keeps it: the places it replaces are
 * remembered closed then, as if it had opened wide. `here` is the
 * conversation's place, shown or not; `reading` what is open now.
 */
export function readingPanelClosesTodoOnWiden(
  reading: "preview" | "review" | null,
  here: TodoPlace | null,
  wasNarrow: boolean,
  narrow: boolean,
): readonly TodoPlace[] {
  if (!reading || !wasNarrow || narrow) return [];
  return readingPanelClosesTodo(reading, here, false);
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

/** Whether a look at the panel has just been opened, or sent ahead to
 * another conversation by a jump out of it (main chat ticket 87): it
 * takes the reading panel's place as an opening does. */
export function todoGlanceOpened(
  next: TodoGlance | null,
  previous: TodoGlance | null,
): boolean {
  return next !== null && next.at !== previous?.at;
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
 * day too on another (「🔔 周二 20:00」). Today's says so (「今天 18:00」,
 * 「今天」): the panel's own to-dos run as one part with no group label
 * over them (main chat ticket 86, ruling 130), as the cards have none,
 * so the day word is never left to a heading. A reminder that has gone
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
): TodoMetaPart[] {
  const parts: TodoMetaPart[] = [];
  const due = item.due;
  if (due) {
    const overdue = checked ? null : todoOverdueDays(item, todayStartMs);
    const when = dueWhen(due, todayStartMs, language, copy);
    if (overdue !== null && overdue >= 1) {
      parts.push({ text: copy.todo.overdueDays(overdue), tone: "warning" });
    } else if (overdue === 0) {
      parts.push({ text: copy.todo.overdueAt(when), tone: "warning" });
    } else {
      parts.push({ text: when, tone: "muted" });
    }
  }
  const reminder = item.reminder;
  if (!reminder || checked || reminder.state === "fired") return parts;
  const full = scheduleTime(reminder.at, todayStartMs, language, copy);
  const at = Date.parse(reminder.at);
  const day = Number.isNaN(at) ? null : localDayStart(at);
  const dueDay = due ? localDayMs(due.date) : null;
  const sameDay = day !== null && day === dueDay;
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

/**
 * Whether a row of 「Galley 在办」 is one of its own reminders that can
 * still be cancelled from the panel (main chat ticket 80, PRD ruling 128
 * point 7): a one-off task still to go off, or paused — the same as a
 * reminder card's 「取消」 (`cancelScheduledTask`). Not a subtask, not a
 * routine.
 */
export function assistantTaskCancellable(item: TodoItem): boolean {
  return (
    item.kind === "task" &&
    (item.repeat?.kind ?? "once") === "once" &&
    (item.state === "scheduled" || item.state === "paused")
  );
}

/**
 * The notes line under one of the user's to-dos not done (main chat
 * ticket 80, PRD ruling 128 point 5): what Galley noted with it to have
 * at hand (a name, a place, a number, a path). `text` is the line, its
 * breaks and runs of space one space; `full` the notes as written, for
 * the hover when the line is cut. Null when there are none or only
 * blanks, and for a done one (已完成 draws none).
 */
export function todoNotesLine(
  item: TodoItem,
): { text: string; full: string } | null {
  if (item.kind !== "todo" || item.state === "done") return null;
  const full = item.notes?.trim();
  if (!full) return null;
  return { text: full.replace(/\s+/g, " "), full };
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

/**
 * What a row is called (its title, and what 「说说这件」 quotes): the
 * words it carries, 「子任务」 for a subtask without a title, and for the
 * daily review a name of its own (main chat ticket 74) — its `prompt` is
 * English for the model, never shown. The name carries no time: the
 * rule and the next time are the second line's, as every routine's
 * (`routineRowLine`), so the time is said once and follows the task's
 * own `timeOfDay` when the user has it moved.
 */
export function todoRowText(item: TodoItem, copy: AppCopy): string {
  if (isDailyReview(item)) return copy.todo.dailyReview;
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

/** The second line of a done item: when (a to-do's tick, a one-off's
 * fire, a subtask's finish), and for what was not a to-do its state. */
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

/**
 * Nothing in any group but the daily review: the panel's empty state.
 * Core seeds the review with the main chat (ticket 73), so counting it
 * kept the empty state from ever showing (main chat ticket 80, PRD
 * ruling 128 point 3); paused, it is still the review. The panel draws
 * 例行 under the empty state then, the review's row as it always looks
 * (assistant PRD ruling 10: in sight, and it can be let go). Cancelled,
 * 例行 is empty and so is everything.
 */
export function todoPanelEmpty(todo: AssistantTodo): boolean {
  return (
    todo.yours.today.length === 0 &&
    todo.yours.later.length === 0 &&
    todo.yours.anytime.length === 0 &&
    todo.assistant.length === 0 &&
    todo.routine.every(isDailyReview) &&
    todo.done.length === 0
  );
}

/** Whether the panel lists a to-do (any group): a card's title is a
 * button then (main chat ticket 87, PRD ruling 131 point 3). Not one
 * cancelled, nor one done more than seven days ago or past 已完成's cap:
 * a title with nowhere to lead is not a button, as in the panel. */
export function todoListed(todo: AssistantTodo, id: string): boolean {
  return [
    todo.yours.today,
    todo.yours.later,
    todo.yours.anytime,
    todo.assistant,
    todo.routine,
    todo.done,
  ].some((group) => group.some((item) => item.id === id));
}

/** Whether lighting up `ids` needs 已完成 unfolded: one of them is only
 * there (ticket 87: a card's title on a done to-do). */
export function todoRowsInDone(
  todo: AssistantTodo,
  ids: readonly string[],
): boolean {
  return ids.some(
    (id) =>
      todo.done.some((item) => item.id === id) &&
      !yourTodos(todo).some((item) => item.id === id),
  );
}

/** The user's to-dos not done, one part in the panel's order (ticket
 * 86): Core's three lists end to end. */
export function yourTodos(todo: AssistantTodo): TodoItem[] {
  return [...todo.yours.today, ...todo.yours.later, ...todo.yours.anytime];
}

/**
 * One of the user's to-dos Galley ticked off while the panel was on
 * screen (main chat ticket 87, PRD ruling 131 point 5): held where it
 * stood, as a tick of the user's own holds (`TODO_SETTLE_MS`), before it
 * goes to 已完成. `item` is the row as it stood; `following` the rows
 * that came after it then, to find its place among the fresh list's.
 */
export interface TodoHold {
  item: TodoItem;
  following: readonly string[];
}

/** What a fresh list changes in the panel (`todoPanelChanges`). */
export interface TodoPanelChange {
  /** The rows to light up, in the panel's order. */
  flash: string[];
  /** To-dos Galley ticked off for the user, held in place a moment. */
  held: TodoHold[];
}

/** Ids with a write of this window's on its way — a tick or untick
 * (`flips`), a reminder being cancelled (`cancelling`) — in either of
 * two reads of the store: the read a write ends with clears its record
 * in the same set. */
export function todoWritesOnTheirWay(
  ...states: readonly {
    flips: Readonly<Record<string, unknown>>;
    cancelling: Readonly<Record<string, unknown>>;
  }[]
): Set<string> {
  const ids = new Set<string>();
  for (const state of states) {
    for (const id of Object.keys(state.flips)) ids.add(id);
    for (const id of Object.keys(state.cancelling)) ids.add(id);
  }
  return ids;
}

function sameDue(a: TodoItem["due"], b: TodoItem["due"]): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.date === b.date &&
    a.hasTime === b.hasTime &&
    (a.at ?? "") === (b.at ?? "")
  );
}

/** A reminder's time, or paused: not its going off (the clock). */
function sameReminder(
  a: TodoItem["reminder"],
  b: TodoItem["reminder"],
): boolean {
  if (!a || !b) return !a && !b;
  return a.at === b.at && (a.state === "paused") === (b.state === "paused");
}

function sameRepeat(a: TodoItem["repeat"], b: TodoItem["repeat"]): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** One of the user's to-dos Galley changed: its words, when it is due,
 * its reminder (time or paused), its notes. */
function yourTodoChanged(before: TodoItem, after: TodoItem): boolean {
  return (
    before.text !== after.text ||
    !sameDue(before.due, after.due) ||
    !sameReminder(before.reminder, after.reminder) ||
    (before.notes ?? "") !== (after.notes ?? "")
  );
}

/** A row of 「Galley 在办」 changed: only one of its own one-off
 * reminders, in its words or its time. A subtask's state, title and
 * latest activity move with its work, not with Galley's changing the
 * list. */
function assistantRowChanged(before: TodoItem, after: TodoItem): boolean {
  if (after.kind !== "task" || (after.repeat?.kind ?? "once") !== "once") {
    return false;
  }
  return before.text !== after.text || (before.at ?? "") !== (after.at ?? "");
}

/** A routine changed: its words, its rule, its time of day, paused or
 * not. Not its next time, which moves on each time it goes off. */
function routineChanged(before: TodoItem, after: TodoItem): boolean {
  return (
    before.text !== after.text ||
    !sameRepeat(before.repeat, after.repeat) ||
    (before.timeOfDay ?? "") !== (after.timeOfDay ?? "") ||
    (before.state === "paused") !== (after.state === "paused")
  );
}

function byId(items: readonly TodoItem[]): Map<string, TodoItem> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * What a fresh list (`next`) lights up in the panel on screen, against
 * the one it showed (`previous`) — main chat ticket 87, PRD ruling 131
 * point 5: what Galley moved, so you see it move. Compared field by
 * field (the panel's rows carry no `updatedAt`); `mine` are this
 * window's own writes on their way (`todoWritesOnTheirWay`), never lit.
 *
 * Lit: a row new to the user's to-dos, 「Galley 在办」 (a subtask too) or
 * 例行; one of the user's to-dos with new words, due time, reminder
 * (time or paused) or notes; one of Galley's own one-off reminders with
 * new words or time; a routine with new words, rule, time of day, or
 * paused or resumed; and one of the user's to-dos Galley ticked off —
 * held where it stood a moment (`held`), lit there, then in 已完成.
 *
 * Not lit: a subtask after it appears (its state, title, activity); a
 * routine's next time moving on as it goes off; a one-off reminder going
 * off into 已完成; anything else new in 已完成; a row that leaves (a
 * cancelled one just goes: the panel draws nothing cancelled).
 */
export function todoPanelChanges(
  previous: AssistantTodo,
  next: AssistantTodo,
  mine: ReadonlySet<string>,
): TodoPanelChange {
  const flash = new Set<string>();
  const compare = (
    before: readonly TodoItem[],
    after: readonly TodoItem[],
    changed: (before: TodoItem, after: TodoItem) => boolean,
  ) => {
    const was = byId(before);
    for (const item of after) {
      if (mine.has(item.id)) continue;
      const old = was.get(item.id);
      if (!old || changed(old, item)) flash.add(item.id);
    }
  };
  const yoursBefore = yourTodos(previous);
  const yoursAfter = yourTodos(next);
  compare(yoursBefore, yoursAfter, yourTodoChanged);
  compare(previous.assistant, next.assistant, assistantRowChanged);
  compare(previous.routine, next.routine, routineChanged);

  const stillYours = new Set(yoursAfter.map((item) => item.id));
  const doneNow = byId(next.done);
  const held: TodoHold[] = [];
  yoursBefore.forEach((item, index) => {
    if (mine.has(item.id) || stillYours.has(item.id)) return;
    if (doneNow.get(item.id)?.kind !== "todo") return;
    held.push({
      item,
      following: yoursBefore.slice(index + 1).map((row) => row.id),
    });
    flash.add(item.id);
  });

  const order = [
    ...todoPanelRows(next, held).yours,
    ...next.assistant,
    ...next.routine,
  ];
  return {
    flash: order.filter((item) => flash.has(item.id)).map((item) => item.id),
    held,
  };
}

/**
 * The user's to-dos and 已完成 as the panel draws them while Galley's
 * ticks hold (`TodoHold`): each held one back where it stood — before
 * the first row that followed it then and is still there, else last —
 * and not yet in 已完成 (`holding` names them). A held one the fresh list
 * has among the user's to-dos again (unticked since) is not drawn twice.
 */
export function todoPanelRows(
  todo: AssistantTodo,
  held: readonly TodoHold[],
): { yours: TodoItem[]; done: TodoItem[]; holding: ReadonlySet<string> } {
  const yours = yourTodos(todo);
  const listed = new Set(yours.map((item) => item.id));
  const holding = held.filter((hold) => !listed.has(hold.item.id));
  for (const hold of holding) {
    let at = yours.length;
    for (const id of hold.following) {
      const index = yours.findIndex((item) => item.id === id);
      if (index >= 0) {
        at = index;
        break;
      }
    }
    yours.splice(at, 0, hold.item);
  }
  const away = new Set(holding.map((hold) => hold.item.id));
  return {
    yours,
    done: away.size
      ? todo.done.filter((item) => !away.has(item.id))
      : todo.done,
    holding: away,
  };
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
