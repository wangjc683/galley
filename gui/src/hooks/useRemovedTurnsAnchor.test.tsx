// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useRemovedTurnsAnchor } from "@/hooks/useRemovedTurnsAnchor";
import {
  useMessageDeleteStore,
  type StagedMessageDelete,
} from "@/stores/message-delete";
import { EMPTY_MESSAGES, useMessagesStore } from "@/stores/messages";
import {
  installPage,
  transforms,
  uninstallPage,
  type Page,
  type Played,
} from "@/test/bubble-motion-page";

/*
 * A deleted message leaving, and one put back (ruling 138, ticket 94):
 * in the main chat the rows gone shrink away where they stood and the
 * rest slide into place, once the anchor has held what you look at
 * (ticket 32). The page is the fake in test/bubble-motion-page.ts: rows
 * stack from the column's top, so a row taken out moves the ones under
 * it up by its height unless the column moves.
 */

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const FAST = 120;
const BASE = 160;
const SLOW = 240;
const POP = "cubic-bezier(0.16, 1, 0.3, 1)";
const FIRM = "cubic-bezier(0.2, 0, 0, 1)";
const EXIT = "cubic-bezier(0.4, 0, 1, 1)";

interface Row {
  id: string;
  side: "user" | "assistant" | "time";
  h: number;
}

const A1: Row = { id: "a-1", side: "assistant", h: 80 };
const U1: Row = { id: "u-1", side: "user", h: 43 };
const A2: Row = { id: "a-2", side: "assistant", h: 80 };
const U2: Row = { id: "u-2", side: "user", h: 43 };

function Harness({ rows, animate = true }: { rows: Row[]; animate?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  useRemovedTurnsAnchor({
    sessionId: "main",
    scrollContainerRef: scroller,
    animate,
  });
  return (
    <div ref={scroller} data-conversation-backdrop="">
      <div data-role="column">
        <div data-role="conversation">
          {rows.map((row) =>
            row.side === "time" ? (
              <div
                key={row.id}
                data-row={row.id}
                data-h={row.h}
                data-role="message-time-divider"
              >
                今天 09:10
              </div>
            ) : row.side === "user" ? (
              <div key={row.id} data-row={row.id} data-h={row.h}>
                <div data-role="user-msg" data-message-id={row.id}>
                  {row.id}
                </div>
                <div data-hover-row="">chips</div>
              </div>
            ) : (
              <div key={row.id} data-row={row.id} data-h={row.h}>
                <div data-message-id={row.id}>
                  <div data-role="assistant-bubble">
                    <p>{row.id}</p>
                  </div>
                  <div data-hover-row="">bar</div>
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let page: Page;
let staging = 0;

function mount(rows: Row[], animate = true) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Harness rows={rows} animate={animate} />));
}

/** The page's 删除 (the store write), and the render it brings. */
function remove(rows: Row[], id: string, animate = true) {
  act(() => {
    staging += 1;
    const entry: StagedMessageDelete = {
      id: staging,
      sessionId: "main",
      messageId: id,
      rowIds: [id],
      committing: false,
    };
    useMessageDeleteStore.setState({
      staged: [...useMessageDeleteStore.getState().staged, entry],
    });
    root!.render(<Harness rows={rows} animate={animate} />);
  });
}

/** 撤销 (or Core refusing): back on the page. */
function putBack(rows: Row[]) {
  act(() => {
    useMessageDeleteStore.setState({ staged: [] });
    root!.render(<Harness rows={rows} />);
  });
}

const rowOf = (id: string) => document.querySelector(`[data-row="${id}"]`);
const copies = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-bubble-motion-layer] [data-role="conversation-row-leaving"]',
    ),
  );
const playedOn = (el: Element | null) =>
  page.played.filter((p: Played) => p.el === el);

