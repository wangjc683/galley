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
 * opens it but you, except once (main chat ticket 87, PRD ruling 131
 * point 4): the first time a card appears under a reply to a round you
 * sent — a to-do's, or since ticket 101 (PRD ruling 147 point 4) one of
 * Galley's own reminders or a memo's — Galley's panel opens by itself,
 * remembered open, on that card's page, and the row lights up: a panel
 * that starts closed with nothing leading to it is shown once, at the
 * first card, where what Galley notes is kept. It
 * was first argued for the daily review, to be in sight and able to be
 * let go (assistant PRD ruling 10), lest a new user never know Galley
 * goes over their things each morning; since main chat PRD ruling 145
 * the panel does not draw the review, and the once stays on its own
 * reason. After that, never again (`TODO_PANEL_INTRODUCED_KEY`). In a
 * narrow main area the remembered open is not shown at all and nothing
 * there reads or writes it (ruling 131 point 2, lib/todo-open.ts): a
 * look there is this run's alone.
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
 * The panel has been met on this machine (main chat ticket 87, PRD
 * ruling 131 point 4): it never opens by itself again. Set by every open
 * or close of yours — the button, ⌘K, ×, Esc, a jump out of the panel, a
 * card's title, in a narrow main area too — and by the one time it
 * opened by itself. A key of its own: a close deletes the open key, so
 * 「closed」 and 「never touched」 read the same there. Open in either
 * place at start counts as met too: whoever left it open knows it. Same
 * rules as above: only `"1"` counts, anything unreadable is not met, a
 * write that fails leaves it met for this run alone.
 */
export const TODO_PANEL_INTRODUCED_KEY = "galley.todoPanelIntroduced";

export function readTodoPanelIntroduced(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(TODO_PANEL_INTRODUCED_KEY) === "1") {
      return true;
    }
  } catch {
    return false;
  }
  return TODO_PLACES.some(readTodoPanelOpen);
}

export function writeTodoPanelIntroduced(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TODO_PANEL_INTRODUCED_KEY, "1");
  } catch {
    // Storage unavailable: met for this run, not on the next.
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
