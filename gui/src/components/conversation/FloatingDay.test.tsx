// @vitest-environment jsdom
import { act, useRef } from "react";
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

import { FloatingDay } from "@/components/conversation/FloatingDay";
import { FLOATING_DAY_IDLE_MS } from "@/hooks/useFloatingDay";
import { CopyProvider } from "@/lib/i18n";
import type { ResolvedLanguage } from "@/lib/language";

/*
 * The main chat's floating day (ruling 171, ticket 124): shown while
 * you scroll, a second after you stop it goes; the day changes as you
 * scroll; not while the top row is today, nor for the conversation's
 * own scrolls along its bottom (useStickyScroll's `atBottom`). The page
 * is a fake laid out by hand: rows stack from the scroll container's
 * top and report their box from its `scrollTop`.
 */

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const NOW = new Date(2026, 10, 2, 15, 0);
const ROW_H = 100;
const FRAME = 16;

function at(m: number, d: number, h = 12): number {
  return new Date(2026, m, d, h).getTime();
}

/** Six rows, a hundred px each: two on Oct 28, a time line, one
 * yesterday, then two today. */
const ROWS: (number | null)[] = [
  at(9, 28, 10),
  at(9, 28, 11),
  null,
  at(10, 1, 21),
  at(10, 2, 9),
  at(10, 2, 9),
];
/** scrollTop that puts row `i`'s middle on the viewport's top edge. */
const onRow = (i: number) => i * ROW_H + ROW_H / 2;

function Harness({ atBottom }: { atBottom: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <div data-area="">
      <div ref={scroller} data-scroller="">
        <div>
          <div data-role="conversation">
            {ROWS.map((rowMs, i) => (
              <div key={i} data-row={i} data-at={rowMs ?? undefined} />
            ))}
          </div>
        </div>
      </div>
      <FloatingDay scrollContainerRef={scroller} atBottom={atBottom} />
    </div>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let containerReads = 0;

function mount(atBottom: boolean, language: ResolvedLanguage = "zh-CN") {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  render(atBottom, language);
}

function render(atBottom: boolean, language: ResolvedLanguage = "zh-CN") {
  act(() =>
    root!.render(
      <CopyProvider language={language}>
        <Harness atBottom={atBottom} />
      </CopyProvider>,
    ),
  );
}

const scroller = () => host!.querySelector<HTMLDivElement>("[data-scroller]")!;
const pill = () =>
  host!.querySelector<HTMLElement>('[data-role="floating-day"] > div')!;
const shown = () => pill().getAttribute("data-shown") === "true";
const text = () => pill().textContent;

/** A scroll to `top`, and the frame after it. */
function scrollTo(top: number) {
  const el = scroller();
  el.scrollTop = top;
  act(() => {
    el.dispatchEvent(new Event("scroll"));
  });
  advance(FRAME);
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: [
      "Date",
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  containerReads = 0;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const el = scroller();
      if (this === el) {
        containerReads += 1;
        return new DOMRect(0, 0, 600, 400);
      }
      const row = this.getAttribute("data-row");
      if (row === null) return new DOMRect();
      return new DOMRect(0, Number(row) * ROW_H - el.scrollTop, 600, ROW_H);
    },
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the floating day", () => {
  it("is mounted empty and transparent, out of the reader's way", () => {
    mount(false);
    expect(shown()).toBe(false);
    expect(text()).toBe("");
    expect(pill().className).toContain("opacity-0");
    const overlay = host!.querySelector('[data-role="floating-day"]')!;
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.className).toContain("pointer-events-none");
    expect(overlay.className).toContain("absolute inset-x-0 top-3 z-10");
  });

  it("shows the top row's day on a scroll, and goes a second after the last one", () => {
    mount(false);
    scrollTo(onRow(0));
    expect(shown()).toBe(true);
    expect(text()).toBe("10月28日");
    expect(pill().className).toContain("opacity-100");
    expect(pill().className).toContain("duration-(--motion-fast)");
    // Still scrolling: the second runs from the last scroll (read in
    // the frame after it).
    advance(600);
    scrollTo(onRow(1));
    advance(FLOATING_DAY_IDLE_MS - FRAME - 1);
    expect(shown()).toBe(true);
    advance(FRAME + 1);
    expect(shown()).toBe(false);
    // It fades out with its words, slower than it came.
    expect(text()).toBe("10月28日");
    expect(pill().className).toContain("opacity-0");
    expect(pill().className).toContain("duration-(--motion-slow)");
  });

  it("changes the day as the top row moves into another one", () => {
    mount(false);
    scrollTo(onRow(1));
    expect(text()).toBe("10月28日");
    // A time line takes the day of the message under it.
    scrollTo(onRow(2));
    expect(text()).toBe("昨天");
    scrollTo(onRow(3));
    expect(text()).toBe("昨天");
    expect(shown()).toBe(true);
  });

  it("does not show while the top row is today; scrolled back into today it goes, with the day it said", () => {
    mount(false);
    scrollTo(onRow(4));
    expect(shown()).toBe(false);
    expect(text()).toBe("");
    scrollTo(onRow(3));
    expect(shown()).toBe(true);
    expect(text()).toBe("昨天");
    scrollTo(onRow(4));
    expect(shown()).toBe(false);
    expect(text()).toBe("昨天");
  });

  it("does not show for the landing on the bottom (opening, a session switch), nor while following it", () => {
    // The bottom here still has yesterday at the top of the viewport.
    mount(true);
    scrollTo(onRow(3));
    advance(200);
    scrollTo(onRow(3) + 20);
    expect(shown()).toBe(false);
    // Scrolling away from the bottom is yours.
    render(false);
    scrollTo(onRow(1));
    expect(shown()).toBe(true);
    expect(text()).toBe("10月28日");
    // Back on the bottom (「回到底部」 arriving, ⌥↓ to the last one): gone.
    render(true);
    expect(shown()).toBe(false);
  });

  it("reads the rows once a frame however many scroll events come, and never scrolls", () => {
    mount(false);
    const el = scroller();
    el.scrollTop = onRow(0);
    act(() => {
      for (let i = 0; i < 5; i++) el.dispatchEvent(new Event("scroll"));
    });
    expect(containerReads).toBe(0);
    advance(FRAME);
    expect(containerReads).toBe(1);
    expect(el.scrollTop).toBe(onRow(0));
  });

  it("writes the day in English as the time line does", () => {
    mount(false, "en-US");
    scrollTo(onRow(0));
    expect(text()).toBe("Oct 28");
    scrollTo(onRow(3));
    expect(text()).toBe("Yesterday");
  });
});
