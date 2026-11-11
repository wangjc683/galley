import { useEffect, useState } from "react";

/** Which way a flag turned: `on` (false → true) or `off`. */
export type FlipBeat = "on" | "off";

/**
 * Which way `value` last turned after mount, for `clearMs` after the turn
 * — the cue for a one-shot motion that plays only when a thing changes
 * in front of you (main chat ticket 160, PRD ruling 208: the checkbox's
 * tick, a to-do's strike).
 *
 * Null at mount, whatever `value` is then: what mounts already on (a
 * list loading, 已完成 opening, a card in the history, a box that is a
 * new instance with the same value) is still. Null again once `clearMs`
 * has gone, so the class it drives is off the element before anything
 * could replay it: a CSS animation starts over when its element comes
 * back from `display: none` or is put back into the document (the badge
 * pop in `SidebarNavIcons.tsx` clears its class the same way). A turn
 * inside the beat starts a new one.
 */
export function useFlipBeat(value: boolean, clearMs: number): FlipBeat | null {
  const [seen, setSeen] = useState<{
    value: boolean;
    beat: FlipBeat | null;
    turn: number;
  }>(() => ({ value, beat: null, turn: 0 }));
  if (seen.value !== value) {
    setSeen({ value, beat: value ? "on" : "off", turn: seen.turn + 1 });
  }
  const { beat, turn } = seen;
  useEffect(() => {
    if (beat === null) return;
    const id = window.setTimeout(
      () =>
        setSeen((now) => (now.turn === turn ? { ...now, beat: null } : now)),
      clearMs,
    );
    return () => window.clearTimeout(id);
  }, [beat, turn, clearMs]);
  return beat;
}
