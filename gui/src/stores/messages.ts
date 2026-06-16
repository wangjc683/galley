import { create } from "zustand";

import {
  loadMessagesBySession,
  persistToolEventApprovalDecision,
  persistUserMessage,
} from "@/lib/db";
import { logPerf, perfNow } from "@/lib/perf";
import { deriveSessionStatus } from "@/lib/sessions";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { rowsToTurns } from "@/stores/messages/rowsToTurns";
import type {
  AgentTurn,
  ConversationToolEvent,
  MessageAttachment,
  Origin,
  PendingApproval,
  PendingAskUser,
  PendingImageAttachment,
  SendPhase,
  SystemTurn,
  Turn,
  UserTurn,
} from "@/types/conversation";
import type { MessageRow } from "@/types/db";
import type { ApprovalDecision } from "@/types/ipc";

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

// Typed as mutable so they slot into existing component prop types
// (Turn[] / PendingApproval[]). Frozen at runtime so accidental
// mutation throws — the freeze is the real safety net, the `readonly`
// modifier was just signalling intent. Empty arrays/objects need an
// `unknown` cast hop because `Object.freeze([])` yields
// `readonly never[]` which doesn't overlap with `Turn[]`.
export const EMPTY_TURNS: Turn[] = Object.freeze([] as Turn[]) as Turn[];
export const EMPTY_APPROVALS: PendingApproval[] = Object.freeze(
  [] as PendingApproval[],
) as PendingApproval[];
export const EMPTY_DECISIONS: Record<string, ApprovalDecision> = Object.freeze(
  {} as Record<string, ApprovalDecision>,
) as Record<string, ApprovalDecision>;

type MessageRowsCacheEntry = {
  completedTurnCount: number;
  rows: MessageRow[];
};

const _messageRowsCache = new Map<string, MessageRowsCacheEntry>();

function sessionCompletedTurnCount(sid: string): number {
  return (
    useSessionsStore.getState().sessions.find((session) => session.id === sid)
      ?.turnCount ?? 0
  );
}

export function rememberMessageRowsForSession(
  sid: string,
  rows: MessageRow[],
  completedTurnCount: number = sessionCompletedTurnCount(sid),
): void {
  _messageRowsCache.set(sid, {
    completedTurnCount,
    rows: rows.slice(),
  });
}

export function getCachedMessageRowsForSession(
  sid: string,
  completedTurnCount: number,
): MessageRow[] | null {
  const cached = _messageRowsCache.get(sid);
  if (!cached || cached.completedTurnCount !== completedTurnCount) {
    return null;
  }
  return cached.rows.slice();
}

export function invalidateMessageRowsCache(sid: string): void {
  _messageRowsCache.delete(sid);
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
  pendingApprovals: PendingApproval[];
  agentRunning: boolean;
  currentTurnIndex: number | null;
  inFlightContent: string;
  approvalDecisions: Record<string, ApprovalDecision>;
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
  turnIndexOffset: number;
  lastUserPersistRequestId: number;
}

export const EMPTY_MESSAGES: PerSessionMessages = Object.freeze({
  turns: EMPTY_TURNS,
  pendingApprovals: EMPTY_APPROVALS,
  agentRunning: false,
  currentTurnIndex: null,
  inFlightContent: "",
  approvalDecisions: EMPTY_DECISIONS,
  pendingAskUser: null,
  sendPhase: null,
  isStopping: false,
  turnIndexOffset: 0,
  lastUserPersistRequestId: 0,
}) as PerSessionMessages;

function emptyMessages(): PerSessionMessages {
  // Fresh allocations so callers writing into the result don't mutate
  // the frozen module singleton.
  return {
    turns: [],
    pendingApprovals: [],
    agentRunning: false,
    currentTurnIndex: null,
    inFlightContent: "",
    approvalDecisions: {},
    pendingAskUser: null,
    sendPhase: null,
    isStopping: false,
    turnIndexOffset: 0,
    lastUserPersistRequestId: 0,
  };
}

