import * as Tooltip from "@radix-ui/react-tooltip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunElapsedHud } from "@/components/conversation/RunElapsedHud";
import { zhCopy } from "@/i18n/locales/zh";
import { dropComposerDraft, saveComposerDraft } from "@/lib/composer-draft";
import { ASSISTANT_BUBBLE_TEXT_CLASS } from "@/lib/conversation-font-size";
import { LocalFilesContext } from "@/lib/local-files";
import type { PerSessionMessages } from "@/stores/messages";
import { useQueueStore } from "@/stores/queue";
import { useSessionsStore } from "@/stores/sessions";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

import { EmptyState } from "./EmptyState";
import { MainView } from "./MainView";

// The live state MainView reads off the active session (its run clock):
// a static render reads the stores' initial state, so the tests hand it
// in here.
const live = vi.hoisted(() => ({
  slice: {} as Partial<PerSessionMessages>,
}));
vi.mock("@/hooks/useActiveSession", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useActiveSession")>();
  const { EMPTY_MESSAGES } = await import("@/stores/messages");
  return {
    ...actual,
    useActiveMessages: <T,>(
      select: (m: PerSessionMessages) => T,
      fallback: T,
    ): T =>
      Object.keys(live.slice).length > 0
        ? select({ ...EMPTY_MESSAGES, ...live.slice })
        : fallback,
  };
});

// The composer's queue strip needs the active session and its queue; a
// static render reads a zustand store's initial state, so these two read
// their current state here (unset, that is the initial state).
vi.mock("@/stores/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/queue")>();
  const store = actual.useQueueStore;
  const current = Object.assign(
    (select?: (state: ReturnType<typeof store.getState>) => unknown) =>
      select ? select(store.getState()) : store.getState(),
    store,
  );
  return { ...actual, useQueueStore: current };
});
vi.mock("@/stores/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/sessions")>();
  const store = actual.useSessionsStore;
  const current = Object.assign(
    (select?: (state: ReturnType<typeof store.getState>) => unknown) =>
      select ? select(store.getState()) : store.getState(),
    store,
  );
  return { ...actual, useSessionsStore: current };
});

// The cards under a reply (tickets 06a, 37, 42): the records the hooks
// read from Core, handed in. Each hook gets the session id only for the
// main chat; anything else reads nothing.
const cards = vi.hoisted(() => ({
  dispatches: new Map<string, unknown[]>(),
  reminders: new Map<string, unknown[]>(),
  todos: new Map<string, unknown[]>(),
  memos: new Map<string, unknown[]>(),
}));
vi.mock("@/hooks/useSubtaskCards", () => ({
  useSubtaskDispatchesByMessage: (id: string | undefined) =>
    id ? cards.dispatches : new Map(),
}));
vi.mock("@/hooks/useReminderCards", () => ({
  useRemindersByMessage: (id: string | undefined) =>
    id ? cards.reminders : new Map(),
}));
vi.mock("@/hooks/useTodoCards", () => ({
  useTodosByMessage: (id: string | undefined) => (id ? cards.todos : new Map()),
}));
vi.mock("@/hooks/useMemoCards", () => ({
  useMemosByMessage: (id: string | undefined) => (id ? cards.memos : new Map()),
}));

afterEach(() => {
  cards.dispatches = new Map();
  cards.reminders = new Map();
  cards.todos = new Map();
  cards.memos = new Map();
  live.slice = {};
  useSessionsStore.setState({ activeSessionId: undefined });
  useQueueStore.setState({ bySession: {} });
});

function tool(name: string, args: Record<string, unknown> = {}) {
  return {
    id: `t-${name}-${Math.random()}`,
    name,
    status: "success-historical",
    args,
  } as ConversationToolEvent;
}

function step(narration: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: narration,
    summary: narration,
    tools: [tool("web_scan")],
  };
}

function answer(text: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: text,
    tools: [tool("no_tool")],
    telemetry: { elapsedMs: 9_000 },
    messageId: `a-${text}`,
  };
}

function ask(question: string, candidates: string[], index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: null,
    tools: [tool("ask_user", { question, candidates })],
  };
}

const GREETING: AgentTurn = {
  role: "agent",
  turnIndex: -1,
  finalAnswer: "你好。以后有什么事，直接在这里跟我说就行。",
  tools: [],
  greeting: true,
  messageId: "a-greeting",
};

/** The greeting, a one-step answer and a two-step one. */
function conversation(): Turn[] {
  return [
    GREETING,
    { role: "user", content: "早，天气怎么样？", messageId: "u-1" },
    answer("多云，记得带伞。", 1),
    { role: "user", content: "帮我排个行程", messageId: "u-2" },
    step("我先查一下船票。", 1),
    answer("排好了。", 2),
  ];
}

function render(props: Partial<ComponentProps<typeof MainView>>): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <MainView
          turns={conversation()}
          llmDisplayName="model"
          activeSessionId="s-1"
          {...props}
        />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

const CORNER_CLOCK = `aria-label="${zhCopy.conversation.runWorking}`;

