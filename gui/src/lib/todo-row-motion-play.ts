/**
 * The page side of the to-do panel's rows leaving and closing up (main
 * chat PRD ruling 208 point 3, ticket 161; the rules in
 * lib/todo-row-motion.ts). Read in two halves, as the main chat's delete
 * (lib/bubble-motion-play.ts `captureRemoval`, `playRemoval`):
 *
 *   before   inside the write that changes the list, React not having
 *            drawn it yet, so the page is what is on screen: the to-do
 *            store's (hooks/useTodoRowMotion.ts) or the flash letting a
 *            row Galley ticked off go (hooks/useTodoPanelFlash.ts). Every
 *            block where it is seen — a motion of an earlier change part
 *            way included, its transform and its fade — and the scroll
 *            position (`noteTodoRowsBefore`).
 *   after    in the commit that draws the change, after layout and
 *            before paint (the hook's layout effect): every block at its
 *            place, the scroll the browser may have taken back from a
 *            shorter list included (`playTodoRows`).
 *
 * Then what stays is put back where it was seen, with `transform`, and
 * let go to its place; what left is a copy where it stood, in a
 * zero-size layer, fading out; what came fades in. The layout is final
 * from the first frame, and nothing here writes the scroll position.
 */
import { prefersReducedMotion } from "@/lib/animate-scroll";
import { readBubbleMotionTiming } from "@/lib/bubble-motion";
import { LOCATE_FLASH_CLASS } from "@/lib/locate-flash";
import {
  todoEnterFade,
  todoRowMotionMode,
  todoRowsPlan,
  todoRowsTiming,
  type TodoBlockBox,
  type TodoBlockSeen,
} from "@/lib/todo-row-motion";

const GROUPS = '[data-role="todo-groups"]';
const GROUP = "[data-todo-group]";
/** A row's hover actions (说说这件, ⋯): not in a leaving copy, where they
 * would stay lit from the menu its 删除 was chosen in. */
const ROW_ACTIONS = "[data-todo-row-actions]";
/** The zero-size layer the copies fade in. */
const LAYER = "data-todo-row-motion-layer";

// ---- Reading the list -------------------------------------------------------

/** The blocks the eye runs down, in order: what each group draws (its
 * label, its rows, 「还有 N 件没有列出」), and what the list draws beside
 * the groups (the empty state, the autostart hint). */
function blocksOf(list: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const child of Array.from(list.children)) {
    if (!(child instanceof HTMLElement) || child.hasAttribute(LAYER)) continue;
    if (!child.matches(GROUPS)) {
      blocks.push(child);
      continue;
    }
    for (const group of Array.from(child.children)) {
      if (!(group instanceof HTMLElement)) continue;
      if (!group.matches(GROUP)) {
        blocks.push(group);
        continue;
      }
      for (const block of Array.from(group.children)) {
        if (block instanceof HTMLElement) blocks.push(block);
      }
    }
  }
  return blocks;
}

/** The list's visible top-left (its padding box) in the viewport. */
function originOf(list: HTMLElement): { top: number; left: number } {
  const rect = list.getBoundingClientRect();
  return { top: rect.top + list.clientTop, left: rect.left + list.clientLeft };
}

// ---- What is moving ---------------------------------------------------------

interface Held {
  animation: Animation;
  /** The slide's start (px below its place), or the fade's opacity. */
  from: number;
}

/** The motion on one list: its blocks' slides and fade-ins, its copies. */
interface ListMotion {
  slides: Map<Element, Held>;
  fades: Map<Element, Held>;
  copies: Set<HTMLElement>;
  layer: HTMLDivElement | null;
}

const motions = new WeakMap<HTMLElement, ListMotion>();

function motionOf(list: HTMLElement): ListMotion {
  let motion = motions.get(list);
  if (!motion) {
    motion = {
      slides: new Map(),
      fades: new Map(),
      copies: new Set(),
      layer: null,
    };
    motions.set(list, motion);
  }
  return motion;
}

/** An animation's eased progress now, 0 to 1; 0 before it starts, 1
 * once it has ended (its `finished` may not have let it go yet). */
function progressOf(animation: Animation): number {
  if (animation.playState === "finished") return 1;
  const progress = animation.effect?.getComputedTiming?.().progress;
  if (progress === null || progress === undefined) return 0;
  return Math.min(1, Math.max(0, progress));
}

function hold(map: Map<Element, Held>, el: Element, held: Held): void {
  map.set(el, held);
  const drop = () => {
    if (map.get(el) === held) map.delete(el);
  };
  held.animation.finished.then(drop, drop);
}

/** The blocks' slides and fade-ins to their end at once: every block at
 * its place, all there. The copies fade on. */
function settleBlocks(motion: ListMotion): void {
  const running = [...motion.slides.values(), ...motion.fades.values()];
  motion.slides.clear();
  motion.fades.clear();
  for (const { animation } of running) animation.cancel();
}

