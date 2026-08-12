/**
 * Outbound message queue (galley#19 / #20) — wire types + invoke
 * wrappers. Core owns the queue (in-memory, per session); the GUI is a
 * presenter: it renders snapshots pushed via SESSION_QUEUE_CHANGED and
 * calls the queue commands below. Queued items are not persisted —
 * they reach SQLite (and the transcript) only when Core dispatches
 * them at dequeue time, arriving back through `user-message-persisted`.
 */

import { invoke } from "@tauri-apps/api/core";

import type { Origin } from "@/types/conversation";

/** Mirror of core/src/api/queue.rs SESSION_QUEUE_CHANGED_EVENT. */
export const SESSION_QUEUE_CHANGED_EVENT = "session-queue:changed";

/** Mirror of core/src/api/queue.rs QueuedMessage. */
export interface QueuedMessage {
  queueId: string;
  /** Verbatim text — "edit" = remove + refill the composer with it. */
  text: string;
  origin?: Origin;
  queuedAt: string;
}

/** Mirror of core/src/api/queue.rs SessionQueueChangedPayload. */
export interface SessionQueueChangedPayload {
  sessionId: string;
  items: QueuedMessage[];
}

/** Result of queue_or_dispatch_user_message. */
export interface QueueSendOutcome {
  /** True when the message entered the queue; false when Core
   * persisted + dispatched it immediately (the row arrives via the
   * `user-message-persisted` event — the GUI must NOT append it
   * locally). */
  queued: boolean;
  queueId?: string;
  position?: number;
}

/** Queue-or-dispatch for a main-agent message while a run is open.
 * Core decides atomically; the race "run completed right before this
 * call" degrades to an immediate Core-side dispatch. */
export function queueOrDispatchUserMessage(
  sessionId: string,
  text: string,
): Promise<QueueSendOutcome> {
  return invoke<QueueSendOutcome>("queue_or_dispatch_user_message", {
    sessionId,
    text,
  });
}

/** 插队: abort the open run (if any) and run this item first. */
export function queueJumpMessage(
  sessionId: string,
  queueId: string,
): Promise<boolean> {
  return invoke<boolean>("queue_jump_message", { sessionId, queueId });
}

/** Remove a queued item; resolves with it (verbatim text) for the
 * remove-and-refill edit flow, or null when it was already gone. */
export function queueRemoveMessage(
  sessionId: string,
  queueId: string,
): Promise<QueuedMessage | null> {
  return invoke<QueuedMessage | null>("queue_remove_message", {
    sessionId,
    queueId,
  });
}

/** One-shot snapshot — initial load / session switch; live updates
 * ride SESSION_QUEUE_CHANGED_EVENT. */
export function sessionQueueSnapshot(
  sessionId: string,
): Promise<QueuedMessage[]> {
  return invoke<QueuedMessage[]>("session_queue_snapshot", { sessionId });
}
