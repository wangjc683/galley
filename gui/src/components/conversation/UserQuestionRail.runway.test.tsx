// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { UserQuestionRail } from "@/components/conversation/UserQuestionRail";
import { layRunway } from "@/lib/scroll-runway";
import type { Turn } from "@/types/conversation";

/*
 * The question rail places each dot at its question's share of the
 * loaded content (main chat ticket 123): the runway standing above the
 * loaded turns while earlier pages remain (lib/scroll-runway.ts) is not
 * content, so the dots sit where they would without it. The scroller
 * keeps its own numbers: 24px of padding above and below the column, the
 * runway over the content, the questions at fixed places in it.
 */

const PAD = 24;
const VIEW = 600;
const CONTENT = 9_000;
/** Where each question starts in the content (px). */
const QUESTIONS = [0, 2_000, 5_000, 8_000];

const turns: Turn[] = QUESTIONS.flatMap((_, i): Turn[] => [
  { role: "user", content: `问题 ${i + 1}` },
  { role: "agent", tools: [], finalAnswer: `回答 ${i + 1}`, turnIndex: i },
]);

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.replaceChildren();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

/** A scroller `runway` px of runway deep, scrolled `scrollTop` into it. */
function scroller(runway: number, scrollTop: number): HTMLDivElement {
  const el = document.createElement("div");
  const column = document.createElement("div");
  if (runway > 0) layRunway(column, runway);
  el.append(column);
  for (const at of QUESTIONS) {
    const message = document.createElement("div");
    message.setAttribute("data-role", "user-msg");
    message.getBoundingClientRect = () =>
      ({ top: PAD + runway + at - scrollTop }) as DOMRect;
    column.append(message);
  }
  Object.defineProperties(el, {
    clientHeight: { value: VIEW },
    scrollHeight: { value: PAD + runway + CONTENT + PAD },
    scrollTop: { value: scrollTop },
  });
  el.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  document.body.append(el);
  return el;
}

/** The dots' places on the rail (their `top`), drawn against `el`. */
function dots(el: HTMLDivElement): string[] {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <UserQuestionRail turns={turns} scrollContainerRef={{ current: el }} />,
    ),
  );
  const nav = host.querySelector('[role="navigation"]')!;
  const tops = Array.from(nav.querySelectorAll<HTMLElement>("[style]"))
    .map((item) => item.style.top)
    .filter(Boolean);
  act(() => root!.unmount());
  root = null;
  return tops;
}

describe("the question rail under a runway", () => {
  it("puts the dots where they are without one", () => {
    const without = dots(scroller(0, 1_200));
    expect(without).toHaveLength(QUESTIONS.length);
    const under = dots(scroller(20_000, 20_000 + 1_200));
    expect(under).toEqual(without);
    // Refilled while the reader rests: still the same places.
    expect(dots(scroller(30_000, 30_000 + 1_200))).toEqual(without);
  });
});
