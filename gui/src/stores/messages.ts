import { create } from "zustand";

import { loadMessagesBySession } from "@/lib/db";
import { logPerf, perfNow } from "@/lib/perf";
import { pendingReplyStepBase } from "@/lib/run-groups";
import type { UserMessagePersistedPayload } from "@/lib/session-send";
import { useSessionsStore } from "@/stores/sessions";
import {
  derivePendingAskUser,
  rowsToTurns,
} from "@/stores/messages/rowsToTurns";
import type {
  AgentTurn,
  MessageAttachment,
  PendingAskUser,
  PendingImageAttachment,
  SendPhase,
  SystemTurn,
  Turn,
  UserTurn,
} from "@/types/conversation";
import type { MessageRow } from "@/types/db";

// ============================================================
// Module-level singletons
// ============================================================
//
// React 19 strict-mode getSnapshot stability rule: every selector
// reading "field for this session, with default" needs the default to
// be a stable reference across renders. Freezing here both signals
// intent (don't mutate) and lets the runtime catch mistakes early.
//
// Exported so call sites in App.tsx can use the same reference as the
// projection default — saves the reader from rebuilding `[]` /
// `{}` on every render.

// Typed as mutable so it slots into existing component prop types
// (Turn[]). Frozen at runtime so accidental
// mutation throws — the freeze is the real safety net, the `readonly`
// modifier was just signalling intent. Empty arrays/objects need an
// `unknown` cast hop because `Object.freeze([])` yields
// `readonly never[]` which doesn't overlap with `Turn[]`.
export const EMPTY_TURNS: Turn[] = Object.freeze([] as Turn[]) as Turn[];

function sessionCompletedTurnCount(sid: string): number {
  return (
    useSessionsStore.getState().sessions.find((session) => session.id === sid)
      ?.turnCount ?? 0
  );
}

// ============================================================
// Per-session conversation state
// ============================================================

/**
 * All per-session conversation state owned by messagesStore.
 *
 * `turnIndexOffset` deserves the long comment — see the docblock on
 * `appendUserTurn` for full rationale. TL;DR: GA's
 * `agent_runner_loop` resets `turn=1` on every `put_task`, so we add
 * this offset when a runner event lacks `absoluteTurnIndex` to keep
 * `msg_${sessionId}_${turnIndex}_assistant` primary keys distinct
 * across consecutive user messages.
 */
export interface PerSessionMessages {
  turns: Turn[];
  agentRunning: boolean;
  currentRunStartedAtMs: number | null;
  currentTurnIndex: number | null;
  inFlightContent: string;
  pendingAskUser: PendingAskUser | null;
  sendPhase: SendPhase | null;
  /**
   * True between the user clicking Stop (abort dispatched to the
   * bridge) and the bridge signalling run_complete / error. Drives
   * the Stop button's "停止中…" acknowledged state so the user sees
   * the click registered and can't fire a second abort into the same
   * run. Cleared together with agentRunning at run end.
   */
  isStopping: boolean;
  /**
   * True while `restoreSessionTurns` is reading this session's turns
   * back from SQLite. Drives the conversation skeleton on cold start
   * into a history session (warm switches never see it — activation
   * defers the active-pointer flip until turns are in memory).
   */
  restoring: boolean;
  turnIndexOffset: number;
  /**
   * Display-step base for the GA loop the latest user turn started:
   * the steps the run already held when that turn was an ask_user
   * reply, 0 when it opened a new run (run-groups
   * `pendingReplyStepBase`, 2026-09-18). GA's per-loop step restarts
   * at 1 on every `put_task`; the turn_start / turn_end handlers add
   * this so the in-flight marker and the sidebar's "第 N 步" continue
   * the run's numbering, matching how settled steps are numbered by
   * position. Known gap: a reply the CLI sends into a session this
   * app launch never loaded restarts at 1 (no turns to count).
   */
  runStepBase: number;
  /**
   * `clientRequestId` of the optimistic send that set the run fields
   * (`agentRunning`, `sendPhase`, …) and still owns them: set by
   * `appendUserTurn`, cleared when Core's broadcast claims the turn or
   * another user row takes the run over. A send Core queued instead
   * (`retractUserTurn`) hands the run state back only while it owns it.
   */
  optimisticRequestId: string | null;
  /**
   * User-voice next-step suggestion from the latest final reply
   * (turn_end.nextSuggestion, managed runtime only). Rendered as
   * composer ghost text while the session is idle; cleared when a new
   * run starts. In-memory only for v1 — an app restart simply starts
   * without ghost text until the next reply.
   */
  nextSuggestion: string | null;
  /**
   * True when the latest run stopped at GA's per-run step cap — its
   * final turn_end carried `exitReason.result === "MAX_TURNS_EXCEEDED"`
   * (#29). Drives MainView's step-limit thread tail while the session
   * is idle. Rewritten on every final visible turn_end; cleared when
   * the user sends or a new run starts (turn_start). In-memory only,
   * like `nextSuggestion`: an app restart drops the tail.
   */
  pausedAtStepLimit: boolean;
}