/**
 * How far a slide here has moved `row` from its place right now (px;
 * positive, below it): 0 when none is under way. For anything that
 * measures a row while the list closes up — the flash scrolling to the
 * first row it lights (hooks/useTodoPanelFlash.ts `revealInList`) decides
 * by where the row ends up, not where it is passing.
 */
export function todoRowShiftNow(list: HTMLElement, row: Element): number {
  const slide = motions.get(list)?.slides.get(row);
  if (!slide) return 0;
  return slide.from * (1 - progressOf(slide.animation));
}

// ---- Before ----------------------------------------------------------------

/** The list as a change found it. */
export interface TodoRowsBefore {
  /** Every block as seen (px from the list's visible top-left). */
  blocks: Map<Element, TodoBlockSeen & { left: number; width: number }>;
  scrollTop: number;
}

const pending = new WeakMap<HTMLElement, TodoRowsBefore>();

/**
 * Read the 待办 page as it is seen, for the change being written now
 * (React has not drawn it). The first read stands until the commit takes
 * it (`takeTodoRowsBefore`): the page does not change between two writes
 * of one task. Nothing on the 备忘 page.
 */
export function noteTodoRowsBefore(list: HTMLElement | null): void {
  if (!list || pending.has(list) || list.dataset.todoPage !== "todo") return;
  const motion = motions.get(list);
  const origin = originOf(list);
  const blocks: TodoRowsBefore["blocks"] = new Map();
  for (const block of blocksOf(list)) {
    const rect = block.getBoundingClientRect();
    const fade = motion?.fades.get(block);
    blocks.set(block, {
      top: rect.top - origin.top,
      left: rect.left - origin.left,
      width: rect.width,
      height: rect.height,
      opacity: fade
        ? fade.from + (1 - fade.from) * progressOf(fade.animation)
        : 1,
    });
  }
  pending.set(list, { blocks, scrollTop: list.scrollTop });
}

/** The read a write left for this commit, taken (null without one). */
export function takeTodoRowsBefore(list: HTMLElement): TodoRowsBefore | null {
  const before = pending.get(list) ?? null;
  pending.delete(list);
  return before;
}

// ---- After -----------------------------------------------------------------

/** To a hundredth of a pixel. */
function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

/** The layer the copies fade in: in the list, out of its flow,
 * absolutely placed at its scroll content's origin (the list is
 * `relative`), so a copy scrolls with the rows; no box of its own, hidden
 * from assistive tech, inert, the pointer going through. Gone with its
 * last copy. */
function layerOf(list: HTMLElement, motion: ListMotion): HTMLDivElement {
  if (motion.layer?.parentElement === list) return motion.layer;
  const layer = document.createElement("div");
  layer.setAttribute(LAYER, "");
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;
  layer.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none";
  list.append(layer);
  motion.layer = layer;
  return layer;
}

/** A copy of a block that left, for the layer: the same look, nothing
 * anything else finds — no ids, none of the panel's `data-todo-*` (the
 * flash, the open row, the menus look rows up by them), not lit, its
 * hover actions hidden. */
function copyOf(block: Element): HTMLElement {
  const copy = block.cloneNode(true) as HTMLElement;
  for (const actions of Array.from(
    copy.querySelectorAll<HTMLElement>(ROW_ACTIONS),
  )) {
    actions.style.visibility = "hidden";
  }
  for (const node of [copy, ...Array.from(copy.querySelectorAll("*"))]) {
    node.removeAttribute("id");
    for (const name of node.getAttributeNames()) {
      if (
        name.startsWith("data-todo-") ||
        name === "data-galley-context-menu-trigger"
      ) {
        node.removeAttribute(name);
      }
    }
  }
  copy.classList.remove(LOCATE_FLASH_CLASS);
  copy.setAttribute("data-role", "todo-row-leaving");
  copy.removeAttribute("role");
  return copy;
}

/** A copy in the page: the CSS animations in it (a box ticking, a strike
 * drawn across, ticket 160) start over in a new element; put to their
 * end, as the row last showed them. One that never ends, stopped. */
function settleCopy(copy: HTMLElement): void {
  if (typeof copy.getAnimations !== "function") return;
  for (const animation of copy.getAnimations({ subtree: true })) {
    try {
      animation.finish();
    } catch {
      animation.cancel();
    }
  }
}

/** An open row's time line opening the date popover (ticket 156,
 * components/todo/TodoDatePopover.tsx): Radix's trigger says it is open. */
const DATE_OPEN =
  '[data-role="todo-meta-date"][aria-expanded="true"], [data-role="todo-add-date"][aria-expanded="true"]';

/** The row the date popover hangs under now, if it is open. */
function dateRowOf(list: HTMLElement): Element | null {
  return list.querySelector(DATE_OPEN)?.closest("[data-todo-row]") ?? null;
}

