import type { AppCopy } from "@/i18n/types";
import { isFinalAnswerTurn } from "@/lib/agent-turn";
import { displaySessionSummary } from "@/lib/session-summary";
import type { BridgeStatus } from "@/stores/runtime/shared";
import type { PendingAskUser, Turn } from "@/types/conversation";
import type { Session } from "@/types/session";

/**
 * Subtasks (main chat ticket 06a, PRD rulings 25 / 52 / 53).
 *
 * The main chat hands long work to a subtask by ending its reply with
 * `<subtask>what to do</subtask>`. Core reads the tags when the reply
 * lands and starts one ordinary conversation per tag (its parent is the
 * main chat, its first message the instructions), recording which reply
 * dispatched which subtask — or why one was not started. The desktop
 * shows each as a card under that reply; the subtask itself stays out
 * of the sidebar until the user writes in it (promoted).
 *
 * Everything here is pure: the wire shape, which sessions count as an
 * unpromoted subtask, and the card's state.
 */

/** Mirror of Core's dispatch record (`list_subtask_dispatches`, the
 * `subtask-dispatched` event). */
export interface SubtaskDispatch {
  parentSessionId: string;
  /** Absolute turn index of the main chat reply that carried the tag. */
  turnIndex: number;
  /** 0-based position of the tag in that reply. */
  ordinal: number;
  /** `msg_${parentSessionId}_${turnIndex}_assistant` — the reply's
   * `AgentTurn.messageId`, live and restored alike. */
  messageId: string;
  /** The subtask session; null when it was never started. */
  sessionId: string | null;
  /** First line of the instructions. */
  title: string;
  failure: "empty" | "unclosed" | "start_failed" | null;
  /** For `start_failed`: Core's error text (English). */
  failureDetail: string | null;
  createdAt: string;
}

/** Payload of Core's `subtask-dispatched`: records of one reply, sent as
 * each is written (one per event) — a subtask's once it exists, again if
 * its runner then did not start; a later record for the same tag
 * replaces the earlier one (`mergeDispatches`). */
export interface SubtaskDispatchedPayload {
  parentSessionId: string;
  dispatches: SubtaskDispatch[];
}

export const SUBTASK_DISPATCHED_EVENT = "subtask-dispatched";

/** A subtask the user has not written in yet: no sidebar row, a card
 * under the reply that dispatched it, its states reach the main chat's
 * row. Once promoted it is an ordinary conversation. */
export function isUnpromotedSubtask(
  session: Pick<Session, "parentSessionId" | "promoted"> | undefined,
): boolean {
  return !!session?.parentSessionId && !session.promoted;
}

/** The unpromoted subtasks of `parentId` among `sessions`. */
export function unpromotedSubtasksOf(
  sessions: readonly Session[],
  parentId: string | undefined,
): Session[] {
  if (!parentId) return [];
  return sessions.filter((s) => s.parentSessionId === parentId && !s.promoted);
}

/** Dispatches in display order: by reply, then by tag position. */
export function sortDispatches(
  dispatches: SubtaskDispatch[],
): SubtaskDispatch[] {
  return [...dispatches].sort(
    (a, b) => a.turnIndex - b.turnIndex || a.ordinal - b.ordinal,
  );
}

/**
 * Merge `incoming` into `current`, one record per (turnIndex, ordinal):
 * a later record replaces an earlier one (a re-read after an event, an
 * event after a re-read). Returns `current` itself when nothing changed.
 */
export function mergeDispatches(
  current: readonly SubtaskDispatch[],
  incoming: readonly SubtaskDispatch[],
): SubtaskDispatch[] {
  const key = (d: SubtaskDispatch) => `${d.turnIndex}:${d.ordinal}`;
  const byKey = new Map(current.map((d) => [key(d), d]));
  let changed = false;
  for (const d of incoming) {
    const prev = byKey.get(key(d));
    if (prev && sameDispatch(prev, d)) continue;
    byKey.set(key(d), d);
    changed = true;
  }
  return changed ? sortDispatches([...byKey.values()]) : [...current];
}

function sameDispatch(a: SubtaskDispatch, b: SubtaskDispatch): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.title === b.title &&
    a.failure === b.failure &&
    a.failureDetail === b.failureDetail &&
    a.messageId === b.messageId
  );
}

/** What the card needs from the live stores for the subtask session. */
export interface SubtaskLiveView {
  agentRunning: boolean;
  pendingAskUser: PendingAskUser | null;
  bridgeStatus?: BridgeStatus;
  bridgeError?: string | null;
  /** The session's loaded turns (messages store). */
  turns: readonly Turn[];
  /** The last run's error message this page saw (subtasks store), if
   * the run ended on one. */
  runError?: string | null;
}

/** Why a card reads as failed or not started. */
export type SubtaskFailure =
  | { kind: "empty" }
  | { kind: "unclosed" }
  | { kind: "startFailed"; detail: string | null }
  | { kind: "error"; message: string | null }
  | { kind: "didNotFinish" };

export type SubtaskCardState =
  /** Never started: no session to open. */
  | { kind: "notStarted"; failure: SubtaskFailure }
  /** The session is gone (deleted). */
  | { kind: "gone" }
  | { kind: "failed"; failure: SubtaskFailure }
  | { kind: "asking"; pending: PendingAskUser }
  /** `step`/`summary`: the sidebar's running subline (the last finished
   * step and its recap); both null before the first step ends. */
  | { kind: "running"; step: number | null; summary: string | null }
  /** `line`: one line of result, null when there is none to show. */
  | { kind: "done"; line: string | null }
  /** The session has history this page has not read yet. */
  | { kind: "loading" };