export const EMPTY_MESSAGES: PerSessionMessages = Object.freeze({
  turns: EMPTY_TURNS,
  agentRunning: false,
  currentRunStartedAtMs: null,
  currentTurnIndex: null,
  inFlightContent: "",
  pendingAskUser: null,
  sendPhase: null,
  isStopping: false,
  restoring: false,
  turnIndexOffset: 0,
  runStepBase: 0,
  optimisticRequestId: null,
  nextSuggestion: null,
  pausedAtStepLimit: false,
}) as PerSessionMessages;

function emptyMessages(): PerSessionMessages {
  // Fresh allocations so callers writing into the result don't mutate
  // the frozen module singleton.
  return {
    turns: [],
    agentRunning: false,
    currentRunStartedAtMs: null,
    currentTurnIndex: null,
    inFlightContent: "",
    pendingAskUser: null,
    sendPhase: null,
    isStopping: false,
    restoring: false,
    turnIndexOffset: 0,
    runStepBase: 0,
    optimisticRequestId: null,
    nextSuggestion: null,
    pausedAtStepLimit: false,
  };
}

// ============================================================
// Store shape
// ============================================================

interface MessagesState {
  byId: Record<string, PerSessionMessages>;
  /**
   * Global monotonic counter incremented every time the user submits
   * a message (via `appendUserTurn` / `applyUserMessagePersisted` /
   * `appendSideQuestionUserTurn`) in ANY session. MainView's
   * stick-to-top scroll effect uses this as a trigger. Lives at the
   * store root rather than per-session because session switching
   * shouldn't fire the scroll effect — the user's intent is "see what
   * I just sent," not "I navigated and want auto-scroll."
   */
  userSubmitTick: number;
}

interface MessagesActions {
  // ---- lifecycle ----
  /** Create an entry for `sid` if missing. Idempotent. */
  ensureMessages: (sid: string) => void;
  /** Drop the entry for `sid`. Called from sessions.deleteSession. */
  clearSessionMessages: (sid: string) => void;
  /**
   * Bridge close-side cleanup. Resets only the streaming/in-flight
   * fields — leaves `turns` intact so the user can still read the
   * conversation while the bridge is down. Called from
   * the runtime bridge slice's onClose handler.
   */
  clearStreamingOnBridgeClose: (sid: string) => void;

  // ---- read path ----
  /**
   * Restore a session's `turns` from SQLite — Stage 3 Task 3 Session
   * Restore. Called by `activateSession` when the runtime is fresh
   * (no in-memory turns yet) and the session has prior turn history
   * on disk. Idempotent: safe to call when there are no rows.
   *
   * Only writes to `byId[sid].turns`; does NOT touch GA
   * `backend.history`. The bridge-side history injection happens in
   * the IPC `ready` handler, which reads the same messages table and
   * sends `load_history` — keeping the two halves decoupled so a
   * bridge crash + respawn re-injects history without needing to
   * touch the UI state.
   */
  restoreSessionTurns: (sid: string) => Promise<void>;

