/**
 * `session-run-state` (ticket 05c) — Core's live run state of one
 * session, emitted whenever it changes: the run gate, the queue length,
 * a pending `ask_user`, a turn going, the runner process, why the last
 * run ended. Events carry whole states, deduplicated per session; a
 * session with no event yet is idle. This page uses only the event's
 * name — a change re-reads the to-do list (`TODO_REFRESH_EVENTS`,
 * lib/assistant-todo.ts) — and infers the run state itself from runner
 * events; the remote module forwards the payload to the phone.
 */

/** Mirror of core/src/runner_manager/run_state_events.rs SESSION_RUN_STATE_EVENT. */
export const SESSION_RUN_STATE_EVENT = "session-run-state";
