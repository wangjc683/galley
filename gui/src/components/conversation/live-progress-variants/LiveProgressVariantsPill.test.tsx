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

import {
  useLiveProgressStore,
  useLiveProgressVariant,
} from "./live-progress-variants";
import { LiveProgressVariantsPill } from "./LiveProgressVariantsPill";

/*
 * TEMP variant switcher (main chat 90) — the pill (a dev build's only,
 * switching at once), and 「新」's line leaving with the dots when the
 * reply takes their place. If 「新」 wins, the hand-off half moves next to
 * useTypingBubbleHandoff; the rest goes with this folder.
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
  useLiveProgressStore.setState({ variant: "now" });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---- The pill ---------------------------------------------------------------------

/** What a surface reads, shown. */
function Probe() {
  return <span data-role="probe">{useLiveProgressVariant()}</span>;
}

describe("the pill", () => {
  it("is in a dev build: 「临时 · 在跑」, 现状 / 新, under the header at the window's centre", () => {
    mount(<LiveProgressVariantsPill />);
    const pill = document.body.querySelector<HTMLElement>(
      '[data-role="live-progress-variants-pill"]',
    );
    expect(pill).not.toBeNull();
    // Portalled to <body>, clickable over any overlay.
    expect(pill!.parentElement).toBe(document.body);
    expect(pill!.style.pointerEvents).toBe("auto");
    expect(pill!.className).toContain("fixed left-1/2 top-[52px]");
    expect(pill!.textContent?.startsWith("临时 · 在跑")).toBe(true);
    const options = [...pill!.querySelectorAll("button")];
    expect(options.map((b) => b.textContent)).toEqual(["现状", "新"]);
    expect(options.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
    ]);
  });

  it("switches what the surfaces read at once, back and forth", () => {
    mount(
      <>
        <LiveProgressVariantsPill />
        <Probe />
      </>,
    );
    const probe = () =>
      document.body.querySelector('[data-role="probe"]')?.textContent;
    const option = (name: string) =>
      [
        ...document.body.querySelectorAll<HTMLButtonElement>(
          '[data-role="live-progress-variants-pill"] button',
        ),
      ].find((b) => b.textContent === name)!;
    expect(probe()).toBe("now");
    act(() => option("新").click());
    expect(probe()).toBe("new");
    expect(option("新").getAttribute("aria-pressed")).toBe("true");
    act(() => option("现状").click());
    expect(probe()).toBe("now");
  });

  it("is nothing outside a dev build, which always reads 现状", () => {
    vi.stubEnv("DEV", false);
    useLiveProgressStore.setState({ variant: "new" });
    mount(
      <>
        <LiveProgressVariantsPill />
        <Probe />
      </>,
    );
    expect(
      document.body.querySelector('[data-role="live-progress-variants-pill"]'),
    ).toBeNull();
    expect(
      document.body.querySelector('[data-role="probe"]')?.textContent,
    ).toBe("now");
  });
});

// ---- The hand-off -------------------------------------------------------------------

/** What `animate` was asked for, by the element's role. */
interface Played {
  role: string | null;
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
  options: KeyframeAnimationOptions | number | undefined;
}

describe("新's line in the hand-off", () => {
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

  it("copies nothing more in 现状 (no line)", () => {
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
