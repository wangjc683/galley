import { readFileSync } from "node:fs";
import path from "node:path";
import { vi, type Mock } from "vitest";

import { BUBBLE_MOTION_TOKENS } from "@/lib/bubble-motion";
import {
  HANDOFF_EASING_TOKEN,
  HANDOFF_FADE_TOKEN,
  HANDOFF_GROW_TOKEN,
} from "@/lib/typing-bubble-handoff";

/*
 * A page for the main chat's motion tests (ruling 138, ticket 94): jsdom
 * has no layout, no Web Animations and no ResizeObserver. Here the
 * scroller (`data-conversation-backdrop`) is a viewport at the top of the
 * window; its one child is the column, at `layout.columnTop`; the column's
 * children and the conversation's rows stack down from it, each as high as
 * its `data-h` (the typing bubble 67, anything else 40). A copy in the
 * motion layer sits where its style puts it. `animate` records what was
 * played and returns an animation that ends when told; a ResizeObserver
 * reports what it was told to observe when `frame()` runs them, in the
 * order they were made — the frame's resize step, before paint.
 */

export interface FakeAnimation {
  cancel: Mock<() => void>;
  finished: Promise<FakeAnimation>;
  /** Its eased progress now, as `getComputedTiming()` gives it. */
  progress: number | null;
  effect: { getComputedTiming: () => { progress: number | null } };
  /** Ends it, as running to its end would. */
  end: () => void;
}

export interface Played {
  el: Element;
  role: string | null;
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
  options: KeyframeAnimationOptions;
  animation: FakeAnimation;
}

export interface Page {
  played: Played[];
  layout: { columnTop: number; viewportHeight: number };
  /** The frame's resize step: every observer's first report. */
  frame: () => void;
  /** How often anything asked for a box. */
  reads: () => number;
  /** 「减少动态效果」 on. */
  reduceMotion: () => void;
}

/** The tokens as globals.css defines them. */
function tokens(): Record<string, string> {
  const css = readFileSync(
    path.resolve(__dirname, "../styles/globals.css"),
    "utf8",
  );
  const out: Record<string, string> = {};
  for (const name of [
    ...Object.values(BUBBLE_MOTION_TOKENS),
    HANDOFF_GROW_TOKEN,
    HANDOFF_FADE_TOKEN,
    HANDOFF_EASING_TOKEN,
  ]) {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
    if (match) out[name] = match[1];
  }
  return out;
}

const LAYER = "data-bubble-motion-layer";

function isScroller(el: Element): boolean {
  return el.hasAttribute("data-conversation-backdrop");
}

function heightOf(el: Element): number {
  if (el.hasAttribute(LAYER)) return 0;
  const own = el.getAttribute("data-h");
  if (own !== null) return Number(own);
  if (
    el.getAttribute("data-role") === "conversation" ||
    (el.parentElement && isScroller(el.parentElement))
  ) {
    return Array.from(el.children).reduce((sum, c) => sum + heightOf(c), 0);
  }
  if (el.getAttribute("data-role") === "assistant-typing") return 67;
  return 40;
}

function rect(top: number, height: number, left = 0, width = 700): DOMRect {
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    height,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

export function installPage(): Page {
  const played: Played[] = [];
  const layout = { columnTop: 300, viewportHeight: 600 };
  let reads = 0;
  const observers: {
    callback: ResizeObserverCallback;
    pending: Set<Element>;
    self: ResizeObserver;
  }[] = [];

  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly entry: (typeof observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.entry = {
          callback,
          pending: new Set(),
          self: this as unknown as ResizeObserver,
        };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.pending.add(target);
      }
      unobserve(target: Element) {
        this.entry.pending.delete(target);
      }
      disconnect() {
        this.entry.pending.clear();
      }
    },
  );
  if (typeof CSS === "undefined" || !CSS.escape) {
    vi.stubGlobal("CSS", { escape: (s: string) => s });
  }

  const topOf = (el: Element): number => {
    const parent = el.parentElement;
    if (!parent) return 0;
    if (isScroller(parent)) return layout.columnTop;
    const stacked =
      isScroller(parent.parentElement ?? parent) ||
      parent.getAttribute("data-role") === "conversation";
    if (!stacked) return topOf(parent);
    let top = topOf(parent);
    for (const sibling of Array.from(parent.children)) {
      if (sibling === el) break;
      top += heightOf(sibling);
    }
    return top;
  };
  /** The box `el` takes its place from: itself when it is the column, a
   * child of it or a row of the conversation; else the nearest of those
   * around it. */
  const rowOf = (el: Element): Element => {
    const parent = el.parentElement;
    if (
      !parent ||
      isScroller(parent) ||
      (parent.parentElement && isScroller(parent.parentElement)) ||
      parent.getAttribute("data-role") === "conversation"
    ) {
      return el;
    }
    return rowOf(parent);
  };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      reads++;
      if (isScroller(this)) return rect(0, layout.viewportHeight, 0, 760);
      const style = (this as HTMLElement).style;
      if (style?.position === "absolute" && style.top) {
        return rect(
          Number.parseFloat(style.top),
          Number.parseFloat(style.height) || 0,
          Number.parseFloat(style.left) || 0,
          Number.parseFloat(style.width) || 0,
        );
      }
      const row = rowOf(this);
      return rect(topOf(row), heightOf(row));
    },
  );
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(
    function (this: Element) {
      return isScroller(this) ? layout.viewportHeight : 0;
    },
  );

  const values = tokens();
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = computed(element);
    if (element !== document.documentElement) return style;
    return {
      getPropertyValue: (name: string) =>
        values[name] ?? style.getPropertyValue(name),
    } as CSSStyleDeclaration;
  });

  Element.prototype.animate = function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    let resolve: (a: FakeAnimation) => void = () => {};
    const animation: FakeAnimation = {
      cancel: vi.fn(),
      finished: new Promise<FakeAnimation>((r) => {
        resolve = r;
      }),
      progress: null,
      effect: { getComputedTiming: () => ({ progress: animation.progress }) },
      end: () => resolve(animation),
    };
    played.push({
      el: this,
      role: this.getAttribute("data-role"),
      keyframes,
      options: (typeof options === "number"
        ? { duration: options }
        : (options ?? {})) as KeyframeAnimationOptions,
      animation,
    });
    return animation as unknown as Animation;
  };

  return {
    played,
    layout,
    frame: () => {
      for (const entry of [...observers]) {
        if (entry.pending.size === 0) continue;
        const targets = [...entry.pending];
        entry.pending.clear();
        entry.callback(
          targets.map((target) => ({ target }) as ResizeObserverEntry),
          entry.self,
        );
      }
    },
    reads: () => reads,
    reduceMotion: () => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
      }));
    },
  };
}

export function uninstallPage(): void {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
  delete (document as { timeline?: unknown }).timeline;
}

/** The keyframes' `transform` values, in order. */
export function transforms(p: Played): string[] {
  const k = p.keyframes;
  if (!k) return [];
  if (Array.isArray(k)) return k.map((f) => String(f.transform ?? ""));
  const t = (k as PropertyIndexedKeyframes).transform;
  return Array.isArray(t) ? t.map(String) : t ? [String(t)] : [];
}

/** The keyframes' `opacity` values, or null without any. */
export function opacities(p: Played): unknown[] | null {
  const k = p.keyframes;
  if (!k || Array.isArray(k)) return null;
  const o = (k as PropertyIndexedKeyframes).opacity;
  return o === undefined ? null : Array.isArray(o) ? o : [o];
}
