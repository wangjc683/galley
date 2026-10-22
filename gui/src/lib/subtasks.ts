import type { AppCopy } from "@/i18n/types";
import { isFinalAnswerTurn } from "@/lib/agent-turn";
import { buildRunGroups, type RunGroup } from "@/lib/run-groups";
import { displaySessionSummary } from "@/lib/session-summary";
import type { BridgeStatus } from "@/stores/runtime/shared";
import type {
  Origin,
  PendingAskUser,
  Turn,
  UserTurn,
} from "@/types/conversation";
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
 * When a subtask's run ends, Core wakes the main chat with a report
 * (tickets 29 / 31): a user row of its own the assistant reads, then
 * tells the user, sends the subtask back, or answers it and says
 * nothing (`<no-reply/>`). The report row is never drawn, nor is a
 * reply that said nothing; the user hears from the assistant alone.
 *
 * Everything here is pure: the wire shape, which sessions count as an
 * unpromoted subtask, the card's state, and which rows of the main
 * chat belong to a report round.
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
  /** How many times the assistant sent the subtask back (ticket 29):
   * its messages in the subtask, answers to the subtask's questions
   * aside. Core counts it from the rows and announces the record again
   * when it changes. Missing on an older payload: read as 0. */
  sendBacks?: number;
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

/** Core's `subtask-report-undelivered` (ticket 29): the reports of these
 * subtasks could not wake the main chat — its runner did not start or
 * did not take the message, or it is waiting for the user's answer. The
 * page falls back to each subtask's own notification, and a subtask
 * asking a question has it answered in its card (ruling 101,
 * `answeredInCard`). */
export const SUBTASK_REPORT_UNDELIVERED_EVENT = "subtask-report-undelivered";

/** Payload of {@link SUBTASK_REPORT_UNDELIVERED_EVENT}. */
export interface SubtaskReportUndeliveredPayload {
  mainChatId: string;
  subtaskIds: string[];
}

/** Origin supervisor of the report row Core writes into the main chat to
 * wake it (Core `SUBTASK_REPORT_SUPERVISOR`, `core/src/api/origin.rs`),
 * with `via: "system"` and the subtask ids, comma-separated, as the
 * reason. */
export const SUBTASK_REPORT_SUPERVISOR = "galley-report";

/** Whether an origin is a subtask report's. */
export function isSubtaskReport(origin: Origin | undefined): boolean {
  return (
    origin?.via === "system" && origin.supervisor === SUBTASK_REPORT_SUPERVISOR
  );
}