beforeEach(() => {
  page = installPage();
  page.layout.columnTop = 100;
  useMessagesStore.setState({ byId: { main: { ...EMPTY_MESSAGES } } });
  useMessageDeleteStore.setState({ staged: [], toastId: null });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  uninstallPage();
  useMessagesStore.setState({ byId: {} });
  useMessageDeleteStore.setState({ staged: [], toastId: null });
});

describe("a deleted message (D2)", () => {
  it("leaves as a copy where it stood, shrinking to its own bottom corner", () => {
    mount([A1, U1, A2, U2]);
    remove([A1, A2, U2], "u-1");
    page.frame();
    const [copy] = copies();
    expect(copies()).toHaveLength(1);
    // Your message, where it stood (under the first reply), out of the
    // flow; the layer in the column, hidden from assistive tech.
    expect(copy.querySelector('[data-role="user-msg-leaving"]')).not.toBeNull();
    expect(copy.style.position).toBe("absolute");
    expect(copy.style.top).toBe(`${100 + 80}px`);
    expect(copy.style.height).toBe("43px");
    const layer = copy.parentElement!;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.style.cssText).toContain("width: 0px");
    // Nothing anything else looks up, and no hover row lit.
    expect(copy.querySelector("[data-message-id]")).toBeNull();
    expect(copy.querySelector('[data-role="user-msg"]')).toBeNull();
    expect(
      copy.querySelector<HTMLElement>("[data-hover-row]")!.style.visibility,
    ).toBe("hidden");
    const [leave] = playedOn(copy);
    expect(leave.keyframes).toEqual({
      transform: ["scale(1)", "scale(0.9)"],
      opacity: [1, 0],
      transformOrigin: ["100% 100%", "100% 100%"],
    });
    expect(leave.options).toEqual({
      duration: BASE,
      easing: EXIT,
      fill: "forwards",
    });
  });

  it("shrinks the assistant's to the bottom left", () => {
    mount([A1, U1, A2, U2]);
    remove([A1, U1, U2], "a-2");
    page.frame();
    const [leave] = playedOn(copies()[0]);
    expect(
      (leave.keyframes as PropertyIndexedKeyframes).transformOrigin,
    ).toEqual(["0% 100%", "0% 100%"]);
  });

  it("slides the rows under it up into its place; the row the anchor holds stays", () => {
    mount([A1, U1, A2, U2]);
    remove([A1, A2, U2], "u-1");
    page.frame();
    for (const id of ["a-2", "u-2"]) {
      const [slide] = playedOn(rowOf(id));
      expect(transforms(slide)).toEqual([
        "translateY(43px)",
        "translateY(0px)",
      ]);
      expect(slide.options).toEqual({ duration: SLOW, easing: FIRM });
    }
    expect(playedOn(rowOf("a-1"))).toEqual([]);
  });

  it("at the bottom, slides the rows above it down: what was measured", () => {
    mount([A1, U1, A2, U2]);
    remove([A1, U1, A2], "u-2");
    // The scroll range shrank under the reader: everything above moved
    // down by the row's height.
    page.layout.columnTop += 43;
    page.frame();
    for (const id of ["a-1", "u-1", "a-2"]) {
      expect(transforms(playedOn(rowOf(id))[0])).toEqual([
        "translateY(-43px)",
        "translateY(0px)",
      ]);
    }
  });

  it("only fades a time line, and a row taller than the viewport", () => {
    const time: Row = { id: "t-1", side: "time", h: 24 };
    const tall: Row = { id: "a-9", side: "assistant", h: 700 };
    page.layout.columnTop = 10;
    mount([time, tall]);
    remove([], "a-9");
    page.frame();
    expect(copies()).toHaveLength(2);
    for (const copy of copies()) {
      expect(playedOn(copy)[0].keyframes).toEqual({ opacity: [1, 0] });
    }
  });

  it("brings in a time line the rules now draw, as a row put back, without shrinking", () => {
    const time: Row = { id: "t-1", side: "time", h: 24 };
    mount([A1, U1, A2]);
    remove([A1, time, A2], "u-1");
    page.frame();
    const [enter] = playedOn(rowOf("t-1"));
    expect(enter.keyframes).toEqual({ opacity: [0, 1] });
    expect(enter.options).toEqual({
      duration: BASE,
      delay: FAST,
      easing: POP,
      fill: "backwards",
    });
  });

  it("puts it back the other way round: the rows make room, it comes from the same corner", () => {
    mount([A1, U1, A2, U2]);
    remove([A1, A2, U2], "u-1");
    page.frame();
    const deleted = [...page.played];
    putBack([A1, U1, A2, U2]);
    // The delete's motion went to its end first, its copy gone.
    for (const p of deleted) expect(p.animation.cancel).toHaveBeenCalled();
    expect(copies()).toEqual([]);
    page.frame();
    const [enter] = playedOn(rowOf("u-1"));
    expect(enter.keyframes).toEqual({
      transform: ["scale(0.9)", "scale(1)"],
      opacity: [0, 1],
      transformOrigin: ["100% 100%", "100% 100%"],
    });
    expect(enter.options).toEqual({
      duration: BASE,
      delay: FAST,
      easing: POP,
      fill: "backwards",
    });
    for (const id of ["a-2", "u-2"]) {
      expect(transforms(playedOn(rowOf(id)).slice(-1)[0])).toEqual([
        "translateY(-43px)",
        "translateY(0px)",
      ]);
    }
  });

  it("fades out a time line the rules drop when one is put back", () => {
    const time: Row = { id: "t-1", side: "time", h: 24 };
    mount([A1, time, A2]);
    remove([A1, time, A2], "u-0");
    page.frame();
    putBack([A1, U1, A2]);
    page.frame();
    const [copy] = copies();
    expect(playedOn(copy)[0].keyframes).toEqual({ opacity: [1, 0] });
  });

  it("does nothing more once Core has deleted what was hidden: nothing on screen changed", () => {
    mount([A1, U1, A2, U2]);
    remove([A1, A2, U2], "u-1");
    page.frame();
    for (const p of page.played) p.animation.end();
    const played = page.played.length;
    act(() => {
      useMessagesStore.setState({
        byId: { main: { ...EMPTY_MESSAGES, removedOrdinals: [1] } },
      });
      useMessageDeleteStore.setState({ staged: [] });
      root!.render(<Harness rows={[A1, A2, U2]} />);
    });
    page.frame();
    expect(page.played.length).toBe(played);
  });

  it("only fades under reduced motion: copies fade, the rest is just there", () => {
    page.reduceMotion();
    mount([A1, U1, A2, U2]);
    remove([A1, A2, U2], "u-1");
    page.frame();
    expect(playedOn(copies()[0])[0].keyframes).toEqual({ opacity: [1, 0] });
    expect(page.played.filter((p) => transforms(p).length > 0)).toEqual([]);
    putBack([A1, U1, A2, U2]);
    page.frame();
    const [enter] = playedOn(rowOf("u-1"));
    expect(enter.keyframes).toEqual({ opacity: [0, 1] });
    expect(enter.options.delay).toBe(0);
  });

  it("moves nothing for an earlier page put in front", () => {
    mount([A1, U1]);
    act(() => {
      useMessagesStore.setState({
        byId: { main: { ...EMPTY_MESSAGES, prependedTurns: 2 } },
      });
      root!.render(<Harness rows={[A2, U2, A1, U1]} />);
    });
    page.frame();
    expect(page.played).toEqual([]);
  });

  it("moves nothing outside the main chat", () => {
    mount([A1, U1, A2, U2], false);
    remove([A1, A2, U2], "u-1", false);
    page.frame();
    expect(page.played).toEqual([]);
    expect(document.querySelector("[data-bubble-motion-layer]")).toBeNull();
  });
});
