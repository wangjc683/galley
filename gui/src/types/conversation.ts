/**
 * Conversation view types — desktop-side rendering shapes.
 *
 * Distinct from `types/ipc.ts`:
 *   - ipc.ts mirrors the wire protocol (events the bridge emits)
 *   - conversation.ts is what the UI iterates over to render turns
 *
 * The state layer in #9 will be responsible for collapsing IPC events
 * into Turn / ToolEvent shapes. For #3 we hand-feed a demo Turn[] in
 * App.tsx until that store lands.
 */

/**
 * 6 visual states for a Tool callout per DESIGN.md §4.5:
 *   - running             : currently executing (apricot spinner)
 *   - success-current     : just completed, current focus (apricot)
 *   - success-historical  : older success (faded; almost invisible)
 *   - failed              : forced-open with error detail (red tint)
 *   - failed-historical   : settled tool whose result was GA's error
 *                           envelope (#22) — red accents but
 *                           auto-collapsed with a headline lead, the
 *                           `-historical` treatment of failed
 *   - denied              : user rejected; collapsed. Historical
 *                           transcripts only, no longer produced (see
 *                           lib/tool-outcome.ts)
 */
export type ToolEventStatus =
  | "running"
  | "success-current"
  | "success-historical"
  | "failed"
  | "failed-historical"
  | "denied";

export type SendPhase =
  | "saving"
  | "starting"
  | "restoring"
  | "waiting_agent"
  | "sent";

export interface ConversationToolEvent {
  id: string;
  /** Tool name like "file_read" / "file_patch" / "code_run". Mono font. */
  name: string;
  status: ToolEventStatus;
  /** One-line human description; shows when collapsed and as the lead
   * line when expanded. */
  summary?: string;
  /** Elapsed display ("120ms" / "—" for pending / "pending · 14s" etc.) */
  elapsed?: string;
  /** Raw args dict (rendered as a fallback mono block when no tool-specific
   * renderer applies). file_patch / file_write specific renderers land in #6. */
  args?: Record<string, unknown>;
  /** Absolute path a `file_write` / `file_patch` actually touched, resolved
   * by the bridge against GA's handler cwd when the turn settled
   * (2026-09-17). Present only on settled events of those two tools. */
  resolvedPath?: string;
  /** ≤200 char preview when raw args is too large. */
  argsPreview?: string;
  /** ≤500 char tool result preview (when status is success / failed). */
  resultPreview?: string;
  /** Decoded error body for `failed-historical` (GA error envelope's
   * stdout / msg with real newlines, tail-capped) — rendered in place
   * of the raw resultPreview. See lib/tool-outcome.toolErrorDisplay. */
  errorDetail?: string;
  /** What a settled `web_scan` / `web_execute_js` result says about the
   * browser's tabs, parsed from the FULL result at construction (the
   * ≤500-char resultPreview cuts a scan's tab list off). Absent for
   * every other tool and for browser results that carry no tab facts
   * (error envelopes, denials). lib/browser-site.ts turns these into
   * the pill's site preview. */
  browser?: BrowserFacts;
}

/** One browser tab as GA reports it. `id` is normalized to a string —
 * scans report string ids, the extension's tab commands numbers. */
export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

/**
 * Tab facts of one browser tool result (lib/browser-site.ts parses them):
 *
 *   scan      `web_scan`: the full tab list plus the tab it read
 *             (`activeTabId`); `tabsOnly` scans read no page.
 *   tab-list  `web_execute_js` running the extension's tab-list
 *             command (`{"cmd": "tabs"}`): a full list, no page read.
 *   tab-open  `web_execute_js` running `{"cmd": "tabs", "method":
 *             "create"}`: the tab it opened.
 *   script    any other `web_execute_js`: the tab the script ran in
 *             (`tabId`, null when GA reported none) and tabs that
 *             connected while it ran (`newTabs`, only those with a URL).
 */
export type BrowserFacts =
  | {
      kind: "scan";
      tabsOnly: boolean;
      activeTabId: string | null;
      tabs: BrowserTab[];
    }
  | { kind: "tab-list"; tabs: BrowserTab[] }
  | { kind: "tab-open"; tab: BrowserTab }
  | { kind: "script"; tabId: string | null; newTabs: BrowserTab[] };

/**
 * Audit metadata for any persisted write. Three-field tuple persisted in
 * SQLite (messages.created_via / supervisor / origin_note since B2 mig
 * 006). Drives the M7 supervisor provenance marker: when `via` is
 * `supervisor`, the UserTurn renders a small robot icon beside the
 * message. Other `via` values (`gui` / `cli` / `system`) render no
 * annotation — they're the default Galley-driven origin and don't need
 * to interrupt the reading flow.
 *
 * agent-api.md §6A is the canonical contract.
 */
export interface Origin {
  via: "gui" | "cli" | "supervisor" | "system";
  /** Supervisor label / agent identity (e.g. `ga-claude-1`). Required
   * when `via === "supervisor"`; optional otherwise. */
  supervisor?: string;
  /** Free-text rationale ("user said tldr"). */
  reason?: string;
}

