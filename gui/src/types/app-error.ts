/**
 * Desktop-side error shape. Decoupled from the IPC wire format
 * (`types/ipc.ts ErrorEvent`) so we can carry desktop-only fields
 * (`id` for toast deduping, etc.) without leaking them onto the bridge
 * protocol.
 *
 * Use `fromIPCError(event)` to lift bridge errors into AppError.
 *
 * The three categories drive *where* the desktop renders the error;
 * see DESIGN.md §6.2 + ipc-protocol.md §4.10:
 *
 *   runtime  → conversation inline message bubble
 *   bridge   → top-level toast
 *   business → top-level toast
 *
 * The optional `hint` selects a tailored Error Card variant.
 */

import type { ErrorEvent as IPCErrorEvent } from "@/types/ipc";

export type AppErrorCategory = IPCErrorEvent["category"];
export type AppErrorSeverity = IPCErrorEvent["severity"];
/** "check_llm_config" | "network" | "quota_exceeded" — null elided. */
export type AppErrorHint = NonNullable<IPCErrorEvent["hint"]>;

export interface AppError {
  /** Stable id (for toast deduping / list keys). Generated client-side. */
  id: string;
  category: AppErrorCategory;
  severity: AppErrorSeverity;
  /**
   * Optional explicit title. When omitted, ErrorCard falls back to
   * `defaultTitle(error)` — which is error-flavored ("操作未能完成"
   * for business, "Bridge 错误" for bridge, etc). Positive-feedback
   * toasts (severity=info) should set this so the header reads
   * sensibly. For real bridge / IPC errors, leave undefined.
   */
  title?: string;
  message: string;
  hint: AppErrorHint | null;
  retryable: boolean;
  /** Command name or pipeline stage when the error fired. */
  context: string | null;
  /** Python traceback (when available; surfaced only in expanded details). */
  traceback: string | null;
  /** Optional single-action CTA for positive desktop feedback toasts. */
  action?:
    | {
        kind: "view_project";
        label: string;
        projectId: string;
      }
    | {
        kind: "view_goal";
        label: string;
        goalId: string;
      }
    | {
        kind: "restart_channels";
        label: string;
      }
    | null;
  /** Per-toast override. Useful for short positive confirmations. */
  autoDismissMs?: number;
  timestamp: string;
}

let counter = 0;
function genId(): string {
  counter += 1;
  return `err_${Date.now().toString(36)}_${counter}`;
}

/** Lift a bridge IPC ErrorEvent into a desktop AppError. */
export function fromIPCError(event: IPCErrorEvent): AppError {
  return {
    id: genId(),
    category: event.category,
    severity: event.severity,
    message: event.message,
    hint: event.hint,
    retryable: event.retryable,
    context: event.context,
    traceback: event.traceback,
    timestamp: event.timestamp,
  };
}

/** Build an AppError from a desktop-only failure (no IPC origin). */
export function makeAppError(
  partial: Omit<AppError, "id" | "timestamp"> &
    Partial<Pick<AppError, "id" | "timestamp">>,
): AppError {
  return {
    id: partial.id ?? genId(),
    timestamp: partial.timestamp ?? new Date().toISOString(),
    ...partial,
  } as AppError;
}
