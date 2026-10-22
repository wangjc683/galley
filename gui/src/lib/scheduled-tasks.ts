import { invoke } from "@tauri-apps/api/core";

import type { AppCopy } from "@/lib/i18n";

/**
 * Thin GUI wrappers over Galley Core's scheduled-task commands
 * (core/src/commands/schedule.rs). Rust owns persistence and the
 * scheduler loop; the GUI is a presenter — it refetches on the
 * `scheduled-tasks:changed` event rather than mirroring state.
 */

/** Tauri event emitted by Core after any scheduled-task change
 * (GUI CRUD or a scheduler fire). Payload is empty; refetch. */
export const SCHEDULED_TASKS_CHANGED_EVENT = "scheduled-tasks:changed";

/** Tauri event emitted by Core when a scheduler fire fails to create a
 * session (core/src/scheduler.rs). The GUI owns turning it into a
 * system notification — Core never sends OS notifications (issue 05's
 * no-double-send rule). Pinned by `scheduled-tasks.test.ts`. */
export const SCHEDULED_TASK_FIRE_FAILED_EVENT = "scheduled-tasks:fire-failed";

/** Payload of {@link SCHEDULED_TASK_FIRE_FAILED_EVENT} (Rust
 * `ScheduledFireFailed`). */
export interface ScheduledFireFailedPayload {
  taskId: string;
  prompt: string;
}

/** Tauri event emitted by Core when a task that wakes the assistant came
 * due but could not reach it — the main chat was waiting for an answer,
 * its runner did not start, or the turn ended on an error (main chat
 * ticket 33). The fire is consumed; the GUI shows a system notification
 * with the task's own words instead. */
export const SCHEDULED_REMINDER_UNDELIVERED_EVENT =
  "scheduled-tasks:reminder-undelivered";

/** Payload of {@link SCHEDULED_REMINDER_UNDELIVERED_EVENT} (Rust
 * `ScheduledReminderUndelivered`). */
export interface ScheduledReminderUndeliveredPayload {
  taskId: string;
  prompt: string;
  reason: "asking" | "not_started" | "no_reply" | "no_main_chat";
}

/** Supervisor label Core stamps on scheduler-created sessions
 * (core/src/scheduler.rs). Used to mark scheduler-created sessions.
 * The literal is pinned on both sides of the language seam by
 * `scheduled-tasks.test.ts` — a rename must land in Rust too. */
export const SCHEDULER_SUPERVISOR = "galley-scheduler";

/** Supervisor label of the daily review (main chat tickets 73, 74;
 * assistant PRD ruling 10): the one routine Core seeds,
 * `created_by_supervisor = 'galley-review'`, which wakes the assistant
 * a little before or after 09:00 (a time Core picks once when it seeds
 * it, ticket 78) to go over what is in hand. Its `prompt` is English for
 * the model; the to-do panel shows a name of its own instead. Pinned by
 * `scheduled-tasks.test.ts`, as the label above is. */
export const REVIEW_SUPERVISOR = "galley-review";

/** Whether a task is the daily review (its `origin` is `{ via:
 * "system", supervisor: "galley-review" }`, ticket 73). The 定时 dialog
 * leaves it out (ticket 74): the dialog only opens without a main chat
 * — the external runtime, where the review never runs — and the row
 * left behind by an earlier managed run would show its English prompt. */
export function isDailyReviewTask(task: ScheduledTask): boolean {
  return task.origin?.supervisor === REVIEW_SUPERVISOR;
}

/** Mirror of Rust `ScheduledTaskRepeat` (tagged, snake_case kinds).
 * Monthly clamps to short months Core-side: day 31 fires on Apr 30 /
 * Feb 28 rather than skipping the month. */
export type ScheduledTaskRepeat =
  | { kind: "daily" }
  | { kind: "weekly"; weekdays: number[] }
  | { kind: "monthly"; monthdays: number[] }
  /** A one-off at `fireAt` (main chat ticket 33). */
  | { kind: "once" };

/** What a fire does (Rust `ScheduleTarget`): start a session, or wake
 * the assistant (the main chat). */
export type ScheduledTaskTarget = "session" | "assistant";

/** How an `assistant` task's last fire reached the main chat (Rust
 * `ScheduledWake`). */
export type ScheduledTaskWake = "pending" | "delivered" | "notified";

