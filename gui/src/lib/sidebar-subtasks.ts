import type { TodoItem, TodoState } from "@/lib/assistant-todo";
import type { Session } from "@/types/session";

/**
 * The subtasks Galley has in hand, listed in the sidebar's assistant
 * zone under its card (main chat ticket 128, PRD ruling 176, overturning
 * rulings 25 and 30's "no place in the sidebar"): since ruling 174 the
 * main chat sends several off at once, and their cards scroll away with
 * the conversation.
 *
 * - **Which**: the subtasks running or asking you, out of Core's
 *   「Galley 在办」 read (`AssistantTodo.assistant`, `kind ===
 *   "subtask"`; Core has already left out the finished, the promoted and
 *   the archived) — the store's copy, whole: the to-do panel draws it
 *   without subtasks since ruling 197 (lib/todo-panel.ts
 *   `withoutSubtasks`), so this is the one place on the desktop they are
 *   listed. A subtask that failed, ran out of steps or stopped short
 *   leaves the moment it stops (ruling 177, correcting 176 point 2): a
 *   failure or a step limit was reported to Galley, who sends it back or
 *   tells you — its business, not yours; a stop was yours, or a
 *   restart's. They stay in Core's list for seven days, which the main
 *   chat reads at each segment's start (「在办的事」). Each
 *   is matched to its session among the main chat's unpromoted subtasks
 *   the sidebar has, for its start time and its title as it stands now;
 *   one the sidebar no longer has as such — promoted or archived a
 *   moment before the list is read again — is left out, so a
 *   conversation is never listed twice.
 * - **Asking you**: all of them, first, never folded.
 * - **Running**: after them, at most `SIDEBAR_SUBTASK_ROWS` (a project
 *   group's 「最近 5 条」), the rest behind one row, 「还有 N 件在办」,
 *   which unfolds them in place, under the others, and becomes 「收起」
 *   (ruling 197 point 4; until then it opened the to-do panel with them
 *   lit, which no longer lists subtasks). Unfolded or not is not
 *   remembered (`sidebarSubtaskRowsShown`).
 * - **Order**: by start time (the session's `createdAt`), the first
 *   started on top; the panel's own order (latest activity first) only
 *   breaks a tie. Rows do not jump about as steps land.
 * - **Done**: the row leaves (ruling 176 point 3). Galley says how it
 *   went in the conversation; the receipt under the reply that sent it
 *   stays (ruling 179; the panel's 已完成 no longer keeps it, ruling
 *   197).
 *
 * Nothing at all: no rows, no space (`NO_SIDEBAR_SUBTASKS`).
 */

/** How many running subtasks show before 「还有 N 件在办」 (ruling 176
 * point 2). */
export const SIDEBAR_SUBTASK_ROWS = 5;

/** The states a listed subtask can be in (ruling 177). */
export type SidebarSubtaskState = Extract<TodoState, "running" | "asking">;

export interface SidebarSubtask {
  /** The subtask's session id. */
  id: string;
  /** Its session's title as the sidebar has it now, else the list's
   * words; empty when neither has any (the row then says 「子任务」). */
  title: string;
  state: SidebarSubtaskState;
}

export interface SidebarSubtasks {
  /** The rows always drawn, in order: asking you, then running. */
  rows: SidebarSubtask[];
  /** The running ones past `SIDEBAR_SUBTASK_ROWS`, in the same order:
   * folded behind 「还有 N 件在办」 (N is its length), drawn after `rows`
   * while unfolded. */
  more: SidebarSubtask[];
}

export const NO_SIDEBAR_SUBTASKS: SidebarSubtasks = { rows: [], more: [] };

/** A subtask that needs you: it asks (ruling 177: a failure is Galley's
 * business). Listed whatever their number, ahead of the rest, with the
 * state's word on the row. */
export function subtaskNeedsYou(state: TodoState): boolean {
  return state === "asking";
}

function listed(state: TodoState): state is SidebarSubtaskState {
  return state === "running" || state === "asking";
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
  const shown: { row: SidebarSubtask; started: number }[] = [];
  for (const item of items) {
    if (item.kind !== "subtask" || !listed(item.state)) continue;
    const session = sessions.get(item.id);
    if (!session) continue;
    shown.push({
      row: {
        id: item.id,
        title: session.title.trim() || item.text.trim(),
        state: item.state,
      },
      started: Date.parse(session.createdAt),
    });
  }
  if (shown.length === 0) return NO_SIDEBAR_SUBTASKS;
  // A stable sort: the panel's order breaks a tie, and a start time that
  // cannot be read keeps its place.
  shown.sort((a, b) => a.started - b.started || 0);
  const asking = shown.filter((s) => subtaskNeedsYou(s.row.state));
  const running = shown.filter((s) => !subtaskNeedsYou(s.row.state));
  return {
    rows: [...asking, ...running.slice(0, SIDEBAR_SUBTASK_ROWS)].map(
      (s) => s.row,
    ),
    more: running.slice(SIDEBAR_SUBTASK_ROWS).map((s) => s.row),
  };
}

/**
 * The rows the sidebar draws (ruling 197 point 4): the ones always
 * drawn, and while 「还有 N 件在办」 is unfolded the ones it folds, after
 * them. What decides the selected place reads this too: a subtask open
 * in the main area with a row drawn is that row's to select, one folded
 * away leaves it on Galley's card (Sidebar).
 */
export function sidebarSubtaskRowsShown(
  list: SidebarSubtasks,
  unfolded: boolean,
): SidebarSubtask[] {
  return unfolded && list.more.length > 0
    ? [...list.rows, ...list.more]
    : list.rows;
}
