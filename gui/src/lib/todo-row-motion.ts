/**
 * The to-do panel's rows leaving and closing up (main chat PRD ruling 208
 * point 3, ticket 161; spec: reply-cards.md 「待办面板」's 「离开与合拢」).
 * Until then a row ticked off held its place for `TODO_SETTLE_MS` and
 * went with the fresh list in one frame, the rows under it jumping a
 * row's height; a delete, a skip, an undo, a row Galley moved, all cut.
 * The main chat's deleted bubbles have closed up since ruling 138
 * (lib/bubble-motion.ts), the model here. When the list the panel draws
 * changes (`todoRowOrder`), every block of the 待办 page — a row, a group's
 * label, 「还有 N 件没有列出」, the empty state, the autostart hint — is:
 *
 *   leaving   gone from the list (ticked and settled, Galley's tick let
 *             go, deleted, skipped, a reminder cancelled, unticked out of
 *             已完成): a copy fades where it stood, not shrinking, not
 *             moving (`--motion-base`, `--ease-exit`)
 *   staying   slides from where it was seen to its place, by the real
 *             distance (`--motion-slow`, `--ease-firm`): what closes up
 *             under a row that left, makes room for one that came, or
 *             moved with a new day
 *   entering  new or put back (undone, refused by Core, unticked back
 *             to your to-dos, the next period of a rule, one Galley
 *             noted): fades in at its place once the others have mostly
 *             made room (`--motion-fast` after, `--motion-base`,
 *             `--ease-pop`)
 *
 * A row going from one group to another (into 已完成, back out of it)
 * leaves and enters: slid across, it would pass over the groups between.
 * Only what is on screen moves; the end layout and the scroll position are
 * what they would be with no motion (transform and opacity on what
 * already sits at its place). Once, for what happens in front of you: not
 * on mounting, the first read, turning to 备忘 and back, opening or folding
 * a row, unfolding 已完成, a resize, or a read that changes no order. A
 * change that comes while one is moving goes on from where things are
 * seen. Under reduced motion only fades (foundations §2.7 「只淡不移」).
 *
 * The page side is lib/todo-row-motion-play.ts, started by
 * hooks/useTodoRowMotion.ts.
 */
import type { AssistantTodo } from "@/lib/assistant-todo";
import {
  rowShift,
  type BubbleMotionTiming,
  type FadeTiming,
  type SlideTiming,
} from "@/lib/bubble-motion";
import { todoPanelRows, type TodoHold } from "@/lib/todo-panel";

/** Reduced motion only fades: nothing slides. */
export type TodoRowMotionMode = "move" | "fade";

export function todoRowMotionMode(reducedMotion: boolean): TodoRowMotionMode {
  return reducedMotion ? "fade" : "move";
}

/**
 * The list as the 待办 page draws it, one key a row in order, group by
 * group (Galley's ticks holding where they stood, `todoPanelRows`): what
 * 「清单换了一份」 compares. 已完成's rows count whether it is folded or
 * not — folding is not a change of the list, nor are a row's words, its
 * time line or its notes, which change no order.
 */
export function todoRowOrder(
  todo: AssistantTodo,
  held: readonly TodoHold[],
): string {
  const rows = todoPanelRows(todo, held);
  return [
    rows.yours.map((item) => item.id),
    todo.assistant.map((item) => item.id),
    todo.routine.map((item) => item.id),
    rows.done.map((item) => `${item.kind}:${item.id}`),
  ]
    .map((ids) => ids.join(","))
    .join("|");
}

/** Whether a commit plays: the list changed from one the panel showed.
 * `null` is nothing to compare: before the first read, on the 备忘 page,
 * at mounting — whatever comes next is just there. */
export function todoRowsChanged(
  previous: string | null,
  next: string | null,
): boolean {
  return previous !== null && next !== null && previous !== next;
}

/**
 * The three parts' timing, from the motion tokens: what leaves fades
 * (`--motion-base`, `--ease-exit`); what stays slides into place
 * (`--motion-slow`, `--ease-firm`, the scale's 「较大结构位移」); what
 * comes in waits until the rows making room have mostly moved
 * (`--motion-fast`), then fades in (`--motion-base`, `--ease-pop`). Under
 * reduced motion nothing slides, so nothing waits. The main chat's delete
 * has the same numbers (`rowsMotion`); written out here so a change there
 * does not move the panel unseen.
 */
export function todoRowsTiming(
  timing: BubbleMotionTiming,
  mode: TodoRowMotionMode,
): { leave: FadeTiming; shift: SlideTiming; enter: FadeTiming } {
  return {
    leave: { durationMs: timing.baseMs, delayMs: 0, easing: timing.exit },
    shift: { durationMs: timing.slowMs, easing: timing.firm },
    enter: {
      durationMs: timing.baseMs,
      delayMs: mode === "move" ? timing.fastMs : 0,
      easing: timing.pop,
    },
  };
}

/** A block coming in from `from`: one an earlier change was fading in,
 * part way, goes on at once from where it is — no second wait. */
export function todoEnterFade(enter: FadeTiming, from: number): FadeTiming {
  return from > 0 ? { ...enter, delayMs: 0 } : enter;
}

/** A block as seen: px below the list's visible top. */
export interface TodoBlockBox {
  top: number;
  height: number;
}

/** A block as seen before a change: with how opaque it was (an earlier
 * change's fade-in part way; 1 otherwise). */
export interface TodoBlockSeen extends TodoBlockBox {
  opacity: number;
}

/** What a change moves: each staying block's slide (from `shift` px
 * below its place; negative, above), and the opacity each entering block
 * and each leaving copy starts its fade from. */
export interface TodoRowsPlan<K> {
  shifts: [K, number][];
  entering: [K, number][];
  leaving: [K, number][];
}

/**
 * What moves when the blocks `before` (as seen just before the change,
 * a motion part way included) become `after` (at their places): keyed by
 * the block itself, so a row that went to another group is another block.
 *
 * - Staying: slides by the distance between the two, when it is on screen
 *   at either end and the distance is a move (`rowShift`: over half a
 *   pixel, under a far scroll's 800px); under reduced motion it is just
 *   there. One an earlier change was fading in goes on fading in.
 * - Leaving: a copy fades where it was, when it was on screen.
 * - Entering: fades in at its place, when it is on screen there.
 *
 * Off screen nothing moves: a row scrolled out of the panel's view is
 * just where it ends up.
 */
export function todoRowsPlan<K>({
  before,
  after,
  viewportHeight,
  mode,
}: {
  before: ReadonlyMap<K, TodoBlockSeen>;
  after: ReadonlyMap<K, TodoBlockBox>;
  viewportHeight: number;
  mode: TodoRowMotionMode;
}): TodoRowsPlan<K> {
  const onScreen = ({ top, height }: TodoBlockBox) =>
    height > 0 && top + height > 0 && top < viewportHeight;
  const plan: TodoRowsPlan<K> = { shifts: [], entering: [], leaving: [] };
  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was) {
      if (onScreen(now)) plan.entering.push([key, 0]);
      continue;
    }
    const shift = mode === "move" ? rowShift(was.top, now.top) : null;
    if (shift !== null && (onScreen(was) || onScreen(now))) {
      plan.shifts.push([key, shift]);
    }
    if (was.opacity < 1 && onScreen(now)) {
      plan.entering.push([key, Math.max(0, was.opacity)]);
    }
  }
  for (const [key, was] of before) {
    if (after.has(key) || was.opacity <= 0 || !onScreen(was)) continue;
    plan.leaving.push([key, Math.min(1, was.opacity)]);
  }
  return plan;
}
