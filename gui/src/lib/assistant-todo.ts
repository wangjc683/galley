import { invoke } from "@tauri-apps/api/core";

import type { AppCopy } from "@/i18n/types";
import type { ResolvedLanguage } from "@/lib/language";
import { formatScheduleTime } from "@/lib/message-time";
import {
  deleteScheduledTask,
  repeatSummary,
  SCHEDULED_TASKS_CHANGED_EVENT,
  type ScheduledTask,
  type ScheduledTaskRepeat,
  type ScheduledTaskTarget,
} from "@/lib/scheduled-tasks";
import { SESSION_RUN_STATE_EVENT } from "@/lib/session-run-state";
import { SUBTASK_DISPATCHED_EVENT } from "@/lib/subtasks";

/**
 * The assistant's to-do list and its reminder cards (main chat tickets
 * 37, 39 and 42; main chat PRD rulings 84, 86 and 91, assistant PRD
 * ruling 9).
 *
 * On the managed runtime there is no 「定时任务」 feature for the user:
 * scheduled tasks are the assistant's hands. It sets a reminder when it
 * hears something with a time in it, says so, and a card drawn from the
 * database hangs under that reply (`remindersByMessage`). It notes the
 * user's own to-dos the same way (ticket 39), each with a card of its
 * own under the reply (ticket 42, lib/todo-panel.ts) that stays there
 * done or cancelled (ticket 43, `list_noted_todos`). The top bar's
 * 「待办」 (ticket 45; every conversation's since ticket 46) opens the
 * to-do panel beside the conversation: the user's to-dos, what Galley
 * is on, its routines, what was done lately — one Core read
 * (`list_assistant_todo`, core/src/assistant_todo.rs), the same one
 * Core writes the main chat's 「在办的事」 from (ticket 36), so what the
 * user sees is what the assistant sees.
 *
 * Everything here is pure but the Core calls: the wire shapes, the
 * card's state, the words and times a row shows, where a row leads.
 */

/** Mirror of Core `TodoKind`. */
export type TodoKind = "todo" | "task" | "subtask";

/** Mirror of Core `TodoState`. */
export type TodoState =
  | "open"
  | "scheduled"
  | "paused"
  | "fired"
  | "running"
  | "asking"
  | "failed"
  | "step_limit"
  | "stopped"
  | "done";

/** Mirror of Core `TodoCreator`: the assistant (its own and the ones the
 * user asked it for are one, ruling 86 point 4), the user's form,
 * another agent. */
export type TodoCreator = "assistant" | "user" | "agent";

/** Mirror of Core `TodoDue` (core/src/api/todo.rs): a day, or a day and
 * a time. */
export interface TodoDue {
  /** The local day, `YYYY-MM-DD` (read in Core's zone). */
  date: string;
  hasTime: boolean;
  /** UTC ISO, when it has a time. */
  at?: string;
  /** Local "HH:MM", when it has a time. */
  time?: string;
}

/** Mirror of Core `TodoReminderState`. */
export type TodoReminderState = "scheduled" | "paused" | "fired";

/** Mirror of Core `TodoReminder`: the scheduled task a to-do's reminder
 * is. */
export interface TodoReminder {
  taskId: string;
  /** UTC ISO. */
  at: string;
  state: TodoReminderState;
}

/** Mirror of Core `TodoItem`. */
export interface TodoItem {
  kind: TodoKind;
  /** To-do or task id, or the subtask's session id. */
  id: string;
  /** The to-do's title, the task's words or the subtask's title, uncut. */
  text: string;
  state: TodoState;
  /** UTC ISO: a task's next fire, a subtask's latest activity, a fire, a
   * finish or a tick (done). Absent for a paused repeating task and for
   * an open to-do (its `due` says when). */
  at?: string;
  createdBy: TodoCreator;
  /** The other agent's supervisor label. */
  agent?: string;
  target?: ScheduledTaskTarget;
  repeat?: ScheduledTaskRepeat;
  /** Local "HH:MM". */
  timeOfDay?: string;
  /** The main chat turn the assistant made the task in. */
  createdIn?: { sessionId: string; turnIndex?: number };
  /** Done session tasks: the session that run made. */
  runSessionId?: string;
  /** To-dos: the notes. */
  notes?: string;
  /** To-dos: when it is due. */
  due?: TodoDue;
  /** To-dos not done: past due (absent when not). */
  overdue?: boolean;
  /** To-dos: the reminder on it. */
  reminder?: TodoReminder;
  /** To-dos ticked off: who ticked it (the user at the desktop is
   * `user`). */
  doneBy?: TodoCreator;
  /** To-dos: when it was noted, UTC ISO (ticket 43: the panel's
   * 「10月16日 记下」). */
  createdAt?: string;
  /** To-dos cancelled: when, UTC ISO; `state` says how it stood. Only
   * `listNotedTodos` returns one (its card says 已取消). */
  cancelledAt?: string;
}

