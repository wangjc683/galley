/**
 * IPC Protocol v0.1 — desktop-side TypeScript mirror of bridge/ipc.py.
 *
 * Wire format reference: docs/ipc-protocol.md.
 * Every field uses camelCase to match the JSON Lines payload directly.
 *
 * KEEP IN SYNC: when bridge/ipc.py changes, update this file in the same
 * commit. The protocol doc is the source of truth; both Python dataclasses
 * and these TS types implement it.
 */

export const PROTOCOL_VERSION = "0.1";

// ---------------- Shared shapes ----------------

export type MessageVisibility = "visible" | "internal";

export interface LLMInfo {
  index: number;
  /** Raw "ClassName/model" from GA */
  name: string;
  /** Runtime-mode display label for UI */
  displayName: string;
  isCurrent: boolean;
}

export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolResult {
  toolUseId?: string;
  content?: unknown;
  [key: string]: unknown;
}

export interface ExitReason {
  /**
   * `MAX_TURNS_EXCEEDED`: GA stopped the run at its per-run step cap
   * (`data: { maxTurns }`); the final turn_end and run_complete both
   * carry it (#29). `DONE_WITHOUT_EXIT`: the bridge's safety net for a
   * loop that ended without reporting an exit — arrives on run_complete
   * only, with no final turn_end before it (`data: null`).
   */
  result:
    | "CURRENT_TASK_DONE"
    | "EXITED"
    | "MAX_TURNS_EXCEEDED"
    | "DONE_WITHOUT_EXIT"
    | "ABORTED"
    | string;
  data: unknown;
}

export interface TurnTelemetry {
  elapsedMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreateTokens?: number | null;
  cacheReadTokens?: number | null;
  requestCount?: number | null;
  contextUsedChars?: number | null;
  contextLimitChars?: number | null;
}

