// @vitest-environment jsdom
import { act, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  EARLIER_TRIGGER_VIEWPORTS,
  RUNWAY_IDLE_MS,
  useEarlierTurns,
} from "@/hooks/useEarlierTurns";
import { RUNWAY_ATTR, RUNWAY_MIN_PX } from "@/lib/scroll-runway";
import {
  EMPTY_MESSAGES,
  useMessagesStore,
  type EarlierTurns,
  type PerSessionMessages,
} from "@/stores/messages";
import { stubFrames } from "@/test/scroll-frames";

/*
 * Paging back through a conversation (main chat rulings 170, 172; ticket
 * 123). jsdom lays nothing out, so the scroller here keeps its own
 * numbers: 24px of padding above and below the column, the runway (the
 * column's padding-top) over the rows, each row as high as its `data-h`,
 * `scrollTop` clamped to the range as the browser keeps it, every write
 * to it recorded. Frames and the idle timer run by hand.
 */

const PAD = 24;
const VIEW = 600;
const SCREENS = EARLIER_TRIGGER_VIEWPORTS * VIEW;
const EARLIER: EarlierTurns = {
  beforeTurnIndex: 100,
  previousUserCreatedAt: null,
};

interface Row {
  id: string;
  h: number;
}

/** `n` rows `h` high, ids `prefix0`…. */
function rowsOf(prefix: string, n: number, h: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, h }));
}

// ---- The scroller's numbers ----------------------------------------------

const scrollTops = new WeakMap<Element, number>();
/** Every value the scroller's `scrollTop` was written to, in order. */
let writes: number[] = [];
const isScroller = (el: Element) => el.hasAttribute("data-scroller");

function columnOf(scroller: Element): HTMLElement {
  return scroller.firstElementChild as HTMLElement;
}
function runwayOf(scroller: Element): number {
  return Number.parseFloat(columnOf(scroller).style.paddingTop) || 0;
}
function stacked(scroller: Element): HTMLElement[] {
  return Array.from(
    columnOf(scroller).querySelectorAll<HTMLElement>("[data-h]"),
  );
}
function contentOf(scroller: Element): number {
  return stacked(scroller).reduce((sum, el) => sum + Number(el.dataset.h), 0);
}
function scrollHeightOf(scroller: Element): number {
  return PAD + runwayOf(scroller) + contentOf(scroller) + PAD;
}
function clamp(scroller: Element, value: number): number {
  return Math.min(
    Math.max(0, value),
    Math.max(0, scrollHeightOf(scroller) - VIEW),
  );
}
function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 700,
    height,
    width: 700,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}
function boxOf(el: Element): DOMRect {
  const scroller = el.closest("[data-scroller]");
  if (!scroller) return rect(0, 0);
  if (el === scroller) return rect(0, VIEW);
  const scrollTop = scrollTops.get(scroller) ?? 0;
  const column = columnOf(scroller);
  if (el === column) {
    return rect(PAD - scrollTop, runwayOf(scroller) + contentOf(scroller));
  }
  let y = PAD + runwayOf(scroller) - clamp(scroller, scrollTop);
  for (const item of stacked(scroller)) {
    const h = Number(item.dataset.h);
    if (item === el) return rect(y, h);
    y += h;
  }
  return rect(PAD + runwayOf(scroller) - scrollTop, contentOf(scroller));
}

const saved: [object, string, PropertyDescriptor | undefined][] = [];
function stub(target: object, name: string, descriptor: PropertyDescriptor) {
  saved.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
  Object.defineProperty(target, name, { configurable: true, ...descriptor });
}

/** The ResizeObservers made, each with what it watches. */
let observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] =
  [];

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  stub(Element.prototype, "scrollTop", {
    get(this: Element) {
      return isScroller(this) ? clamp(this, scrollTops.get(this) ?? 0) : 0;
    },
    set(this: Element, value: number) {
      if (!isScroller(this)) return;
      const top = clamp(this, value);
      scrollTops.set(this, top);
      writes.push(top);
    },
  });
  stub(Element.prototype, "scrollHeight", {
    get(this: Element) {
      return isScroller(this) ? scrollHeightOf(this) : 0;
    },
  });
  stub(Element.prototype, "clientHeight", {
    get(this: Element) {
      return isScroller(this) ? VIEW : 0;
    },
  });
  stub(Element.prototype, "getBoundingClientRect", {
    value(this: Element) {
      return boxOf(this);
    },
  });
  class ResizeObserverStandIn {
    private readonly entry: (typeof observers)[number];
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: new Set() };
      observers.push(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.add(target);
    }
    unobserve(target: Element) {
      this.entry.targets.delete(target);
    }
    disconnect() {
      this.entry.targets.clear();
    }
  }
  stub(globalThis, "ResizeObserver", { value: ResizeObserverStandIn });
});

