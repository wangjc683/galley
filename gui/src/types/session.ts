/**
 * Session / Project domain types — desktop-side.
 *
 * Mirrors PRD §8 (Data model). These are entities the desktop owns and
 * persists to SQLite; not to be confused with IPC events in types/ipc.ts
 * which are the wire protocol with the bridge subprocess.
 *
 * Field names follow TS / camelCase convention (matching the SQLite
 * column-to-row mapping done in the persistence layer, not the JSON
 * Lines wire format).
 */

import type { Origin } from "@/types/conversation";

/** Lifecycle states a session can be in. PRD §8.1. */
export type SessionStatus =
  | "idle"
  | "connecting"
  | "running"
  | "waiting_approval"
  | "error"
  | "completed"
  | "cancelled"
  | "archived";

/**
 * The subset of `SessionStatus` that is durable, persisted lifecycle
 * state — the only values a `Session` row may hold. The live/runtime
 * values (`connecting` / `running` / `waiting_approval` / `error`) are
 * NOT stored on the row; they are derived at read time from conversation
 * + bridge state by `deriveSessionStatus` (see `useSessionStatusView`).
 * Narrowing the row to this type makes "the row never holds a runtime
 * status" a compile-time guarantee rather than a convention upheld by
 * the old `fireSessionMirror` push.
 */
export type DurableSessionStatus =
  | "idle"
  | "completed"
  | "cancelled"
  | "archived";

export type RuntimeKind = "managed" | "external";

/**
 * Sidebar grouping bucket. Computed from `lastActivityAt` and `pinned`
 * via `bucketSession()` — not stored on the entity. `recent` is never
 * produced by `bucketSession`; it only exists as the backfill target of
 * `backfillRecentSessions()` when the active window is empty.
 */
export type SessionBucket = "pinned" | "today" | "week" | "recent" | "earlier";

export interface Session {
  id: string;
  projectId?: string;
  title: string;
  /**
   * Durable lifecycle status only. Live runtime status (running /
   * waiting_approval / connecting / error) is derived at read time via
   * `useSessionStatusView` — never written here.
   */
  status: DurableSessionStatus;

  /** "Turn N · {one-line summary}" — used on the sidebar row. */
  summary?: string;
  turnCount?: number;
  /** Tool name currently running, if the derived status is "running". */
  currentTool?: string;

  errorCount: number;
  /**
   * "There is a completed reply the user hasn't seen yet." Set when
   * the final turn_end for a run arrives for a session that is NOT the
   * active session; cleared when the user activates that session via
   * the sidebar. Persisted to SQLite (column `has_unread`) so the
   * inbox-style signal survives app restart. Orthogonal to the runtime
   * status — the Sidebar suppresses the dot while a run is still active.
   */
  hasUnread?: boolean;
  /**
   * GA-side per-message step the agent **most recently finished**
   * (the turnIndex passed in the last `turn_end` event for the
   * current user_message's loop). Surfaced by the Sidebar running
   * subline as "第 N 步 · {summary}" — each tick is a real
   * completed-step recap rather than a still-in-flight guess.
   *
   * The sidebar intentionally lags one step behind the main view:
   * we trade real-time accuracy for paired step-number + summary
   * (which only become consistent at turn_end). Users wanting the
   * truly-current step can click into the conversation, where the
   * thinking placeholder and TurnMarker surface live progress.
   *
   * Written by `bumpSessionAfterTurn` on each turn_end; transient
   * (in-memory only, not persisted — meaningful only while the
   * runtime is alive).
   */
  lastStepIndex?: number;

  /** ISO 8601 timestamps. lastActivityAt drives sidebar bucket. */
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  /** Creation provenance. Sidebar only surfaces Supervisor-created rows. */
  origin?: Origin;

  /** Subprocess identity (when bridge is alive for this session). */
  pid?: number;
  cwd?: string;

  pinned?: boolean;

  /**
   * Per-session approval-mode override ("auto" | "approval").
   * null / undefined = follow the app-wide default. See
   * lib/approval-mode.ts for the effective-mode resolution rule.
   */
  approvalMode?: "auto" | "approval" | null;

  /**
   * Last LLM index reported by the runtime. Kept for bridge command
   * compatibility and old rows; restore logic prefers `selectedLlmKey`
   * because indexes drift when model order changes.
   */
  selectedLlmIndex?: number;
  /**
   * Stable identity for the selected LLM. Managed runtime stores
   * `managed_models.id`; external runtime stores GA's raw LLM name.
   */
  selectedLlmKey?: string;
  /**
   * Display-name companion to {@link selectedLlmIndex}. Lets the
   * sidebar pill render the persisted label before the freshly
   * spawned bridge re-confirms with `ready`.
   */
  selectedLlmDisplayName?: string;

  /** Product-facing runtime ownership labels for CLI / diagnostics. */
  runtimeKind: RuntimeKind;
  runtimeLabel: string;
  /** GenericAgent runtime ownership captured when the session was created. */
  gaRuntimeKind: RuntimeKind;
  /** Stable runtime id for future multi-runtime support. */
  gaRuntimeId?: string;
  /** Managed prompt profile applied at session creation, if any. */
  promptProfile?: string;
}

export interface Project {
  id: string;
  name: string;
  /** Optional GA Workspace root. This is never injected as process cwd;
   * it activates GA Project Mode only when workspaceEnabled is true. */
  rootPath?: string;
  workspaceEnabled: boolean;
  /** Legacy metadata; current GUI renders Phosphor folder icons instead. */
  icon?: string;
  color?: string;
  /** Pin to top in Project Review. PRD §8.2. */
  pinned: boolean;
  /** max(non-archived sessions.lastActivityAt where projectId = this.id),
   * fallback to createdAt when project has no active content.
   * Drives default sort: pinned first, then active content recency. */
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}