// ============================================================
// Store shape
// ============================================================

interface MessagesState {
  byId: Record<string, PerSessionMessages>;
  /**
   * Global monotonic counter incremented every time the user submits
   * a message (via `appendUserTurn` / `appendUserTurnExternal` /
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
   * fields — leaves `turns` / `pendingApprovals` / `approvalDecisions`
   * intact so the user can still read the conversation while the
   * bridge is down. Called from runtimeStore.spawnBridge onClose.
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
  appendUserTurn: (
    sid: string,
    text: string,
    attachments?: PendingImageAttachment[],
  ) => Promise<PersistedUserTurn>;
  /**
   * Append a user turn that was persisted out-of-band by Rust core
   * (`socket_listener::dispatch_session_send`). Skips the SQLite write
   * that `appendUserTurn` does because the row is already in DB.
   * Triggered by the `user-message-persisted` Tauri event whenever CLI
   * / supervisor agents call `galley session send`.
   *
   * Otherwise close to `appendUserTurn`: appends a UserTurn, sets
   * `agentRunning=true` only when the bridge has been dispatched, bumps
   * `userSubmitTick` so the conversation scrolls to the new message,
   * derives the sidebar title on first message.
   */
  appendUserTurnExternal: (
    sid: string,
    text: string,
    origin?: Origin,
    createdAt?: string,
    dispatched?: boolean,
    turnIndex?: number | null,
  ) => void;
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
   * clears (typically after the user submits a reply). Also lights
   * up the Sidebar yellow "⏸ 等你回复" indicator via the session row
   * mirror written in `fireSessionMirror`.
   */
  setPendingAskUser: (sid: string, value: PendingAskUser | null) => void;
  clearConversation: (sid: string) => void;

  // ---- approval writes ----
  addPendingApproval: (sid: string, p: PendingApproval) => void;
  removePendingApproval: (sid: string, approvalId: string) => void;
  recordApprovalDecision: (
    sid: string,
    approvalId: string,
    decision: ApprovalDecision,
  ) => void;
  recordApprovalDecisionLocal: (
    sid: string,
    approvalId: string,
    decision: ApprovalDecision,
  ) => void;
  upsertToolEvent: (
    sid: string,
    tool: ConversationToolEvent,
    turnIndex?: number,
    summary?: string,
  ) => void;
}

export type MessagesStore = MessagesState & MessagesActions;

export interface PersistedUserTurn {
  turnIndex: number;
  attachments: MessageAttachment[];
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Apply an updater to a single session's messages entry. Returns the
 * fields to merge into Zustand state. The caller fires the session
 * row mirror separately (see `fireSessionMirror`) — keeping mirror
 * dispatch outside `set` preserves Zustand's single-update semantics
 * and avoids re-entrant store writes.
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

/**
 * Sync sidebar-visible fields (status, pendingApprovalCount,
 * hasPendingAskUser) onto the session row in sessionsStore. Called by
 * messagesStore actions after a `set` that touched any of the fields
 * `deriveSessionStatus` reads.
 *
 * Pulls bridgeStatus from runtimeStore because `deriveSessionStatus`
 * needs it for the `spawning` / `error` short-circuit; the session
 * row itself doesn't carry bridge status (it's not persisted state).
 */
function fireSessionMirror(sid: string, next: PerSessionMessages): void {
  const sessionsState = useSessionsStore.getState();
  const session = sessionsState.sessions.find((s) => s.id === sid);
  if (!session) return;
  const bridgeStatus = useRuntimeStore.getState().byId[sid]?.bridgeStatus;
  const status = deriveSessionStatus(session, next, bridgeStatus);
  sessionsState.applyDerivedFromRuntime(sid, {
    status,
    pendingApprovalCount: next.pendingApprovals.length,
    hasPendingAskUser: next.pendingAskUser !== null,
  });
}

function replaceLastPendingUserAttachments(
  turns: Turn[],
  content: string,
  attachments: MessageAttachment[],
): Turn[] {
  if (attachments.length === 0) return turns;
  const next = turns.slice();
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const turn = next[i];
    if (turn.role !== "user") continue;
    if (turn.content !== content) break;
    next[i] = { ...turn, attachments };
    return next;
  }
  return turns;
}

