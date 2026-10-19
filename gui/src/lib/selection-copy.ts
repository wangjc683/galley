import { useSyncExternalStore } from "react";

/**
 * Where a text selection gets the floating copy (SelectionCopyToolbar):
 * an assistant answer (`assistant-answer`, MessageAgent), and in the
 * assistant's conversation the user's own bubble too (`user-message`,
 * MessageUser with `assistant`; main chat PRD ruling 73, which kept it
 * when ruling 105 gave the bubble its hover copy · quote · ⋯): its plain
 * text is exactly what a selection copies. A selection gets the toolbar
 * only when it starts and ends inside one such scope.
 */
export const SELECTION_COPY_SCOPE =
  '[data-selection-copy-scope="assistant-answer"], [data-selection-copy-scope="user-message"]';

/**
 * The hover row yields to the selection toolbar (main chat PRD ruling
 * 108): while the toolbar shows for a message, that message's hover row
 * — a reply's action bar (MessageActions), the row under your bubble
 * (MessageUser) — does not, so one set of actions shows at a time.
 *
 * A message whose text can get the toolbar carries a key of its own
 * (`useId`) on its hover region, `data-selection-yield`, an ancestor of
 * its selection scope. The toolbar reads the key off the scope it
 * serves (`closest(SELECTION_YIELD_REGION)`) and names it here; each row
 * asks whether it is the one named. Only the key changing notifies, and
 * a row re-renders only when its own answer flips: the message the
 * toolbar leaves and the one it comes to, not every message on every
 * `selectionchange`.
 */
export const SELECTION_YIELD_REGION = "[data-selection-yield]";

let servedKey: string | null = null;
const listeners = new Set<() => void>();

/** The toolbar names the message it serves; null when it goes. */
export function selectionToolbarServes(key: string | null): void {
  if (servedKey === key) return;
  servedKey = key;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the selection toolbar is showing for the message keyed
 * `key` (no key: it never is). */
export function useYieldsToSelection(key: string | undefined): boolean {
  const snapshot = () => key !== undefined && servedKey === key;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