afterAll(() => {
  for (const [target, name, descriptor] of saved.reverse()) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete (target as Record<string, unknown>)[name];
  }
});

/** The frame's resize step: every observer still watching reports. */
function resizeStep() {
  for (const { callback, targets } of observers) {
    if (targets.size > 0) callback([], {} as ResizeObserver);
  }
}

// ---- The page ------------------------------------------------------------

/** What the column's padding-top was when the page's first layout
 * effect ran: useStickyScroll's, which places the scroll position, is
 * declared before useEarlierTurns in MainView. */
let runwayAtFirstLayout: string | null = null;

function Harness({
  rows,
  prependedTurns,
  typing,
}: {
  rows: Row[];
  prependedTurns: number;
  typing: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    runwayAtFirstLayout ??= columnOf(scroller.current!).style.paddingTop;
  }, []);
  const columnRef = useEarlierTurns({
    sessionId: "s",
    scrollContainerRef: scroller,
    turnsLength: rows.length,
    prependedTurns,
  });
  return (
    <div ref={scroller} data-scroller="">
      <div ref={columnRef}>
        <div data-role="conversation">
          {rows.map((row) => (
            <div key={row.id} data-row={row.id} data-h={row.h} />
          ))}
        </div>
        {typing && <div data-role="assistant-typing" data-h={67} />}
      </div>
    </div>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let frames: ReturnType<typeof stubFrames>;
const load = vi.fn(async (_sid: string) => false);
const loadEarlierTurns = useMessagesStore.getState().loadEarlierTurns;
let shown: { rows: Row[]; prependedTurns: number; typing: boolean };

function patchSlice(patch: Partial<PerSessionMessages>) {
  useMessagesStore.setState((state) => ({
    byId: {
      ...state.byId,
      s: { ...(state.byId.s ?? EMPTY_MESSAGES), ...patch },
    },
  }));
}

function render() {
  root!.render(<Harness {...shown} />);
}

function mount({
  rows,
  earlier = EARLIER,
  restoring = false,
  typing = false,
}: {
  rows: Row[];
  earlier?: EarlierTurns | null;
  restoring?: boolean;
  typing?: boolean;
}): HTMLElement {
  patchSlice({ earlier, restoring, prependedTurns: 0 });
  shown = { rows, prependedTurns: 0, typing };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(render);
  return document.querySelector<HTMLElement>("[data-scroller]")!;
}

/** Where the scroller is, as if scrolled there; nothing recorded. */
function place(scroller: HTMLElement, top: number) {
  scroller.scrollTop = top;
  writes = [];
}

function scrolled(scroller: HTMLElement) {
  act(() => {
    scroller.dispatchEvent(new Event("scroll"));
  });
}

/** An earlier page going in, as the store writes it (the last one when
 * `last`), and the render it brings. */
function prepend(page: Row[], { last = false } = {}) {
  act(() => {
    shown = {
      ...shown,
      rows: [...page, ...shown.rows],
      prependedTurns: shown.prependedTurns + page.length,
    };
    patchSlice({
      prependedTurns: shown.prependedTurns,
      ...(last ? { earlier: null } : {}),
    });
    render();
  });
}

const topOf = (id: string) =>
  document.querySelector(`[data-row="${id}"]`)!.getBoundingClientRect().top;

function idle(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  frames = stubFrames();
  writes = [];
  observers = [];
  runwayAtFirstLayout = null;
  load.mockClear();
  useMessagesStore.setState({ byId: {}, loadEarlierTurns: load });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useMessagesStore.setState({ byId: {}, loadEarlierTurns });
});

