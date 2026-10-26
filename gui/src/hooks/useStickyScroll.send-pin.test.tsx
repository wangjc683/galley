// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { useStickyScroll } from "@/hooks/useStickyScroll";

/*
 * 贴底's send lands at the bottom in the commit that draws it, before
 * paint (main chat ruling 138, ticket 94): the send's slide measures the
 * column where it ends, so the first frame is the slide's start. Before,
 * a send while you read further up was put at the bottom a frame later.
 * The workbench's send is its own and unchanged.
 */

const LAYOUT = { scrollHeight: 3000, clientHeight: 600 };
const scrollTops = new WeakMap<Element, number>();
const isScroller = (el: Element) => el.hasAttribute("data-scroller");
const saved: [object, string, PropertyDescriptor | undefined][] = [];

function stub(target: object, name: string, descriptor: PropertyDescriptor) {
  saved.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
  Object.defineProperty(target, name, { configurable: true, ...descriptor });
}

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  stub(Element.prototype, "scrollTop", {
    get(this: Element) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      const max = isScroller(this)
        ? LAYOUT.scrollHeight - LAYOUT.clientHeight
        : 0;
      scrollTops.set(this, Math.max(0, Math.min(max, value)));
    },
  });
  stub(Element.prototype, "scrollHeight", {
    get(this: Element) {
      return isScroller(this) ? LAYOUT.scrollHeight : 0;
    },
  });
  stub(Element.prototype, "clientHeight", {
    get(this: Element) {
      return isScroller(this) ? LAYOUT.clientHeight : 0;
    },
  });
  class ResizeObserverStandIn {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  stub(globalThis, "ResizeObserver", { value: ResizeObserverStandIn });
});

afterAll(() => {
  for (const [target, name, descriptor] of saved.reverse()) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete (target as Record<string, unknown>)[name];
  }
});

function Harness({
  tick,
  stickBottom,
}: {
  tick: number;
  stickBottom: boolean;
}) {
  const { scrollContainerRef } = useStickyScroll({
    activeSessionId: "s",
    userSubmitTick: tick,
    streamingContent: "",
    turnsLength: tick,
    stickBottom,
  });
  return (
    <div ref={scrollContainerRef} data-scroller="">
      <div />
    </div>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Mounted, settled at the bottom, then scrolled up to read. */
async function readingUp(stickBottom: boolean, tick: number) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Harness tick={tick} stickBottom={stickBottom} />));
  await act(async () => {
    await frame();
    await frame();
  });
  const el = document.querySelector<HTMLElement>("[data-scroller]")!;
  act(() => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  return el;
}

describe("a send in the main chat (贴底)", () => {
  it("is at the bottom when its commit is drawn, not a frame later", async () => {
    const el = await readingUp(true, 10);
    act(() => root!.render(<Harness tick={11} stickBottom />));
    expect(el.scrollTop).toBe(LAYOUT.scrollHeight - LAYOUT.clientHeight);
  });

  it("leaves the workbench's send to its own frame", async () => {
    const el = await readingUp(false, 20);
    act(() => root!.render(<Harness tick={21} stickBottom={false} />));
    expect(el.scrollTop).toBe(0);
  });
});