  // ---- conversation writes ----
  /**
   * The optimistic echo of a send this page hands to Core's
   * `send_user_message` (ticket 02c): append the user turn with its
   * images as data URLs, tagged with the send's `clientRequestId`, and
   * show the run as starting (`sendPhase: "saving"`). Nothing is written
   * here — Core persists the row (and derives the seed title) and claims
   * this turn through `applyUserMessagePersisted`.
   */
  appendUserTurn: (
    sid: string,
    text: string,
    clientRequestId: string,
    attachments?: PendingImageAttachment[],
  ) => void;
  /**
   * Take back the optimistic echo of a send Core queued instead (the
   * page thought the session idle, Core found a run open — the queue bar
   * shows it now). Hands the run state back only if that send still
   * owns it. No-op once the turn was claimed.
   */
  retractUserTurn: (sid: string, clientRequestId: string) => void;
  /**
   * Apply Core's `user-message-persisted` for a user row — this page's
   * own sends through `send_user_message`, and rows other writers
   * persisted (CLI / supervisor `session send`, queue drain, Goal):
   *
   *   - a row already shown (same `message.id`) only moves its run state
   *     along (`dispatched` → working; `persisted_only` / `spawn_failed`
   *     → stopped), never back and never twice;
   *   - this page's optimistic echo (same `clientRequestId`) is claimed:
   *     it gets the row id, the persisted image attachments and the
   *     durable `turnIndexOffset` — before Core dispatches, so before any
   *     `turn_start` — and the send moves from "saving" to "starting";
   *   - any other row is appended once, as starting (`pending`), working
   *     (`dispatched`) or stopped.
   *
   * Bumps `userSubmitTick` only for an append into the active session.
   */
  applyUserMessagePersisted: (payload: UserMessagePersistedPayload) => void;
  /**
   * Append a transient user message for `/btw` side questions.
   * Distinct from `appendUserTurn`:
   *   - Doesn't touch agentRunning / inFlightContent /
   *     currentTurnIndex / pendingAskUser — /btw runs in its own
   *     bridge worker; main agent state is untouched
   *   - Doesn't derive sidebar title (/btw isn't a "topic")
   *   - Doesn't persist to SQLite (ephemeral by design)
   * Still bumps `userSubmitTick` so the scroll-to-bottom-anchor
   * effect fires — user wants to see their question appear.
   */
  appendSideQuestionUserTurn: (sid: string, text: string) => void;
  appendAgentTurn: (sid: string, turn: AgentTurn) => void;
  /**
   * Append a non-agent-loop system message (currently from /btw
   * side-question replies; future: /session.x=v confirmations).
   * Distinct from `appendAgentTurn`:
   *   - Doesn't carry tool calls or turn index
   *   - Doesn't affect agentRunning / currentTurnIndex
   *   - Renders with a callout chrome rather than the bare prose
   *     of an agent final answer
   * Transient — no SQLite write for V0.1. See implementation.
   */
  appendSystemTurn: (sid: string, turn: SystemTurn) => void;

