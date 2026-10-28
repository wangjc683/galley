// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FreshCard } from "@/lib/fresh-cards";
import { flightFrame, type FlightLevel } from "@/lib/todo-flight";

import { flyFreshCards, replayFlight } from "./todo-flight-run";

/**
 * The DOM half of a card's glyph flying into the top bar's 「待办」
 * button (main chat ticket 102): where each takes off and lands, the
 * layer it flies in, the button's pop class and when. jsdom lays nothing
 * out, so each element's box is set by hand; how it looks is for the
 * real window.
 */

const BIG: FlightLevel = {
  lift: 160,
  peak: 24,
  durationMs: 700,
  popScale: 1.25,
};

function box(left: number, top: number, width: number, height: number) {
  return () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** A card under a reply, its glyph's column at (left, top), 16×20. */
function card(
  parent: HTMLElement,
  role: string,
  attr: string,
  id: string,
  left: number,
  top: number,
) {
  const el = document.createElement("div");
  el.dataset.role = role;
  el.setAttribute(attr, id);
  const glyph = document.createElement("span");
  glyph.dataset.cardIcon = "";
  glyph.className = "text-ink-muted";
  glyph.innerHTML = '<svg data-x="1" id="g"></svg>';
  glyph.getBoundingClientRect = box(left, top, 16, 20);
  el.appendChild(glyph);
  parent.appendChild(el);
  return glyph;
}

let button: HTMLElement;

function page() {
  document.body.innerHTML = "";
  const header = document.createElement("header");
  button = document.createElement("button");
  button.dataset.role = "topbar-todo";
  button.innerHTML = "<svg></svg>";
  button.getBoundingClientRect = box(1180, 10, 28, 28);
  button.querySelector("svg")!.getBoundingClientRect = box(1186, 16, 16, 16);
  header.appendChild(button);
  document.body.appendChild(header);
  const scroller = document.createElement("div");
  scroller.dataset.conversationBackdrop = "";
  scroller.getBoundingClientRect = box(300, 52, 900, 700);
  const reply = document.createElement("div");
  reply.dataset.messageId = "msg_s-main_7_assistant";
  scroller.appendChild(reply);
  document.body.appendChild(scroller);
  return { scroller, reply };
}

const T: FreshCard = { kind: "todo", row: "todo_a", card: "todo_a" };
const R: FreshCard = { kind: "reminder", row: "sched_a", card: "sched_a" };
const M: FreshCard = { kind: "memo", row: "memo_1", card: "11" };

const flights = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[data-role="todo-flight"]'),
  );
const layer = () =>
  document.querySelector<HTMLElement>('[data-role="todo-flight-layer"]');
