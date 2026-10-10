/**
 * Core's unified send (ticket 02c) — wire types + invoke wrappers.
 *
 * Core owns the whole send: it reserves the session's run gate, persists
 * the user row (with its images), makes sure the runner is up with the
 * session's history restored, and dispatches — or queues the text when a
 * run is already open, or forwards a `/btw` side question without
 * persisting it. The GUI keeps only the optimistic echo and the display:
 * it tags the echo with a `clientRequestId`, and Core's
 * `user-message-persisted` broadcast carrying the same id claims it (see
 * the messages store).
 */

import { invoke } from "@tauri-apps/api/core";

import {
  formatInvokeError,
  invokeErrorTag,
  type RunnerHandle,
} from "@/lib/bridge";
import type { MessageAttachment, Origin } from "@/types/conversation";

/** How Core settled a `send_user_message`. */
export type SendOutcome = "dispatched" | "queued" | "side_question";

/** Arguments of Core's `send_user_message` Tauri command. */
export interface SendUserMessageArgs {
  sessionId: string;
  text: string;
  images?: { dataUrl: string; width?: number; height?: number }[];
  /** Tags this page's optimistic echo; Core echoes it on the
   * `user-message-persisted` broadcasts of the row it writes. */
  clientRequestId?: string;
  /** EmptyState's pending model pick, for a runner Core starts for a
   * brand-new session (`takePendingLLMPick`). */
  llmIndex?: number;
  llmKey?: string;
  /** Transitional, as for `ensure_session_runner` (ticket 02a): the
   * page's in-memory `gaConfig`. */
  gaConfig?: {
    python: string;
    gaPath: string;
    bridgeCwd: string;
    useExternalPython: boolean;
  };
}

/**
 * A persisted message row as Core broadcasts and returns it
 * (`api::MessageBrief`, camelCase; absent fields are skipped on the
 * wire).
 */
export interface PersistedMessageBrief {
  id?: string;
  sessionId?: string;
  role?: "user" | "agent" | "system";
  content: string;
  createdAt?: string;
  turnIndex?: number;
  /** Set on a Goal's objective row (goal v2), so the in-thread
   * commission marker matches by id, not by objective text. */
  goalId?: string;
  attachments?: MessageAttachment[];
  origin?: Origin;
}

/** Result of `send_user_message`. */
export interface SendUserMessageResult {
  outcome: SendOutcome;
  /** The persisted row when `dispatched` (same shape as the event's). */
  message: PersistedMessageBrief | null;
  /** Where the text landed when `queued`. */
  queue: { queueId: string; position: number } | null;
  /** The session's runner when `dispatched` / `side_question`. */
  runner: RunnerHandle | null;
}

/**
 * Payload of Core's `user-message-persisted` event.
 *
 * A send through `send_user_message` broadcasts the same row twice:
 * `pending` right after the write (before Core starts / restores /
 * dispatches), then `dispatched` — or `persisted_only` when the runner
 * could not start, restore or take the message (the row stays, no run
 * opened). Both carry the send's `clientRequestId`. Socket sends (CLI),
 * queue drains and Goal broadcast once, with `dispatched`,
 * `persisted_only` or `spawn_failed` and no `clientRequestId`. Absent
 * `dispatch` (older Cores) means dispatched.
 */
export interface UserMessagePersistedPayload {
  sessionId: string;
  message: PersistedMessageBrief;
  dispatch?: "pending" | "dispatched" | "persisted_only" | "spawn_failed";
  clientRequestId?: string;
}

/** A failed `send_user_message`: Core's error tag and readable message. */
export class SendUserMessageError extends Error {
  readonly tag: string | null;

  constructor(tag: string | null, message: string) {
    super(message);
    this.name = "SendUserMessageError";
    this.tag = tag;
  }
}

/** `RunnerSpawnError` tags: the runner could not start at all. */
const RUNNER_START_FAILURE_TAGS = new Set([
  "python_not_found",
  "ga_path_invalid",
  "managed_runtime_invalid",
  "managed_model_not_configured",
  "bridge_cwd_invalid",
  "path_encoding",
  "spawn_io",
  "pipe_unavailable",
]);

/** Whether a send failed because the session's runner could not start —
 * a bridge failure, as opposed to a refused or undeliverable message. */
export function isRunnerStartFailure(e: unknown): boolean {
  return (
    e instanceof SendUserMessageError &&
    e.tag !== null &&
    RUNNER_START_FAILURE_TAGS.has(e.tag)
  );
}

/** Image tags Core refuses a send with; the GUI pre-checks the same
 * rules, so these only surface when its view of the session was stale. */
export type ImageRefusalTag =
  | "images_not_supported"
  | "images_not_queueable"
  | "images_not_allowed";

export function imageRefusalTag(e: unknown): ImageRefusalTag | null {
  if (!(e instanceof SendUserMessageError)) return null;
  switch (e.tag) {
    case "images_not_supported":
    case "images_not_queueable":
    case "images_not_allowed":
      return e.tag;
    default:
      return null;
  }
}

/** Invoke Core's `send_user_message`; failures throw
 * [`SendUserMessageError`]. Listener setup is the runtime store's
 * (`deliverUserMessage`), not this wrapper's. */
export async function sendUserMessageCommand(
  args: SendUserMessageArgs,
): Promise<SendUserMessageResult> {
  try {
    return await invoke<SendUserMessageResult>("send_user_message", {
      sessionId: args.sessionId,
      text: args.text,
      images: args.images,
      clientRequestId: args.clientRequestId,
      llmIndex: args.llmIndex,
      llmKey: args.llmKey,
      gaConfig: args.gaConfig,
    });
  } catch (e) {
    // `formatInvokeError` already extracts the typed tag and detail.
    throw new SendUserMessageError(invokeErrorTag(e), formatInvokeError(e));
  }
}

/** What `stop_session_run` did: aborted the open run, or found none. */
export interface StopSessionRunResult {
  dispatch: "abort_sent" | "already_stopped";
}

/** Ask Core to stop the session's open run. */
export async function stopSessionRun(
  sessionId: string,
): Promise<StopSessionRunResult> {
  try {
    return await invoke<StopSessionRunResult>("stop_session_run", {
      sessionId,
    });
  } catch (e) {
    // eslint-disable-next-line preserve-caught-error
    throw new Error(formatInvokeError(e));
  }
}
