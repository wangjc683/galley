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
 * The assistant's to-do list and its reminder cards (main chat ticket
 * 37; main chat PRD rulings 84 and 86, assistant PRD ruling 9).
 *
 * On the managed runtime there is no 「定时任务」 feature for the user:
 * scheduled tasks are the assistant's hands. It sets a reminder when it
 * hears something with a time in it, says so, and a card drawn from the
 * database hangs under that reply (`remindersByMessage`). The second
 * icon of the sidebar masthead opens its 待办: what is coming up, what
 * it is working on, what it finished lately — one Core read
 * (`list_assistant_todo`, core/src/assistant_todo.rs), the same one
 * Core writes the main chat's 「在办的事」 from (ticket 36), so what the
 * user sees is what the assistant sees.
 *
 * Everything here is pure but the two Core calls: the wire shapes, the
 * card's state, the words and times a row shows, where a row leads.
 */

/** Mirror of Core `TodoKind`. */
export type TodoKind = "task" | "subtask";

/** Mirror of Core `TodoState`. */
export type TodoState =
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

/** Mirror of Core `TodoItem`. */
export interface TodoItem {
  kind: TodoKind;
  /** Task id, or the subtask's session id. */
  id: string;
  /** The task's words or the subtask's title, uncut. */
  text: string;
  state: TodoState;
  /** UTC ISO: next fire (upcoming), latest activity (active), the fire
   * or the finish (recent). Absent for a paused repeating task. */
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
  /** Recent session tasks: the session that run made. */
  runSessionId?: string;
}

/** Mirror of Core `AssistantTodo`. */
export interface AssistantTodo {
  upcoming: TodoItem[];
  active: TodoItem[];
  recent: TodoItem[];
  /** Finished within the window past Core's cap: left out. */
  recentOmitted: number;
}

export const EMPTY_TODO: AssistantTodo = {
  upcoming: [],
  active: [],
  recent: [],
  recentOmitted: 0,
};

export async function listAssistantTodo(): Promise<AssistantTodo> {
  return invoke<AssistantTodo>("list_assistant_todo");
}

/**
 * Core events after which the open list reads again: a task changed or
 * fired (`scheduled-tasks:changed`), a subtask was dispatched, a run
 * started or ended (`session-run-state`), a subtask was promoted,
 * archived, restored or deleted, a reply was deleted. Already emitted;
 * the list adds none.
 */
export const TODO_REFRESH_EVENTS: readonly string[] = [
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

/** Whether the list has nothing at all (its empty state). */
export function todoIsEmpty(todo: AssistantTodo): boolean {
  return (
    todo.upcoming.length === 0 &&
    todo.active.length === 0 &&
    todo.recent.length === 0
  );
}

/** The reply a turn's message id names (`AgentTurn.messageId`, the
 * subtask dispatch's `messageId`). */
export function replyMessageId(sessionId: string, turnIndex: number): string {
  return `msg_${sessionId}_${turnIndex}_assistant`;
}

// ---- Times and words ------------------------------------------------------

function scheduleTime(
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

/** The small mark for what the assistant did not make: the user's form
 * (「手动」) or another agent (「Agent」, its name in the tooltip). The
 * assistant's own and the ones the user asked it for carry none. */
export function todoBadge(
  item: TodoItem,
  copy: AppCopy,
): { label: string; title: string } | null {
  switch (item.createdBy) {
    case "assistant":
      return null;
    case "user":
      return {
        label: copy.todo.badgeManual,
        title: copy.todo.badgeManualTitle,
      };
    case "agent":
      return {
        label: copy.todo.badgeAgent,
        title: item.agent
          ? copy.todo.badgeAgentTitle(item.agent)
          : copy.todo.badgeAgentTitleBare,
      };
  }
}

// ---- Where a row leads, what it can do -------------------------------------

/** What clicking a row does. */
export type TodoTarget =
  /** The reply the assistant made it in: jump there and light it up
   * (the 查找聊天记录 jump, ticket 28). */
  | { kind: "reply"; sessionId: string; messageId: string }
  /** A subtask: open it, as its card's 「打开」 does. */
  | { kind: "subtask"; sessionId: string }
  /** The session a scheduled run made. */
  | { kind: "session"; sessionId: string }
  /** A task made in the form: open the form. */
  | { kind: "edit"; taskId: string };

/** Where a row leads; null for a row with nowhere to go (a task another
 * agent made, or made outside a reply). */
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
  if (todoCanEdit(item)) return { kind: "edit", taskId: item.id };
  return null;
}

/** Still to come (接下来). */
function upcoming(item: TodoItem): boolean {
  return (
    item.kind === "task" &&
    (item.state === "scheduled" || item.state === "paused")
  );
}

/** Every task still to come can be cancelled. */
export function todoCanCancel(item: TodoItem): boolean {
  return upcoming(item);
}

/** A repeating task can be paused; a paused one resumed. */
export function todoCanPause(item: TodoItem): boolean {
  return upcoming(item) && item.state === "scheduled" && isRepeating(item);
}

export function todoCanResume(item: TodoItem): boolean {
  return upcoming(item) && item.state === "paused";
}

/** The user's own repeating tasks open the old form (one-offs it cannot
 * express). */
export function todoCanEdit(item: TodoItem): boolean {
  return upcoming(item) && item.createdBy === "user" && isRepeating(item);
}

function isRepeating(item: TodoItem): boolean {
  return !!item.repeat && item.repeat.kind !== "once";
}

/** The hint at the top of the list (scheduled-tasks ticket 14's rule):
 * launch at login is off and something is set to go off. Unknown
 * (`null`) never warns. */
export function todoAutostartHintVisible(
  autostartEnabled: boolean | null,
  todo: AssistantTodo,
): boolean {
  return (
    autostartEnabled === false &&
    todo.upcoming.some((item) => item.state === "scheduled")
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

/** A failed cancel (or pause) in words, from Core's rejection
 * (`{"error": "not_found", …}` when the task is gone). */
export function todoActionFailure(error: unknown, copy: AppCopy): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  try {
    const parsed = JSON.parse(raw) as { error?: unknown } | null;
    if (parsed?.error === "not_found") return copy.todo.actionGone;
  } catch {
    // Not Core's JSON.
  }
  return copy.todo.actionFailed;
}