/** translate(x, y) of a flight: its top-left, 8px off its centre. */
const at = (el: HTMLElement) => {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(
    el.style.transform,
  )!;
  return { x: Number(m[1]) + 8, y: Number(m[2]) + 8, scale: Number(m[3]) };
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
  Object.defineProperty(window, "innerWidth", {
    value: 1400,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 900,
    configurable: true,
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flyInput = (fresh: FreshCard[]) => ({
  fresh,
  mainChatOnScreen: true,
  panelShown: false,
  form: "fly" as const,
  level: BIG,
});

describe("flying the new cards", () => {
  it("takes off from each glyph's centre 90ms apart, lands on the button's glyph, pops as the last lands", () => {
    const { reply } = page();
    card(reply, "todo-card", "data-todo-id", "todo_a", 340, 600);
    card(reply, "reminder-card", "data-reminder-id", "sched_a", 340, 648);
    card(reply, "memo-card", "data-memo-event", "11", 340, 696);
    flyFreshCards(flyInput([T, R, M]));

    expect(flights()).toHaveLength(1);
    expect(layer()?.style.zIndex).toBe("40");
    expect(layer()?.style.pointerEvents).toBe("none");
    expect(layer()?.getAttribute("aria-hidden")).toBe("true");
    expect(at(flights()[0])).toEqual({ x: 348, y: 610, scale: 1 });

    vi.advanceTimersByTime(90);
    expect(flights()).toHaveLength(2);
    expect(at(flights()[1])).toEqual({ x: 348, y: 658, scale: 1 });
    vi.advanceTimersByTime(90);
    expect(flights()).toHaveLength(3);
    expect(button.classList.contains("todo-catch-pop")).toBe(false);

    // The first lands at 700ms and is gone; the pop waits for the last.
    vi.advanceTimersByTime(700 - 180 + 20);
    expect(flights()).toHaveLength(2);
    expect(button.classList.contains("todo-catch-pop")).toBe(false);
    vi.advanceTimersByTime(180 - 20);
    expect(button.classList.contains("todo-catch-pop")).toBe(true);
    expect(button.style.getPropertyValue("--todo-catch-peak")).toBe("1.25");
    expect(button.style.getPropertyValue("--todo-catch-dip")).toBe("0.96");
    vi.advanceTimersByTime(40);
    expect(flights()).toHaveLength(0);
    expect(layer()).toBeNull();
    vi.advanceTimersByTime(440);
    expect(button.classList.contains("todo-catch-pop")).toBe(false);
  });

  it("moves along the arc towards the button's glyph, then fades into it", () => {
    const { reply } = page();
    card(reply, "todo-card", "data-todo-id", "todo_a", 340, 600);
    flyFreshCards(flyInput([T]));
    const node = flights()[0];
    vi.advanceTimersByTime(350);
    const mid = at(node);
    expect(mid.x).toBeGreaterThan(348);
    expect(mid.y).toBeLessThan(610);
    expect(Number(node.style.opacity)).toBe(1);
    vi.advanceTimersByTime(330);
    const late = at(node);
    expect(late.x).toBeGreaterThan(mid.x);
    expect(Math.abs(late.x - 1194)).toBeLessThan(Math.abs(mid.x - 1194));
    expect(Number(node.style.opacity)).toBeLessThan(1);
  });

  it("flies a copy of the glyph, its colour, without the ids and data the card is found by", () => {
    const { reply } = page();
    card(reply, "todo-card", "data-todo-id", "todo_a", 340, 600);
    vi.stubGlobal(
      "getComputedStyle",
      () => ({ color: "rgb(135, 130, 122)" }) as CSSStyleDeclaration,
    );
    flyFreshCards(flyInput([T]));
    const node = flights()[0];
    expect(node.style.color).toBe("rgb(135, 130, 122)");
    expect(node.querySelector("svg")).not.toBeNull();
    expect(node.querySelector("[data-card-icon], [id], [data-x]")).toBeNull();
    // The card's own glyph stays.
    expect(document.querySelectorAll("[data-card-icon]")).toHaveLength(1);
  });

  it("does not fly a glyph scrolled out of view: the button only pops, at once", () => {
    const { reply } = page();
    // Below the conversation's view (52–752).
    card(reply, "todo-card", "data-todo-id", "todo_a", 340, 800);
    flyFreshCards(flyInput([T]));
    expect(flights()).toHaveLength(0);
    expect(button.classList.contains("todo-catch-pop")).toBe(true);
  });

  it("does nothing while the panel is on screen", () => {
    const { reply } = page();
    card(reply, "todo-card", "data-todo-id", "todo_a", 340, 600);
    flyFreshCards({ ...flyInput([T]), panelShown: true });
    vi.advanceTimersByTime(1000);
    expect(flights()).toHaveLength(0);
    expect(button.className).toBe("");
  });

  it("only pops at 只 pop, and under reduced motion washes the ground instead", () => {
    const { reply } = page();
    card(reply, "todo-card", "data-todo-id", "todo_a", 340, 600);
    flyFreshCards({ ...flyInput([T]), form: "pop" });
    expect(flights()).toHaveLength(0);
    expect(button.classList.contains("todo-catch-pop")).toBe(true);
    vi.advanceTimersByTime(440);

    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    flyFreshCards(flyInput([T]));
    expect(flights()).toHaveLength(0);
    expect(button.classList.contains("todo-catch-pop")).toBe(false);
    expect(button.classList.contains("todo-catch-wash")).toBe(true);
    vi.advanceTimersByTime(600);
    expect(button.classList.contains("todo-catch-wash")).toBe(false);
  });
});

describe("where it lands (ticket 103's 乙 and 丙)", () => {
  it("lands on the button's glyph, not the middle of a button with its word", () => {
    const { reply } = page();
    card(reply, "todo-card", "data-todo-id", "todo_a", 340, 600);
    // 乙: 「☑ 待办 2」, 62px wide; the glyph at its left, 6px in.
    button.getBoundingClientRect = box(1100, 10, 62, 28);
    button.querySelector("svg")!.getBoundingClientRect = box(1106, 16, 16, 16);
    flyFreshCards(flyInput([T]));
    const node = flights()[0];
    vi.advanceTimersByTime(600);
    // How far the glyph is from the path to `to` at its closest moment:
    // where it is and how big, against every millisecond of that path.
    const from = { x: 348, y: 610 };
    const now = at(node);
    const off = (to: { x: number; y: number }) =>
      Math.min(
        ...Array.from({ length: 701 }, (_, ms) => {
          const f = flightFrame(from, to, BIG, ms);
          return Math.max(
            Math.abs(f.x - now.x),
            Math.abs(f.y - now.y),
            Math.abs(f.size / 16 - now.scale) * 16,
          );
        }),
      );
    // On the way to the glyph's centre (1114, 24), not the button's (1131).
    expect(off({ x: 1114, y: 24 })).toBeLessThan(0.01);
    expect(off({ x: 1131, y: 24 })).toBeGreaterThan(1);
    // The pop is the whole button's.
    vi.advanceTimersByTime(100);
    expect(button.classList.contains("todo-catch-pop")).toBe(true);
  });
});

describe("重放 (TEMP variant switcher, main chat 102)", () => {
  it("flies the cards of the last reply that has any, the panel open or not", () => {
    const { scroller, reply } = page();
    const older = document.createElement("div");
    older.dataset.messageId = "msg_s-main_3_assistant";
    scroller.insertBefore(older, reply);
    card(older, "todo-card", "data-todo-id", "todo_old", 340, 200);
    card(reply, "reminder-card", "data-reminder-id", "sched_a", 340, 600);
    card(reply, "memo-card", "data-memo-event", "11", 340, 648);
    replayFlight("fly", BIG);
    expect(flights().map((el) => at(el).y)).toEqual([610]);
    vi.advanceTimersByTime(90);
    expect(flights()).toHaveLength(2);
    expect(at(flights()[1]).y).toBe(658);
    vi.advanceTimersByTime(1000);
    expect(button.classList.contains("todo-catch-pop")).toBe(true);
  });

  it("with no card, flies one box from the composer's left end", () => {
    page();
    const composer = document.createElement("div");
    composer.dataset.role = "composer-one-line";
    composer.getBoundingClientRect = box(320, 780, 800, 48);
    document.body.appendChild(composer);
    replayFlight("fly", BIG);
    expect(flights()).toHaveLength(1);
    expect(at(flights()[0])).toEqual({ x: 344, y: 804, scale: 1 });
    expect(flights()[0].querySelector("span.rounded-sm")).not.toBeNull();
  });

  it("follows the form: nothing at 现状, the pop alone at 只 pop", () => {
    const { reply } = page();
    card(reply, "todo-card", "data-todo-id", "todo_a", 340, 600);
    replayFlight("none", BIG);
    expect(flights()).toHaveLength(0);
    expect(button.className).toBe("");
    replayFlight("pop", BIG);
    expect(flights()).toHaveLength(0);
    expect(button.classList.contains("todo-catch-pop")).toBe(true);
  });
});
