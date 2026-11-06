// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TypingBubble } from "@/components/conversation/TypingBubble";
import { useBubbleMotion } from "@/hooks/useBubbleMotion";
import { useScrollSpring } from "@/hooks/useScrollSpring";
import { useTypingBubbleHandoff } from "@/hooks/useTypingBubbleHandoff";
import type { TypingBubbleHandoff } from "@/lib/typing-bubble-handoff";
import { EMPTY_MESSAGES, useMessagesStore } from "@/stores/messages";
import {
  installPage,
  transforms,
  uninstallPage,
  type Page,
} from "@/test/bubble-motion-page";
import { stubFrames } from "@/test/scroll-frames";

/*
 * A new bubble's landing bounce (main chat PRD ruling 200 第 3 条, 201 第
 * 4 条; ticket 151): once each of the five entrances has played to its
 * end — your send's slide, the reply growing out of the dots, a woken
 * round's reply, a line told mid-run, its question — the row it landed
 * in goes past its place along the way it came and the scroll spring
 * brings it back. The page is the fake in test/bubble-motion-page.ts
 * (rows stacked from `layout.columnTop`, each as high as its `data-h`),
 * the frames by hand (test/scroll-frames.ts); the spring is the main
 * chat's own (hooks/useScrollSpring.ts).
 */

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

interface Row {
  id: string;
  side: "user" | "assistant";
  h: number;
}

const A1: Row = { id: "a-1", side: "assistant", h: 60 };
const U1: Row = { id: "u-1", side: "user", h: 43 };
const U2: Row = { id: "u-2", side: "user", h: 43 };
const A3: Row = { id: "a-3", side: "assistant", h: 60 };
/** A line it told you mid-run. */
const T1: Row = { id: "t-1", side: "assistant", h: 67.5 };

interface State {
  rows: Row[];
  typing: boolean;
  live: boolean;
  enabled?: boolean;
  handoff?: TypingBubbleHandoff | null;
  /** Its question, waiting for you (MainView's AskUserBubble). */
  question?: boolean;
}