export interface MessageAttachment {
  id: string;
  messageId: string;
  sessionId: string;
  kind: "image" | string;
  path: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface MessageTelemetry {
  elapsedMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreateTokens?: number | null;
  cacheReadTokens?: number | null;
  requestCount?: number | null;
  contextUsedChars?: number | null;
  contextLimitChars?: number | null;
}

export interface PendingImageAttachment {
  id: string;
  /** Base64 data URL of the (downsampled) image — crosses the IPC
   * boundary into `send_user_message`. Kept compact so the React
   * state and the Tauri invoke payload stay small. */
  dataUrl: string;
  /** Object URL for on-screen preview (thumbnail tile + dialog).
   * Backed by the same blob as `dataUrl` but as a URL the `<img>`
   * can stream-decode, instead of holding the full base64 string.
   * Owner must `URL.revokeObjectURL` it when the attachment is
   * removed / submitted / unmounted. */
  previewUrl: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  width?: number;
  height?: number;
}

export interface UserTurn {
  role: "user";
  content: string;
  /**
   * `messages.id` of the persisted row (`msg_<session>_<turn>_user`).
   * The DOM anchor the palette's "locate this hit" scroll targets.
   * Absent on a not-yet-persisted optimistic turn.
   */
  messageId?: string;
  /**
   * This page's key for an optimistic turn it sent through Core's
   * `send_user_message` (ticket 02c). The `user-message-persisted`
   * broadcast carrying the same id claims the turn (sets `messageId`)
   * instead of appending a second one. In memory only.
   */
  clientRequestId?: string;
  attachments?: MessageAttachment[];
  /** Audit origin for the user message. When `origin.via ===
   * "supervisor"`, MessageUser renders a small provenance icon (B4 M7).
   * Absent / `gui` means the local user typed it directly. */
  origin?: Origin;
  /** ISO send time: `messages.created_at` on a persisted row, the
   * client clock on an optimistic / transient turn. Drives the user
   * message time label (lib/message-time, 2026-09-28) and goal-thread's
   * commission and segment matching. Optional so existing UserTurn
   * constructions in tests / demo data don't need to change; an undated
   * turn gets no label. */
  createdAt?: string;
  /** Goal this turn commissioned (`messages.goal_id`, migration 031).
   * When present, goal-thread.ts matches the commission marker by exact
   * id instead of the objective-text + timestamp heuristic. */
  goalId?: string;
}

/**
 * Standalone, non-agent-loop conversation message. Comes from the
 * bridge's SystemMessageEvent (GA slash-command paths that bypass
 * agent_runner_loop — currently /btw side-question, /session.x=v
 * config confirmations).
 *
 * Rendered as a callout block distinct from agent turns:
 *   - "side_question": yellow AskUserBubble-family chrome
 *   - "system": neutral muted register
 *   - "goal": Galley Goal narration (Target glyph, "Galley" label)
 */
export interface SystemTurn {
  role: "system";
  /** Markdown source — rendered via the same MarkdownView pipeline
   * as agent final answers. */
  content: string;
  variant: "side_question" | "system" | "goal";
}

export interface AgentTurn {
  role: "agent";
  /** `messages.id` of the persisted row (`msg_<session>_<turn>_assistant`);
   * see UserTurn.messageId. */
  messageId?: string;
  /** Optional `<thinking>...</thinking>` block from the LLM — first-
   * person inner monologue. Rendered in the TurnMarker DetailPanel
   * alongside `preamble`. */
  thinking?: string;
  /** Optional "当前阶段：..." paragraph the LLM writes before each
   * tool call (per GA's sys_prompt). Distinct from `summary`:
   *   - `summary` is a one-liner third-person recap, surfaced on the
   *     TurnMarker row itself.
   *   - `preamble` is the multi-line prose reasoning that led to the
   *     tool dispatch — surfaced inline under TurnMarker via the
   *     DetailPanel when the user clicks to expand. During streaming,
   *     MainView can compact the same prose into TurnMarker's one-line
   *     live status so the process stays visible without a separate
   *     paragraph.
   */
  preamble?: string;
  tools: ConversationToolEvent[];
  /** Final answer markdown. null when the agent is still working
   * (e.g., waiting on an ask_user reply). */
  finalAnswer: string | null;
  /**
   * GA-side turn number (1-based). One user message can produce
   * multiple agent turns — each LLM call + dispatch cycle is one
   * turn. Surfaced in the conversation as a "Turn N" header so
   * users can track agent progress on long-running tasks. Comes
   * from `turn_end` event's turnIndex; optional because legacy
   * demo turns and unit tests may construct AgentTurns without it.
   */
  turnIndex?: number;
  /**
   * Third-person turn summary generated by GA's agent_runner_loop
   * (one-line description of what this step did, e.g. "用户打招呼，
   * 无具体任务" or "读取 PRD 第 180-230 行"). Comes from `turn_end`
   * event's `summary` field — distinct from `thinking`:
   *   - `thinking` is the LLM's first-person inner monologue
   *     ("我应该先 read PRD…"), wrapped in <thinking>...</thinking>
   *   - `summary` is GA's structured one-liner produced after the
   *     turn completes, suitable for sidebar previews + the
   *     conversation's TurnMarker sub-line.
   * Same string the Sidebar uses for its two-line preview.
  */
  summary?: string;
  /** Optional metadata shown in the final-answer footer. */
  telemetry?: MessageTelemetry;
}

export type Turn = UserTurn | AgentTurn | SystemTurn;

/**
 * GA-initiated question awaiting a user reply (V0.2). Set on the
 * session runtime by the `ask_user` IPC event; cleared when the user
 * submits a response (or switches sessions / app restarts).
 *
 * The transient bubble itself is not persisted, but the question text
 * is NOT lost: it lives in the assistant turn's `tool_calls` JSON, and
 * `AgentTurnView` renders a static `AnsweredAskUser` echo from those
 * args once the live bubble clears (and on restore from history). So
 * the user can always see what they were asked.
 *
 * Rendered as an inline bubble at the bottom of the conversation
 * (AskUserBubble) plus a yellow "⏸ 等你回复" indicator on the sidebar
 * row. Candidates surface as quick-fill chips; the Composer remains
 * fully open for free-form replies.
 */
export interface PendingAskUser {
  question: string;
  /** Quick-fill suggestions. Empty array = open-ended question (no chips). */
  candidates: string[];
}
