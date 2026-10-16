import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TIME_LINE_ANCHOR_TOP_PX,
  USER_MSG_ANCHOR_TOP_PX,
} from "@/lib/conversation-anchor";
import {
  ASK_USER_COVERED_PX,
  ASK_USER_GAP_PX,
  askUserRevealTop,
  liveTailBlank,
  liveTailMinHeight,
  liveTailPark,
  liveTailReattaches,
  scrolledAboveRound,
  startLiveTail,
  submitScroll,
} from "@/lib/live-tail";
import { useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import { resetStores } from "@/test/store-reset";
import { stubFrames } from "@/test/scroll-frames";

/** The scroll container's top edge in viewport coordinates. */
const TOP = 100;
/** The container's `py-6`. */
const PAD = 24;
/** A time line's height plus its gap to the bubble (10.5 + 20). */
const TIME_LINE_ABOVE = 30.5;

/**
 * Just enough layout for the tail: a scroll container (`py-6`) around
 * one column whose height is the larger of its content and its
 * `min-height`, a `scrollTop` the "browser" clamps whenever the
 * scrollable height has shrunk under it, and a user message at `y` in
 * the column, with or without a time line right above it.
 */
class Layout {
  /** The column's content height. */
  content: number;
  clientHeight: number;
  /** A margin of the column's last child that leaves the column while
   * the content sets its height (collapses through it). */
  collapsingMargin = 0;
  private top = 0;
  readonly column = {
    style: { minHeight: "" },
    getBoundingClientRect: () => ({ height: this.columnHeight }),
  };
  readonly el: EventTarget & {
    scrollTop: number;
    readonly scrollHeight: number;
    readonly clientHeight: number;
    readonly ownerDocument: EventTarget;
    getBoundingClientRect(): { top: number };
    querySelector(selectors: string): Element | null;
  };
  anchor: ReturnType<Layout["makeAnchor"]>;
  /** What `querySelector` finds for a row id (a re-rendered node). */
  rendered: Element | null = null;

  constructor({
    content,
    clientHeight,
    y,
    timeLine = false,
  }: {
    content: number;
    clientHeight: number;
    y: number;
    timeLine?: boolean;
  }) {
    this.content = content;
    this.clientHeight = clientHeight;
    this.anchor = this.makeAnchor(y, timeLine);
    this.el = Object.defineProperties(new EventTarget(), {
      ownerDocument: { value: new EventTarget() },
      scrollTop: {
        get: () => this.scrollTop,
        set: (value: number) => {
          this.scrollTop = value;
        },
      },
      scrollHeight: { get: () => this.scrollHeight },
      clientHeight: { get: () => this.clientHeight },
      getBoundingClientRect: { value: () => ({ top: TOP }) },
      querySelector: { value: () => this.rendered },
    }) as Layout["el"];
  }

  get minHeight(): number {
    return Number.parseFloat(this.column.style.minHeight) || 0;
  }
  get columnHeight(): number {
    return Math.max(this.content, this.minHeight);
  }
  get scrollHeight(): number {
    const margin = this.content >= this.minHeight ? this.collapsingMargin : 0;
    return PAD + this.columnHeight + margin + PAD;
  }
  get maxScrollTop(): number {
    return Math.max(0, this.scrollHeight - this.clientHeight);
  }
  get scrollTop(): number {
    // Layout clamps a scroll position the content no longer reaches.
    this.top = Math.min(this.top, this.maxScrollTop);
    return this.top;
  }
  set scrollTop(value: number) {
    this.top = Math.min(Math.max(0, value), this.maxScrollTop);
  }
  /** The bubble's top edge from the viewport's top. */
  get anchorOnScreen(): number {
    return this.anchor.getBoundingClientRect().top - TOP;
  }

  /** An ask_user block `height` tall at `y` in the column. */
  question(y: number, height: number) {
    return {
      getBoundingClientRect: () => {
        const top = TOP + PAD + y - this.scrollTop;
        return { top, bottom: top + height };
      },
    } as unknown as Element;
  }
  /** Where a question's edges sit from the viewport's top edge. */
  onScreen(question: Element) {
    const rect = question.getBoundingClientRect();
    return { top: rect.top - TOP, bottom: rect.bottom - TOP };
  }

  makeAnchor(y: number, timeLine: boolean, id: string | null = null) {
    const rect = (contentY: number) => ({
      top: TOP + PAD + contentY - this.scrollTop,
    });
    const anchor = {
      y,
      isConnected: true,
      getAttribute: (name: string) =>
        name === "data-message-id"
          ? id
          : name === "data-role"
            ? "user-msg"
            : null,
      getBoundingClientRect: () => rect(anchor.y),
      parentElement: {
        previousElementSibling: timeLine
          ? {
              getAttribute: (name: string) =>
                name === "data-role" ? "message-time-divider" : null,
              getBoundingClientRect: () => rect(anchor.y - TIME_LINE_ABOVE),
            }
          : null,
      },
    };
    return anchor;
  }
}

let raf: ReturnType<typeof stubFrames>;

beforeEach(() => {
  raf = stubFrames();
  // Instant parks unless a test watches the animation.
  raf.state.reducedMotion = true;
  vi.stubGlobal("CSS", { escape: (value: string) => value });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function start(layout: Layout, park = true) {
  return startLiveTail(
    layout.el,
    layout.column,
    layout.anchor as unknown as Element,
    { park },
  );
}

describe("the blank's height", () => {
  // An 800px viewport; your message at 2000px into the column.
  const clientHeight = 800;
  const y = 2_000;
  const parkTop = PAD + y - USER_MSG_ANCHOR_TOP_PX; // 1992

  it("fills up to one viewport under the park line when the content is short", () => {
    // The message and the start of the run: 2120px of content.
    const minHeight = liveTailMinHeight({
      parkTop,
      clientHeight,
      scrollHeight: 2_120 + 2 * PAD,
      columnHeight: 2_120,
    });
    // The bottom then is exactly the park position.
    expect(PAD + minHeight + PAD - clientHeight).toBe(parkTop);
    expect(liveTailBlank(minHeight, 2_120)).toBe(624);
  });

  it("is none when the content just reaches it, and none past it", () => {
    const minHeight = liveTailMinHeight({
      parkTop,
      clientHeight,
      scrollHeight: 2_120 + 2 * PAD,
      columnHeight: 2_120,
    });
    expect(liveTailBlank(minHeight, minHeight)).toBe(0);
    expect(liveTailBlank(minHeight, minHeight + 900)).toBe(0);
  });

  it("parks the bubble on the anchor line, or the time line above it on its own", () => {
    const plain = new Layout({ content: 2_120, clientHeight, y });
    expect(liveTailPark(plain.el, 2_120, plain.anchor as never).parkTop).toBe(
      parkTop,
    );
    const timed = new Layout({
      content: 2_120,
      clientHeight,
      y,
      timeLine: true,
    });
    const park = liveTailPark(timed.el, 2_120, timed.anchor as never);
    expect(park.parkTop).toBe(
      PAD + y - TIME_LINE_ABOVE - TIME_LINE_ANCHOR_TOP_PX,
    );
    // The park line sits 46.5px above the bubble instead of 32px: the
    // blank reaches as much less far down.
    expect(park.minHeight).toBe(
      liveTailMinHeight({
        parkTop: park.parkTop,
        clientHeight,
        scrollHeight: 2_120 + 2 * PAD,
        columnHeight: 2_120,
      }),
    );
  });
});

describe("startLiveTail", () => {
  it("parks your message with the blank under it, and stops following", () => {
    const layout = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    layout.scrollTop = 1_368; // at the bottom before the send
    const tail = start(layout);
    expect(layout.anchorOnScreen).toBe(USER_MSG_ANCHOR_TOP_PX);
    expect(layout.scrollTop).toBe(layout.maxScrollTop);
    expect(tail.noFollow).toBe(true);
  });

  it("parks a message with a time line above it by the line", () => {
    const layout = new Layout({
      content: 2_120,
      clientHeight: 800,
      y: 2_000,
      timeLine: true,
    });
    start(layout);
    expect(layout.anchorOnScreen).toBe(
      TIME_LINE_ANCHOR_TOP_PX + TIME_LINE_ABOVE,
    );
    // The line's half pixel: the blank is whole pixels, so the bottom
    // is at most a pixel under the park position.
    expect(layout.maxScrollTop - layout.scrollTop).toBeLessThan(1);
  });

  it("keeps the viewport still while the run grows past the screen and folds up again", () => {
    const layout = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    const tail = start(layout);
    const parked = layout.scrollTop;
    // Steps land, the reply streams: well past the blank.
    layout.content = 4_000;
    expect(layout.scrollTop).toBe(parked);
    expect(layout.maxScrollTop).toBeGreaterThan(parked);
    // It settles: the process folds into its header, 1500px less.
    layout.content = 2_500;
    expect(layout.scrollTop).toBe(parked);
    expect(layout.anchorOnScreen).toBe(USER_MSG_ANCHOR_TOP_PX);
    expect(tail.noFollow).toBe(true);
  });

  it("attaches following again only at the content's real end", () => {
    const layout = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    const tail = start(layout);
    // At the bottom of the blank (the park position): still the tail.
    tail.onScroll();
    expect(tail.noFollow).toBe(true);
    // The reply outgrows the screen; you read down to its end.
    layout.content = 3_500;
    layout.scrollTop = layout.maxScrollTop - 10;
    tail.onScroll();
    expect(tail.noFollow).toBe(false);
  });

  it("does not attach following when you scroll up and back to the blank", () => {
    const layout = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    const tail = start(layout);
    layout.scrollTop -= 300;
    tail.onScroll();
    layout.scrollTop += 300;
    tail.onScroll();
    expect(tail.noFollow).toBe(true);
  });

  it("keeps a parked message on its line when the composer shrinks or grows", () => {
    const layout = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    const tail = start(layout);
    tail.onScroll();
    // The composer drops back to one line: the viewport grows by 45px
    // and layout clamps the scroll position before anything else runs.
    layout.clientHeight = 845;
    expect(layout.anchorOnScreen).toBe(USER_MSG_ANCHOR_TOP_PX + 45);
    expect(tail.refresh()).toBe(true);
    expect(layout.anchorOnScreen).toBe(USER_MSG_ANCHOR_TOP_PX);
    expect(layout.scrollTop).toBe(layout.maxScrollTop);
    // You type three lines: the viewport is 90px shorter, the blank too.
    layout.clientHeight = 755;
    tail.refresh();
    expect(layout.anchorOnScreen).toBe(USER_MSG_ANCHOR_TOP_PX);
    expect(layout.scrollTop).toBe(layout.maxScrollTop);
  });

  it("follows its message when the rows above it change (an earlier page)", () => {
    const layout = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    const tail = start(layout);
    tail.onScroll();
    // A page lands above: 3000px more before your message. The prepend
    // keeps what was on screen by scrolling down as much, which the
    // stale blank cannot take yet.
    layout.content += 3_000;
    layout.anchor.y += 3_000;
    layout.scrollTop += 3_000;
    tail.refresh();
    expect(layout.anchorOnScreen).toBe(USER_MSG_ANCHOR_TOP_PX);
    expect(layout.scrollTop).toBe(layout.maxScrollTop);
  });

  it("leaves a reader who scrolled up where they are", () => {
    const layout = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    const tail = start(layout);
    layout.scrollTop -= 400;
    tail.onScroll();
    const reading = layout.scrollTop;
    layout.clientHeight = 845;
    tail.refresh();
    expect(layout.scrollTop).toBe(reading);
  });

  it("fits the blank when a margin stops leaving the column under it", () => {
    const layout = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    layout.collapsingMargin = 30;
    start(layout);
    // Read with the margin outside the column, the blank came out 30px
    // short; fitted, the park position is the bottom.
    expect(layout.maxScrollTop).toBe(layout.scrollTop);
    expect(layout.anchorOnScreen).toBe(USER_MSG_ANCHOR_TOP_PX);
  });

  it("puts the blank under a message without moving the viewport", () => {
    const layout = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    layout.scrollTop = layout.maxScrollTop;
    const before = layout.scrollTop;
    const tail = start(layout, false);
    expect(layout.scrollTop).toBe(before);
    expect(tail.noFollow).toBe(true);
    // Scrolling down later parks it.
    layout.scrollTop = layout.maxScrollTop;
    expect(layout.anchorOnScreen).toBe(USER_MSG_ANCHOR_TOP_PX);
  });

  it("ends, blank and all, when its message is gone; finds it again when re-rendered", () => {
    const gone = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    const tail = start(gone);
    gone.anchor.isConnected = false;
    expect(tail.refresh()).toBe(false);
    expect(gone.column.style.minHeight).toBe("");
    expect(tail.noFollow).toBe(false);

    const moved = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    moved.anchor = moved.makeAnchor(2_000, false, "msg_s_4_user");
    const kept = start(moved);
    kept.onScroll();
    // React drew the row again under a new node.
    moved.anchor.isConnected = false;
    const again = moved.makeAnchor(2_000, false, "msg_s_4_user");
    moved.rendered = again as unknown as Element;
    moved.anchor = again;
    expect(kept.refresh()).toBe(true);
    // Late layout above it pushes it 120px down; it goes back up.
    again.y += 120;
    moved.content += 120;
    expect(moved.anchorOnScreen).toBe(USER_MSG_ANCHOR_TOP_PX + 120);
    kept.refresh();
    expect(moved.anchorOnScreen).toBe(USER_MSG_ANCHOR_TOP_PX);
  });

  it("scrolls there with the conversation's smooth scroll, re-aimed if the line moves", () => {
    raf.state.reducedMotion = false;
    const layout = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    layout.scrollTop = 1_368;
    const tail = start(layout);
    expect(layout.scrollTop).toBe(1_368);
    raf.tick(100);
    expect(layout.scrollTop).toBeGreaterThan(1_368);
    // Late layout above it, mid-way.
    layout.anchor.y += 60;
    layout.content += 60;
    tail.refresh();
    raf.runOut();
    expect(layout.anchorOnScreen).toBe(USER_MSG_ANCHOR_TOP_PX);
  });
});

describe("liveTailReattaches", () => {
  it("needs both the bottom and content past the blank", () => {
    expect(
      liveTailReattaches({
        distFromBottom: 0,
        columnHeight: 2_744,
        minHeight: 2_744,
      }),
    ).toBe(false);
    expect(
      liveTailReattaches({
        distFromBottom: 30,
        columnHeight: 3_500,
        minHeight: 2_744,
      }),
    ).toBe(false);
    expect(
      liveTailReattaches({
        distFromBottom: 10,
        columnHeight: 3_500,
        minHeight: 2_744,
      }),
    ).toBe(true);
  });
});

describe("submitScroll", () => {
  it("gives a composer send the tail and leaves the viewport alone for a queued one", () => {
    expect(submitScroll("composer", true)).toBe("tail");
    expect(submitScroll("composer", false)).toBe("tail");
    expect(submitScroll("queued", true)).toBe("blank");
    expect(submitScroll("queued", false)).toBe("none");
    expect(submitScroll("side", false)).toBe("park");
    expect(submitScroll("external", false)).toBe("park-follow");
  });

  it("is told who sent by the messages store", () => {
    resetStores();
    useSessionsStore.setState({ activeSessionId: "s" });
    const store = useMessagesStore.getState();
    store.appendUserTurn("s", "hi", "req-1", []);
    expect(useMessagesStore.getState().lastSubmitSource).toBe("composer");
    store.appendSideQuestionUserTurn("s", "/btw what?");
    expect(useMessagesStore.getState().lastSubmitSource).toBe("side");
    const row = (via: "gui" | "cli" | "supervisor", turnIndex: number) => ({
      sessionId: "s",
      message: {
        content: `from ${via}`,
        origin: { via },
        createdAt: "2026-10-16T08:00:00.000Z",
        turnIndex,
      },
      dispatch: "dispatched" as const,
    });
    store.applyUserMessagePersisted(row("gui", 5));
    expect(useMessagesStore.getState().lastSubmitSource).toBe("queued");
    store.applyUserMessagePersisted(row("cli", 6));
    expect(useMessagesStore.getState().lastSubmitSource).toBe("external");
    store.applyUserMessagePersisted(row("supervisor", 7));
    expect(useMessagesStore.getState().lastSubmitSource).toBe("external");
    expect(useMessagesStore.getState().userSubmitTick).toBe(5);
  });
});

describe("a question while it runs (ticket 09)", () => {
  /** In view: under the top edge, over the button's band. */
  const RESTS_AT = 800 - ASK_USER_COVERED_PX - ASK_USER_GAP_PX; // 728

  it("leaves a question in full view, and scrolls one under the fold to just over the button", () => {
    expect(
      askUserRevealTop({
        scrollTop: 1_000,
        clientHeight: 800,
        top: 500,
        bottom: 700,
      }),
    ).toBeNull();
    // Under the button's band (752–800) counts as out of view.
    expect(
      askUserRevealTop({
        scrollTop: 1_000,
        clientHeight: 800,
        top: 600,
        bottom: 760,
      }),
    ).toBe(1_000 + 760 - RESTS_AT);
    // Entirely below.
    expect(
      askUserRevealTop({
        scrollTop: 1_000,
        clientHeight: 800,
        top: 1_100,
        bottom: 1_300,
      }),
    ).toBe(1_000 + 1_300 - RESTS_AT);
  });

  it("puts a question taller than the room on the anchor line by its top", () => {
    expect(
      askUserRevealTop({
        scrollTop: 1_000,
        clientHeight: 800,
        top: 900,
        bottom: 1_700,
      }),
    ).toBe(1_000 + 900 - USER_MSG_ANCHOR_TOP_PX);
  });

  it("draws the line at where this round's message parks", () => {
    // Parked, or the viewport below the park position (reading the run).
    expect(scrolledAboveRound(0)).toBe(false);
    expect(scrolledAboveRound(8)).toBe(false);
    expect(scrolledAboveRound(-900)).toBe(false);
    // Above it: the message sits under its line.
    expect(scrolledAboveRound(9)).toBe(true);
    expect(scrolledAboveRound(400)).toBe(true);
  });

  /** Your message parked, the run past the screen, a question asked at
   * its end. */
  function asked(height = 150) {
    const layout = new Layout({ content: 2_120, clientHeight: 800, y: 2_000 });
    const tail = start(layout);
    tail.onScroll();
    const y = 3_400;
    layout.content = y + height + 20;
    return { layout, tail, question: layout.question(y, height) };
  }

  it("scrolls a question under the fold into view; following stays off", () => {
    const { layout, tail, question } = asked();
    const round = layout.anchor as unknown as Element;
    expect(tail.reveal(question, round, "q1")).toBe("scrolling");
    tail.onScroll();
    // At the content's end it rests as far as the content scrolls: the
    // bottom, which is not you asking to follow.
    expect(layout.scrollTop).toBe(layout.maxScrollTop);
    expect(layout.onScreen(question).bottom).toBeLessThanOrEqual(800 - 24);
    expect(tail.noFollow).toBe(true);
    expect(tail.reveal(question, round, "q1")).toBe("visible");
    // You scroll away and back to the end yourself: that attaches.
    layout.scrollTop -= 200;
    tail.onScroll();
    layout.scrollTop = layout.maxScrollTop;
    tail.onScroll();
    expect(tail.noFollow).toBe(false);
  });

  it("rests just over the button when there is more below it", () => {
    const { layout, tail, question } = asked();
    layout.content += 600; // the step-cap row, say
    tail.reveal(question, layout.anchor as unknown as Element, "q1");
    expect(layout.onScreen(question).bottom).toBe(RESTS_AT);
    tail.onScroll();
    expect(tail.noFollow).toBe(true);
  });

  it("puts a tall question's top on the anchor line", () => {
    const { layout, tail, question } = asked(900);
    tail.reveal(question, layout.anchor as unknown as Element, "q1");
    expect(layout.onScreen(question).top).toBe(USER_MSG_ANCHOR_TOP_PX);
  });

  it("leaves you alone when you are above this round, and not when you read below it", () => {
    const above = asked();
    above.layout.scrollTop -= 300;
    above.tail.onScroll();
    const reading = above.layout.scrollTop;
    expect(
      above.tail.reveal(above.question, above.layout.anchor as never, "q1"),
    ).toBe("above");
    expect(above.layout.scrollTop).toBe(reading);

    const below = asked();
    below.layout.scrollTop += 500; // reading the run's steps
    below.tail.onScroll();
    expect(
      below.tail.reveal(below.question, below.layout.anchor as never, "q1"),
    ).toBe("scrolling");
    // As far as the content scrolls: its end, 24px of padding under the
    // block's 20px margin.
    expect(below.layout.scrollTop).toBe(below.layout.maxScrollTop);
    expect(below.layout.onScreen(below.question).bottom).toBe(800 - 24 - 20);
  });

  it("is yours once you scroll during it; a new question starts over", () => {
    const { layout, tail, question } = asked();
    raf.state.reducedMotion = false;
    const round = layout.anchor as unknown as Element;
    expect(tail.reveal(question, round, "q1")).toBe("scrolling");
    raf.tick(100);
    layout.el.dispatchEvent(new Event("wheel"));
    expect(tail.reveal(question, round, "q1")).toBe("taken-over");
    // The next question of the round goes by the same rule again.
    expect(tail.reveal(question, round, "q2")).toBe("scrolling");
  });

  it("re-aims when the layout moves it, and when other code moved the scroll", () => {
    const { layout, tail } = asked();
    raf.state.reducedMotion = false;
    const round = layout.anchor as unknown as Element;
    let y = 3_400;
    const moving = {
      getBoundingClientRect: () => {
        const top = TOP + PAD + y - layout.scrollTop;
        return { top, bottom: top + 150 };
      },
    } as unknown as Element;
    tail.reveal(moving, round, "q1");
    raf.tick(100);
    // The run's region re-renders above it: 300px more.
    y += 300;
    layout.content += 300;
    expect(tail.reveal(moving, round, "q1")).toBe("scrolling");
    // Something else moves the scroll position (the browser's own
    // anchoring, say): not you.
    raf.tick(16);
    layout.scrollTop -= 50;
    raf.tick(16);
    expect(tail.reveal(moving, round, "q1")).toBe("scrolling");
    raf.runOut();
    expect(layout.onScreen(moving).bottom).toBeLessThanOrEqual(800 - 24);
  });

  it("leaves a round that follows to the follow rules", () => {
    const { layout, tail, question } = asked();
    tail.resumeFollowing();
    const before = layout.scrollTop;
    expect(tail.reveal(question, layout.anchor as never, "q1")).toBe(
      "following",
    );
    expect(layout.scrollTop).toBe(before);
  });
});

describe("useStickyScroll's wiring", () => {
  // Static renders run no effects; this checks the source.
  const source = readFileSync(
    path.resolve(__dirname, "../hooks/useStickyScroll.ts"),
    "utf8",
  );

  it("never starts a tail in the main chat", () => {
    const submit = source.slice(source.indexOf("const fresh = userSubmitTick"));
    const mainChat = submit.indexOf("if (stickBottomRef.current) {");
    expect(mainChat).toBeGreaterThan(-1);
    expect(submit.indexOf("return;", mainChat)).toBeLessThan(
      submit.indexOf("submitScroll("),
    );
    expect(source.split("startLiveTail(").length - 1).toBe(1);
  });

  it("reveals a question only through the workbench's tail", () => {
    const ask = source.slice(source.indexOf("const askedRef = useRef"));
    const keep = ask.slice(ask.indexOf("const keep = () => {"));
    expect(
      keep.indexOf("if (stickBottomRef.current || !tail) return;"),
    ).toBeLessThan(keep.indexOf("tail.reveal("));
  });

  it("stands every follow path down while the tail holds following off", () => {
    expect(source.split("tailRef.current?.noFollow").length - 1).toBe(4);
  });
});