describe("the runway (ruling 172)", () => {
  it("is laid in the first commit, before the page places the scroll position", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    expect(runwayAtFirstLayout).toBe(`${RUNWAY_MIN_PX}px`);
    expect(columnOf(scroller).hasAttribute(RUNWAY_ATTR)).toBe(true);
  });

  it("takes a page that lands mid-scroll, writing no scrollTop", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    place(scroller, RUNWAY_MIN_PX + 600);
    const before = topOf("a2");
    prepend(rowsOf("b", 10, 320));
    expect(runwayOf(scroller)).toBe(RUNWAY_MIN_PX - 3_200);
    expect(writes).toEqual([]);
    expect(topOf("a2")).toBe(before);
  });

  it("takes the page's late layout too", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    place(scroller, RUNWAY_MIN_PX + 600);
    const before = topOf("a2");
    prepend(rowsOf("b", 10, 320));
    // A code block in the new page highlights, 150px taller.
    document.querySelector<HTMLElement>('[data-row="b5"]')!.dataset.h = "470";
    act(resizeStep);
    expect(runwayOf(scroller)).toBe(RUNWAY_MIN_PX - 3_200 - 150);
    expect(writes).toEqual([]);
    expect(topOf("a2")).toBe(before);
  });

  it("scrolls for the part of a page taller than what is left", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    place(scroller, RUNWAY_MIN_PX + 600);
    const before = topOf("a2");
    prepend(rowsOf("b", 10, 1_500));
    expect(runwayOf(scroller)).toBe(5_000);
    prepend(rowsOf("c", 10, 700));
    expect(runwayOf(scroller)).toBe(0);
    expect(columnOf(scroller).hasAttribute(RUNWAY_ATTR)).toBe(true);
    expect(writes).toEqual([RUNWAY_MIN_PX + 600 + 2_000]);
    expect(topOf("a2")).toBe(before);
  });

  it("is refilled once the reader stops: not at 199ms, at 200ms, scrollTop with it", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    place(scroller, RUNWAY_MIN_PX + 600);
    prepend(rowsOf("b", 10, 320));
    const before = topOf("a2");
    scrolled(scroller);
    idle(RUNWAY_IDLE_MS - 1);
    expect(runwayOf(scroller)).toBe(RUNWAY_MIN_PX - 3_200);
    expect(writes).toEqual([]);
    idle(1);
    expect(runwayOf(scroller)).toBe(RUNWAY_MIN_PX);
    expect(writes).toEqual([RUNWAY_MIN_PX + 600 + 3_200]);
    expect(topOf("a2")).toBe(before);
    // Nothing more to do on the next rest.
    idle(RUNWAY_IDLE_MS * 3);
    expect(writes).toHaveLength(1);
  });

  it("is refilled to twice the tallest page seen", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    place(scroller, RUNWAY_MIN_PX + 600);
    prepend(rowsOf("b", 10, 1_500));
    idle(RUNWAY_IDLE_MS);
    expect(runwayOf(scroller)).toBe(30_000);
  });

  it("is not refilled at the bottom", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    place(scroller, scroller.scrollHeight - VIEW);
    prepend(rowsOf("b", 10, 320));
    scrolled(scroller);
    idle(RUNWAY_IDLE_MS);
    expect(runwayOf(scroller)).toBe(RUNWAY_MIN_PX - 3_200);
    expect(writes).toEqual([]);
  });

  it("waits while the typing bubble is up", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300), typing: true });
    place(scroller, RUNWAY_MIN_PX + 600);
    prepend(rowsOf("b", 10, 320));
    idle(RUNWAY_IDLE_MS * 2);
    expect(runwayOf(scroller)).toBe(RUNWAY_MIN_PX - 3_200);
    shown = { ...shown, typing: false };
    act(render);
    idle(RUNWAY_IDLE_MS);
    expect(runwayOf(scroller)).toBe(RUNWAY_MIN_PX);
  });

  it("goes once the reader stops after the first page is in, scrollTop with it", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    place(scroller, RUNWAY_MIN_PX + 600);
    const before = topOf("a2");
    prepend(rowsOf("b", 10, 320), { last: true });
    scrolled(scroller);
    idle(RUNWAY_IDLE_MS - 1);
    expect(columnOf(scroller).hasAttribute(RUNWAY_ATTR)).toBe(true);
    idle(1);
    expect(columnOf(scroller).hasAttribute(RUNWAY_ATTR)).toBe(false);
    expect(columnOf(scroller).style.paddingTop).toBe("");
    expect(writes).toEqual([600 + 3_200]);
    expect(topOf("a2")).toBe(before);
  });

  it("ends a flick that runs into it on the first turn, then gives the overflow back", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    place(scroller, RUNWAY_MIN_PX + 600);
    prepend(rowsOf("b", 10, 320), { last: true });
    // Flicked past the first message, into the blank: the momentum is
    // taken away at once, the runway goes two frames later.
    place(scroller, 5_000);
    scrolled(scroller);
    expect(scroller.style.overflowY).toBe("hidden");
    expect(writes).toEqual([]);
    act(() => frames.tick());
    expect(columnOf(scroller).hasAttribute(RUNWAY_ATTR)).toBe(true);
    act(() => frames.tick());
    expect(columnOf(scroller).hasAttribute(RUNWAY_ATTR)).toBe(false);
    expect(writes).toEqual([0]);
    expect(topOf("b0")).toBe(PAD);
    expect(scroller.style.overflowY).toBe("hidden");
    act(() => frames.tick());
    expect(scroller.style.overflowY).toBe("");
  });

  it("does not stop a flick into it while earlier pages are still coming", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    // Outran the reads: in the blank, a page still to land there.
    place(scroller, 5_000);
    scrolled(scroller);
    expect(scroller.style.overflowY).toBe("");
    act(() => frames.tick());
    act(() => frames.tick());
    expect(columnOf(scroller).hasAttribute(RUNWAY_ATTR)).toBe(true);
  });

  it("does not stop a flick above the first turn's top", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    place(scroller, RUNWAY_MIN_PX + 600);
    prepend(rowsOf("b", 10, 320), { last: true });
    place(scroller, runwayOf(scroller) + 10);
    scrolled(scroller);
    expect(scroller.style.overflowY).toBe("");
  });

  it("is laid when earlier pages arrive after the mount, scrollTop with it", () => {
    // A cold start: the skeleton first, the restore later.
    const scroller = mount({ rows: [], earlier: null, restoring: true });
    expect(columnOf(scroller).hasAttribute(RUNWAY_ATTR)).toBe(false);
    act(() => {
      patchSlice({ earlier: EARLIER, restoring: false });
      shown = { ...shown, rows: rowsOf("a", 10, 300) };
      render();
    });
    expect(runwayOf(scroller)).toBe(RUNWAY_MIN_PX);
    expect(writes).toEqual([RUNWAY_MIN_PX]);
  });
});

