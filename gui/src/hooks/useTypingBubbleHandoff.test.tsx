// @vitest-environment jsdom
import { act, type ReactNode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  TypingBubble,
  type TypingProgress,
} from "@/components/conversation/TypingBubble";
import { useTypingBubbleHandoff } from "@/hooks/useTypingBubbleHandoff";

/*
 * The line under the dots in the hand-off (main chat PRD rulings 134,
 * 135): it leaves with the dots when the reply takes their place — only
 * the sentence on screen, its sweep going on where it was (ruling 137).
 */

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** What `animate` was asked for, by the element's role. */
interface Played {
  role: string | null;
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
  options: KeyframeAnimationOptions | number | undefined;
}

describe("the line under the dots in the hand-off", () => {
  const NOW = Date.UTC(2026, 9, 23, 4, 0, 0);
  let played: Played[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    played = [];
    // jsdom has no Web Animations, no ResizeObserver and no CSS.escape;
    // the tokens the hand-off reads its timing from are the page's.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    if (typeof CSS === "undefined" || !CSS.escape) {
      vi.stubGlobal("CSS", { escape: (s: string) => s });
    }
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ) {
      played.push({ role: this.getAttribute("data-role"), keyframes, options });
      return {
        finished: new Promise<never>(() => {}),
        cancel() {},
      } as unknown as Animation;
    };
    const tokens: Record<string, string> = {
      "--motion-slow": "240ms",
      "--motion-fast": "120ms",
      "--ease-pop": "cubic-bezier(0.2, 0.9, 0.3, 1.2)",
      // The line's roll (lib/progress-line-motion.ts).
      "--ease-firm": "cubic-bezier(0.2, 0, 0, 1)",
    };
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = computed(element);
      if (element !== document.documentElement) return style;
      return {
        getPropertyValue: (name: string) =>
          tokens[name] ?? style.getPropertyValue(name),
      } as CSSStyleDeclaration;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (Element.prototype as { animate?: unknown }).animate;
    delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
    delete (document as { timeline?: unknown }).timeline;
  });

  /** A column with the typing bubble until `replied`, then the reply. */
  function Harness({
    replied,
    progress,
  }: {
    replied: boolean;
    progress: TypingProgress | null;
  }) {
    const scroller = useRef<HTMLDivElement>(null);
    const ref = useTypingBubbleHandoff({
      enabled: true,
      live: !replied,
      scrollContainerRef: scroller,
      handoff: replied ? { tick: 1, kind: "reply", messageId: "a-1" } : null,
    });
    return (
      <div ref={scroller} data-role="scroller">
        <div data-role="column">
          {replied ? (
            <div data-message-id="a-1">
              <div data-role="assistant-bubble">
                <p>东部我看好凯尔特人。</p>
              </div>
            </div>
          ) : (
            <TypingBubble ref={ref} progress={progress} />
          )}
        </div>
      </div>
    );
  }

  function handOff(
    progress: TypingProgress | null,
    then?: TypingProgress | null,
  ) {
    mount(<Harness replied={false} progress={progress} />);
    // A new sentence just before the reply: its roll is still running
    // (`animate` here never finishes).
    if (then) {
      act(() => root!.render(<Harness replied={false} progress={then} />));
    }
    act(() => root!.render(<Harness replied progress={then ?? progress} />));
    return document.querySelector<HTMLElement>('[data-role="scroller"]')!;
  }

  it("leaves with the dots: a copy out of the layout, on their duration and curve", () => {
    const scroller = handOff({
      doing: "我对比各队近三季的胜场",
      startedAtMs: NOW - 12_000,
      baseMs: 0,
    });
    // The column holds the reply alone; the copies sit in the hidden layer.
    expect(scroller.querySelector('[data-role="assistant-typing"]')).toBeNull();
    const line = scroller.querySelector<HTMLElement>(
      '[data-role="assistant-progress-leaving"]',
    )!;
    expect(line).not.toBeNull();
    expect(line.textContent).toBe("我对比各队近三季的胜场 · 12 秒");
    const layer = line.parentElement!;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.style.cssText).toContain("position: absolute");
    expect(layer.style.cssText).toContain("width: 0px");
    expect(
      layer.querySelector('[data-role="assistant-typing-dots-leaving"]'),
    ).not.toBeNull();
    expect(line.style.position).toBe("absolute");
    expect(line.style.margin).toBe("0px");
    expect(line.style.maxWidth).toBe("none");
    // The same fade as the dots' copy.
    const dots = played.find((p) => p.role === "assistant-typing-dots-leaving");
    const own = played.find((p) => p.role === "assistant-progress-leaving");
    expect(dots).toBeDefined();
    expect(own).toEqual({ ...dots, role: "assistant-progress-leaving" });
    expect(own!.keyframes).toEqual({ opacity: [1, 0] });
    expect(own!.options).toEqual({
      duration: 120,
      easing: "cubic-bezier(0.2, 0.9, 0.3, 1.2)",
      fill: "forwards",
    });
    // The reply still grows from the bubble's box (its clip-path).
    expect(
      played.some(
        (p) =>
          p.role === "assistant-bubble" &&
          p.keyframes !== null &&
          "clipPath" in p.keyframes,
      ),
    ).toBe(true);
  });

  it("copies only the sentence on screen, mid-roll: the one rolling out stays behind", () => {
    const scroller = handOff(
      { doing: "我查各队伤病与轮换", startedAtMs: NOW - 12_000, baseMs: 0 },
      { doing: "我对比各队近三季的胜场", startedAtMs: NOW - 12_000, baseMs: 0 },
    );
    // The roll was under way when the reply came.
    expect(played.map((p) => p.role)).toEqual(
      expect.arrayContaining([
        "assistant-progress-doing-leaving",
        "assistant-progress-doing",
      ]),
    );
    const line = scroller.querySelector<HTMLElement>(
      '[data-role="assistant-progress-leaving"]',
    )!;
    expect(line.textContent).toBe("我对比各队近三季的胜场 · 12 秒");
    expect(
      line.querySelector('[data-role="assistant-progress-doing-leaving"]'),
    ).toBeNull();
    const box = line.querySelector(
      '[data-role="assistant-progress-doing-box"]',
    )!;
    expect(Array.from(box.children).map((e) => e.textContent)).toEqual([
      "我对比各队近三季的胜场",
    ]);
  });

  it("carries the sweep on where it was, as the dots' loop", () => {
    // The sweep on the sentence started at 1000ms on the document
    // timeline; the reply comes at 1600ms.
    const timeline = { currentTime: 1000 };
    Object.defineProperty(document, "timeline", {
      configurable: true,
      value: timeline,
    });
    Element.prototype.getAnimations = function (this: Element) {
      if (this.getAttribute("data-role") !== "assistant-progress-doing") {
        return [];
      }
      // A roll running on it too: not the sweep.
      return [
        { startTime: 900 },
        { animationName: "progress-shimmer", startTime: 1000 },
      ] as unknown as Animation[];
    };
    const progress = {
      doing: "我对比各队近三季的胜场",
      startedAtMs: NOW - 12_000,
      baseMs: 0,
    };
    mount(<Harness replied={false} progress={progress} />);
    timeline.currentTime = 1600;
    act(() => root!.render(<Harness replied progress={progress} />));
    const sentence = document.querySelector<HTMLElement>(
      '[data-role="assistant-progress-leaving"] [data-role="assistant-progress-doing"]',
    )!;
    expect(sentence.style.animationDelay).toBe("-600ms");
    // The time has no sweep to carry.
    const elapsed = document.querySelector<HTMLElement>(
      '[data-role="assistant-progress-leaving"] [data-role="assistant-progress-elapsed"]',
    )!;
    expect(elapsed.style.animationDelay).toBe("");
  });

  it("copies nothing more without a line (a round Core woke it for)", () => {
    const scroller = handOff(null);
    expect(
      scroller.querySelector('[data-role="assistant-progress-leaving"]'),
    ).toBeNull();
    expect(
      scroller.querySelector('[data-role="assistant-typing-dots-leaving"]'),
    ).not.toBeNull();
    expect(played.map((p) => p.role)).not.toContain(
      "assistant-progress-leaving",
    );
  });
});
