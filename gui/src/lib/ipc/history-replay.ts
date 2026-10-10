import { useMessagesStore } from "@/stores/messages";

/**
 * Payload of Core's `runner-history-replay` event (ticket 02b). Core
 * replays a session's persisted conversation into its runner itself —
 * `load_history` before the runner may take a turn — and announces each
 * attempt: `started` right before it sends, then `done` or `failed`. A
 * restart after a failed attempt shows as a second `started`.
 */
export interface RunnerHistoryReplayPayload {
  sessionId: string;
  phase: "started" | "done" | "failed";
}

/**
 * Show "restoring" while Core replays history for a send this page is
 * waiting on. Only for a session whose run the page already shows as
 * started (`agentRunning`, set when the user's turn is appended) — a
 * replay on activation alone, or for a side question, shows nothing.
 * The send path moves the phase on once Core's ensure returns.
 */
export function applyRunnerHistoryReplay(
  payload: RunnerHistoryReplayPayload,
): void {
  if (payload.phase !== "started") return;
  const messages = useMessagesStore.getState();
  if (messages.byId[payload.sessionId]?.agentRunning) {
    messages.setSendPhase(payload.sessionId, "restoring");
  }
}