describe("the main chat is the assistant's conversation", () => {
  it("draws the main chat as the assistant's and every other conversation (a subtask, the external runtime) as before", () => {
    // The process button: a <button> chip (the fold header is a div
    // with the same words).
    const PROCESS = `<button type="button" aria-label="${zhCopy.conversation.foldExpand}"`;
    const main = render({ isMainChat: true });
    expect(main).toContain('data-role="assistant-bubble"');
    expect(main).toContain("ml-auto max-w-[min(80%,560px)]");
    expect(count(main, PROCESS)).toBe(1);
    const other = render({ isMainChat: false });
    expect(other).not.toContain('data-role="assistant-bubble"');
    expect(other).not.toContain(PROCESS);
    expect(other).toContain('data-role="run-fold"');
    // The user's words sit on the right in both (workbench ticket 01);
    // only beside the question rail does the bubble read the scroll
    // box's width and the column's cap to keep off the rail.
    expect(other).toContain("ml-auto max-w-[min(80%,560px)]");
    expect(other).toContain(
      "overflow-y-auto px-8 py-6 @container/conversation [--conversation-column:760px]",
    );
    expect(main).not.toContain("@container/conversation");
    expect(main).not.toContain("--conversation-column");
    expect(render({ isMainChat: false, conversationWidth: "wide" })).toContain(
      "[--conversation-column:1200px]",
    );
  });

  it("hangs the reminders it set under that reply, after its subtask cards; nowhere else (ticket 37)", () => {
    const reminder = {
      id: "sched_water",
      prompt: "提醒用户喝水",
      repeat: { kind: "once" },
      timeOfDay: "21:40",
      enabled: true,
      fireAt: "2099-10-16T13:40:00.000Z",
      target: "assistant",
      createdIn: { sessionId: "s-1", turnIndex: 2 },
      createdAt: "2026-10-16T08:00:00Z",
      updatedAt: "2026-10-16T08:00:00Z",
    };
    cards.reminders = new Map([["a-排好了。", [reminder]]]);
    const main = render({ isMainChat: true });
    expect(count(main, 'data-role="reminder-card"')).toBe(1);
    // Under the reply it was set in, before that reply's action row.
    const card = main.indexOf('data-role="reminder-card"');
    expect(main.lastIndexOf("排好了。", card)).toBeGreaterThan(
      main.lastIndexOf("多云，记得带伞。", card),
    );
    expect(main).toContain(
      'data-role="reminder-cards" class="flex flex-col gap-2 mt-3"',
    );
    // With the reply's subtask cards: theirs first, then 8px.
    cards.dispatches = new Map([
      [
        "a-排好了。",
        [
          {
            parentSessionId: "s-1",
            turnIndex: 2,
            ordinal: 0,
            messageId: "a-排好了。",
            sessionId: null,
            title: "订船票",
            failure: "empty",
            failureDetail: null,
            createdAt: "2026-10-16T08:00:00Z",
          },
        ],
      ],
    ]);
    const both = render({ isMainChat: true });
    expect(both.indexOf('data-role="subtask-cards"')).toBeGreaterThan(-1);
    expect(both.indexOf('data-role="subtask-cards"')).toBeLessThan(
      both.indexOf('data-role="reminder-cards"'),
    );
    expect(both).toContain(
      'data-role="reminder-cards" class="flex flex-col gap-2 mt-2"',
    );
    // A workbench session, a subtask, the external runtime: none.
    const other = render({ isMainChat: false });
    expect(other).not.toContain('data-role="reminder-card');
    expect(other).not.toContain('data-role="subtask-card');
  });

  it("hangs the to-dos it noted under that reply: subtasks, to-dos, reminders (ticket 42)", () => {
    const noted = {
      kind: "todo",
      id: "todo_report",
      text: "交季度报告",
      state: "open",
      createdBy: "assistant",
      createdIn: { sessionId: "s-1", turnIndex: 2 },
      due: { date: "2099-10-21", hasTime: false },
    };
    cards.todos = new Map([["a-排好了。", [noted]]]);
    const alone = render({ isMainChat: true });
    expect(count(alone, 'data-role="todo-card"')).toBe(1);
    expect(alone).toContain(
      'data-role="todo-cards" class="flex flex-col gap-2 mt-3"',
    );
    const card = alone.indexOf('data-role="todo-card"');
    expect(alone.lastIndexOf("排好了。", card)).toBeGreaterThan(
      alone.lastIndexOf("多云，记得带伞。", card),
    );
    // With a reminder card: the to-dos first, the reminders 8px under.
    cards.reminders = new Map([
      [
        "a-排好了。",
        [
          {
            id: "sched_water",
            prompt: "提醒用户喝水",
            repeat: { kind: "once" },
            timeOfDay: "21:40",
            enabled: true,
            fireAt: "2099-10-16T13:40:00.000Z",
            target: "assistant",
            createdIn: { sessionId: "s-1", turnIndex: 2 },
            createdAt: "2026-10-16T08:00:00Z",
            updatedAt: "2026-10-16T08:00:00Z",
          },
        ],
      ],
    ]);
    const two = render({ isMainChat: true });
    expect(two.indexOf('data-role="todo-cards"')).toBeLessThan(
      two.indexOf('data-role="reminder-cards"'),
    );
    expect(two).toContain(
      'data-role="todo-cards" class="flex flex-col gap-2 mt-3"',
    );
    expect(two).toContain(
      'data-role="reminder-cards" class="flex flex-col gap-2 mt-2"',
    );
    // With a subtask card too: subtasks, then the to-dos, then the
    // reminders, 8px apart.
    cards.dispatches = new Map([
      [
        "a-排好了。",
        [
          {
            parentSessionId: "s-1",
            turnIndex: 2,
            ordinal: 0,
            messageId: "a-排好了。",
            sessionId: null,
            title: "订船票",
            failure: "empty",
            failureDetail: null,
            createdAt: "2026-10-16T08:00:00Z",
          },
        ],
      ],
    ]);
    cards.reminders = new Map([
      [
        "a-排好了。",
        [
          {
            id: "sched_water",
            prompt: "提醒用户喝水",
            repeat: { kind: "once" },
            timeOfDay: "21:40",
            enabled: true,
            fireAt: "2099-10-16T13:40:00.000Z",
            target: "assistant",
            createdIn: { sessionId: "s-1", turnIndex: 2 },
            createdAt: "2026-10-16T08:00:00Z",
            updatedAt: "2026-10-16T08:00:00Z",
          },
        ],
      ],
    ]);
    const all = render({ isMainChat: true });
    const order = [
      'data-role="subtask-cards"',
      'data-role="todo-cards"',
      'data-role="reminder-cards"',
    ].map((needle) => all.indexOf(needle));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(all).toContain(
      'data-role="todo-cards" class="flex flex-col gap-2 mt-2"',
    );
    expect(all).toContain(
      'data-role="reminder-cards" class="flex flex-col gap-2 mt-2"',
    );
    // Only the main chat has them.
    expect(render({ isMainChat: false })).not.toContain('data-role="todo-card');
  });

  it("hangs what it noted about you under that reply, after its to-do and reminder cards (ticket 97)", () => {
    const noted = {
      id: 7,
      memoId: "memo_cilantro",
      action: "add",
      text: "你不吃香菜",
      sessionId: "s-1",
      turnIndex: 2,
      memoExists: true,
      createdAt: "2026-10-26T08:00:00Z",
    };
    cards.memos = new Map([["a-排好了。", [noted]]]);
    const alone = render({ isMainChat: true });
    expect(count(alone, 'data-role="memo-card"')).toBe(1);
    // 12px off the bubble with nothing above it.
    expect(alone).toContain(
      'data-role="memo-cards" class="flex flex-col gap-2 mt-3"',
    );
    const card = alone.indexOf('data-role="memo-card"');
    expect(alone.lastIndexOf("排好了。", card)).toBeGreaterThan(
      alone.lastIndexOf("多云，记得带伞。", card),
    );
    // With a to-do card and a reminder card: the to-dos, the reminders,
    // then the memos, 8px apart.
    cards.todos = new Map([
      [
        "a-排好了。",
        [
          {
            kind: "todo",
            id: "todo_hotel",
            text: "订上海的酒店",
            state: "open",
            createdBy: "assistant",
            createdIn: { sessionId: "s-1", turnIndex: 2 },
          },
        ],
      ],
    ]);
    const two = render({ isMainChat: true });
    expect(two.indexOf('data-role="todo-cards"')).toBeLessThan(
      two.indexOf('data-role="memo-cards"'),
    );
    expect(two).toContain(
      'data-role="memo-cards" class="flex flex-col gap-2 mt-2"',
    );
    cards.reminders = new Map([
      [
        "a-排好了。",
        [
          {
            id: "sched_visa",
            prompt: "问一下签证进度",
            repeat: { kind: "once" },
            timeOfDay: "09:00",
            enabled: true,
            fireAt: "2099-10-16T01:00:00.000Z",
            target: "assistant",
            createdIn: { sessionId: "s-1", turnIndex: 2 },
            createdAt: "2026-10-16T08:00:00Z",
            updatedAt: "2026-10-16T08:00:00Z",
          },
        ],
      ],
    ]);
    const all = render({ isMainChat: true });
    const order = [
      'data-role="todo-cards"',
      'data-role="reminder-cards"',
      'data-role="memo-cards"',
    ].map((needle) => all.indexOf(needle));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Only the main chat has them.
    expect(render({ isMainChat: false })).not.toContain('data-role="memo-card');
  });

  it("hangs the files a reply handed over under it, first, in marker order; nowhere else (ticket 74)", () => {
    const delivered: AgentTurn = {
      ...answer("排好了。", 2),
      files: [
        "/Users/jc/Documents/五一行程.html",
        "/Users/jc/Documents/船票.pdf",
      ],
    };
    const turns: Turn[] = [...conversation().slice(0, -1), delivered];
    const main = render({ isMainChat: true, turns });
    expect(count(main, 'data-role="file-card"')).toBe(2);
    expect(main).toContain(
      'data-role="file-cards" class="mt-3 flex flex-col gap-2"',
    );
    // Under the reply that handed them over, in the order it wrote them.
    const first = main.indexOf('data-role="file-card"');
    expect(main.lastIndexOf("排好了。", first)).toBeGreaterThan(
      main.lastIndexOf("多云，记得带伞。", first),
    );
    expect(main.indexOf("五一行程")).toBeLessThan(main.indexOf("船票"));
    // The paths themselves are not shown: the cleaned answer has no
    // marker and the cards show a name and a folder.
    expect(main).not.toContain("[FILE:");
    expect(main).not.toContain(">/Users/jc/Documents/五一行程.html<");
    // With the reply's subtask and reminder cards: the files first, the
    // rest 8px under them.
    cards.dispatches = new Map([
      [
        "a-排好了。",
        [
          {
            parentSessionId: "s-1",
            turnIndex: 2,
            ordinal: 0,
            messageId: "a-排好了。",
            sessionId: null,
            title: "订船票",
            failure: "empty",
            failureDetail: null,
            createdAt: "2026-10-16T08:00:00Z",
          },
        ],
      ],
    ]);
    cards.reminders = new Map([
      [
        "a-排好了。",
        [
          {
            id: "sched_water",
            prompt: "提醒用户喝水",
            repeat: { kind: "once" },
            timeOfDay: "21:40",
            enabled: true,
            fireAt: "2099-10-16T13:40:00.000Z",
            target: "assistant",
            createdIn: { sessionId: "s-1", turnIndex: 2 },
            createdAt: "2026-10-16T08:00:00Z",
            updatedAt: "2026-10-16T08:00:00Z",
          },
        ],
      ],
    ]);
    const all = render({ isMainChat: true, turns });
    const order = [
      'data-role="file-cards"',
      'data-role="subtask-cards"',
      'data-role="reminder-cards"',
    ].map((needle) => all.indexOf(needle));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(all).toContain(
      'data-role="subtask-cards" class="mt-2 flex flex-col gap-2"',
    );
    expect(all).toContain(
      'data-role="reminder-cards" class="flex flex-col gap-2 mt-2"',
    );
    // A workbench session, a subtask, the external runtime: none.
    expect(render({ isMainChat: false, turns })).not.toContain(
      'data-role="file-card',
    );
  });

  it("stacks a short conversation up from the composer (贴底)", () => {
    const main = render({ isMainChat: true, turns: [GREETING] });
    expect(main).toContain("overflow-y-auto px-8 py-6 flex flex-col");
    expect(main).toContain("mt-auto w-full");
    const other = render({ isMainChat: false, turns: [GREETING] });
    expect(other).not.toContain("flex flex-col");
    expect(other).not.toContain("mt-auto w-full");
  });

  it("sets the text in its bubbles a step tighter, at the tier; the workbench as before (telegram-details ruling 8)", () => {
    const COLUMN_CLASS = ASSISTANT_BUBBLE_TEXT_CLASS.replace(/&/g, "&amp;");
    const main = render({ isMainChat: true });
    expect(main).toContain(COLUMN_CLASS);
    expect(main).toContain(
      'style="--conversation-bubble-leading:1.55;--conversation-bubble-block-gap:10.5px"',
    );
    // ⌘= / ⌘−: the column follows the tier.
    expect(
      render({ isMainChat: true, conversationFontSize: "large" }),
    ).toContain(
      'style="--conversation-bubble-leading:1.6;--conversation-bubble-block-gap:12.5px"',
    );
    expect(
      render({ isMainChat: true, conversationFontSize: "small" }),
    ).toContain(
      'style="--conversation-bubble-leading:1.5;--conversation-bubble-block-gap:9.5px"',
    );
    // The workbench's column carries nothing of it.
    for (const conversationFontSize of [
      "small",
      "standard",
      "large",
    ] as const) {
      const other = render({ isMainChat: false, conversationFontSize });
      expect(other).not.toContain("--conversation-bubble-");
      expect(other).not.toContain("data-role=assistant-bubble]]");
    }
  });

  it("asks as a plain left bubble with the candidates under it", () => {
    const turns: Turn[] = [
      ...conversation(),
      { role: "user", content: "顺便订船票", messageId: "u-3" },
      ask("订哪一班？", ["8:30", "9:00", "9:30"], 1),
    ];
    const pendingAskUser = {
      question: "订哪一班？",
      candidates: ["8:30", "9:00", "9:30"],
    };
    const html = render({ isMainChat: true, turns, pendingAskUser });
    expect(html).not.toContain(zhCopy.conversation.waitingForYou);
    expect(html).not.toContain("border-warning bg-warning");
    const bubble = html.indexOf('data-role="ask-user-bubble"');
    const inner = html.indexOf('data-role="assistant-bubble"', bubble);
    const question = html.indexOf("订哪一班？", bubble);
    expect(inner).toBeGreaterThan(bubble);
    expect(question).toBeGreaterThan(inner);
    expect(html.indexOf("8:30", question)).toBeGreaterThan(question);
    // Elsewhere: the warning bar and 「等你回复」.
    const other = render({ isMainChat: false, turns, pendingAskUser });
    expect(other).toContain(zhCopy.conversation.waitingForYou);
  });
});

