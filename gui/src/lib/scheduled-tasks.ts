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

/** Supervisor label Core stamps on scheduler-created sessions
 * (core/src/scheduler.rs). Used to derive the approval-blocked badge.
 * The literal is pinned on both sides of the language seam by
 * `scheduled-tasks.test.ts` — a rename must land in Rust too. */
export const SCHEDULER_SUPERVISOR = "galley-scheduler";

/** Mirror of Rust `ScheduledTaskRepeat` (tagged, snake_case kinds).
 * Monthly clamps to short months Core-side: day 31 fires on Apr 30 /
 * Feb 28 rather than skipping the month. */
export type ScheduledTaskRepeat =
  | { kind: "daily" }
  | { kind: "weekly"; weekdays: number[] }
  | { kind: "monthly"; monthdays: number[] };

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
  /** UTC ISO instant of the next fire; unset when disabled. */
  nextFireAt?: string;
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

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  return invoke<ScheduledTask[]>("list_scheduled_tasks");
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
 * action" half the approval-blocked badge count doesn't cover. Disabled
 * tasks are excluded: pausing is itself the user's handling. The state
 * clears when the next fire succeeds; there is deliberately no manual
 * dismiss. */
export function countFailedTasks(tasks: ScheduledTask[]): number {
  return tasks.filter(
    (t) => t.enabled && t.lastFiredAt !== undefined && !t.lastRunSessionId,
  ).length;
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
