// @vitest-environment jsdom
import { act } from "react";
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
import { zhCopy } from "@/i18n/locales/zh";

/*
 * The line under the dots moving (main chat PRD ruling 137, ticket 93):
 * a new sentence rolls in, the doing part sweeps, the time does neither.
 * The rules alone are in lib/progress-line-motion.test.ts; the hand-off's
 * copy in hooks/useTypingBubbleHandoff.test.tsx.
 */

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(doing: string) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<TypingBubble progress={progress(doing)} />));
}

function say(doing: string) {
  act(() => root!.render(<TypingBubble progress={progress(doing)} />));
}

const NOW = Date.UTC(2026, 9, 23, 4, 0, 0);

/** A fresh object each time, as MainView builds it every render. */
function progress(doing: string): TypingProgress {
  return { doing, startedAtMs: NOW - 12_000, baseMs: 0 };
}

function q(role: string): HTMLElement[] {
  return Array.from(
    host!.querySelectorAll<HTMLElement>(`[data-role="${role}"]`),
  );
}

/** What the status region reads out: its text, `aria-hidden` left out. */
function spoken(node: Node): string {
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") {
    return "";
  }
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return Array.from(node.childNodes).map(spoken).join("");
}

/** What `animate` was asked for, and a hand on each animation. */
interface Played {
  element: Element;
  role: string | null;
  text: string | null;
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
  options: KeyframeAnimationOptions | number | undefined;
  finish: () => void;
  cancelled: boolean;
}

