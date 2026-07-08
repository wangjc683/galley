import type { Project, RuntimeKind, SessionStatus } from "@/types/session";

export type GoalStatus =
  | "running"
  | "wrapping"
  | "completed"
  | "stopped"
  | "failed";

export type GoalWriteMode = "autonomous" | "read_only";

export interface GoalBrief {
  id: string;
  proposalId?: string;
  projectId: string;
  masterSessionId?: string;
  objective: string;
  status: GoalStatus;
  budgetSeconds: number;
  workerLimit: number;
  runtimeKind: RuntimeKind;
  writeMode: GoalWriteMode;
  /** Engine: `solo` (single agent) or `hive` (master + workers). Drives
   * mode-specific UI (e.g. solo hides the hive-only "N agents" chip). */
  mode: GoalMode;
  startedAt: string;
  deadlineAt: string;
  endedAt?: string;
  latestSummary?: string;
  resultSeenAt?: string;
  stopRequested: boolean;
  workspacePath?: string;
  /** Task-board counters + deliverable anchor version. Present on the
   * live-surface queries (visible list / status / per-session list);
   * absent = unknown, not zero — hide the affordance, don't show 0/0. */
  taskCount?: number;
  completedTaskCount?: number;
  deliverableVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StartDesktopGoalInput {
  objective: string;
  projectId?: string;
  masterSessionId: string;
  runtimeKind?: RuntimeKind;
  budgetSeconds?: number;
  workerLimit?: number;
  /** Goal engine. Omitted → `hive` (backward-compat default resolved in
   * Core). The GUI sends `solo` as the product default. */
  mode?: GoalMode;
  /** Display name of the model the operator picked in the Composer at
   * launch. Best-effort applied to the master session (and inherited by
   * worker sessions) by the backend; a miss falls back to the GA
   * default and never blocks the launch. */
  llmName?: string;
  /** Operator's resolved UI locale (`zh-CN` / `en-US`) at launch. Selects
   * the language of the Galley-authored system narration that Core (launch
   * ack) and the CLI controller (lifecycle checkpoints) persist into the
   * master session — Rust can't read GUI i18n, so the resolved locale is
   * handed down here. Omitted → Chinese (the surface's original behavior). */
  locale?: string;
}

export interface GoalMasterMessage {
  id: string;
  sessionId: string;
  role: "user" | "agent" | "system";
  content: string;
  createdAt: string;
  summary?: string;
  turnIndex?: number;
  origin?: {
    via: "gui" | "cli" | "supervisor" | "system";
    supervisor?: string;
    reason?: string;
  };
}

export interface StartDesktopGoalResult {
  goal: GoalBrief;
  objectiveMessage: GoalMasterMessage;
  masterMessage: GoalMasterMessage;
}

/** Which Goal engine to run. `solo` = one agent to budget (product
 * default); `hive` = master + parallel workers, cross-verified. */
export type GoalMode = "solo" | "hive";

export interface GoalLaunchConfig {
  workerLimit: number;
  budgetSeconds: number;
  mode: GoalMode;
}

export interface GoalTaskBrief {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  status:
    | "open"
    | "claimed"
    | "running"
    | "completed"
    | "blocked"
    | "cancelled";
  ownerSessionId?: string;
  scope?: string;
  resultSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoalEventBrief {
  id: number;
  goalId: string;
  taskId?: string;
  authorSessionId?: string;
  eventType:
    | "plan"
    | "claim"
    | "progress"
    | "result"
    | "conflict"
    | "synthesis"
    | "system";
  body: string;
  createdAt: string;
}

export interface GoalSessionBrief {
  id: string;
  projectId?: string;
  title: string;
  status: SessionStatus;
  summary?: string;
  turnCount?: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  hasUnread?: boolean;
  selectedLlmIndex?: number;
  selectedLlmKey?: string;
  selectedLlmDisplayName?: string;
  runtimeKind: RuntimeKind;
  runtimeLabel: string;
  gaRuntimeKind: RuntimeKind;
  gaRuntimeId?: string;
  promptProfile?: string;
}

export interface GoalDeliverable {
  id: string;
  goalId: string;
  version: number;
  content: string;
  note?: string;
  authorSessionId?: string;
  createdAt: string;
}

export interface GoalStatusSnapshot {
  goal: GoalBrief;
  project?: Project;
  tasks: GoalTaskBrief[];
  events: GoalEventBrief[];
  sessions: GoalSessionBrief[];
  deliverable?: GoalDeliverable;
}

/** Worker-session orientation from `goal_context_for_session`: which
 * Goal the session works for and its latest owned task. Null for
 * sessions that never claimed a goal task (normal sessions, masters).
 * Drives the worker context bar at the top of the conversation. */
export interface GoalWorkerContext {
  goal: GoalBrief;
  task: GoalTaskBrief;
}