/** Mirror of Core `YourTodos`: the user's to-dos not done. */
export interface YourTodos {
  /** Due today or before, overdue ones first. */
  today: TodoItem[];
  /** Due after today. */
  later: TodoItem[];
  /** No due date. */
  anytime: TodoItem[];
}

/** Mirror of Core `AssistantTodo` (ticket 39's four groups). */
export interface AssistantTodo {
  /** 你的事. */
  yours: YourTodos;
  /** Galley 在办: subtasks not finished, then its one-off tasks. */
  assistant: TodoItem[];
  /** 例行: repeating tasks. */
  routine: TodoItem[];
  /** 已完成: the last seven days. */
  done: TodoItem[];
  /** Done within the window past Core's cap: left out. */
  doneOmitted: number;
  /** 「今天 N」: to-dos due today or overdue, not done. */
  todayCount: number;
}

export const EMPTY_TODO: AssistantTodo = {
  yours: { today: [], later: [], anytime: [] },
  assistant: [],
  routine: [],
  done: [],
  doneOmitted: 0,
  todayCount: 0,
};

export async function listAssistantTodo(): Promise<AssistantTodo> {
  return invoke<AssistantTodo>("list_assistant_todo");
}

/**
 * The to-dos Galley noted in the main chat, every one (Core's
 * `list_noted_todos`, main chat ticket 43): not done, done however long
 * ago, cancelled — the cards under the replies that noted them, which
 * stay where 已完成 lets a to-do go after seven days. In the order they
 * were noted, each as `listAssistantTodo` words it, `cancelledAt` on a
 * cancelled one. Empty on the external runtime and before there is a
 * main chat.
 */
export async function listNotedTodos(): Promise<TodoItem[]> {
  return invoke<TodoItem[]>("list_noted_todos");
}

/** Mirror of Core `TodoStatus`. */
export type TodoStatus = "open" | "done" | "cancelled";