function upsertToolInTurns(
  turns: Turn[],
  tool: ConversationToolEvent,
  turnIndex?: number,
  summary?: string,
): Turn[] {
  const next = turns.slice();
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const turn = next[i];
    if (turn.role !== "agent") continue;
    if (turnIndex !== undefined && turn.turnIndex !== turnIndex) continue;
    const tools = turn.tools.slice();
    const existing = tools.findIndex(
      (item) => item.id === tool.id || item.approvalId === tool.approvalId,
    );
    if (existing >= 0) {
      tools[existing] = { ...tools[existing], ...tool };
    } else {
      tools.push(tool);
    }
    next[i] = { ...turn, tools };
    return next;
  }
  next.push({
    role: "agent",
    tools: [tool],
    finalAnswer: null,
    turnIndex,
    summary,
  } as AgentTurn);
  return next;
}

function appendOrReplaceAgentTurn(turns: Turn[], turn: AgentTurn): Turn[] {
  if (typeof turn.turnIndex === "number") {
    const existing = turns.findIndex(
      (item) => item.role === "agent" && item.turnIndex === turn.turnIndex,
    );
    if (existing >= 0) {
      const next = turns.slice();
      next[existing] = turn;
      return next;
    }
  }
  return [...turns, turn];
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
      invalidateMessageRowsCache(sid);
      if (!state.byId[sid]) return {};
      const byId = { ...state.byId };
      delete byId[sid];
      return { byId };
    }),

  clearStreamingOnBridgeClose: (sid) => {
    const state = get();
    if (!state.byId[sid]) return;
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      agentRunning: false,
      currentTurnIndex: null,
      inFlightContent: "",
      sendPhase: null,
      isStopping: false,
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  // ---- read path ----

  restoreSessionTurns: async (sid) => {
    const startedAt = perfNow();
    let rows: MessageRow[];
    try {
      rows = await loadMessagesBySession(sid);
    } catch (e) {
      console.debug("[messages] restoreSessionTurns: SQLite unavailable.", e);
      return;
    }
    rememberMessageRowsForSession(sid, rows);
    logPerf("messages.restoreSessionTurns", startedAt, {
      sessionId: sid,
      rowCount: rows.length,
      completedTurnCount: sessionCompletedTurnCount(sid),
    });
    if (rows.length === 0) return;
    const turns = rowsToTurns(rows);
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({ ...m, turns }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  // ---- conversation writes ----

  appendUserTurn: (sid, text, attachments = []) => {
    // Optimistically snapshot turnCount before any state mutation. Core is
    // still the authority for the durable turn_index; this value is only the
    // temporary UI offset until persistUserMessage returns the real row.
    //
    // Why: GA's `agent_runner_loop` (agent_loop.py) declares
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
    // absolute turn_index. Core now returns that userRowTurnIndex after the
    // write; until then, currentTurnCount remains the best visual guess.
    const sessionsState = useSessionsStore.getState();
    const currentTurnCount =
      sessionsState.sessions.find((s) => s.id === sid)?.turnCount ?? 0;
    const state = get();
    const persistRequestId = state.userSubmitTick + 1;
    const optimisticAttachments: MessageAttachment[] = attachments.map(
      (image) => ({
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
      }),
    );
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: [
        ...m.turns,
        {
          role: "user",
          content: text,
          attachments: optimisticAttachments,
        } as UserTurn,
      ],
      // The agent will start running on the bridge shortly. Set
      // synchronously rather than wait for `turn_start` over IPC —
      // the round-trip would re-introduce the latency we're
      // masking with the thinking placeholder.
      agentRunning: true,
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
      sendPhase: "saving",
      isStopping: false,
      turnIndexOffset: currentTurnCount,
      lastUserPersistRequestId: persistRequestId,
    }));
    set({ byId, userSubmitTick: state.userSubmitTick + 1 });
    fireSessionMirror(sid, next);
    // Derive a Sidebar title from the first user message — but only
    // once, and only when the row is still wearing the seed "新对话"
    // placeholder. sessionsStore handles the trim / fallback / Rust
    // persist; this call is a no-op when the title has been edited.
    useSessionsStore.getState().maybeDeriveTitle(sid, text);
    // Persist the user message to SQLite for Session Restore. Core assigns
    // the durable turn_index and returns it so the runner command can carry
    // the same absoluteTurnIndex.
    return persistUserMessage({
      sessionId: sid,
      content: text,
      attachments,
    }).then((message) => {
      const persistedTurnIndex =
        typeof message.turnIndex === "number" ? message.turnIndex : null;
      if (persistedTurnIndex === null) {
        throw new Error("Core did not return a durable turnIndex.");
      }
      const persistedOffset = persistedTurnIndex - 1;
      const persistedAttachments = message.attachments ?? [];
      const latest = get();
      const latestMessages = latest.byId[sid];
      if (
        persistedOffset !== currentTurnCount &&
        latestMessages?.lastUserPersistRequestId === persistRequestId
      ) {
        const { byId: adjusted } = patchMessages(latest, sid, (m) => ({
          ...m,
          turns: replaceLastPendingUserAttachments(
            m.turns,
            text,
            persistedAttachments,
          ),
          turnIndexOffset: persistedOffset,
          sendPhase: m.sendPhase === "saving" ? "starting" : m.sendPhase,
        }));
        set({ byId: adjusted });
      } else if (
        latestMessages?.lastUserPersistRequestId === persistRequestId
      ) {
        const { byId: adjusted } = patchMessages(latest, sid, (m) => ({
          ...m,
          turns: replaceLastPendingUserAttachments(
            m.turns,
            text,
            persistedAttachments,
          ),
          sendPhase: m.sendPhase === "saving" ? "starting" : m.sendPhase,
        }));
        set({ byId: adjusted });
      }
      return {
        turnIndex: persistedTurnIndex,
        attachments: persistedAttachments,
      };
    });
  },

  appendUserTurnExternal: (
    sid,
    text,
    origin,
    createdAt,
    dispatched = true,
    turnIndex,
  ) => {
    // Mirror of appendUserTurn — see that action's comments for
    // rationale on each field. Difference: skips `persistUserMessage`
    // because Rust already wrote the row before emitting
    // `user-message-persisted`. Carries the Origin triple through from
    // the socket envelope (B4 M7) so MessageUser can render the
    // supervisor provenance marker in the live path the same way
    // rowsToTurns reconstructs it on restore.
    const currentTurnCount =
      useSessionsStore.getState().sessions.find((s) => s.id === sid)
        ?.turnCount ?? 0;
    const offset =
      typeof turnIndex === "number" ? turnIndex - 1 : currentTurnCount;
    const userTurn: UserTurn = { role: "user", content: text };
    if (origin) userTurn.origin = origin;
    if (createdAt) userTurn.createdAt = createdAt;
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: [...m.turns, userTurn],
      agentRunning: dispatched,
      inFlightContent: "",
      currentTurnIndex: null,
      pendingAskUser: null,
      sendPhase: dispatched ? "waiting_agent" : null,
      turnIndexOffset: offset,
      lastUserPersistRequestId: 0,
    }));
    set({ byId, userSubmitTick: state.userSubmitTick + 1 });
    fireSessionMirror(sid, next);
    useSessionsStore.getState().maybeDeriveTitle(sid, text);
  },

  appendSideQuestionUserTurn: (sid, text) => {
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: [...m.turns, { role: "user", content: text } as UserTurn],
      // Deliberately NOT touching agentRunning / inFlightContent /
      // currentTurnIndex / pendingAskUser — /btw is a side worker
      // path that doesn't interfere with the main agent loop.
    }));
    set({ byId, userSubmitTick: state.userSubmitTick + 1 });
    fireSessionMirror(sid, next);
  },

  appendAgentTurn: (sid, turn) => {
    invalidateMessageRowsCache(sid);
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: appendOrReplaceAgentTurn(m.turns, turn),
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
    set({ byId });
    fireSessionMirror(sid, next);
  },

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
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: [...m.turns, turn],
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  setAgentRunning: (sid, running) => {
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      agentRunning: running,
      sendPhase: running ? m.sendPhase : null,
      // run_complete / error / bridge-close all land here as the run's
      // terminal signal — clear isStopping in lockstep so a finished
      // (or aborted-then-finished) run never leaves the button stuck.
      isStopping: running ? m.isStopping : false,
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  setCurrentTurnIndex: (sid, idx) => {
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      currentTurnIndex: idx,
      sendPhase: idx !== null ? null : m.sendPhase,
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  setSendPhase: (sid, phase) => {
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      sendPhase: phase,
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  setStopping: (sid, stopping) => {
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      isStopping: stopping,
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  appendInFlightDelta: (sid, delta) => {
    // HOT PATH — streaming `turn_progress`. N7 perf baseline measured
    // 1.42 ev/s for long prompts, so Zustand single-field set without
    // 16ms batching keeps React re-renders well within budget. See
    // [B3-M5-sub-plan §3 T5.3] for why we don't introduce a Rust-side
    // batch here (B3-I4 守 Rust 端不动).
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      inFlightContent: m.inFlightContent + delta,
      sendPhase: null,
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  clearInFlightContent: (sid) => {
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      inFlightContent: "",
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  setPendingAskUser: (sid, value) => {
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      pendingAskUser: value,
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  clearConversation: (sid) => {
    invalidateMessageRowsCache(sid);
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: [],
      pendingApprovals: [],
      approvalDecisions: {},
      agentRunning: false,
      currentTurnIndex: null,
      inFlightContent: "",
      sendPhase: null,
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  // ---- approval writes ----

  addPendingApproval: (sid, p) => {
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      // de-dupe on approvalId so a re-emitted pending event doesn't
      // create twin entries
      pendingApprovals: [
        ...m.pendingApprovals.filter((x) => x.approvalId !== p.approvalId),
        p,
      ],
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  removePendingApproval: (sid, approvalId) => {
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      pendingApprovals: m.pendingApprovals.filter(
        (x) => x.approvalId !== approvalId,
      ),
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  recordApprovalDecision: (sid, approvalId, decision) => {
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      approvalDecisions: { ...m.approvalDecisions, [approvalId]: decision },
    }));
    set({ byId });
    fireSessionMirror(sid, next);
    // Best-effort Core DB write for the approval audit trail.
    // The matching `pending` row was written when tool_call_pending
    // arrived (see ipc-handlers.persistToolEventPendingFromIPC); this
    // update fills in approval_decision + terminal status.
    void persistToolEventApprovalDecision(
      approvalId,
      decision,
      new Date().toISOString(),
    ).catch((e) => {
      console.debug("[messages] persistToolEventApprovalDecision failed.", e);
    });
  },

  recordApprovalDecisionLocal: (sid, approvalId, decision) => {
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      approvalDecisions: { ...m.approvalDecisions, [approvalId]: decision },
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },

  upsertToolEvent: (sid, tool, turnIndex, summary) => {
    invalidateMessageRowsCache(sid);
    const state = get();
    const { byId, next } = patchMessages(state, sid, (m) => ({
      ...m,
      turns: upsertToolInTurns(m.turns, tool, turnIndex, summary),
    }));
    set({ byId });
    fireSessionMirror(sid, next);
  },
}));

// Expose the store on `window.__messagesStore` in dev so the user can
// inspect / mutate state from the DevTools console.
if (import.meta.env.DEV) {
  (
    globalThis as { __messagesStore?: typeof useMessagesStore }
  ).__messagesStore = useMessagesStore;
}