describe("the line under the dots", () => {
  let played: Played[] = [];
  let reduced = false;
  let tokens: Record<string, string> = {};

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    played = [];
    reduced = false;
    tokens = {
      "--motion-slow": "240ms",
      "--ease-firm": "cubic-bezier(0.2, 0, 0, 1)",
    };
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && reduced,
    }));
    // jsdom has no Web Animations: each call is kept, finished by hand.
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ) {
      let resolve: () => void = () => {};
      let reject: (error: unknown) => void = () => {};
      const finished = new Promise<void>((ok, fail) => {
        resolve = ok;
        reject = fail;
      });
      const entry: Played = {
        element: this,
        role: this.getAttribute("data-role"),
        text: this.textContent,
        keyframes,
        options,
        finish: () => resolve(),
        cancelled: false,
      };
      played.push(entry);
      return {
        finished,
        cancel() {
          entry.cancelled = true;
          reject(new DOMException("cancelled", "AbortError"));
        },
      } as unknown as Animation;
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
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (Element.prototype as { animate?: unknown }).animate;
  });

  it("sweeps the doing part, not the time", () => {
    mount("我查各队伤病与轮换");
    const [doing] = q("assistant-progress-doing");
    expect(doing.className.split(" ")).toEqual(
      expect.arrayContaining(["truncate-fade", "progress-shimmer"]),
    );
    expect(doing.textContent).toBe("我查各队伤病与轮换");
    // Its box clips the roll to the line.
    expect(doing.parentElement!.getAttribute("data-role")).toBe(
      "assistant-progress-doing-box",
    );
    expect(doing.parentElement!.className).toBe("grid min-w-0 overflow-hidden");
    const [elapsed] = q("assistant-progress-elapsed");
    expect(elapsed.textContent).toBe(" · 12 秒");
    expect(elapsed.className).not.toContain("shimmer");
    expect(elapsed.parentElement).toBe(q("assistant-progress")[0]);
  });

  it("does not roll as it first appears, nor for the same sentence again", () => {
    mount("思考中");
    say("思考中");
    say("思考中");
    expect(played).toEqual([]);
    expect(q("assistant-progress-doing-leaving")).toEqual([]);
    expect(q("assistant-progress-doing").map((e) => e.textContent)).toEqual([
      "思考中",
    ]);
  });

  it("rolls the old sentence up and out and the new one in from below, on --motion-slow / --ease-firm", () => {
    mount("思考中");
    const first = q("assistant-progress-doing")[0];
    say("我查各队伤病与轮换");
    // Both in the box: the old one first, under the new one.
    const [leaving] = q("assistant-progress-doing-leaving");
    const [doing] = q("assistant-progress-doing");
    expect(leaving).toBe(first); // the same element turns round
    expect(leaving.textContent).toBe("思考中");
    expect(leaving.className).toContain("progress-shimmer");
    expect(leaving.className).toContain("pointer-events-none");
    expect(doing.textContent).toBe("我查各队伤病与轮换");
    expect(Array.from(doing.parentElement!.children)).toEqual([leaving, doing]);
    const timing = { duration: 240, easing: "cubic-bezier(0.2, 0, 0, 1)" };
    expect(
      played.map(({ element, keyframes, options }) => [
        element,
        keyframes,
        options,
      ]),
    ).toEqual([
      [
        leaving,
        { transform: ["none", "translateY(-100%)"] },
        { ...timing, fill: "forwards" },
      ],
      [doing, { transform: ["translateY(100%)", "translateY(0)"] }, timing],
    ]);
  });

  it("reads out only the new sentence: the one leaving is aria-hidden", () => {
    mount("思考中");
    say("我查各队伤病与轮换");
    const [row] = q("assistant-typing");
    expect(row.getAttribute("role")).toBe("status");
    expect(
      q("assistant-progress-doing-leaving")[0].getAttribute("aria-hidden"),
    ).toBe("true");
    expect(spoken(row)).toBe(
      `${zhCopy.assistant.typingLabel}我查各队伤病与轮换`,
    );
  });

  it("drops the old sentence once it has rolled out", async () => {
    mount("思考中");
    say("我查各队伤病与轮换");
    await act(async () => {
      for (const p of played) p.finish();
    });
    expect(q("assistant-progress-doing-leaving")).toEqual([]);
    expect(
      Array.from(q("assistant-progress-doing")[0].parentElement!.children).map(
        (e) => e.textContent,
      ),
    ).toEqual(["我查各队伤病与轮换"]);
  });

  it("goes straight to the newest mid-roll: the one coming in turns round from where it is", () => {
    mount("思考中");
    say("我查各队伤病与轮换");
    const midway = q("assistant-progress-doing")[0];
    const comingIn = played[1];
    // Where the roll has it now.
    midway.style.transform = "translateY(6px)";
    say("正在写回复");
    expect(comingIn.cancelled).toBe(true);
    // The one before it goes on undisturbed.
    expect(played[0].cancelled).toBe(false);
    const roll = played.slice(2);
    expect(roll.map((p) => [p.text, p.keyframes])).toEqual([
      [
        "我查各队伤病与轮换",
        { transform: ["translateY(6px)", "translateY(-100%)"] },
      ],
      ["正在写回复", { transform: ["translateY(100%)", "translateY(0)"] }],
    ]);
    expect(q("assistant-progress-doing").map((e) => e.textContent)).toEqual([
      "正在写回复",
    ]);
    expect(
      q("assistant-progress-doing-leaving").map((e) => e.textContent),
    ).toEqual(["思考中", "我查各队伤病与轮换"]);
    expect(spoken(q("assistant-typing")[0])).toBe(
      `${zhCopy.assistant.typingLabel}正在写回复`,
    );
  });

  it("fades in place under reduced motion, read at each change", () => {
    mount("思考中");
    reduced = true;
    say("我查各队伤病与轮换");
    expect(played.map((p) => [p.text, p.keyframes])).toEqual([
      ["思考中", { opacity: ["1", "0"] }],
      ["我查各队伤病与轮换", { opacity: [0, 1] }],
    ]);
    reduced = false;
    say("正在写回复");
    expect(played.slice(2).map((p) => p.keyframes)).toEqual([
      { transform: ["none", "translateY(-100%)"] },
      { transform: ["translateY(100%)", "translateY(0)"] },
    ]);
  });

  it("swaps when the tokens cannot be read", async () => {
    mount("思考中");
    tokens = {};
    say("我查各队伤病与轮换");
    expect(played).toEqual([]);
    await act(async () => {});
    expect(q("assistant-progress-doing-leaving")).toEqual([]);
    expect(q("assistant-progress-doing").map((e) => e.textContent)).toEqual([
      "我查各队伤病与轮换",
    ]);
  });

  it("swaps without Web Animations, keeping nothing to leave", () => {
    delete (Element.prototype as { animate?: unknown }).animate;
    mount("思考中");
    say("我查各队伤病与轮换");
    expect(q("assistant-progress-doing-leaving")).toEqual([]);
    expect(q("assistant-progress-doing").map((e) => e.textContent)).toEqual([
      "我查各队伤病与轮换",
    ]);
  });
});
