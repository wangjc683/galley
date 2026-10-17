/**
 * Whether the to-do panel was left open (main chat ticket 45, PRD ruling
 * 93 point 2): open when you left, open when you come back, and across a
 * restart. Two places, each remembered apart (ticket 46, ruling 95
 * point 3): beside Galley itself, and beside everything else — the
 * workbench's conversations, subtasks and the empty composer share one.
 * Kept open in Galley to glance at, it does not take 320px of the
 * workbench, where the right side is the file preview's and the Git
 * review's more often.
 *
 * A per-machine convenience in localStorage, like the theme's cache and
 * the composer drafts: never in Core (Rule 5), never business data.
 * Default closed in both — a panel standing open on the right is what
 * made Galley read like an IDE (tools-and-approvals.md §4.7), so nothing
 * opens it but you.
 *
 * Anything unreadable counts as closed: no window (a static render), a
 * WebView with storage disabled, a value that is not ours. A write that
 * fails leaves the choice to this run alone.
 */

/** Where the panel is open: beside Galley itself (`mainChatOnScreen`,
 * lib/todo-open.ts), or beside anything else. */
export type TodoPlace = "galley" | "elsewhere";

export const TODO_PLACES: readonly TodoPlace[] = ["galley", "elsewhere"];

/** Galley's keeps ticket 45's key, unmigrated; the rest got their own. */
export const TODO_PANEL_OPEN_KEYS: Readonly<Record<TodoPlace, string>> = {
  galley: "galley.todoPanelOpen",
  elsewhere: "galley.todoPanelOpenElsewhere",
};

export function readTodoPanelOpen(place: TodoPlace): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TODO_PANEL_OPEN_KEYS[place]) === "1";
  } catch {
    return false;
  }
}

export function writeTodoPanelOpen(place: TodoPlace, open: boolean): void {
  if (typeof window === "undefined") return;
  const key = TODO_PANEL_OPEN_KEYS[place];
  try {
    if (open) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: this run remembers, the next starts closed.
  }
}

/**
 * The launch-at-login hint at the foot of the list, closed with its ×
 * (main chat PRD ruling 96): gone for good on this machine, whatever
 * comes to be set to go off later — launch at login stays in Settings →
 * General. Same rules as above: only `"1"` counts, anything unreadable
 * is not closed, a write that fails keeps it closed for this run alone.
 */
export const TODO_AUTOSTART_HINT_CLOSED_KEY = "galley.todoAutostartHintClosed";

export function readAutostartHintClosed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TODO_AUTOSTART_HINT_CLOSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAutostartHintClosed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TODO_AUTOSTART_HINT_CLOSED_KEY, "1");
  } catch {
    // Storage unavailable: closed for this run, back on the next.
  }
}