describe("the assistant's typing bubble", () => {
  const sent: Turn[] = [
    ...conversation(),
    { role: "user", content: "顺便看看船票", messageId: "u-3" },
  ];
  const TYPING = 'data-role="assistant-typing"';

  it("while it runs, shows the typing bubble and the line under it: no steps, no streaming prose", () => {
    const turns: Turn[] = [...sent, step("我先查一下周六的船班。", 1)];
    live.slice = { inFlightContent: "周六上午还有三班船。" };
    const html = render({ isMainChat: true, isRunning: true, turns });
    expect(count(html, TYPING)).toBe(1);
    const typing = html.slice(html.indexOf(TYPING));
    // Three dots in the assistant's tint, read as 「Galley 正在输入」.
    expect(typing).toMatch(/^data-role="assistant-typing" role="status"/);
    expect(typing).toContain(zhCopy.assistant.typingLabel);
    expect(typing).toContain("bg-assistant-tint");
    expect(count(typing, "live-dot rounded-full")).toBe(3);
    // What it is doing is the line under the dots (rulings 134, 135: here
    // it writes words); what streams, nobody's.
    expect(count(html, 'data-role="assistant-progress"')).toBe(1);
    expect(typing).toMatch(
      /data-role="assistant-progress-doing"[^>]*>正在写回复</,
    );
    expect(html).not.toContain("我先查一下周六的船班。");
    expect(html).not.toContain("周六上午还有三班船。");
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toContain("streaming-prose");
    // Elsewhere: the live window and the in-flight row.
    const other = render({ isMainChat: false, isRunning: true, turns });
    expect(other).toContain('data-role="step-marker"');
    expect(other).not.toContain(TYPING);
  });

  it("shows from the send on, and goes once the round has its answer or asks", () => {
    // Sent, nothing back yet.
    const waiting = render({ isMainChat: true, isRunning: true, turns: sent });
    expect(count(waiting, TYPING)).toBe(1);
    // The answer landed before the run closed: the typing bubble goes.
    const answered = render({
      isMainChat: true,
      isRunning: true,
      turns: [...sent, answer("还有票。", 1)],
    });
    expect(answered).not.toContain(TYPING);
    // Asking: it waits, it is not busy.
    const asking = render({
      isMainChat: true,
      turns: [...sent, ask("订哪一班？", ["8:30"], 1)],
      pendingAskUser: { question: "订哪一班？", candidates: ["8:30"] },
    });
    expect(asking).not.toContain(TYPING);
    expect(asking).toContain('data-role="ask-user-bubble"');
    // …from the moment the question arrives, before the run's close:
    // its bubble takes the typing bubble's place (tickets 51, 58).
    const asked = render({
      isMainChat: true,
      isRunning: true,
      turns: [...sent, ask("订哪一班？", ["8:30"], 1)],
      pendingAskUser: { question: "订哪一班？", candidates: ["8:30"] },
    });
    expect(asked).not.toContain(TYPING);
    expect(asked).toContain('data-role="ask-user-bubble"');
  });

  it("keeps the time to the line under the dots: no clock in the corner", () => {
    live.slice = { currentRunStartedAtMs: Date.now() - 14_000 };
    const html = render({ isMainChat: true, isRunning: true, turns: sent });
    // Rulings 134, 135: the round's time is the line's, once.
    expect(count(html, "14 秒")).toBe(1);
    expect(html).toContain(
      'data-role="assistant-progress-elapsed" class="shrink-0 whitespace-pre"> · 14 秒<',
    );
    expect(html).not.toContain(CORNER_CLOCK);
    // Elsewhere the corner clock stays.
    const other = render({ isMainChat: false, isRunning: true, turns: sent });
    expect(other).toContain(CORNER_CLOCK);
  });

  // Ticket 31, rulings 107 and 110: a round Core woke it for shows the
  // typing bubble only while it writes words, and a reply that said
  // nothing settles it with nothing left.
  it("shows a subtask report's round only while it writes, and leaves nothing when its reply says nothing", () => {
    const woken: Turn[] = [
      ...conversation(),
      {
        role: "user",
        content: "[Galley — not a message from the user] …",
        messageId: "u-report",
        origin: { via: "system", supervisor: "galley-report", reason: "s-2" },
      },
      step("我让它再查一家。", 1),
    ];
    // Between its words: nothing at the conversation's end.
    const quiet = render({ isMainChat: true, isRunning: true, turns: woken });
    expect(quiet).not.toContain(TYPING);
    expect(quiet).not.toContain("我让它再查一家。");
    expect(quiet).not.toContain("not a message from the user");
    // Writing: the typing bubble.
    live.slice = { inFlightContent: "查好了，" };
    const writing = render({ isMainChat: true, isRunning: true, turns: woken });
    expect(count(writing, TYPING)).toBe(1);
    // A silent reply on its way says no words.
    live.slice = { inFlightContent: "<no-reply" };
    expect(
      render({ isMainChat: true, isRunning: true, turns: woken }),
    ).not.toContain(TYPING);
    live.slice = {};
    const silent: AgentTurn = {
      role: "agent",
      turnIndex: 2,
      finalAnswer: null,
      tools: [tool("no_tool")],
      silent: true,
    };
    // Before run_complete: the silent reply already settled the round.
    const settled = render({
      isMainChat: true,
      isRunning: true,
      turns: [...woken, silent],
    });
    expect(settled).not.toContain(TYPING);
    expect(settled).not.toContain("我让它再查一家。");
    expect(settled).not.toContain('data-role="step-marker"');
  });
});

