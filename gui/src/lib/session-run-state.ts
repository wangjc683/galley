/**
 * `session-run-state` (ticket 05c) — Core's live run state of one
 * session, emitted whenever it changes: the run gate, the queue length,
 * a pending `ask_user`, a turn going, the runner process, why the last
 * run ended. Events carry whole states, deduplicated per session; a
 * session with no event yet is idle. This page does not listen yet — it
 * infers the same from runner events — the remote module forwards it to
 * the phone. Wire types only.
 */

/** Mirror of core/src/runner_manager/run_state_events.rs SESSION_RUN_STATE_EVENT. */
export const SESSION_RUN_STATE_EVENT = "session-run-state";

/** Mirror of core/src/runner_manager/run_state_events.rs SessionRunStatePayload. */
export interface SessionRunStatePayload {
  sessionId: string;
  /** A runner process is registered for the session. */
  runnerAlive: boolean;
  /** The runner is mid-turn (false in the gaps between a run's turns). */
  agentRunning: boolean;
  /** A dispatched run has not completed yet — the run-level busy flag. */
  openRun: boolean;
  /** Messages waiting in the session's queue. */
  queuedCount: number;
  /** The last run ended on an `ask_user` question nobody answered yet. */
  askPending: boolean;
  /** `exitReason.result` of the last completed run, `null` before one. */
  lastExit: string | null;
}