/**
 * The date popover open on a row that slides (ticket 161's open case):
 * Radix places the popover by the row's box as drawn, transform and all,
 * and follows it only when an IntersectionObserver reports the move
 * (@floating-ui/dom `autoUpdate`'s `layoutShift`), a frame behind — the
 * popover would trail the row it hangs under, by up to a frame's step of
 * the slide (about 13px a row moved, at the slide's fastest). A day or a
 * quick pick closes it once Core has answered, React drawing that a task
 * after the commit that moves the row — as a rule before the frame: the
 * slide stays. One still open in the frame (a time, a reminder or a rule
 * changed, which keep it open; Galley moving that row meanwhile) and this
 * change does not slide: everything goes to its place before the frame
 * is painted, as it did before ticket 161. Fades stay.
 */
function unlessDateStays(
  list: HTMLElement,
  hung: Element,
  slides: readonly Held[],
): void {
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    if (dateRowOf(list) !== hung) return;
    const motion = motions.get(list);
    for (const slide of slides) {
      for (const [block, held] of motion?.slides ?? []) {
        if (held === slide) motion?.slides.delete(block);
      }
      slide.animation.cancel();
    }
  });
}

/**
 * A change drawn (ruling 208 point 3): what an earlier change still moves
 * goes to its place, so everything is read where it stands; then each
 * block that stayed slides from where it was seen, each that left fades
 * as a copy where it stood, each that came fades in
 * (lib/todo-row-motion.ts `todoRowsPlan`). The copies of an earlier change
 * stay where they were seen, the scroll having moved under them. Without
 * the tokens or Web Animations nothing moves: everything is where it ends
 * up, as it was before this ticket.
 */
export function playTodoRows(list: HTMLElement, before: TodoRowsBefore): void {
  const motion = motionOf(list);
  settleBlocks(motion);
  const timing = readBubbleMotionTiming();
  if (!timing || typeof list.animate !== "function") return;
  try {
    const mode = todoRowMotionMode(prefersReducedMotion());
    const parts = todoRowsTiming(timing, mode);
    const origin = originOf(list);
    const after = new Map<Element, TodoBlockBox>();
    for (const block of blocksOf(list)) {
      const rect = block.getBoundingClientRect();
      after.set(block, { top: rect.top - origin.top, height: rect.height });
    }
    const plan = todoRowsPlan({
      before: before.blocks,
      after,
      viewportHeight: list.clientHeight,
      mode,
    });
    const scrollTop = list.scrollTop;
    const scrolled = scrollTop - before.scrollTop;
    if (scrolled !== 0) {
      for (const copy of motion.copies) {
        copy.style.top = px(Number.parseFloat(copy.style.top) + scrolled);
      }
    }

    const slides: Held[] = [];
    for (const [block, shift] of plan.shifts) {
      const animation = block.animate(
        { transform: [`translateY(${px(shift)})`, "translateY(0px)"] },
        { duration: parts.shift.durationMs, easing: parts.shift.easing },
      );
      const slide = { animation, from: shift };
      hold(motion.slides, block, slide);
      slides.push(slide);
    }
    const hung = dateRowOf(list);
    if (hung && motion.slides.has(hung)) unlessDateStays(list, hung, slides);
    for (const [block, from] of plan.entering) {
      const fade = todoEnterFade(parts.enter, from);
      const animation = block.animate(
        { opacity: [from, 1] },
        {
          duration: fade.durationMs,
          delay: fade.delayMs,
          easing: fade.easing,
          // Transparent while it waits for the others to make room.
          fill: "backwards",
        },
      );
      hold(motion.fades, block, { animation, from });
    }
    for (const [block, from] of plan.leaving) {
      const seen = before.blocks.get(block);
      if (!seen) continue;
      const copy = copyOf(block);
      copy.style.position = "absolute";
      copy.style.margin = "0";
      copy.style.top = px(seen.top + scrollTop);
      copy.style.left = px(seen.left + list.scrollLeft);
      copy.style.width = px(seen.width);
      copy.style.height = px(seen.height);
      layerOf(list, motion).append(copy);
      settleCopy(copy);
      motion.copies.add(copy);
      const animation = copy.animate(
        { opacity: [from, 0] },
        {
          duration: parts.leave.durationMs,
          easing: parts.leave.easing,
          fill: "forwards",
        },
      );
      const gone = () => {
        copy.remove();
        motion.copies.delete(copy);
        if (motion.copies.size === 0) {
          motion.layer?.remove();
          motion.layer = null;
        }
      };
      animation.finished.then(gone, gone);
    }
  } catch (error) {
    // Whatever went wrong, the list is left as it ends up.
    settleBlocks(motion);
    console.warn("[todo-row-motion]", error);
  }
}
