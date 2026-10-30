// A restore's page merged with the turns that arrived live before it
// (ticket 113). Pure function — no store dependency.

import type { SystemTurn, Turn } from "@/types/conversation";

/** The persisted row a turn shows, if it names one. */
function rowId(turn: Turn): string | undefined {
  return turn.role === "system" ? undefined : turn.messageId;
}

/** A turn Core writes a row for: a user or agent turn with its row id,
 * or Galley's narration (the only system turn Core persists, which
 * carries no id). */
function isPersisted(turn: Turn): boolean {
  return rowId(turn) !== undefined || isNarration(turn);
}

function isNarration(turn: Turn): turn is SystemTurn {
  return turn.role === "system" && turn.variant === "narration";
}

/**
 * The turns a restore lands: the latest page Core read (`restored`, in
 * conversation order), with the turns this page already holds (`live`)
 * merged in — a session can get live turns before it is first opened
 * (the morning review waking the main chat at launch).
 *
 * Core writes every row before the page hears of it, so the page is
 * complete up to the moment Core read it, and `live` is in arrival
 * order. Live turns are matched to the page by row id (`messageId`,
 * `msg_<session>_<turn_index>_<role>` on both sides):
 *
 *   - a live turn the page holds stays as the object already on screen,
 *     in the page's place for it — drawn once;
 *   - every live turn after the last one the page holds came after the
 *     read, or is not persisted yet (an optimistic send, a `/btw`
 *     exchange, a bridge system message): appended in arrival order. A
 *     narration turn there is dropped when the page holds narration of
 *     the same text after that point (narration carries no id);
 *   - a live turn before one the page holds was there before the read:
 *     dropped when Core persists it (it is in the page, or older than the
 *     page and `earlier` reaches it), kept just in front of that turn
 *     when it is transient.
 *
 * In-flight state — the running step, the typing bubble, a pending
 * question — lives outside `turns` and is not touched here.
 */
export function mergeRestoredTurns(restored: Turn[], live: Turn[]): Turn[] {
  if (live.length === 0) return restored;
  const pageIndex = new Map<string, number>();
  restored.forEach((turn, index) => {
    const id = rowId(turn);
    if (id !== undefined) pageIndex.set(id, index);
  });
  const page = restored.slice();
  /** Transient live turns to draw just before page turn `index`. */
  const inFront = new Map<number, Turn[]>();
  let lastHeld = -1;
  let since: Turn[] = [];
  for (const turn of live) {
    const id = rowId(turn);
    const index = id === undefined ? undefined : pageIndex.get(id);
    if (index === undefined) {
      since.push(turn);
      continue;
    }
    page[index] = turn;
    const transient = since.filter((t) => !isPersisted(t));
    if (transient.length > 0) {
      inFront.set(index, [...(inFront.get(index) ?? []), ...transient]);
    }
    since = [];
    lastHeld = Math.max(lastHeld, index);
  }
  // Narration the page holds after the last turn both sides share: a
  // live narration turn of the same text is that row.
  const narrationAfter = page
    .slice(lastHeld + 1)
    .filter(isNarration)
    .map((turn) => turn.content);
  const after = since.filter((turn) => {
    if (!isNarration(turn)) return true;
    const at = narrationAfter.indexOf(turn.content);
    if (at === -1) return true;
    narrationAfter.splice(at, 1);
    return false;
  });
  const merged: Turn[] = [];
  page.forEach((turn, index) => {
    const front = inFront.get(index);
    if (front) merged.push(...front);
    merged.push(turn);
  });
  merged.push(...after);
  return merged;
}