/**
 * The card's state. Deterministic over its inputs, in this order:
 *
 *   1. no session id → not started (the dispatch's failure);
 *   2. the session is not known → gone;
 *   3. the runner crashed (bridge `error`) or the last run ended on an
 *      error → failed;
 *   4. a question is pending → asking;
 *   5. working (a run open, or its runner starting) → running;
 *   6. Core could not start its runner and no step ever ran → failed;
 *   7. the last turn is a final answer (no question) → done;
 *   8. history exists but is not loaded yet → loading;
 *   9. otherwise the run stopped short of an answer → failed
 *      (「没有跑完」).
 *
 * Same sources as the sidebar row (`useSessionStatusView`): the running
 * line is the row's subline, error is the row's 出错.
 */
export function deriveSubtaskCard(
  dispatch: SubtaskDispatch,
  session: Session | undefined,
  live: SubtaskLiveView,
): SubtaskCardState {
  if (!dispatch.sessionId) {
    return { kind: "notStarted", failure: dispatchFailure(dispatch) };
  }
  if (!session) return { kind: "gone" };
  if (live.bridgeStatus === "error") {
    return {
      kind: "failed",
      failure: { kind: "error", message: live.bridgeError ?? null },
    };
  }
  if (live.runError) {
    return {
      kind: "failed",
      failure: { kind: "error", message: live.runError },
    };
  }
  if (live.pendingAskUser) {
    return { kind: "asking", pending: live.pendingAskUser };
  }
  if (live.agentRunning || live.bridgeStatus === "spawning") {
    return {
      kind: "running",
      step: session.lastStepIndex ?? null,
      summary: session.lastStepIndex != null ? (session.summary ?? null) : null,
    };
  }
  const lastAgent = [...live.turns].reverse().find((t) => t.role === "agent");
  if (dispatch.failure === "start_failed" && !lastAgent) {
    return {
      kind: "failed",
      failure: { kind: "startFailed", detail: dispatch.failureDetail },
    };
  }
  if (
    lastAgent?.role === "agent" &&
    lastAgent.finalAnswer !== null &&
    isFinalAnswerTurn(lastAgent.tools)
  ) {
    return {
      kind: "done",
      line: session.summary ?? firstLine(lastAgent.finalAnswer),
    };
  }
  if (live.turns.length === 0 && (session.turnCount ?? 0) > 0) {
    return { kind: "loading" };
  }
  return { kind: "failed", failure: { kind: "didNotFinish" } };
}

function dispatchFailure(dispatch: SubtaskDispatch): SubtaskFailure {
  switch (dispatch.failure) {
    case "empty":
      return { kind: "empty" };
    case "unclosed":
      return { kind: "unclosed" };
    default:
      return { kind: "startFailed", detail: dispatch.failureDetail };
  }
}

/** First non-empty line of `text`, markdown heading / list marks off. */
function firstLine(text: string): string | null {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*)/, "").trim();
    if (line) return line;
  }
  return null;
}

/** The card's one state line, in the UI language. Null for a state
 * that shows no line (asking draws the question; loading draws none). */
export function subtaskCardLine(
  state: SubtaskCardState,
  copy: AppCopy,
): string | null {
  switch (state.kind) {
    case "notStarted":
    case "failed":
      return failureText(state.failure, copy);
    case "gone":
      return copy.subtask.gone;
    case "running": {
      const summary = state.summary
        ? displaySessionSummary(state.summary, copy.sidebar.turnProtocolFailure)
        : null;
      return state.step != null && summary
        ? copy.sidebar.stepSummary(state.step, summary)
        : copy.sidebar.thinking;
    }
    case "done": {
      const line = state.line
        ? displaySessionSummary(state.line, copy.sidebar.turnProtocolFailure)
        : "";
      return line || copy.subtask.done;
    }
    case "asking":
    case "loading":
      return null;
  }
}

/** Why it failed or never started, in words: a tag Core could not use
 * and a session it could not create read as not started; anything that
 * went wrong once the subtask existed reads as failed. */
export function failureText(failure: SubtaskFailure, copy: AppCopy): string {
  switch (failure.kind) {
    case "empty":
      return copy.subtask.notStartedEmpty;
    case "unclosed":
      return copy.subtask.notStartedUnclosed;
    case "startFailed":
      return failure.detail
        ? copy.subtask.couldNotStart(failure.detail)
        : copy.subtask.couldNotStartBare;
    case "error":
      return failure.message
        ? copy.subtask.failed(failure.message)
        : copy.subtask.failedBare;
    case "didNotFinish":
      return copy.subtask.didNotFinish;
  }
}

/**
 * The main header's crumb while `active` is an unpromoted subtask: its
 * parent's label before the title, a click opens the parent. A subtask
 * has no sidebar row of its own, so this is the way back. Undefined for
 * every other session (a promoted subtask is an ordinary conversation).
 */
export function subtaskBreadcrumb(
  active: Session | undefined,
  {
    label,
    ariaLabel,
    openParent,
  }: { label: string; ariaLabel: string; openParent: () => void },
): { label: string; ariaLabel: string; onClick: () => void } | undefined {
  if (!isUnpromotedSubtask(active)) return undefined;
  return { label, ariaLabel, onClick: openParent };
}
