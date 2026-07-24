import { invoke } from "@tauri-apps/api/core";

/**
 * Thin GUI wrappers over Galley Core's scheduled-task commands
 * (core/src/commands/schedule.rs). Rust owns persistence and the
 * scheduler loop; the GUI is a presenter — it refetches on the
 * `scheduled-tasks:changed` event rather than mirroring state.
 */

/** Tauri event emitted by Core after any scheduled-task change
 * (GUI CRUD or a scheduler fire). Payload is empty; refetch. */
export const SCHEDULED_TASKS_CHANGED_EVENT = "scheduled-tasks:changed";

/** Supervisor label Core stamps on scheduler-created sessions
 * (core/src/scheduler.rs). Used to derive the approval-blocked badge. */
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
