/**
 * Outbound message queue (galley#19 / #20) — wire types + invoke
 * wrappers. Core owns the queue (in-memory, per session); the GUI is a
 * presenter: it renders snapshots pushed via SESSION_QUEUE_CHANGED and
 * calls the queue commands below. A send lands here when Core's
 * `send_user_message` finds a run open (lib/session-send). Queued items
 * are not persisted — they reach SQLite (and the transcript) only when
 * Core dispatches them at dequeue time, arriving back through
 * `user-message-persisted`.
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