/** Mirror of Rust `ScheduledTaskBrief`. */
export interface ScheduledTask {
  id: string;
  projectId?: string;
  prompt: string;
  repeat: ScheduledTaskRepeat;
  /** Local wall clock, "HH:MM". */
  timeOfDay: string;
  /** Model display name for fires (`--llm` semantic); unset = runtime
   * default. Core degrades to the default when it no longer resolves. */
  llmName?: string;
  enabled: boolean;
  /** UTC ISO instant of the last fire; unset = never fired. */
  lastFiredAt?: string;
  /** Session created by the last fire. Fired-but-unset = that fire
   * failed to create a session; may also dangle after a delete. */
  lastRunSessionId?: string;
  /** UTC ISO instant of the next fire; unset when disabled, cancelled,
   * or a one-off that already fired. */
  nextFireAt?: string;
  /** A one-off's fire instant, UTC ISO. */
  fireAt?: string;
  /** What a fire does; Core always sends it (`session` for old rows). */
  target?: ScheduledTaskTarget;
  /** Planned instant of the last fire (UTC ISO). */
  lastDueAt?: string;
  lastWake?: ScheduledTaskWake;
  /** Who made it: `{ via: "gui" }`, the assistant (`supervisor` +
   * `galley-assistant`), another agent. */
  origin?: { via: string; supervisor?: string; reason?: string };
  /** The main chat turn the assistant made it in. */
  createdIn?: { sessionId: string; turnIndex?: number };
  /** Set once cancelled (deleted); the default list leaves these out. */
  cancelledAt?: string;
  /** Who cancelled it and why (main chat ticket 61): `{ via: "gui" }`,
   * the CLI's label and reason, `{ via: "system" }` for Core's own. */
  cancelledBy?: { via: string; supervisor?: string; reason?: string };
  /** The to-do this task is the reminder of (main chat ticket 39); the
   * to-do's card stands for it. */
  todoId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskPatch {
  projectId?: string | null;
  prompt?: string;
  repeat?: ScheduledTaskRepeat;
  timeOfDay?: string;
  llmName?: string | null;
  enabled?: boolean;
}

const GUI_ORIGIN = { via: "gui" } as const;

export function mintScheduledTaskId(): string {
  return `sched_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** The tasks that are not cancelled; `all` adds the cancelled ones. */
export async function listScheduledTasks(
  all?: boolean,
): Promise<ScheduledTask[]> {
  return invoke<ScheduledTask[]>(
    "list_scheduled_tasks",
    all ? { all } : undefined,
  );
}

export async function createScheduledTask(input: {
  id: string;
  projectId?: string;
  prompt: string;
  repeat: ScheduledTaskRepeat;
  timeOfDay: string;
  llmName?: string;
  enabled: boolean;
}): Promise<ScheduledTask> {
  return invoke<ScheduledTask>("create_scheduled_task", {
    input,
    origin: GUI_ORIGIN,
  });
}

export async function updateScheduledTask(
  id: string,
  patch: ScheduledTaskPatch,
): Promise<ScheduledTask> {
  return invoke<ScheduledTask>("update_scheduled_task", {
    id,
    patch,
    origin: GUI_ORIGIN,
  });
}

export async function deleteScheduledTask(id: string): Promise<void> {
  await invoke("delete_scheduled_task", { id, origin: GUI_ORIGIN });
}

/** Manual "run now": fires the task once through the exact scheduled
 * path (same supervisor label, same `last_fired_at` stamp), so the run
 * becomes the row's 上次运行 and a success clears a failed-fire badge.
 * Future planned fires are never consumed — Core's due math keeps them
 * strictly after the new baseline. Resolves when the fire completed;
 * the row itself updates via `scheduled-tasks:changed`. */
export async function runScheduledTaskNow(id: string): Promise<void> {
  await invoke("run_scheduled_task_now", { id });
}

/** Mirror of Rust `FirePreview`: what saving a task with the given rule
 * would do. `dueNow` means an unconsumed period earlier today fires
 * within the next scheduler tick (reachable only when editing). */
export interface ScheduledFirePreview {
  dueNow: boolean;
  /** UTC ISO instant of the next planned fire strictly after now. */
  nextFireAt: string;
}

/** Read-only next-fire preview for the create/edit form. Calendar math
 * (monthly clamping, DST) stays in Rust — the GUI never re-derives it. */
export async function previewScheduledFire(input: {
  repeat: ScheduledTaskRepeat;
  timeOfDay: string;
  taskId?: string;
}): Promise<ScheduledFirePreview> {
  return invoke<ScheduledFirePreview>("preview_scheduled_fire", input);
}

/** Enabled tasks whose last fire produced no session — the "needs your
 * action" count on the 定时 badge. Disabled
 * tasks are excluded: pausing is itself the user's handling. The state
 * clears when the next fire succeeds; there is deliberately no manual
 * dismiss. */
export function countFailedTasks(tasks: ScheduledTask[]): number {
  // A task that wakes the assistant starts no session by design.
  return tasks.filter(
    (t) =>
      t.enabled &&
      t.target !== "assistant" &&
      t.lastFiredAt !== undefined &&
      !t.lastRunSessionId,
  ).length;
}

/** The edit form for `task`; `null` for a one-off, which the form (daily
 * / weekly / monthly) cannot express. */
export function formFromTask(
  task: ScheduledTask,
): ScheduledTaskFormState | null {
  const repeat = task.repeat;
  if (repeat.kind === "once") return null;
  return {
    id: task.id,
    prompt: task.prompt,
    projectId: task.projectId ?? "",
    repeatKind: repeat.kind,
    weekdays: repeat.kind === "weekly" ? repeat.weekdays : [],
    monthdays: repeat.kind === "monthly" ? repeat.monthdays : [],
    timeOfDay: task.timeOfDay,
    llmName: task.llmName ?? "",
  };
}

/** Create/edit form state — the GUI half of the form ↔ wire repeat
 * codec. Lives here (not in the dialog) so the codec and the display
 * helpers below are covered by the node test suite, mirroring the
 * Rust-side calendar tests in `core/src/api/schedule.rs`. */
export interface ScheduledTaskFormState {
  /** Task id when editing; null = creating. */
  id: string | null;
  prompt: string;
  projectId: string;
  repeatKind: "daily" | "weekly" | "monthly";
  weekdays: number[];
  monthdays: number[];
  timeOfDay: string;
  /** Model display name; "" = runtime default. */
  llmName: string;
}

export const EMPTY_SCHEDULED_TASK_FORM: ScheduledTaskFormState = {
  id: null,
  prompt: "",
  projectId: "",
  repeatKind: "daily",
  weekdays: [],
  monthdays: [],
  timeOfDay: "09:00",
  llmName: "",
};

/** Form → wire. Days are sorted so the stored CSV matches what Core's
 * `normalized()` would produce; the day-pick order is a UI accident. */
export function repeatFromForm(form: ScheduledTaskFormState): ScheduledTaskRepeat {
  switch (form.repeatKind) {
    case "daily":
      return { kind: "daily" };
    case "weekly":
      return {
        kind: "weekly",
        weekdays: [...form.weekdays].sort((a, b) => a - b),
      };
    case "monthly":
      return {
        kind: "monthly",
        monthdays: [...form.monthdays].sort((a, b) => a - b),
      };
  }
}

/** Mirror of Core's non-empty-days validation, checked pre-submit so
 * the form can disable its confirm instead of surfacing an error. */
export function formDaysValid(form: ScheduledTaskFormState): boolean {
  if (form.repeatKind === "weekly") return form.weekdays.length > 0;
  if (form.repeatKind === "monthly") return form.monthdays.length > 0;
  return true;
}

/** One-line repeat description ("每周一·五 09:00") for rows + examples. */
export function repeatSummary(
  copy: AppCopy,
  repeat: ScheduledTaskRepeat,
  timeOfDay: string,
): string {
  switch (repeat.kind) {
    case "daily":
      return copy.scheduled.repeatSummaryDaily(timeOfDay);
    case "weekly":
      return copy.scheduled.repeatSummaryWeekly(
        repeat.weekdays.map((d) => copy.scheduled.weekdayLabel(d)).join("·"),
        timeOfDay,
      );
    case "monthly":
      return copy.scheduled.repeatSummaryMonthly(
        repeat.monthdays.join("·"),
        timeOfDay,
      );
    case "once":
      return copy.scheduled.repeatSummaryOnce(timeOfDay);
  }
}

/** Locale-formatted fire instant; falls back to the raw ISO string when
 * the value doesn't parse (a real decision — a corrupt timestamp should
 * degrade visibly, not blank the cell). */
export function formatFireTime(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