  setAgentRunning: (sid: string, running: boolean) => void;
  setCurrentTurnIndex: (sid: string, idx: number | null) => void;
  setSendPhase: (sid: string, phase: SendPhase | null) => void;
  setStopping: (sid: string, stopping: boolean) => void;
  appendInFlightDelta: (sid: string, delta: string) => void;
  clearInFlightContent: (sid: string) => void;
  /**
   * Set / clear the GA-side pending question for a session. `null`
   * clears (typically after the user submits a reply). Drives the
   * Sidebar yellow "⏸ 等你回复" indicator, which each row reads at
   * render time via `useSessionStatusView`.
   */
  setPendingAskUser: (sid: string, value: PendingAskUser | null) => void;
  /**
   * Set / clear the latest final reply's next-step suggestion. Written
   * on every final visible turn_end (null when the reply carried no
   * tag, so stale suggestions never survive a newer reply); cleared
   * when a new run starts.
   */
  setNextSuggestion: (sid: string, value: string | null) => void;
  /**
   * Set / clear the step-limit pause (`pausedAtStepLimit`). Written on
   * every final visible turn_end, cleared on turn_start; user sends
   * clear it inline. No-op when the value is unchanged.
   */
  setPausedAtStepLimit: (sid: string, value: boolean) => void;
  clearConversation: (sid: string) => void;
}

export type MessagesStore = MessagesState & MessagesActions;

// ============================================================
// Internal helpers
// ============================================================

/**
 * Apply an updater to a single session's messages entry. Returns the
 * fields to merge into Zustand state. Sidebar status is derived from
 * this slice at read time (`useSessionStatusView`) — the store no
 * longer pushes a mirror onto the session row.
 */
function patchMessages(
  state: MessagesState,
  sid: string,
  updater: (m: PerSessionMessages) => PerSessionMessages,
): { byId: Record<string, PerSessionMessages>; next: PerSessionMessages } {
  const old = state.byId[sid] ?? emptyMessages();
  const next = updater(old);
  return {
    byId: { ...state.byId, [sid]: next },
    next,
  };
}

type PersistDispatch = NonNullable<UserMessagePersistedPayload["dispatch"]>;

/** Index of the last user turn matching `pred`, or -1. */
function findLastUserTurn(
  turns: Turn[],
  pred: (turn: UserTurn) => boolean,
): number {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.role === "user" && pred(turn)) return i;
  }
  return -1;
}

/** Whether the user turn at `index` opened the latest main-agent run:
 * no main user turn (persisted, or an optimistic send) came after it.
 * `/btw` turns carry neither key and do not count. */
function isLatestRunTurn(turns: Turn[], index: number): boolean {
  for (let i = index + 1; i < turns.length; i += 1) {
    const turn = turns[i];
    if (
      turn.role === "user" &&
      (turn.messageId !== undefined || turn.clientRequestId !== undefined)
    ) {
      return false;
    }
  }
  return true;
}

function isPreDispatchPhase(phase: SendPhase | null): boolean {
  return phase === "saving" || phase === "starting" || phase === "restoring";
}

/**
 * Move a run along for a later broadcast of the row that opened it —
 * forward only: `pending` → starting, `dispatched` → working (unless
 * the runner's own events already took the phase over), a failed start
 * → stopped.
 */
function withDispatch(
  m: PerSessionMessages,
  dispatch: PersistDispatch,
): PerSessionMessages {
  switch (dispatch) {
    case "pending":
      return {
        ...m,
        agentRunning: true,
        currentRunStartedAtMs: m.currentRunStartedAtMs ?? Date.now(),
        sendPhase: m.sendPhase === "saving" ? "starting" : m.sendPhase,
      };
    case "dispatched":
      return m.agentRunning && isPreDispatchPhase(m.sendPhase)
        ? { ...m, sendPhase: "waiting_agent" }
        : m;
    case "persisted_only":
    case "spawn_failed":
      return {
        ...m,
        agentRunning: false,
        currentRunStartedAtMs: null,
        currentTurnIndex: null,
        inFlightContent: "",
        sendPhase: null,
        isStopping: false,
      };
  }
}

function createdAtToMs(createdAt?: string): number | null {
  if (!createdAt) return null;
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : null;
}

// ============================================================
// Store
// ============================================================