export interface ConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ConversationContentBlock[];
  images?: string[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export type ConversationContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

// ---------------- Events (bridge → desktop) ----------------

export interface ReadyEvent {
  kind: "ready";
  sessionId: string;
  protocolVersion: string;
  /** Full SHA-1 hash from `git rev-parse HEAD` of the user's GA repo.
   * `"unknown"` when ga_path isn't a git checkout. */
  gaCommit: string;
  /** ISO 8601 commit date of the GA HEAD. `"unknown"` when not a git
   * checkout. Pairs with gaCommit for the Settings → Runtime version
   * row + baseline comparison. */
  gaCommitDate: string;
  gaPath: string;
  llmName: string;
  cwd: string;
  pid: number;
  availableLLMs: LLMInfo[];
  /** Whether the active model backend can receive image content blocks.
   * Absent on older runners that predate the capability report — read it
   * as `?? true` so the composer keeps accepting images. */
  imagesSupported?: boolean;
  /** Reasoning effort actually in force on the active backend after the
   * runner replayed the session override. Absent / null = no parameter
   * is sent and the provider decides. */
  reasoningEffort?: string | null;
  /** The tier the model configuration itself carries, read before the
   * override was replayed — lets the composer tell "deviating from the
   * model" from "following it". Absent / null = the model sets none. */
  configuredReasoningEffort?: string | null;
  timestamp: string;
}

export interface TurnStartEvent {
  kind: "turn_start";
  sessionId: string;
  turnIndex: number;
  visibility?: MessageVisibility;
  timestamp: string;
}

export interface ToolCallStartEvent {
  kind: "tool_call_start";
  sessionId: string;
  toolCallId: string;
  turnIndex: number;
  absoluteTurnIndex?: number | null;
  toolName: string;
  args: Record<string, unknown>;
  argsPreview: string;
  timestamp: string;
}

export interface ToolCallEndEvent {
  kind: "tool_call_end";
  sessionId: string;
  toolCallId: string;
  status: "success" | "failed" | "denied" | "cancelled";
  resultPreview: string;
  elapsedMs: number;
  timestamp: string;
}

export interface ToolCallProgressEvent {
  kind: "tool_call_progress";
  sessionId: string;
  toolCallId: string;
  text: string;
  timestamp: string;
}

export interface TurnEndEvent {
  kind: "turn_end";
  sessionId: string;
  turnIndex: number;
  summary: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  responseContent: string;
  /**
   * GA's `response.thinking` for this step: the model's native
   * reasoning (OpenAI-compatible `reasoning_content` and the like), or
   * a prompted `<thinking>` block GA moved out of `responseContent`.
   * Absent when the step had no reasoning. The settled turn's
   * `thinking` (the DetailPanel behind the step caret, persisted to the
   * `thinking` column) prefers it over the `<thinking>` tag still
   * extracted from `responseContent` for older runtimes. While the step
   * streams the same reasoning arrives in-band on `turn_progress`,
   * wrapped in `<thinking>…</thinking>`.
   */
  responseThinking?: string | null;
  exitReason: ExitReason | null;
  telemetry?: TurnTelemetry | null;
  visibility?: MessageVisibility;
  absoluteTurnIndex?: number | null;
  /**
   * User-voice next-step suggestion from the final answer's
   * `<next-suggestion>` tag (managed runtime only). Present only on the
   * final turn_end of a run, and only when the model emitted the tag.
   * Rendered as composer ghost text — never as answer prose.
   */
  nextSuggestion?: string | null;
  timestamp: string;
}

/**
 * LLM streaming partial. The bridge subscribes to GA's display_queue
 * and forwards each chunk; desktop accumulates `delta` into
 * `inFlightContent` and re-renders the in-flight reply mid-turn.
 *
 * `delta` is GA-raw — still contains <thinking>/<summary>/
 * <tool_use>/<file_content> tags. Desktop strips them at render
 * time, with robust handling of unclosed tags at the partial's tail.
 * Native reasoning streams in-band as `<thinking>…</thinking>` (managed
 * runtime; a literal close tag inside it arrives as `</ thinking>`) —
 * MainView renders it as the live thinking preview, not answer prose.
 */
export interface TurnProgressEvent {
  kind: "turn_progress";
  sessionId: string;
  delta: string;
  source: string;
  visibility?: MessageVisibility;
  timestamp: string;
}

export interface AskUserEvent {
  kind: "ask_user";
  sessionId: string;
  question: string;
  candidates: string[];
  timestamp: string;
}

export interface RunCompleteEvent {
  kind: "run_complete";
  sessionId: string;
  exitReason: ExitReason;
  finalContent: string;
  totalTurns: number;
  visibility?: MessageVisibility;
  timestamp: string;
}

/**
 * Structured error event. See docs/ipc-protocol.md §4.10 for the contract.
 *
 * Desktop renders by `category`:
 *   - "runtime"  → conversation inline message bubble
 *   - "bridge"   → top-level toast
 *   - "business" → top-level toast
 *
 * `hint` (when present) maps to a tailored Error Card variant per
 * DESIGN.md §6.2:
 *   - "check_llm_config" — auth / api_key issues
 *   - "network"          — timeout / DNS / connection refused
 *   - "quota_exceeded"   — 429 / rate limits
 */
export interface ErrorEvent {
  kind: "error";
  sessionId: string;
  message: string;
  category: "bridge" | "runtime" | "business";
  severity: "error" | "warning" | "info";
  retryable: boolean;
  hint: "check_llm_config" | "network" | "quota_exceeded" | null;
  context: string | null;
  traceback: string | null;
  visibility?: MessageVisibility;
  timestamp: string;
}

export interface HistoryLoadedEvent {
  kind: "history_loaded";
  sessionId: string;
  messageCount: number;
  timestamp: string;
}

export interface LLMChangedEvent {
  kind: "llm_changed";
  sessionId: string;
  index: number;
  name: string;
  displayName: string;
  /** Same capability report as {@link ReadyEvent.imagesSupported} —
   * re-sent because switching the LLM can change what the backend takes. */
  imagesSupported?: boolean;
  /** Same pair as on {@link ReadyEvent} — re-sent because the override
   * was replayed onto the new backend and its configured tier may
   * differ from the previous model's. */
  reasoningEffort?: string | null;
  configuredReasoningEffort?: string | null;
  timestamp: string;
}

/**
 * Runner confirmation that a `set_reasoning_effort` command landed on
 * the active backend. Carries the same pair as {@link ReadyEvent} so the
 * composer row can re-derive its highlight from one shape.
 */
export interface ReasoningEffortChangedEvent {
  kind: "reasoning_effort_changed";
  sessionId: string;
  reasoningEffort?: string | null;
  configuredReasoningEffort?: string | null;
  timestamp: string;
}

/**
 * Standalone, non-agent-loop conversation message. Emitted by the
 * bridge when GA's slash-command paths (`/btw`, `/session.x=v`) push
 * a `done` payload to display_queue with `source='system'` — those
 * paths bypass agent_runner_loop, so no turn_end carries the reply.
 *
 * `content` is markdown source — desktop renders through the same
 * pipeline as agent final answers but wraps in a callout chrome
 * matching `variant`.
 *
 * `variant`:
 *   - "side_question": `/btw` reply — yellow callout (AskUserBubble
 *     color family)
 *   - "system": catch-all confirmations — neutral muted register
 */
export interface SystemMessageEvent {
  kind: "system_message";
  sessionId: string;
  content: string;
  variant: "side_question" | "system";
  timestamp: string;
}

/**
 * LLM-generated session title (auto-title, `generate_title` command).
 * Consumed by Core's watcher — it CAS-writes the DB and mirrors the
 * result through `session-updated-external`, so the GUI's runner-event
 * dispatcher deliberately ignores this kind.
 */
export interface TitleGeneratedEvent {
  kind: "title_generated";
  sessionId: string;
  title: string;
  timestamp: string;
}

export type IPCEvent =
  | ReadyEvent
  | TurnStartEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | ToolCallProgressEvent
  | TurnEndEvent
  | TurnProgressEvent
  | AskUserEvent
  | RunCompleteEvent
  | ErrorEvent
  | HistoryLoadedEvent
  | LLMChangedEvent
  | ReasoningEffortChangedEvent
  | TitleGeneratedEvent
  | SystemMessageEvent;

// ---------------- Commands (desktop → bridge) ----------------

export interface UserMessageCommand {
  kind: "user_message";
  text: string;
  images?: string[];
  visibility?: MessageVisibility;
  absoluteTurnIndex?: number | null;
}

export interface AskUserResponseCommand {
  kind: "ask_user_response";
  text: string;
  absoluteTurnIndex?: number | null;
}

export interface AbortCommand {
  kind: "abort";
}

export interface LoadHistoryCommand {
  kind: "load_history";
  messages: ConversationMessage[];
}

export interface SetLLMCommand {
  kind: "set_llm";
  llmIndex: number;
}

/**
 * Set or clear this session's reasoning-effort override. Sent by
 * Galley Core only (the GUI calls the Tauri command
 * `set_session_reasoning_effort`, Core persists and forwards) —
 * mirrored here because this file is the ts surface of the full wire
 * protocol. `value` is a tier or `null` (= follow the model
 * configuration); the bridge answers with `reasoning_effort_changed`.
 */
export interface SetReasoningEffortCommand {
  kind: "set_reasoning_effort";
  value: string | null;
}

export interface ShutdownCommand {
  kind: "shutdown";
}

/**
 * Ask the bridge for a short LLM-generated session title. Sent by
 * Galley Core's auto-title watcher, never by the GUI — mirrored here
 * because this file is the ts surface of the full wire protocol. The
 * prompt context travels in the command (Core owns the message store);
 * the bridge answers with one out-of-band `backend.raw_ask`.
 */
export interface GenerateTitleCommand {
  kind: "generate_title";
  firstUserMessage: string;
  finalAnswer?: string;
}

export type IPCCommand =
  | UserMessageCommand
  | AskUserResponseCommand
  | AbortCommand
  | LoadHistoryCommand
  | SetLLMCommand
  | SetReasoningEffortCommand
  | ShutdownCommand
  | GenerateTitleCommand;

// ---------------- Core's memo commands (Tauri; main chat ticket 95) ----------------
//
// Not the bridge protocol above: what Galley Core's Tauri commands for the
// memos return (`list_memos`, `list_memo_events`, `delete_memo`; mirror of
// `core/src/api/memo.rs`), for the panel's 「备忘」 page and the cards under
// the main chat's replies (ticket 97). camelCase, optional fields omitted
// when empty. No `kind` field: the protocol drift check reads only the
// shapes that carry one.

/** Tauri event after any memo change; empty payload, read again. */
export const MEMOS_CHANGED_EVENT = "memos:changed";

/** Mirror of Core `MemoBrief`: what `galley memo` prints and every write
 * returns. `until` is the memo's last day, a local `YYYY-MM-DD`. */
export interface MemoBrief {
  id: string;
  text: string;
  until?: string;
  origin: { via: string; supervisor?: string; reason?: string };
  createdIn?: { sessionId: string; turnIndex?: number };
  createdAt: string;
  /** When its text or its last day last changed: the day the page groups
   * it under. */
  updatedAt: string;
}

/** Mirror of Core `MemoItem` (`list_memos`): a memo that holds today, and
 * where in the main chat it was last noted or changed (the row jumps
 * there; `turnIndex` is the reply, once its run ended). */
export interface MemoItem extends MemoBrief {
  changedIn?: { sessionId: string; turnIndex?: number };
}

/** Mirror of Core `MemoAction`. */
export type MemoAction = "add" | "update" | "delete";

/** Mirror of Core `MemoEventItem` (`list_memo_events`): one write of a memo
 * in the main chat, for the card under its reply. `text` is the memo after
 * the write (before it, for a delete); `memoExists` says whether the memo
 * is still there. */
export interface MemoEventItem {
  id: number;
  memoId: string;
  action: MemoAction;
  text: string;
  until?: string;
  sessionId: string;
  turnIndex?: number;
  memoExists: boolean;
  createdAt: string;
}
