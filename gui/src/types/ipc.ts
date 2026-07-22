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
  result:
    | "CURRENT_TASK_DONE"
    | "EXITED"
    | "MAX_TURNS_EXCEEDED"
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
  timestamp: string;
}

export interface TurnStartEvent {
  kind: "turn_start";
  sessionId: string;
  turnIndex: number;
  visibility?: MessageVisibility;
  timestamp: string;
}

export interface ToolCallPendingEvent {
  kind: "tool_call_pending";
  sessionId: string;
  approvalId: string;
  turnIndex: number;
  absoluteTurnIndex?: number | null;
  toolName: string;
  args: Record<string, unknown>;
  argsPreview: string;
  riskLevel: "low" | "medium" | "high";
  reason: string;
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
  exitReason: ExitReason | null;
  telemetry?: TurnTelemetry | null;
  visibility?: MessageVisibility;
  absoluteTurnIndex?: number | null;
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
  timestamp: string;
}

/**
 * Bridge confirmation that a `reinject_tools` command succeeded.
 * `blocksAdded` is how many history entries were appended (one per
 * tool definition block read from GA's `tool_usable_history.json`).
 * Desktop surfaces this as a toast.
 */
export interface ToolsReinjectedEvent {
  kind: "tools_reinjected";
  sessionId: string;
  blocksAdded: number;
  timestamp: string;
}

/**
 * Bridge confirmation that a Desktop Pet subprocess has been spawned
 * for this session and the per-turn hook is registered.
 */
export interface PetAttachedEvent {
  kind: "pet_attached";
  sessionId: string;
  port: number;
  timestamp: string;
}

/**
 * Bridge confirmation that the Desktop Pet subprocess has terminated
 * and the per-turn hook has been removed.
 */
export interface PetDetachedEvent {
  kind: "pet_detached";
  sessionId: string;
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

export type IPCEvent =
  | ReadyEvent
  | TurnStartEvent
  | ToolCallPendingEvent
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
  | ToolsReinjectedEvent
  | PetAttachedEvent
  | PetDetachedEvent
  | SystemMessageEvent;

// ---------------- Commands (desktop → bridge) ----------------

export interface UserMessageCommand {
  kind: "user_message";
  text: string;
  images?: string[];
  visibility?: MessageVisibility;
  absoluteTurnIndex?: number | null;
}

export type ApprovalDecision =
  | "allow_once"
  | "deny"
  | "always_allow_project"
  | "always_allow_global";

export interface ApprovalResponseCommand {
  kind: "approval_response";
  approvalId: string;
  decision: ApprovalDecision;
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

export interface SetApprovalRulesCommand {
  kind: "set_approval_rules";
  alwaysAllowGlobal: string[];
  alwaysAllowProject: string[];
}

/**
 * Toggle YOLO mode on the bridge (PRD §11.5).
 *
 * When enabled, every dispatched tool call bypasses the approval gate
 * — bridge does not emit `tool_call_pending`. The desktop is expected
 * to keep the user informed via the persistent TopBar indicator
 * (DESIGN.md §4.1). YOLO is upper-priority over `always_allow_*`
 * lists; toggling it back off does not clear those lists.
 */
export interface SetYoloModeCommand {
  kind: "set_yolo_mode";
  enabled: boolean;
}

export interface SetLLMCommand {
  kind: "set_llm";
  llmIndex: number;
}

export interface ShutdownCommand {
  kind: "shutdown";
}

/**
 * Re-inject GA's tool definitions into this session's LLM history.
 * Mirrors GA's stapp.py "Reinject Tools" button — useful when a
 * long-running session has drifted and the agent is confused about
 * what tools are available.
 */
export interface ReinjectToolsCommand {
  kind: "reinject_tools";
}

/**
 * Spawn GA's `desktop_pet_v2.pyw` subprocess and register a per-turn
 * progress hook on this session's agent. `port` is the local HTTP
 * port the pet listens on (default 41983, matching GA's stapp.py).
 * Only one pet can run at a time globally since it binds a fixed port.
 */
export interface AttachPetCommand {
  kind: "attach_pet";
  port?: number;
}

/**
 * Terminate the Desktop Pet subprocess (if running) and remove the
 * per-turn hook. No-op if no pet is currently attached.
 */
export interface DetachPetCommand {
  kind: "detach_pet";
}

export type IPCCommand =
  | UserMessageCommand
  | ApprovalResponseCommand
  | AskUserResponseCommand
  | AbortCommand
  | LoadHistoryCommand
  | SetApprovalRulesCommand
  | SetYoloModeCommand
  | SetLLMCommand
  | ShutdownCommand
  | ReinjectToolsCommand
  | AttachPetCommand
  | DetachPetCommand;
