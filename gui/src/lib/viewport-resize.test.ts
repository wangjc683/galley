import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  keepBottomOnViewportResize,
  viewportResizeScrollTop,
} from "@/lib/viewport-resize";

describe("viewportResizeScrollTop", () => {
  it("keeps a conversation that sat at the bottom there when the composer grows or shrinks", () => {
    // 968px of conversation in a 790px viewport; three lines grow the
    // composer by 45px.
    expect(
      viewportResizeScrollTop({
        previousHeight: 790,
        height: 745,
        scrollHeight: 968,
        wasAtBottom: true,
      }),
    ).toBe(223);
    // Back to one line after the send.
    expect(
      viewportResizeScrollTop({
        previousHeight: 745,
        height: 790,
        scrollHeight: 968,
        wasAtBottom: true,
      }),
    ).toBe(178);
    // A conversation shorter than the viewport has nowhere to scroll.
    expect(
      viewportResizeScrollTop({
        previousHeight: 790,
        height: 745,
        scrollHeight: 600,
        wasAtBottom: true,
      }),
    ).toBe(0);
  });

  it("leaves a reader who scrolled up where they are", () => {
    expect(
      viewportResizeScrollTop({
        previousHeight: 790,
        height: 745,
        scrollHeight: 968,
        wasAtBottom: false,
      }),
    ).toBeNull();
  });

  it("does nothing on the first measure or when the height did not change", () => {
    expect(
      viewportResizeScrollTop({
        previousHeight: null,
        height: 790,
        scrollHeight: 968,
        wasAtBottom: true,
      }),
    ).toBeNull();
    expect(
      viewportResizeScrollTop({
        previousHeight: 790,
        height: 790,
        scrollHeight: 1_200,
        wasAtBottom: true,
      }),
    ).toBeNull();
  });
});

describe("keepBottomOnViewportResize", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A stand-in ResizeObserver the test fires by hand. */
  function stubObserver() {
    const made: {
      fire: () => void;
      target: unknown;
      disconnected: boolean;
    }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private entry: (typeof made)[number];
        constructor(callback: () => void) {
          this.entry = {
            fire: () => callback(),
            target: null,
            disconnected: false,
          };
          made.push(this.entry);
        }
        observe(target: unknown) {
          this.entry.target = target;
        }
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
    return made;
  }

  it("watches the scroll container itself and pins it while it sat at the bottom", () => {
    const made = stubObserver();
    const el = { scrollTop: 178, scrollHeight: 968, clientHeight: 790 };
    let atBottom = true;
    const stop = keepBottomOnViewportResize(
      el as unknown as HTMLElement,
      () => atBottom,
    );
    expect(made).toHaveLength(1);
    expect(made[0].target).toBe(el);
    // The first callback (on observe) only measures.
    made[0].fire();
    expect(el.scrollTop).toBe(178);
    // The composer grows by three lines.
    el.clientHeight = 745;
    made[0].fire();
    expect(el.scrollTop).toBe(223);
    // The reader scrolls up, then the composer grows again: left alone.
    atBottom = false;
    el.scrollTop = 40;
    el.clientHeight = 700;
    made[0].fire();
    expect(el.scrollTop).toBe(40);
    stop();
    expect(made[0].disconnected).toBe(true);
  });
});

describe("useStickyScroll", () => {
  it("applies the rule to its scroll container, by its own at-bottom state", () => {
    // A static render runs no effects, so this checks the wiring in the
    // source (the rule itself is tested above). The workbench's live
    // tail (ticket 06) keeps its parked message on its line itself, so
    // the rule stands down while it holds following off.
    const source = readFileSync(
      path.resolve(__dirname, "../hooks/useStickyScroll.ts"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(source).toContain(
      "keepBottomOnViewportResize( el, () => atBottomRef.current && !tailRef.current?.noFollow, )",
    );
  });
});