/** Mirror of Core `TodoBrief`: the record the to-do commands return. */
export interface TodoBrief {
  id: string;
  title: string;
  notes?: string;
  due?: TodoDue;
  reminder?: TodoReminder;
  status: TodoStatus;
  doneAt?: string;
  doneBy?: { via: string; supervisor?: string; reason?: string };
  origin: { via: string; supervisor?: string; reason?: string };
  createdIn?: { sessionId: string; turnIndex?: number };
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Tick a to-do off (Core's `complete_todo`): its reminder goes with it
 * while it has not reached Galley. Core sends `todos:changed`. */
export async function completeTodo(id: string): Promise<TodoBrief> {
  return invoke<TodoBrief>("complete_todo", { id });
}

/** Untick a to-do (`reopen_todo`); a reminder the tick cancelled stays
 * cancelled. */
export async function reopenTodo(id: string): Promise<TodoBrief> {
  return invoke<TodoBrief>("reopen_todo", { id });
}

/** Cancel a to-do's reminder, the to-do left as it is
 * (`cancel_todo_reminder`). */
export async function cancelTodoReminder(id: string): Promise<TodoBrief> {
  return invoke<TodoBrief>("cancel_todo_reminder", { id });
}

/** Core's event after any to-do change (`TODOS_CHANGED_EVENT`, ticket
 * 39); empty payload, read again. */
export const TODOS_CHANGED_EVENT = "todos:changed";

/**
 * Core events after which the list reads again: a to-do changed
 * (`todos:changed`), a task changed or fired (`scheduled-tasks:changed`),
 * a subtask was dispatched, a run started or ended
 * (`session-run-state`), a subtask was promoted, archived, restored or
 * deleted, a reply was deleted.
 */
export const TODO_REFRESH_EVENTS: readonly string[] = [
  TODOS_CHANGED_EVENT,
  SCHEDULED_TASKS_CHANGED_EVENT,
  SUBTASK_DISPATCHED_EVENT,
  SESSION_RUN_STATE_EVENT,
  "session-updated-external",
  "session-archived-external",
  "session-unarchived-external",
  "session-deleted-external",
  // lib/message-delete.ts MESSAGE_DELETED_EVENT (not imported: it pulls
  // in the messages store).
  "message-deleted",
];

/** The reply a turn's message id names (`AgentTurn.messageId`, the
 * subtask dispatch's `messageId`). */
export function replyMessageId(sessionId: string, turnIndex: number): string {
  return `msg_${sessionId}_${turnIndex}_assistant`;
}

// ---- Times and words ------------------------------------------------------

/** An instant in the reminder card's shapes (「明天 09:00」); the raw
 * value when it does not parse. */
export function scheduleTime(
  iso: string,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
): string {
  return (
    formatScheduleTime(iso, todayStartMs, language, {
      today: copy.todo.timeToday,
      tomorrow: copy.todo.timeTomorrow,
      yesterday: copy.todo.timeYesterday,
    }) ?? iso
  );
}

/** A row's time: a repeating task still to come writes its rule
 * (「每天 08:00」); everything else its instant (「明天 09:00」). */
export function todoTimeLabel(
  item: TodoItem,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
): string {
  const upcoming = item.state === "scheduled" || item.state === "paused";
  if (
    item.kind === "task" &&
    upcoming &&
    item.repeat &&
    item.repeat.kind !== "once"
  ) {
    return repeatSummary(copy, item.repeat, item.timeOfDay ?? "");
  }
  return item.at ? scheduleTime(item.at, todayStartMs, language, copy) : "";
}

/** A row's state, in words. A task that starts a session runs rather
 * than reminds. */
export function todoStateLabel(item: TodoItem, copy: AppCopy): string {
  const session = item.target === "session";
  switch (item.state) {
    // A to-do not done: its box says it (lib/todo-panel.ts words its
    // due date and reminder).
    case "open":
      return "";
    case "scheduled":
      return session
        ? copy.todo.stateScheduledSession
        : copy.todo.stateScheduled;
    case "paused":
      return copy.todo.statePaused;
    case "fired":
      return session ? copy.todo.stateFiredSession : copy.todo.stateFired;
    case "running":
      return copy.todo.stateRunning;
    case "asking":
      return copy.todo.stateAsking;
    case "failed":
      return copy.todo.stateFailed;
    case "step_limit":
      return copy.todo.stateStepLimit;
    case "stopped":
      return copy.todo.stateStopped;
    case "done":
      return copy.todo.stateDone;
  }
}

// ---- Where a row leads -----------------------------------------------------

/** What clicking a row's title does. */
export type TodoTarget =
  /** The reply the assistant made it in: jump there and light it up
   * (the 查找聊天记录 jump, ticket 28). */
  | { kind: "reply"; sessionId: string; messageId: string }
  /** A subtask: open it, as its card's 「打开」 does. */
  | { kind: "subtask"; sessionId: string }
  /** The session a scheduled run made. */
  | { kind: "session"; sessionId: string };

/** Where a row leads; null for a row with nowhere to go (a task another
 * agent or the old form made, or made outside a reply). */
export function todoRowTarget(item: TodoItem): TodoTarget | null {
  if (item.kind === "subtask") return { kind: "subtask", sessionId: item.id };
  const anchor = item.createdIn;
  if (anchor && anchor.turnIndex != null) {
    return {
      kind: "reply",
      sessionId: anchor.sessionId,
      messageId: replyMessageId(anchor.sessionId, anchor.turnIndex),
    };
  }
  if (item.state === "fired" && item.runSessionId) {
    return { kind: "session", sessionId: item.runSessionId };
  }
  return null;
}

/** The hint at the foot of the list (scheduled-tasks ticket 14's rule;
 * main chat PRD ruling 96 moved it down and gave it a ×): launch at
 * login is off and something is set to go off — a task, or a to-do's
 * reminder — and the user has not closed it. Unknown (`null`) never
 * warns. */
export function todoAutostartHintVisible(
  autostartEnabled: boolean | null,
  todo: AssistantTodo,
  closed: boolean,
): boolean {
  if (closed || autostartEnabled !== false) return false;
  const tasks = [...todo.assistant, ...todo.routine];
  const yours = [
    ...todo.yours.today,
    ...todo.yours.later,
    ...todo.yours.anytime,
  ];
  return (
    tasks.some((item) => item.kind === "task" && item.state === "scheduled") ||
    yours.some((item) => item.reminder?.state === "scheduled")
  );
}

// ---- Reminder cards -------------------------------------------------------

/** A card's state: still to come, gone off (a one-off), cancelled,
 * switched off. */
export type ReminderCardState = "scheduled" | "fired" | "cancelled" | "paused";

function secs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Mirror of Core `ScheduledTaskBrief::once_fired`: a one-off fired for
 * its time (a manual run before it does not count). */
export function onceFired(task: ScheduledTask): boolean {
  if (task.repeat.kind !== "once") return false;
  const fireAt = secs(task.fireAt);
  const last = secs(task.lastFiredAt);
  return fireAt !== null && last !== null && last >= fireAt;
}

export function reminderCardState(task: ScheduledTask): ReminderCardState {
  if (task.cancelledAt) return "cancelled";
  if (onceFired(task)) return "fired";
  if (!task.enabled) return "paused";
  return "scheduled";
}

/** The card's state in words: 待提醒 / 已提醒 / 已取消 / 已暂停 (a task
 * that starts a session: 待运行 / 已运行). */
export function reminderStateLabel(task: ScheduledTask, copy: AppCopy): string {
  const session = task.target === "session";
  switch (reminderCardState(task)) {
    case "scheduled":
      return session
        ? copy.todo.stateScheduledSession
        : copy.todo.stateScheduled;
    case "fired":
      return session ? copy.todo.stateFiredSession : copy.todo.stateFired;
    case "cancelled":
      return copy.todo.stateCancelled;
    case "paused":
      return copy.todo.statePaused;
  }
}

/** The card's time: a one-off's instant (「明天 09:00」), a repeating
 * task's rule (「每天 08:00」). */
export function reminderTimeLabel(
  task: ScheduledTask,
  todayStartMs: number,
  language: ResolvedLanguage,
  copy: AppCopy,
): string {
  if (task.repeat.kind === "once") {
    return task.fireAt
      ? scheduleTime(task.fireAt, todayStartMs, language, copy)
      : task.timeOfDay;
  }
  return repeatSummary(copy, task.repeat, task.timeOfDay);
}

/**
 * The tasks the assistant made in `mainChatId`'s replies, by the reply
 * they hang under (`AgentTurn.messageId`), each reply's in the order
 * they were made. Cancelled ones stay (their card says so); a task whose
 * run has not settled its reply yet (`turnIndex` absent) has no card
 * until it does.
 */
export function remindersByMessage(
  tasks: readonly ScheduledTask[],
  mainChatId: string | undefined,
): Map<string, ScheduledTask[]> {
  const byMessage = new Map<string, ScheduledTask[]>();
  if (!mainChatId) return byMessage;
  const made = tasks
    .filter(
      (t) =>
        t.createdIn?.sessionId === mainChatId && t.createdIn.turnIndex != null,
    )
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  for (const task of made) {
    const key = replyMessageId(mainChatId, task.createdIn!.turnIndex!);
    const group = byMessage.get(key);
    if (group) group.push(task);
    else byMessage.set(key, [task]);
  }
  return byMessage;
}

/** Cancel a task — the card's 「取消」 and the list's: Core's soft
 * delete (`delete_scheduled_task`, the row stays with `cancelledAt`). No
 * confirm: it touches this one thing. The assistant is not told; it
 * reads its 「在办的事」 next time. */
export async function cancelScheduledTask(id: string): Promise<void> {
  await deleteScheduledTask(id);
}

/** Why an action failed: the thing is gone (Core's `{"error":
 * "not_found", …}`), or anything else. */
export type TodoFailure = "gone" | "failed";

export function todoFailureKind(error: unknown): TodoFailure {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  try {
    const parsed = JSON.parse(raw) as { error?: unknown } | null;
    if (parsed?.error === "not_found") return "gone";
  } catch {
    // Not Core's JSON.
  }
  return "failed";
}

/** A failure in words, for the line under a card or a row. */
export function todoFailureText(kind: TodoFailure, copy: AppCopy): string {
  return kind === "gone" ? copy.todo.actionGone : copy.todo.actionFailed;
}

/** A failed cancel (a card's, a reminder's) in words, from Core's
 * rejection. */
export function todoActionFailure(error: unknown, copy: AppCopy): string {
  return todoFailureText(todoFailureKind(error), copy);
}
