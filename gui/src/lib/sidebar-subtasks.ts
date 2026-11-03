import type { TodoItem, TodoState } from "@/lib/assistant-todo";
import type { Session } from "@/types/session";

/**
 * The subtasks Galley has in hand, listed in the sidebar's assistant
 * zone under its card (main chat ticket 128, PRD ruling 176, overturning
 * rulings 25 and 30's "no place in the sidebar"): since ruling 174 the
 * main chat sends several off at once, and their cards scroll away with
 * the conversation.
 *
 * - **Which**: the to-do panel's 「Galley 在办」 subtasks, one read
 *   (`AssistantTodo.assistant`, `kind === "subtask"`): Core has already
 *   left out the finished, the promoted and the archived, and the ones
 *   neither running nor moved for seven days (core/src/assistant_todo.rs).
 *   No rule of its own. Each is matched to its session among the main
 *   chat's unpromoted subtasks the sidebar has, for its start time and
 *   its title as it stands now; one the sidebar no longer has as such —
 *   promoted or archived a moment before the list is read again — is
 *   left out, so a conversation is never listed twice.
 * - **Needs you** (asking, failed): all of them, first, never folded.
 * - **The rest** (running, paused at the step limit, stopped short):
 *   after them, at most `SIDEBAR_SUBTASK_ROWS` (a project group's
 *   「最近 5 条」), the rest behind one row, 「还有 N 件在办」, which opens
 *   the panel.
 * - **Order**: by start time (the session's `createdAt`), the first
 *   started on top; the panel's own order (latest activity first) only
 *   breaks a tie. Rows do not jump about as steps land.
 * - **Done**: the row leaves (ruling 176 point 3). Galley says how it
 *   went in the conversation; the card under the reply that sent it
 *   stays, and the panel keeps it under 已完成 for seven days.
 *
 * Nothing at all: no rows, no space (`NO_SIDEBAR_SUBTASKS`).
 */

/** How many of the subtasks that do not need you show before
 * 「还有 N 件在办」 (ruling 176 point 2). */
export const SIDEBAR_SUBTASK_ROWS = 5;

export interface SidebarSubtask {
  /** The subtask's session id. */
  id: string;
  /** Its session's title as the sidebar has it now, else the list's
   * words; empty when neither has any (the row then says 「子任务」). */
  title: string;
  state: TodoState;
}

export interface SidebarSubtasks {
  /** The rows, in order: what needs you, then the rest. */
  rows: SidebarSubtask[];
  /** The rest past `SIDEBAR_SUBTASK_ROWS`, by id, in the same order:
   * 「还有 N 件在办」 (N is its length) opens the panel and lights them. */
  more: string[];
}

export const NO_SIDEBAR_SUBTASKS: SidebarSubtasks = { rows: [], more: [] };

/** A subtask that needs you: it asks, or it failed. Listed whatever
 * their number, ahead of the rest, with the state's word on the row. */
export function subtaskNeedsYou(state: TodoState): boolean {
  return state === "asking" || state === "failed";
}

/**
 * The sidebar's subtasks: `items` is Galley's group of the to-do list
 * (`AssistantTodo.assistant`, its subtasks and one-off tasks), `subtasks`
 * the main chat's unpromoted subtask sessions the sidebar has.
 */
export function sidebarSubtasks(
  items: readonly TodoItem[],
  subtasks: readonly Pick<Session, "id" | "title" | "createdAt">[],
): SidebarSubtasks {
  const sessions = new Map(subtasks.map((s) => [s.id, s]));
  const listed: { row: SidebarSubtask; started: number }[] = [];
  for (const item of items) {
    if (item.kind !== "subtask") continue;
    const session = sessions.get(item.id);
    if (!session) continue;
    listed.push({
      row: {
        id: item.id,
        title: session.title.trim() || item.text.trim(),
        state: item.state,
      },
      started: Date.parse(session.createdAt),
    });
  }
  if (listed.length === 0) return NO_SIDEBAR_SUBTASKS;
  // A stable sort: the panel's order breaks a tie, and a start time that
  // cannot be read keeps its place.
  listed.sort((a, b) => a.started - b.started || 0);
  const needsYou = listed.filter((s) => subtaskNeedsYou(s.row.state));
  const rest = listed.filter((s) => !subtaskNeedsYou(s.row.state));
  return {
    rows: [...needsYou, ...rest.slice(0, SIDEBAR_SUBTASK_ROWS)].map(
      (s) => s.row,
    ),
    more: rest.slice(SIDEBAR_SUBTASK_ROWS).map((s) => s.row.id),
  };
}
