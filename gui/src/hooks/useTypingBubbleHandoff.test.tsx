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
 * 135): it leaves with the dots when the reply takes their place.
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

  function handOff(progress: TypingProgress | null) {
    mount(<Harness replied={false} progress={progress} />);
    act(() => root!.render(<Harness replied progress={progress} />));
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