function Harness({
  rows,
  typing,
  live,
  enabled = true,
  handoff = null,
  question = false,
}: State) {
  const scroller = useRef<HTMLDivElement>(null);
  // MainView's order: the hand-off, the bubble motions, the spring.
  const typingRef = useTypingBubbleHandoff({
    enabled,
    live,
    scrollContainerRef: scroller,
    handoff,
  });
  useBubbleMotion({
    enabled,
    sessionId: "main",
    live,
    scrollContainerRef: scroller,
  });
  useScrollSpring({ enabled, scrollContainerRef: scroller });
  return (
    <div ref={scroller} data-conversation-backdrop="">
      <div data-role="column">
        <div data-role="conversation">
          {rows.map((row) =>
            row.side === "user" ? (
              <div key={row.id} data-row={row.id} data-h={row.h}>
                <div data-role="user-msg" data-message-id={row.id}>
                  {row.id}
                </div>
              </div>
            ) : (
              <div key={row.id} data-row={row.id} data-h={row.h}>
                <div data-message-id={row.id}>
                  <div data-role="assistant-bubble">
                    <p>{row.id}</p>
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
        {typing && <TypingBubble ref={typingRef} />}
        {question && (
          <div data-role="ask-user-bubble" data-h="80">
            <div data-role="assistant-bubble">
              <p>周末去哪？</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let page: Page;
let frames: ReturnType<typeof stubFrames>;

function mount(state: State) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Harness {...state} />));
}

function render(state: State, write?: () => void) {
  act(() => {
    write?.();
    root!.render(<Harness {...state} />);
  });
}

/** The store write a send makes: your message in, the run started. */
function send() {
  const state = useMessagesStore.getState();
  useMessagesStore.setState({
    userSubmitTick: state.userSubmitTick + 1,
    byId: {
      ...state.byId,
      main: { ...EMPTY_MESSAGES, agentRunning: true },
    },
  });
}

const rowOf = (id: string) =>
  document.querySelector(`[data-row="${id}"]`) as HTMLElement;
const typingRow = () =>
  document.querySelector<HTMLElement>('[data-role="assistant-typing"]');
const questionRow = () =>
  document.querySelector<HTMLElement>('[data-role="ask-user-bubble"]');

function translateOf(el: Element | null): number {
  const value = (el as HTMLElement | null)?.style.getPropertyValue("translate");
  if (!value) return 0;
  return Number.parseFloat(value.split(" ")[1] ?? "0");
}

/** Every entrance played to its end, and the promise callbacks after. */
async function endAll() {
  for (const p of page.played) p.animation.end();
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

/** `el`'s offsets over the frames that follow, until the spring rests. */
function pathOf(el: Element | null): number[] {
  const path: number[] = [];
  for (let i = 0; i < 60 && frames.pending() > 0; i++) {
    frames.tick();
    path.push(translateOf(el));
  }
  return path;
}

/** Bounced up past its place, then back, at most 1.5px. */
function expectUp(path: number[]) {
  expect(Math.min(...path)).toBeLessThan(0);
  expect(Math.min(...path)).toBeGreaterThanOrEqual(-1.5);
  expect(Math.max(...path)).toBe(0);
  expect(path[path.length - 1]).toBe(0);
  expect(frames.pending()).toBe(0);
}

/** Bounced down past its place, then back, at most 1.5px. */
function expectDown(path: number[]) {
  expect(Math.max(...path)).toBeGreaterThan(0);
  expect(Math.max(...path)).toBeLessThanOrEqual(1.5);
  expect(Math.min(...path)).toBe(0);
  expect(path[path.length - 1]).toBe(0);
}

beforeEach(() => {
  page = installPage();
  frames = stubFrames();
  // The 1.5px peak painted as it is (the fake's 1x would round it).
  Object.defineProperty(window, "devicePixelRatio", {
    value: 2,
    configurable: true,
  });
  useMessagesStore.setState({
    userSubmitTick: 0,
    byId: { main: { ...EMPTY_MESSAGES, agentRunning: true } },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  uninstallPage();
  Reflect.deleteProperty(window, "devicePixelRatio");
  useMessagesStore.setState({ userSubmitTick: 0, byId: {} });
});

describe("your send lands with a bounce (ticket 151)", () => {
  function sendU2() {
    useMessagesStore.setState({
      byId: { main: { ...EMPTY_MESSAGES, agentRunning: false } },
    });
    mount({ rows: [A1, U1], typing: false, live: false });
    render({ rows: [A1, U1, U2], typing: true, live: true }, send);
    // The column moved up 110px at once; the slide plays before paint.
    page.layout.columnTop -= 110;
    page.frame();
  }

  it("once the slide is over, up the way it came, your row alone", async () => {
    sendU2();
    expect(page.played.some((p) => transforms(p).length > 0)).toBe(true);
    // Not before the slide's end.
    expect(frames.pending()).toBe(0);
    await endAll();
    const neighbour: number[] = [];
    const path: number[] = [];
    for (let i = 0; i < 60 && frames.pending() > 0; i++) {
      frames.tick();
      path.push(translateOf(rowOf("u-2")));
      neighbour.push(translateOf(rowOf("u-1")), translateOf(typingRow()));
    }
    expectUp(path);
    expect(neighbour.every((x) => x === 0)).toBe(true);
  });

  it("not under reduced motion: no slide, no bounce", async () => {
    frames.state.reducedMotion = true;
    sendU2();
    await endAll();
    expect(frames.pending()).toBe(0);
    expect(translateOf(rowOf("u-2"))).toBe(0);
  });
});

describe("a bubble growing in lands with a bounce (ticket 151)", () => {
  it("the reply out of the dots, following: up the way it came", async () => {
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    render({
      rows: [A1, U1, A3],
      typing: false,
      live: false,
      handoff: { tick: 1, kind: "reply", messageId: "a-3" },
    });
    expect(frames.pending()).toBe(0);
    // The follow took everything up 60px on the growth's clock.
    page.layout.columnTop -= 60;
    await endAll();
    expectUp(pathOf(rowOf("a-3")));
  });

  it("the reply out of the dots, scrolled up reading: grown where it stands, down", async () => {
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    render({
      rows: [A1, U1, A3],
      typing: false,
      live: false,
      handoff: { tick: 1, kind: "reply", messageId: "a-3" },
    });
    await endAll();
    expectDown(pathOf(rowOf("a-3")));
  });

  it("a woken round's reply with no dots up, following: up", async () => {
    mount({ rows: [A1, U1], typing: false, live: true });
    page.frame();
    render({
      rows: [A1, U1, A3],
      typing: false,
      live: false,
      handoff: { tick: 1, kind: "reply", messageId: "a-3" },
    });
    page.layout.columnTop -= 60;
    await endAll();
    expectUp(pathOf(rowOf("a-3")));
  });

  it("its question, following: up, the question's row", async () => {
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    render({
      rows: [A1, U1],
      typing: false,
      live: false,
      question: true,
      handoff: { tick: 1, kind: "question", messageId: null },
    });
    page.layout.columnTop -= 80;
    await endAll();
    expectUp(pathOf(questionRow()));
  });

  it("a line told mid-run, a short conversation let up: up, the dots still", async () => {
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    // 贴底: the column moved up by the line at once.
    page.layout.columnTop -= T1.h;
    render({
      rows: [A1, U1, T1],
      typing: true,
      live: true,
      handoff: { tick: 1, kind: "told", messageId: "t-1" },
    });
    await endAll();
    const dots: number[] = [];
    const path: number[] = [];
    for (let i = 0; i < 60 && frames.pending() > 0; i++) {
      frames.tick();
      path.push(translateOf(rowOf("t-1")));
      dots.push(translateOf(typingRow()));
    }
    expectUp(path);
    expect(dots.every((x) => x === 0)).toBe(true);
  });

  it("a line told mid-run, scrolled up reading: down", async () => {
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    render({
      rows: [A1, U1, T1],
      typing: true,
      live: true,
      handoff: { tick: 1, kind: "told", messageId: "t-1" },
    });
    await endAll();
    expectDown(pathOf(rowOf("t-1")));
  });

  it("not before the growth's end", () => {
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    render({
      rows: [A1, U1, A3],
      typing: false,
      live: false,
      handoff: { tick: 1, kind: "reply", messageId: "a-3" },
    });
    page.layout.columnTop -= 60;
    frames.tick();
    expect(frames.pending()).toBe(0);
    expect(translateOf(rowOf("a-3"))).toBe(0);
  });

  it("not under reduced motion: it only fades in", async () => {
    frames.state.reducedMotion = true;
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    render({
      rows: [A1, U1, T1],
      typing: true,
      live: true,
      handoff: { tick: 1, kind: "told", messageId: "t-1" },
    });
    await endAll();
    expect(frames.pending()).toBe(0);
    expect(translateOf(rowOf("t-1"))).toBe(0);
  });

  it("only in the main chat", async () => {
    mount({ rows: [A1, U1], typing: true, live: true, enabled: false });
    render({
      rows: [A1, U1, A3],
      typing: false,
      live: false,
      enabled: false,
      handoff: { tick: 1, kind: "reply", messageId: "a-3" },
    });
    await endAll();
    expect(page.played).toEqual([]);
    expect(frames.pending()).toBe(0);
    expect(rowOf("a-3").getAttribute("style")).toBeNull();
  });
});