/** Whether a turn is a subtask report row (never drawn). */
export function isSubtaskReportTurn(turn: Turn | undefined): turn is UserTurn {
  return turn?.role === "user" && isSubtaskReport(turn.origin);
}

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
    a.messageId === b.messageId &&
    (a.sendBacks ?? 0) === (b.sendBacks ?? 0)
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
  /** Present when Core said this subtask's report could not wake the
   * main chat (subtasks store `askInCard`): the question it was asking
   * then, null when the page had not seen it yet. Absent otherwise. */
  askInCard?: PendingAskUser | null;
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
  /** `inCard`: the question is answered in the card — its report could
   * not wake the main chat (ruling 101, `answeredInCard`). Otherwise
   * the assistant takes it to the main chat, and the card only says
   * it is waiting. */
  | { kind: "asking"; pending: PendingAskUser; inCard: boolean }
  /** `step`/`summary`: the sidebar's running subline (the last finished
   * step and its recap); both null before the first step ends. `round`:
   * which round this is once the assistant sent it back (2 after one
   * send-back), absent in the first. */
  | {
      kind: "running";
      step: number | null;
      summary: string | null;
      round?: number;
    }
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
 *   4. a question is pending → asking (answered in the card only when
 *      its report could not wake the main chat, `answeredInCard`);
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
    return {
      kind: "asking",
      pending: live.pendingAskUser,
      inCard: answeredInCard(live.askInCard, live.pendingAskUser),
    };
  }
  if (live.agentRunning || live.bridgeStatus === "spawning") {
    const sendBacks = dispatch.sendBacks ?? 0;
    return {
      kind: "running",
      step: session.lastStepIndex ?? null,
      summary: session.lastStepIndex != null ? (session.summary ?? null) : null,
      ...(sendBacks >= 1 ? { round: sendBacks + 1 } : {}),
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

/**
 * Whether a subtask's question is answered in its card (main chat PRD
 * ruling 101). In the main chat a subtask's question goes to the
 * assistant: Core wakes it with the question, and it answers for the
 * user or asks them in the main chat — so the card only says the
 * subtask is waiting, and the question is never on screen twice. The
 * fallback is Core saying the report could not wake the main chat
 * (`subtask-report-undelivered`: it is waiting for the user's answer to
 * something else, or its runner did not start or take the message):
 * then nobody else will ask, and the card draws the question and a
 * reply line as before.
 *
 * `fallback` is that word from Core (subtasks store `askInCard`): the
 * question the subtask was asking when it came, or null when the page
 * had not seen the question yet (it then holds for the question that
 * arrives). It holds while the subtask still asks that same question;
 * the store drops it when the subtask runs again and when a later wake
 * carrying it reaches the assistant.
 *
 * The subtask opened in the main area follows from the same facts
 * (ruling 102, {@link subtaskQuestionHolder}): it answers whenever the
 * card does, and also before the question reached the assistant.
 */
export function answeredInCard(
  fallback: PendingAskUser | null | undefined,
  pending: PendingAskUser,
): boolean {
  if (fallback === undefined) return false;
  if (fallback === null) return true;
  return sameQuestion(fallback, pending);
}

/** The same question: same words, same candidates in the same order. */
export function sameQuestion(a: PendingAskUser, b: PendingAskUser): boolean {
  return (
    a.question === b.question &&
    a.candidates.length === b.candidates.length &&
    a.candidates.every((c, i) => c === b.candidates[i])
  );
}

// ---- Who holds a subtask's question (ruling 102) ---------------------

/** What the page has of the main chat, for {@link subtaskQuestionHolder}. */
export interface MainChatQuestionView {
  /** Its loaded turns (messages store). */
  turns: readonly Turn[];
  agentRunning: boolean;
  pendingAskUser: PendingAskUser | null;
}

/**
 * Who has a subtask's question now, and so where it is answered:
 *
 *   none           it asks nothing.
 *   subtask        it was not handed to the assistant yet — Core has not
 *                  woken the main chat, or the page cannot tell (the main
 *                  chat's turns not loaded, a reload): answered in the
 *                  subtask itself, opened from its card.
 *   card           Core could not wake the main chat for it (ruling 101,
 *                  `answeredInCard`): answered in the card, and in the
 *                  opened subtask too — both go straight to the subtask,
 *                  and nothing waits in the main chat.
 *   galleyWorking  a wake carrying it reached the assistant and that round
 *                  is running: the assistant is answering it for the user
 *                  or about to ask them. Nowhere for the user to answer,
 *                  on purpose: an answer now would have the assistant
 *                  relay a question already answered.
 *   galleyAsked    in that round the assistant asked the user in the main
 *                  chat, and waits: answered there.
 *
 * The opened subtask is locked (`subtaskQuestionLocked`) in the last
 * two: an answer there would leave the main chat's question waiting,
 * its next message taken as the answer (ruling 102). Somewhere answers
 * at every moment but while the assistant's round runs
 * (`subtaskQuestionPlaces`).
 *
 * The wake is the main chat's latest run when a report row (Core's
 * `galley-report`) opened it, its note names this subtask, and it was
 * written after the subtask's current run began (its latest user turn:
 * the run that ended on the question). An older wake — the question
 * before, a result, a send-back — is not this question's. Core stamps
 * both rows to the second; a report always comes at least one model
 * call after the run it reports began, hence strictly later.
 */
export type SubtaskQuestionHolder =
  | "none"
  | "subtask"
  | "card"
  | "galleyWorking"
  | "galleyAsked";

export function subtaskQuestionHolder({
  subtaskId,
  pending,
  askInCard,
  subtaskTurns,
  mainChat,
}: {
  subtaskId: string;
  /** The subtask's pending question (messages store). */
  pending: PendingAskUser | null;
  /** The subtasks store's `askInCard` entry for it, absent for none. */
  askInCard: PendingAskUser | null | undefined;
  /** The subtask's loaded turns: when its current run began. */
  subtaskTurns: readonly Turn[];
  /** The main chat as the page has it; undefined when not loaded. */
  mainChat: MainChatQuestionView | undefined;
}): SubtaskQuestionHolder {
  if (!pending) return "none";
  if (answeredInCard(askInCard, pending)) return "card";
  if (!mainChat || !wakeCarries(subtaskId, subtaskTurns, mainChat.turns)) {
    return "subtask";
  }
  if (mainChat.agentRunning) return "galleyWorking";
  if (mainChat.pendingAskUser) return "galleyAsked";
  // The round ended without a question to the user (told them in a
  // sentence, stopped, failed): the subtask is the place again.
  return "subtask";
}

/** Whether the opened subtask may not answer: its question is with the
 * assistant (ruling 102). */
export function subtaskQuestionLocked(holder: SubtaskQuestionHolder): boolean {
  return holder === "galleyWorking" || holder === "galleyAsked";
}

/** Where the user can answer a subtask's question for `holder` — the
 * card (`answeredInCard`, ruling 101), the opened subtask (ruling 102),
 * the main chat (the assistant's own question). */
export function subtaskQuestionPlaces(holder: SubtaskQuestionHolder): {
  card: boolean;
  subtask: boolean;
  mainChat: boolean;
} {
  return {
    card: holder === "card",
    subtask: holder !== "none" && !subtaskQuestionLocked(holder),
    mainChat: holder === "galleyAsked",
  };
}

/** Whether the main chat's latest run is a wake carrying the subtask's
 * current question (see {@link SubtaskQuestionHolder}). */
function wakeCarries(
  subtaskId: string,
  subtaskTurns: readonly Turn[],
  mainTurns: readonly Turn[],
): boolean {
  const runBegan = latestUserTurnMs(subtaskTurns);
  if (runBegan === null || !mainTurns.some(isSubtaskReportTurn)) return false;
  const groups = buildRunGroups(mainTurns as Turn[]);
  const last = groups[groups.length - 1];
  if (!last || !isReportRound(last, mainTurns)) return false;
  const opener = mainTurns[last.openerIndex];
  if (opener?.role !== "user") return false;
  const named = (opener.origin?.reason ?? "").split(",").map((id) => id.trim());
  const writtenAt = timeMs(opener.createdAt);
  return (
    named.includes(subtaskId) && writtenAt !== null && writtenAt > runBegan
  );
}

function latestUserTurnMs(turns: readonly Turn[]): number | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.role === "user") return timeMs(turn.createdAt);
  }
  return null;
}

function timeMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
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
 * that shows no line: a question answered in the card (its bubble says
 * 「等你回复」 above it), loading. Asking otherwise says 「等你回复」, the
 * sidebar row's words (ruling 101). */
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
      const line =
        state.step != null && summary
          ? copy.sidebar.stepSummary(state.step, summary)
          : copy.sidebar.thinking;
      // Sent back: which round, then the step as before (ruling 68
      // keeps a subtask's steps). Only while it runs.
      return state.round ? copy.subtask.roundPrefix(state.round) + line : line;
    }
    case "done": {
      const line = state.line
        ? displaySessionSummary(state.line, copy.sidebar.turnProtocolFailure)
        : "";
      return line || copy.subtask.done;
    }
    case "asking":
      return state.inCard ? null : copy.sidebar.waitingForYou;
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

// ---- Report rounds -------------------------------------------------------

/** A report round: a run Core opened by waking the main chat — its
 * opener is a report row. */
export function isReportRound(
  group: RunGroup,
  turns: readonly Turn[],
): boolean {
  return (
    group.openerIndex >= 0 && isSubtaskReportTurn(turns[group.openerIndex])
  );
}

/**
 * A report round whose reply said nothing (`<no-reply/>`, the closing
 * turn's `silent`): the assistant sent the subtask back or answered it,
 * or only dispatched new subtasks (ruling 125, ticket 76: the daily
 * review with no result yet). Nothing of it is drawn but the questions
 * it asked the user and their answers — no steps, and no cards of what
 * it dispatched, which hang under that silent reply alone; the subtask
 * is in the to-do panel's 「Galley 在办」. It notifies nobody, marks
 * nothing unread and is no last message. Once its silent reply lands it
 * counts as settled, before run_complete. A `<no-reply/>` outside a
 * report round is a misuse and reads as a reply that was only tags,
 * its cards under it.
 */
export function isSilentReport(
  group: RunGroup,
  turns: readonly Turn[],
): boolean {
  if (group.complete || !isReportRound(group, turns)) return false;
  for (let k = group.memberIndices.length - 1; k >= 0; k -= 1) {
    const turn = turns[group.memberIndices[k]];
    if (turn.role === "agent") return turn.silent === true;
    if (turn.role === "user") return false;
  }
  return false;
}

/** Whether `turns` end in a silent report round (nothing took the
 * round's place, nothing landed to read). */
export function endsInSilentReport(turns: readonly Turn[]): boolean {
  if (!turns.some(isSubtaskReportTurn)) return false;
  const groups = buildRunGroups(turns as Turn[]);
  const last = groups[groups.length - 1];
  return !!last && isSilentReport(last, turns);
}

/** Whether the latest run of `turns` is a report round (a reply to it
 * notifies like a reply the user asked for). */
export function inReportRound(turns: readonly Turn[]): boolean {
  if (!turns.some(isSubtaskReportTurn)) return false;
  const groups = buildRunGroups(turns as Turn[]);
  const last = groups[groups.length - 1];
  return !!last && isReportRound(last, turns);
}

function asksUser(turn: Turn): boolean {
  return (
    turn.role === "agent" && turn.tools.some((tool) => tool.name === "ask_user")
  );
}

/**
 * The indices of the main chat's rows the user never sees as a
 * message: every report row, and the agent turns of a silent report
 * round but its questions. The sidebar card's last message skips them
 * (lib/assistant.ts); the conversation's plan draws none of them
 * (lib/assistant-conversation.ts).
 */
export function hiddenReportTurns(turns: readonly Turn[]): Set<number> {
  const hidden = new Set<number>();
  if (!turns.some(isSubtaskReportTurn)) return hidden;
  for (const group of buildRunGroups(turns as Turn[])) {
    if (!isReportRound(group, turns)) continue;
    hidden.add(group.openerIndex);
    if (!isSilentReport(group, turns)) continue;
    for (const i of group.memberIndices) {
      if (turns[i].role === "agent" && !asksUser(turns[i])) hidden.add(i);
    }
  }
  return hidden;
}