// Rulings 134, 135 (tickets 90, 91): in a round you started, a line
// under the dots says what it is doing and for how long.
describe("the line under the dots, in a round you started", () => {
  const NOW = Date.UTC(2026, 9, 23, 4, 0, 0);

  beforeEach(() => {
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function user(content: string, id: string): UserTurn {
    return { role: "user", content, messageId: id };
  }

  /** A tool step that wrote only its `<summary>` (no narration). */
  function toolStep(summary: string, index: number): AgentTurn {
    return {
      role: "agent",
      turnIndex: index,
      finalAnswer: null,
      summary,
      tools: [tool("web_scan")],
      telemetry: { elapsedMs: 21_000 },
    };
  }

  /** Your message, nothing back yet. */
  const SENT: Turn[] = [user("新赛季 NBA 东部你怎么预测？", "u-2")];

  const STEPPED: Turn[] = [
    ...SENT,
    toolStep("已拿到东部各队休赛期动向；我查各队伤病与轮换。", 1),
  ];

  /** It asked, and you answered: the run's first segment banked 26s. */
  const ANSWERED: Turn[] = [
    ...STEPPED,
    {
      role: "agent",
      turnIndex: 2,
      finalAnswer: null,
      summary: "需要用户选东部还是西部；我问用户",
      tools: [tool("ask_user")],
      telemetry: { elapsedMs: 26_000 },
    },
    user("东部", "u-3"),
  ];

  /** A round Core woke it for, after a reply. */
  const REPORT: UserTurn = {
    role: "user",
    content: "[Galley — not a message from the user] …",
    messageId: "u-report",
    origin: { via: "system", supervisor: "galley-report", reason: "s-2" },
  };

  /** GA's verbose dispatch marker after a reply (the runner drops the
   * 5-backtick output fence that follows it: workbench_bridge
   * `_FenceFilter`). */
  const DISPATCH =
    '\n\n🛠️ Tool: `web_scan`  📥 args:\n````text\n{\n  "tabs_only": false\n}\n````\n';

  const DISPATCHED_STREAM = `<thinking>先看伤病。</thinking>\n<summary>伤病已查完；我对比各队近三季的胜场</summary>${DISPATCH}`;

  function mainView(props: Partial<ComponentProps<typeof MainView>>): string {
    return render({
      turns: SENT,
      activeSessionId: "s-main",
      isMainChat: true,
      isRunning: true,
      ...props,
    });
  }

  /** Every SVG as an empty one: the icons are not what this is about. */
  function withoutSvg(html: string): string {
    return html.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>");
  }

  /** The conversation area (the column, the corner clock's place, the
   * scroll button), up to the composer's stack. */
  function conversationArea(html: string): string {
    const start = html.indexOf("<div data-conversation-area");
    const end = html.indexOf('<div class="bg-app px-8 pb-6">', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return withoutSvg(html.slice(start, end));
  }

  /** The `<div` at `start` up to its own `</div>`. */
  function element(html: string, start: number): string {
    let depth = 0;
    const tag = /<div[\s>]|<\/div>/g;
    tag.lastIndex = start;
    for (let m = tag.exec(html); m; m = tag.exec(html)) {
      depth += m[0] === "</div>" ? -1 : 1;
      if (depth === 0) return html.slice(start, m.index + 6);
    }
    throw new Error("unclosed <div>");
  }

  /** The typing bubble's row (its `role="status"` root), or null. */
  function typingRow(html: string): string | null {
    const i = html.indexOf('<div data-role="assistant-typing"');
    return i < 0 ? null : element(html, i);
  }

  /** The line under the dots, or null. */
  function progressLine(html: string): string | null {
    const i = html.indexOf('<div data-role="assistant-progress"');
    return i < 0 ? null : element(html, i);
  }

  const textOf = (fragment: string | null) =>
    fragment === null ? null : fragment.replace(/<[^>]*>/g, "");

  it("hangs 「{在做什么} · {用时}」 in the dots' row, under the bubble, from the send on", () => {
    live.slice = { currentRunStartedAtMs: NOW - 75_000 };
    const row = typingRow(mainView({}))!;
    // The row is the typing bubble's, the line after the bubble inside it.
    expect(row).toMatch(
      /^<div data-role="assistant-typing" role="status"><span class="sr-only">Galley 正在输入<\/span><div data-role="assistant-typing-bubble"/,
    );
    const line = progressLine(row)!;
    expect(row.endsWith(`${line}</div>`)).toBe(true);
    expect(textOf(line)).toBe("思考中 · 1 分 15 秒");
    // 6px under the bubble, one 18px line, 12px ink-soft, tabular
    // numbers, no wider than a reply bubble.
    const box = line.slice(0, line.indexOf(">") + 1);
    for (const cls of [
      "mt-1.5",
      "flex",
      "h-[18px]",
      "text-[12px]",
      "leading-[18px]",
      "text-ink-soft",
      "tabular-nums",
      "max-w-[88%]",
    ]) {
      expect([cls, box.includes(cls)]).toEqual([cls, true]);
    }
    // The doing part sweeps, in a box that clips its roll (ruling 137),
    // and gives way (fade, whole on hover); the time does neither.
    expect(line).not.toMatch(/animate-|live-dot/);
    expect(count(line, "shimmer")).toBe(1);
    expect(line).toMatch(
      /<span data-role="assistant-progress-doing-box" class="grid min-w-0 overflow-hidden"><span data-role="assistant-progress-doing" class="truncate-fade progress-shimmer [^"]*">思考中<\/span><\/span>/,
    );
    expect(line).toContain(
      '<span aria-hidden="true" data-role="assistant-progress-elapsed" class="shrink-0 whitespace-pre"> · 1 分 15 秒</span>',
    );
  });

  it("says what it is doing: before a dispatch, between steps, at a dispatch, writing", () => {
    for (const [turns, inFlightContent, said] of [
      [SENT, "<thinking>先想想", "思考中"],
      [STEPPED, "", "我查各队伤病与轮换"],
      [
        STEPPED,
        "<summary>伤病已查完；我对比各队近三季的胜场</summary>",
        "我查各队伤病与轮换",
      ],
      [STEPPED, DISPATCHED_STREAM, "我对比各队近三季的胜场"],
      [STEPPED, "<summary>都查完了</summary>\n东部我看好", "正在写回复"],
      [ANSWERED, "", "思考中"],
    ] as const) {
      live.slice = { currentRunStartedAtMs: NOW - 75_000, inFlightContent };
      const doing = progressLine(mainView({ turns: [...turns] }))!;
      expect(textOf(doing)?.split(" · ")[0]).toBe(said);
    }
  });

  it("has no time under a second, nor before the run has a clock", () => {
    live.slice = { currentRunStartedAtMs: NOW - 400 };
    expect(textOf(progressLine(mainView({})))).toBe("思考中");
    expect(mainView({})).not.toContain("assistant-progress-elapsed");
    live.slice = { inFlightContent: "<thinking>" };
    expect(textOf(progressLine(mainView({})))).toBe("思考中");
  });

  it("counts the time as the workbench's corner clock: its words, the answered segments added up", () => {
    const hud = (startedAtMs: number, baseMs = 0) =>
      textOf(
        renderToStaticMarkup(
          <RunElapsedHud startedAtMs={startedAtMs} baseMs={baseMs} />,
        ),
      )!.replace("工作中", "");
    for (const [ago, said] of [
      [1_000, "1 秒"],
      [59_000, "59 秒"],
      [60_000, "1 分 0 秒"],
      [75_000, "1 分 15 秒"],
    ] as const) {
      live.slice = { currentRunStartedAtMs: NOW - ago };
      expect(textOf(progressLine(mainView({})))).toBe(`思考中 · ${said}`);
      expect(hud(NOW - ago)).toBe(said);
    }
    // Answered its question: 26s banked, 10s since your answer; the time
    // it waited on you is in neither.
    live.slice = { currentRunStartedAtMs: NOW - 10_000 };
    expect(textOf(progressLine(mainView({ turns: ANSWERED })))).toBe(
      "思考中 · 36 秒",
    );
    expect(hud(NOW - 10_000, 26_000)).toBe("36 秒");
  });

  it("reads out what it is doing, never the ticking time", () => {
    live.slice = { currentRunStartedAtMs: NOW - 75_000 };
    const row = typingRow(mainView({ turns: STEPPED }))!;
    // The row is the polite live region; inside it the time is hidden.
    expect(row).toMatch(/^<div[^>]*role="status"/);
    const elapsed = row.slice(
      row.lastIndexOf("<span", row.indexOf("assistant-progress-elapsed")),
    );
    expect(elapsed).toMatch(/^<span aria-hidden="true"/);
    expect(row).toMatch(/<span data-role="assistant-progress-doing"[^>]*>我查/);
    expect(row.match(/aria-hidden/g)).toHaveLength(2); // the dots, the time
  });

  it("draws no line in a round Core woke it for, nor while it asks", () => {
    live.slice = {
      currentRunStartedAtMs: NOW - 12_000,
      inFlightContent: "子任务查好了，",
    };
    const woken = conversationArea(
      mainView({ turns: [...SENT, answer("交给子任务去查了。", 1), REPORT] }),
    );
    expect(woken).toContain('data-role="assistant-typing"');
    expect(woken).not.toContain("assistant-progress");
    live.slice = { currentRunStartedAtMs: NOW - 12_000 };
    const asking = mainView({
      turns: ANSWERED.slice(0, -1),
      pendingAskUser: { question: "看东部还是西部？", candidates: ["东部"] },
    });
    expect(asking).not.toContain('data-role="assistant-typing"');
    expect(asking).not.toContain("assistant-progress");
  });

  it("leaves the workbench and a subtask without it", () => {
    live.slice = {
      currentRunStartedAtMs: NOW - 75_000,
      inFlightContent: DISPATCHED_STREAM,
    };
    const others = [
      mainView({ turns: STEPPED, isMainChat: false }),
      mainView({
        turns: STEPPED,
        isMainChat: false,
        activeSessionId: "s-sub",
      }),
    ].join("\n");
    expect(others).not.toContain("assistant-progress");
  });
});

describe("the composer: one line in every session, the card on the empty state", () => {
  const ONE_LINE = 'data-role="composer-one-line"';
  const CARD = "relative rounded-md border border-line bg-elevated px-3.5";
  // Under the one-line form the hint row starts at the input's text, 44px
  // in (ruling 74, item 3); under the card it is flush with the card.
  const HINT_ROW = '<div class="mt-1.5 text-[11px] text-ink-muted pl-[44px]">';
  const CARD_HINT_ROW = '<div class="mt-1.5 text-[11px] text-ink-muted">';
  const ANY_HINT_ROW = '<div class="mt-1.5 text-[11px] text-ink-muted';
  const QUEUE_HEADING = 'data-role="composer-queue-heading"';
  const STATES = [
    {},
    { isRunning: true },
    { pendingAskUser: { question: "订哪一班？", candidates: ["8:30"] } },
  ];

  afterEach(() => {
    dropComposerDraft("s-1");
  });

  /** The two the stopping sentence needs: the session, one queued message. */
  function queueOne() {
    useSessionsStore.setState({ activeSessionId: "s-1" });
    useQueueStore.setState({
      bySession: {
        "s-1": [
          {
            queueId: "q-1",
            text: "顺便看看周六的船票",
            queuedAt: "2026-10-15T08:00:00.000Z",
          },
        ],
      },
    });
  }

  function emptyState(props: Partial<ComponentProps<typeof EmptyState>> = {}) {
    return renderToStaticMarkup(
      <Tooltip.Provider>
        <EmptyState llmDisplayName="model" {...props} />
      </Tooltip.Provider>,
    );
  }

  it("is one line in every session (the main chat, a workbench session, a subtask, the external runtime), at rest, running and asking (ruling 74)", () => {
    for (const state of STATES) {
      // A subtask and the external runtime's sessions take the workbench
      // path (isMainChat false); the external runtime takes no images.
      for (const props of [
        { isMainChat: true },
        { isMainChat: false },
        { isMainChat: false, imagesEnabled: false },
      ]) {
        const html = render({ ...props, ...state });
        expect(html).toContain(ONE_LINE);
        expect(html).not.toContain(CARD);
      }
    }
  });

  it("keeps the card on the new-chat empty state, its hint row flush with the card", () => {
    const html = emptyState();
    expect(html).toContain(CARD);
    expect(html).not.toContain(ONE_LINE);
    expect(html).toContain('rows="2"');
    // The global empty state has no hint row; a project's says where the
    // conversation goes, in the card's row.
    expect(html).not.toContain(ANY_HINT_ROW);
    const project = emptyState({ projectName: "读书会" });
    expect(project).toContain(CARD);
    expect(project).toContain(CARD_HINT_ROW);
    expect(project).not.toContain("pl-[44px]");
    expect(project).toContain(zhCopy.composer.willCreateIn("读书会"));
  });

  it("has no hint row in the main chat; a workbench session's sits under the one line, at the input's text", () => {
    const main = render({ isMainChat: true });
    expect(main).not.toContain(ANY_HINT_ROW);
    expect(main).not.toContain(zhCopy.composer.dragToReferenceHint);
    for (const state of STATES) {
      const other = render({ isMainChat: false, ...state });
      const row = other.indexOf(HINT_ROW);
      expect(row).toBeGreaterThan(other.indexOf(ONE_LINE));
      expect(count(other, ANY_HINT_ROW)).toBe(1);
    }
    expect(render({ isMainChat: false })).toContain(
      `${HINT_ROW}${zhCopy.composer.dragToReferenceHint}`,
    );
  });

  it("sits 24px off the window's bottom edge in the main chat, 16 under the hint row elsewhere (ruling 72)", () => {
    expect(render({ isMainChat: true })).toContain(
      '<div class="bg-app px-8 pb-6">',
    );
    const other = render({ isMainChat: false });
    expect(other).toContain('<div class="bg-app px-8 pb-4">');
    expect(other).not.toContain("pb-6");
  });

  it("says 「发消息…」 in the main chat at rest and while it works (no /btw); the workbench keeps 「继续…」 and the /btw lesson; both 「回复上方提问」 while it asks", () => {
    const rest = render({ isMainChat: true });
    expect(rest).toContain(`placeholder="${zhCopy.composer.writeMessage}"`);
    const running = render({ isMainChat: true, isRunning: true });
    expect(running).toContain(`placeholder="${zhCopy.composer.writeMessage}"`);
    expect(running).not.toContain("/btw");
    const asking = {
      pendingAskUser: { question: "订哪一班？", candidates: [] },
    };
    expect(render({ isMainChat: true, ...asking })).toContain(
      `placeholder="${zhCopy.composer.replyOpen}"`,
    );
    expect(render({ isMainChat: false })).toContain(
      `placeholder="${zhCopy.composer.continueConversation}"`,
    );
    expect(render({ isMainChat: false, isRunning: true })).toContain(
      `placeholder="${zhCopy.composer.byTheWay}"`,
    );
    expect(render({ isMainChat: false, ...asking })).toContain(
      `placeholder="${zhCopy.composer.replyOpen}"`,
    );
  });

  it("says 「正在停止，排队的消息会自动发出」 once while a stop waits on queued messages: in the main chat's queue strip heading, in a workbench session's hint row", () => {
    queueOne();
    const stopping = render({
      isMainChat: true,
      isRunning: true,
      isStopping: true,
    });
    expect(count(stopping, zhCopy.composer.stoppingQueueHint)).toBe(1);
    const heading = stopping.indexOf(QUEUE_HEADING);
    expect(heading).toBeGreaterThan(-1);
    expect(stopping.slice(heading, heading + 200)).toContain(
      zhCopy.composer.stoppingQueueHint,
    );
    expect(heading).toBeLessThan(stopping.indexOf(ONE_LINE));
    expect(stopping).not.toContain(ANY_HINT_ROW);
    // Still working, not stopping: the count, as before.
    const running = render({ isMainChat: true, isRunning: true });
    expect(running).not.toContain(zhCopy.composer.stoppingQueueHint);
    expect(running).toContain(zhCopy.composer.queueStripLabel(1));
    // A workbench session's one line has the hint row, and the row says it.
    const other = render({
      isMainChat: false,
      isRunning: true,
      isStopping: true,
    });
    expect(count(other, zhCopy.composer.stoppingQueueHint)).toBe(1);
    expect(other).toContain(`${HINT_ROW}${zhCopy.composer.stoppingQueueHint}`);
    expect(other).not.toContain(QUEUE_HEADING);
    expect(other).toContain(zhCopy.composer.queueStripLabel(1));
  });

  it("queues a send while it works, as every session does (ruling 71: no 排队 / 开新对话 choice)", () => {
    // A typed draft (the Composer seeds from the parked one). Enter's
    // own path is in Composer.test.tsx; the main chat has no hint row
    // to teach it, every other conversation's says 「Enter 排队」.
    saveComposerDraft("s-1", { text: "顺便查下周五的天气", images: [] });
    const QUEUE_HINT = `<span class="font-mono text-ink-soft">Enter</span>${zhCopy.composer.queueEnterHint.slice("Enter".length)}`;
    const main = render({ isMainChat: true, isRunning: true });
    expect(main).toContain("顺便查下周五的天气");
    expect(main).not.toContain(QUEUE_HINT);
    expect(main).not.toContain("main-chat-busy-choice");
    expect(main).not.toContain("开新对话");
    const other = render({ isMainChat: false, isRunning: true });
    expect(other).toContain(`${HINT_ROW}${QUEUE_HINT}`);
  });
});

describe("the composer trial is gone", () => {
  const SRC = path.resolve(__dirname, "../..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
    });
  }

  it("leaves no switcher, demo, storage key or trial prop behind", () => {
    const self = path.resolve(__filename);
    const leftovers = [
      "galley.tmp.composerTrial",
      "composer-trial",
      "ComposerTrialSwitcher",
      "ComposerDemoInert",
      "useComposerTrialOverrides",
      "composerTrial",
      "ComposerTrialView",
      "demoQueue",
      "trial?.",
      "ticket 24",
      "票 24",
    ];
    const hits = sources(SRC)
      .filter((file) => file !== self && !file.includes("zz-harness"))
      .flatMap((file) => {
        const text = readFileSync(file, "utf8");
        return leftovers
          .filter((needle) => text.includes(needle))
          .map((needle) => `${path.relative(SRC, file)}: ${needle}`);
      });
    expect(hits).toEqual([]);
  });
});

describe("the bubble text switcher is gone (telegram-details 10)", () => {
  const SRC = path.resolve(__dirname, "../..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
    });
  }

  it("leaves no pill, store, storage key or marker behind", () => {
    const self = path.resolve(__filename);
    // Spelled in pieces, so a grep of the tree for them finds none (the
    // ticket's check), this file included.
    const leftovers = [
      ["td", "density"].join("-"),
      ["td", "Density"].join(""),
      ["Td", "Density"].join(""),
      ["bubble", "Density"].join(""),
      ["BUBBLE", "DENSITY"].join("_"),
      ["--bubble", "body-"].join("-"),
      ["TEMP variant", "switcher (telegram-details 10)"].join(" "),
    ];
    const hits = sources(SRC)
      .filter((file) => file !== self && !file.includes("zz-harness"))
      .flatMap((file) => {
        const text = readFileSync(file, "utf8");
        return leftovers
          .filter((needle) => text.includes(needle))
          .map((needle) => `${path.relative(SRC, file)}: ${needle}`);
      });
    expect(hits).toEqual([]);
  });
});