export const useMessagesStore = create<MessagesStore>((set, get) => ({
  byId: {},
  userSubmitTick: 0,

  // ---- lifecycle ----

  ensureMessages: (sid) =>
    set((state) =>
      state.byId[sid]
        ? {}
        : { byId: { ...state.byId, [sid]: emptyMessages() } },
    ),

  clearSessionMessages: (sid) =>
    set((state) => {
      if (!state.byId[sid]) return {};
      const byId = { ...state.byId };
      delete byId[sid];
      return { byId };
    }),

  clearStreamingOnBridgeClose: (sid) => {
    const state = get();
    if (!state.byId[sid]) return;
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      agentRunning: false,
      currentRunStartedAtMs: null,
      currentTurnIndex: null,
      inFlightContent: "",
      sendPhase: null,
      isStopping: false,
    }));
    set({ byId });  },

  // ---- read path ----

  restoreSessionTurns: async (sid) => {
    const startedAt = perfNow();
    set({ byId: patchMessages(get(), sid, (m) => ({ ...m, restoring: true })).byId });
    try {
      let rows: MessageRow[];
      try {
        rows = await loadMessagesBySession(sid);
      } catch (e) {
        console.debug("[messages] restoreSessionTurns: SQLite unavailable.", e);
        return;
      }
      logPerf("messages.restoreSessionTurns", startedAt, {
        sessionId: sid,
        rowCount: rows.length,
        completedTurnCount: sessionCompletedTurnCount(sid),
      });
      if (rows.length === 0) return;
      const turns = rowsToTurns(rows);
      const state = get();
      const { byId } = patchMessages(state, sid, (m) => ({
        ...m,
        turns,
        // A restart (or bridge death) while a GA question was pending
        // dropped the transient pendingAskUser — rebuild it from the
        // persisted tool args so the live bubble / chips / sidebar dot
        // come back instead of degrading to the quiet echo. A live
        // in-memory value wins: restore only runs on fresh runtimes,
        // but if a race ever lands one, the IPC event is fresher than
        // the derivation.
        pendingAskUser: m.pendingAskUser ?? derivePendingAskUser(turns),
      }));
      set({ byId });
    } finally {
      set({
        byId: patchMessages(get(), sid, (m) => ({ ...m, restoring: false })).byId,
      });
    }
  },

  // ---- conversation writes ----

  appendUserTurn: (sid, text, clientRequestId, attachments = []) => {
    // `turnIndexOffset` starts as a guess (the completed-turn count) and
    // becomes durable when Core's `pending` broadcast claims this turn,
    // which happens before Core dispatches it.
    //
    // Why an offset: GA's `agent_runner_loop` (agent_loop.py) declares
    // `turn = 0` locally and increments per LLM call within one
    // invocation. Each new `put_task(user_message)` starts a fresh
    // loop, so the very first turn of every user message arrives as
    // `turnIndex=1` — regardless of how many prior turns the
    // session has accumulated. Without the offset, two consecutive
    // user messages each produce an assistant row with the same
    // `msg_${sessionId}_1_assistant` primary key; the SQLite ON
    // CONFLICT UPDATE then silently overwrites the older one.
    // Restore reads back a single assistant covering both turns,
    // manifesting as "the conversation lost some replies and the
    // rest is out of order".
    //
    // For old rows and bridge events that do not carry absoluteTurnIndex,
    // offset = userRowTurnIndex - 1 maps GA step 1 back onto the user row's
    // absolute turn_index (see lib/turn-index.ts).
    const sessionsState = useSessionsStore.getState();
    const currentTurnCount =
      sessionsState.sessions.find((s) => s.id === sid)?.turnCount ?? 0;
    const state = get();
    const optimisticAttachments: MessageAttachment[] = attachments.map((image) => ({
      id: image.id,
      messageId: "",
      sessionId: sid,
      kind: "image",
      path: image.dataUrl,
      mimeType: image.mimeType,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      createdAt: new Date().toISOString(),
    }));
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: [
        ...m.turns,
        {
          role: "user",
          content: text,
          clientRequestId,
          attachments: optimisticAttachments,
          // Send time for the message time label (lib/message-time)
          // until Core's broadcast (or a restore) brings the row's own
          // created_at.
          createdAt: new Date().toISOString(),
        } as UserTurn,
      ],
      // The agent will start running on the bridge shortly. Set
      // synchronously rather than wait for `turn_start` over IPC —
      // the round-trip would re-introduce the latency we're
      // masking with the thinking placeholder.
      agentRunning: true,
      currentRunStartedAtMs: Date.now(),
      inFlightContent: "",
      // Reset currentTurnIndex so the Sidebar's "正在工作 · 第 N 步"
      // doesn't briefly show the last turn's step number before
      // the new agent_runner_loop's turn_start arrives. New
      // message = new loop = step counter restarts at 1.
      currentTurnIndex: null,
      // Any GA-initiated ask_user is by definition answered by
      // this submission — clear the bubble + yellow sidebar dot
      // so the conversation reverts to normal running visuals.
      pendingAskUser: null,
      // New run — the previous reply's ghost suggestion is spent.
      nextSuggestion: null,
      // … and so is the step-limit tail: this send is the "继续".
      pausedAtStepLimit: false,
      sendPhase: "saving",
      isStopping: false,
      turnIndexOffset: currentTurnCount,
      runStepBase: pendingReplyStepBase(m.turns),
      optimisticRequestId: clientRequestId,
    }));
    set({ byId, userSubmitTick: state.userSubmitTick + 1 });
  },

  retractUserTurn: (sid, clientRequestId) => {
    const state = get();
    const m = state.byId[sid];
    if (!m) return;
    const index = findLastUserTurn(
      m.turns,
      (turn) =>
        turn.clientRequestId === clientRequestId &&
        turn.messageId === undefined,
    );
    if (index === -1) return;
    const owned = m.optimisticRequestId === clientRequestId;
    const { byId } = patchMessages(state, sid, (current) => {
      const turns = current.turns.slice();
      turns.splice(index, 1);
      if (!owned) return { ...current, turns };
      // The page thought the session idle when it echoed this send;
      // hand that state back. Core's open run reports through its own
      // events.
      return {
        ...current,
        turns,
        agentRunning: false,
        currentRunStartedAtMs: null,
        currentTurnIndex: null,
        inFlightContent: "",
        sendPhase: null,
        isStopping: false,
        optimisticRequestId: null,
      };
    });
    set({ byId });
  },

  applyUserMessagePersisted: (payload) => {
    const { sessionId: sid, message, clientRequestId } = payload;
    // Older Cores sent no `dispatch`; their rows were dispatched.
    const dispatch: PersistDispatch = payload.dispatch ?? "dispatched";
    const turnIndex =
      typeof message.turnIndex === "number" ? message.turnIndex : null;
    const messageId =
      message.id ??
      (turnIndex !== null ? `msg_${sid}_${turnIndex}_user` : undefined);
    const state = get();
    const turns = state.byId[sid]?.turns ?? EMPTY_TURNS;

    // 1. A row this page already shows: a later broadcast for it (the
    //    second of a send's two), or a restore that read it first.
    const shownAt =
      messageId === undefined
        ? -1
        : findLastUserTurn(turns, (turn) => turn.messageId === messageId);
    if (shownAt !== -1) {
      if (!isLatestRunTurn(turns, shownAt)) return;
      const { byId } = patchMessages(state, sid, (m) =>
        withDispatch(m, dispatch),
      );
      set({ byId });
      return;
    }

    // 2. This page's optimistic echo of it: claim, don't append.
    const ownAt =
      clientRequestId === undefined
        ? -1
        : findLastUserTurn(
            turns,
            (turn) =>
              turn.clientRequestId === clientRequestId &&
              turn.messageId === undefined,
          );
    if (ownAt !== -1) {
      const persistedAttachments = message.attachments ?? [];
      const { byId } = patchMessages(state, sid, (m) => {
        const claimed = m.turns.slice();
        const turn = claimed[ownAt] as UserTurn;
        claimed[ownAt] = {
          ...turn,
          messageId,
          createdAt: message.createdAt ?? turn.createdAt,
          // The data URLs give way to the files Core stored.
          attachments:
            persistedAttachments.length > 0
              ? persistedAttachments
              : turn.attachments,
        };
        return withDispatch(
          {
            ...m,
            turns: claimed,
            // Durable now — and set before Core dispatches, so before
            // the runner's first turn_start.
            turnIndexOffset:
              turnIndex !== null ? turnIndex - 1 : m.turnIndexOffset,
            optimisticRequestId:
              m.optimisticRequestId === clientRequestId
                ? null
                : m.optimisticRequestId,
          },
          dispatch,
        );
      });
      set({ byId });
      return;
    }

    // 3. First sight of a row another writer persisted (or one whose
    //    echo this page no longer holds).
    const currentTurnCount =
      useSessionsStore.getState().sessions.find((s) => s.id === sid)
        ?.turnCount ?? 0;
    const userTurn: UserTurn = { role: "user", content: message.content };
    if (messageId !== undefined) userTurn.messageId = messageId;
    if (message.attachments && message.attachments.length > 0) {
      userTurn.attachments = message.attachments;
    }
    if (message.origin) userTurn.origin = message.origin;
    if (message.createdAt) userTurn.createdAt = message.createdAt;
    if (message.goalId) userTurn.goalId = message.goalId;
    const running = dispatch === "pending" || dispatch === "dispatched";
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: [...m.turns, userTurn],
      agentRunning: running,
      currentRunStartedAtMs: running
        ? (createdAtToMs(message.createdAt) ?? Date.now())
        : null,
      inFlightContent: "",
      currentTurnIndex: null,
      pendingAskUser: null,
      sendPhase:
        dispatch === "pending"
          ? "starting"
          : dispatch === "dispatched"
            ? "waiting_agent"
            : null,
      turnIndexOffset: turnIndex !== null ? turnIndex - 1 : currentTurnCount,
      runStepBase: pendingReplyStepBase(m.turns),
      // This row owns the run state now, not an earlier optimistic echo.
      optimisticRequestId: null,
      nextSuggestion: null,
      pausedAtStepLimit: false,
    }));
    // Only the ACTIVE session's submit moves the viewport: external
    // submits into background sessions (supervisor / CLI / goal
    // workers) used to bump the global tick too, yanking the current
    // conversation to its own last user message with a spurious ack
    // animation.
    const isActiveSession =
      useSessionsStore.getState().activeSessionId === sid;
    set(
      isActiveSession
        ? { byId, userSubmitTick: state.userSubmitTick + 1 }
        : { byId },
    );
  },

  appendSideQuestionUserTurn: (sid, text) => {
    const state = get();
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: [
        ...m.turns,
        // Dated like any user turn so it gets a send time; never
        // persisted, so this client time is its only one.
        {
          role: "user",
          content: text,
          createdAt: new Date().toISOString(),
        } as UserTurn,
      ],
      // Deliberately NOT touching agentRunning / inFlightContent /
      // currentTurnIndex / pendingAskUser — /btw is a side worker
      // path that doesn't interfere with the main agent loop.
    }));
    set({ byId, userSubmitTick: state.userSubmitTick + 1 });  },

  appendAgentTurn: (sid, turn) => {
    const state = get();
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: [...m.turns, turn],
      // turn_end is per-step inside GA's agent_runner_loop, NOT the
      // terminal signal — a single user message can produce 20+
      // turn_end events before the run actually exits. Keep
      // agentRunning true so the sidebar stays on "正在工作 · 第 N
      // 步" and the main view keeps showing the thinking placeholder
      // / streaming partial across step boundaries. Only
      // `run_complete` / `error` / bridge `onClose` flip it false.
      // currentTurnIndex clears so the brief gap between this
      // turn_end and the next turn_start renders as generic
      // "正在工作…" / "思考中…" instead of stale "第 N 步".
      currentTurnIndex: null,
      // Finalised turn replaces the streaming buffer.
      inFlightContent: "",
      sendPhase: null,
    }));
    set({ byId });  },

  appendSystemTurn: (sid, turn) => {
    // Transient append — no DB persistence for V0.1. The /btw side
    // question + reply are ephemeral by design ("不打断主任务" 已经
    // 暗示了"不进入主线"). On session reopen the /btw exchange is
    // gone from view — consistent with the "side, not main" mental
    // model. If users complain in dogfood we promote to persisted
    // (messages.role='system' rows + rowsToTurns handling).
    //
    // Also intentionally NOT touching agentRunning / currentTurnIndex
    // — /btw runs in its own worker, doesn't drive the main agent's
    // running state.
    const state = get();
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: [...m.turns, turn],
    }));
    set({ byId });  },

  setAgentRunning: (sid, running) => {
    const state = get();
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      agentRunning: running,
      currentRunStartedAtMs: running
        ? (m.currentRunStartedAtMs ?? Date.now())
        : null,
      sendPhase: running ? m.sendPhase : null,
      // run_complete / error / bridge-close all land here as the run's
      // terminal signal — clear isStopping in lockstep so a finished
      // (or aborted-then-finished) run never leaves the button stuck.
      isStopping: running ? m.isStopping : false,
    }));
    set({ byId });  },

  setCurrentTurnIndex: (sid, idx) => {
    const state = get();
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      currentTurnIndex: idx,
      sendPhase: idx !== null ? null : m.sendPhase,
    }));
    set({ byId });  },

  setSendPhase: (sid, phase) => {
    const state = get();
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      sendPhase: phase,
    }));
    set({ byId });  },

  setStopping: (sid, stopping) => {
    const state = get();
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      isStopping: stopping,
    }));
    set({ byId });  },

  setNextSuggestion: (sid, value) => {
    const state = get();
    const { byId } = patchMessages(state, sid, (m) =>
      m.nextSuggestion === value ? m : { ...m, nextSuggestion: value },
    );
    set({ byId });
  },

  setPausedAtStepLimit: (sid, value) => {
    const state = get();
    // turn_start calls this on every step; skip the store write when
    // nothing changes (also avoids minting an entry just to say false).
    if ((state.byId[sid]?.pausedAtStepLimit ?? false) === value) return;
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      pausedAtStepLimit: value,
    }));
    set({ byId });
  },

  appendInFlightDelta: (sid, delta) => {
    // HOT PATH — streaming `turn_progress`. N7 perf baseline measured
    // 1.42 ev/s for long prompts, so Zustand single-field set without
    // 16ms batching keeps React re-renders well within budget. See
    // [B3-M5-sub-plan §3 T5.3] for why we don't introduce a Rust-side
    // batch here (B3-I4 守 Rust 端不动).
    const state = get();
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      inFlightContent: m.inFlightContent + delta,
      sendPhase: null,
    }));
    set({ byId });  },

  clearInFlightContent: (sid) => {
    const state = get();
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      inFlightContent: "",
    }));
    set({ byId });  },

  setPendingAskUser: (sid, value) => {
    const state = get();
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      pendingAskUser: value,
    }));
    set({ byId });  },

  clearConversation: (sid) => {
    const state = get();
    const { byId } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: [],
      agentRunning: false,
      currentRunStartedAtMs: null,
      currentTurnIndex: null,
      inFlightContent: "",
      sendPhase: null,
      pausedAtStepLimit: false,
    }));
    set({ byId });  },
}));

// Expose the store on `window.__messagesStore` in dev so the user can
// inspect / mutate state from the DevTools console.
if (import.meta.env.DEV) {
  (
    globalThis as { __messagesStore?: typeof useMessagesStore }
  ).__messagesStore = useMessagesStore;
}