describe("reading the page before (ruling 172)", () => {
  it("reads within ten screens of the loaded top, not past them", () => {
    const scroller = mount({ rows: rowsOf("a", 30, 300) });
    place(scroller, RUNWAY_MIN_PX + 11 * VIEW);
    act(() => frames.tick());
    expect(load).not.toHaveBeenCalled();
    place(scroller, RUNWAY_MIN_PX + 9 * VIEW);
    scrolled(scroller);
    expect(load).toHaveBeenCalledWith("s");
    expect(SCREENS).toBe(10 * VIEW);
  });

  it("reads once the conversation is open, without a scroll", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    // Placed at the bottom by the open (useStickyScroll), 2,448px under
    // the loaded top.
    place(scroller, scroller.scrollHeight - VIEW);
    act(() => frames.tick());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reads on once a page has gone in and the top is still near", async () => {
    load.mockResolvedValueOnce(true);
    const scroller = mount({ rows: rowsOf("a", 10, 300) });
    place(scroller, scroller.scrollHeight - VIEW);
    act(() => frames.tick());
    await act(async () => {});
    act(() => frames.tick());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not read while the restore is out", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300), restoring: true });
    act(() => frames.tick());
    place(scroller, RUNWAY_MIN_PX);
    scrolled(scroller);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("a conversation with no earlier pages", () => {
  it("has no runway, reads nothing, writes nothing", () => {
    const scroller = mount({ rows: rowsOf("a", 10, 300), earlier: null });
    const column = columnOf(scroller);
    expect(column.hasAttribute(RUNWAY_ATTR)).toBe(false);
    expect(column.style.paddingTop).toBe("");
    expect(runwayAtFirstLayout).toBe("");
    place(scroller, 0);
    act(() => frames.tick());
    scrolled(scroller);
    idle(RUNWAY_IDLE_MS * 2);
    expect(load).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(column.style.paddingTop).toBe("");
  });
});
