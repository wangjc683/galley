import type { AppCopy } from "@/i18n/types";
import { displaySessionSummary } from "@/lib/session-summary";
import type { SessionStatus } from "@/types/session";

/**
 * The assistant (main chat ticket 17, PRD rulings 60 / 62 / 63): the
 * main chat drawn as a person called Galley — an entry at the top of
 * the sidebar and, while it is open, an identity row in the main
 * header. Only the sidebar-top trial's variants 2 / 3 / 3′ show it
 * (components/layout/sidebar/sidebar-top-trial.ts); underneath it is
 * still the one main chat session.
 *
 * What the entry says is the main chat row's state, in the row's own
 * priority (layout-and-chrome.md 「有主对话时」): an error — its own or
 * an unpromoted subtask's — over a question — its own or a subtask's —
 * over running, over unread, over nothing. The words are the row's
 * subline, which speaks only of a state (ruling 58): nothing at rest,
 * and nothing for a new reply either, which the avatar's mark and the
 * name's weight carry.
 */

export type AssistantStateKind =
  | "error"
  | "ask"
  | "running"
  | "unread"
  | "idle";

export interface AssistantLine {
  text: string;
  tone: "running" | "warning" | "error";
}

export interface AssistantState {
  kind: AssistantStateKind;
  /** Under the name: the main chat row's subline. */
  line: AssistantLine | null;
  /** The tooltip's and the accessible name's words: the line, or the
   * unread title for a new reply; null at rest. */
  words: string | null;
}

export interface AssistantStateInput {
  /** The main chat's live status (useSessionStatusView). */
  status: SessionStatus;
  hasPendingAskUser: boolean;
  /** One of its unpromoted subtasks is erroring or asking (ticket 06a). */
  subtaskState?: "error" | "ask";
  hasUnread?: boolean;
  /** The main chat, or one of its subtasks, is open: nothing is unread. */
  open: boolean;
  lastStepIndex?: number;
  summary?: string;
  errorCount?: number;
}

export const ASSISTANT_IDLE: AssistantState = {
  kind: "idle",
  line: null,
  words: null,
};

export function assistantState(
  input: AssistantStateInput,
  copy: AppCopy,
): AssistantState {
  // A subtask's error or question counts as the main chat's own, the
  // words aside — SidebarSessionRow's `subtaskState` rule.
  const subtaskErrored =
    input.subtaskState === "error" && input.status !== "error";
  const subtaskAsking =
    input.subtaskState === "ask" &&
    !input.hasPendingAskUser &&
    input.status !== "error";
  if (input.status === "error" || subtaskErrored) {
    const count = input.errorCount || 0;
    const text = subtaskErrored
      ? copy.subtask.sidebarErrored
      : count > 1
        ? `${copy.sidebar.errored} · ${count}`
        : copy.sidebar.errored;
    return { kind: "error", line: { text, tone: "error" }, words: text };
  }
  if (input.hasPendingAskUser || subtaskAsking) {
    const text = subtaskAsking
      ? copy.subtask.sidebarWaiting
      : copy.sidebar.waitingForYou;
    return { kind: "ask", line: { text, tone: "warning" }, words: text };
  }
  if (input.status === "running") {
    const summary = input.summary
      ? displaySessionSummary(input.summary, copy.sidebar.turnProtocolFailure)
      : null;
    const text =
      input.lastStepIndex != null && summary
        ? copy.sidebar.stepSummary(input.lastStepIndex, summary)
        : copy.sidebar.thinking;
    return { kind: "running", line: { text, tone: "running" }, words: text };
  }
  if (input.hasUnread && !input.open) {
    return { kind: "unread", line: null, words: copy.sidebar.newReplyTitle };
  }
  return ASSISTANT_IDLE;
}

/** The accessible name, and 方案 2's tooltip: the name, then what it is
 * doing when it is doing something. */
export function assistantLabel(name: string, state: AssistantState): string {
  return state.words ? `${name} · ${state.words}` : name;
}
