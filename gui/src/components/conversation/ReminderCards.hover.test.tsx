// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EMPTY_TODO, type TodoItem } from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import type { ScheduledTask } from "@/lib/scheduled-tasks";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

import { ReminderCards } from "./ReminderCards";

/**
 * A reminder card's words cut short, hovered (main chat ticket 105, PRD
 * ruling 151): the native tooltip gives the first line in full, never
 * the assistant's notes to itself after the blank line — whether the
 * words are the button that opens the panel (the panel lists the task,
 * ticket 101) or plain words. The rest of the card is pinned in
 * ReminderCards.test.tsx.
 */

const FIRST = "周五前把报销单交给财务部的王老师，记得附上全部发票原件";
const WORDS = `${FIRST}\n\n用户周三说的；发票在抽屉里，到时问一声交了没有。`;

const TASK: ScheduledTask = {
  id: "sched_1",
  prompt: WORDS,
  repeat: { kind: "once" },
  timeOfDay: "09:00",
  enabled: true,
  fireAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
  target: "assistant",
  origin: { via: "supervisor", supervisor: "galley-assistant" },
  createdIn: { sessionId: "s-main", turnIndex: 7 },
  createdAt: "2026-10-28T08:00:00Z",
  updatedAt: "2026-10-28T08:00:00Z",
};

const ROW: TodoItem = {
  kind: "task",
  id: "sched_1",
  text: WORDS,
  state: "scheduled",
  createdBy: "assistant",
  target: "assistant",
  repeat: { kind: "once" },
  at: TASK.fireAt,
  createdIn: { sessionId: "s-main", turnIndex: 7 },
};

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useAssistantTodoStore.setState({ todo: EMPTY_TODO });
});

function mount() {
  act(() =>
    root.render(
      <CopyProvider language="zh-CN">
        <Tooltip.Provider>
          <ReminderCards tasks={[TASK]} />
        </Tooltip.Provider>
      </CopyProvider>,
    ),
  );
}

/** The card's element of this tag holding exactly the words shown. */
function wordsIn(tag: "span" | "button"): HTMLElement | undefined {
  return [
    ...host.querySelectorAll<HTMLElement>(`[data-role="reminder-card"] ${tag}`),
  ].find((el) => el.textContent === FIRST);
}

/** The element holding the words, made to measure as cut (jsdom lays
 * nothing out), then hovered. */
function hoverCut(el: HTMLElement): void {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: 600 });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 200 });
  act(() => {
    el.dispatchEvent(
      new MouseEvent("pointerover", { bubbles: true, relatedTarget: null }),
    );
  });
}

describe("a reminder card's cut words, hovered", () => {
  it("as plain words: the first line in full, not the notes", () => {
    mount();
    const words = wordsIn("span");
    expect(wordsIn("button")).toBeUndefined();
    expect(words).toBeDefined();
    hoverCut(words as HTMLElement);
    expect(words?.getAttribute("title")).toBe(FIRST);
  });

  it("as the button to the panel's row: the first line in full, not the notes", () => {
    useAssistantTodoStore.setState({
      todo: { ...EMPTY_TODO, assistant: [ROW] },
    });
    mount();
    const button = wordsIn("button");
    expect(button).toBeDefined();
    hoverCut(button as HTMLElement);
    expect(button?.getAttribute("title")).toBe(FIRST);
  });
});
