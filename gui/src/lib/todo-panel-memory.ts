/**
 * Whether the to-do panel was left open (main chat ticket 45, PRD ruling
 * 93 point 2): open when you left Galley, open when you come back, and
 * across a restart. A per-machine convenience in localStorage, like the
 * theme's cache and the composer drafts: never in Core (Rule 5), never
 * business data. Default closed — a panel standing open on the right is
 * what made Galley read like an IDE (tools-and-approvals.md §4.7), so
 * nothing opens it but you.
 *
 * Anything unreadable counts as closed: no window (a static render), a
 * WebView with storage disabled, a value that is not ours. A write that
 * fails leaves the choice to this run alone.
 */

export const TODO_PANEL_OPEN_KEY = "galley.todoPanelOpen";

export function readTodoPanelOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TODO_PANEL_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeTodoPanelOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (open) window.localStorage.setItem(TODO_PANEL_OPEN_KEY, "1");
    else window.localStorage.removeItem(TODO_PANEL_OPEN_KEY);
  } catch {
    // Storage unavailable: this run remembers, the next starts closed.
  }
}
