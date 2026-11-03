import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { TodoItem } from "@/lib/assistant-todo";
import type { MemoEventItem } from "@/lib/memo";
import type { ScheduledTask } from "@/lib/scheduled-tasks";
import type { SubtaskDispatch } from "@/lib/subtasks";
import { CopyProvider } from "@/lib/i18n";
import { makeSession } from "@/test/factories";

/**
 * A reply's frame of cards as MainView draws it (main chat PRD rulings
 * 181, 182, ticket 133): one frame, one 24px line an item. Each card's
 * own words and states are pinned in its own test; here what they share.
 * Static rendering reads a zustand store's initial state, so the stores
 * the lines read are plain objects: one subtask running, one failed, the
 * to-do and the reminder listed in the panel, the memo still kept.
 */

const state = vi.hoisted(() => ({
  sessions: [] as unknown[],
}));

function fakeStore<T>(get: () => T) {
  return Object.assign(<R,>(select: (s: T) => R) => select(get()), {
    getState: get,
  });
}

vi.mock("@/stores/sessions", () => ({
  useSessionsStore: fakeStore(() => ({ sessions: state.sessions })),
}));
vi.mock("@/stores/messages", () => ({
  useMessagesStore: fakeStore(() => ({
    byId: {
      "s-run": {
        agentRunning: true,
        pendingAskUser: null,
        turns: [],
        restoring: false,
      },
      "s-err": {
        agentRunning: false,
        pendingAskUser: null,
        turns: [{ role: "user", content: "x" }],
        restoring: false,
      },
    },
    restoreSessionTurns: () => Promise.resolve(),
  })),
}));
vi.mock("@/stores/runtime", () => ({
  useRuntimeStore: fakeStore(() => ({ byId: {} })),
}));
vi.mock("@/stores/subtasks", () => ({
  useSubtasksStore: fakeStore(() => ({
    runErrors: { "s-err": "网页打不开" },
    askInCard: {},
  })),
}));
vi.mock("@/stores/assistant-todo", () => ({
  useAssistantTodoStore: fakeStore(() => ({
    todo: null,
    flips: {},
    failures: {},
    deleting: {},
  })),
}));
vi.mock("@/lib/todo-panel", async (orig) => ({
  ...(await orig<typeof import("@/lib/todo-panel")>()),
  todoListed: () => true,
  reminderListed: () => true,
}));
vi.mock("@/lib/memo", async (orig) => ({
  ...(await orig<typeof import("@/lib/memo")>()),
  memoCardState: () => "listed",
}));

import { FileCards } from "./FileCards";
import { MemoCards } from "./MemoCards";
import { ReminderCards } from "./ReminderCards";
import { ReplyCards } from "./ReplyCards";
import { SubtaskCards } from "./SubtaskCards";
import { TodoCards } from "./TodoCards";

function dispatch(ordinal: number, sessionId: string): SubtaskDispatch {
  return {
    parentSessionId: "s-main",
    turnIndex: 4,
    ordinal,
    messageId: "msg_s-main_4_assistant",
    sessionId,
    title: ordinal === 0 ? "整理一页会议纪要" : "比较三款扫地机器人的价格",
    failure: null,
    failureDetail: null,
    createdAt: "2026-11-03T08:00:00.000Z",
  };
}

const TODO = {
  kind: "todo",
  id: "todo_water",
  text: "给3号楼的绿萝浇水",
  state: "open",
  createdBy: "assistant",
  createdIn: { sessionId: "s-main", turnIndex: 4 },
  due: { date: "2099-11-05", hasTime: false },
} as TodoItem;

const REMINDER = {
  id: "sched_coat",
  prompt: "提醒去取干洗的外套",
  repeat: { kind: "once" },
  timeOfDay: "18:00",
  enabled: true,
  fireAt: "2099-11-04T10:00:00.000Z",
  target: "assistant",
  createdIn: { sessionId: "s-main", turnIndex: 4 },
  createdAt: "2026-11-03T08:00:00Z",
  updatedAt: "2026-11-03T08:00:00Z",
} as ScheduledTask;

const MEMO = {
  id: 1,
  memoId: "memo_run",
  action: "add",
  text: "周末喜欢去公园跑步",
  sessionId: "s-main",
  memoExists: true,
  createdAt: "2026-11-03T08:00:00Z",
} as MemoEventItem;

function render(): string {
  state.sessions = [
    makeSession({ id: "s-run", title: "整理一页会议纪要" }),
    makeSession({ id: "s-err", title: "比较三款扫地机器人的价格" }),
  ];
  return renderToStaticMarkup(
    <CopyProvider language="zh-CN">
      <Tooltip.Provider>
        <ReplyCards>
          <FileCards paths={["/Users/demo/Downloads/周末出行计划.pdf"]} />
          <SubtaskCards
            dispatches={[dispatch(0, "s-run"), dispatch(1, "s-err")]}
          />
          <TodoCards items={[TODO]} />
          <ReminderCards tasks={[REMINDER]} />
          <MemoCards events={[MEMO]} />
        </ReplyCards>
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
/** The opening tag of the first element carrying `needle`. */
const tagOf = (html: string, needle: string) => {
  const at = html.indexOf(needle);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};

describe("a reply's frame of cards", () => {
  const html = render();

  it("is one frame: the process card's, as wide as its widest line, 12px off the bubble", () => {
    expect(count(html, 'data-role="reply-cards"')).toBe(1);
    expect(html.startsWith('<div data-role="reply-cards"')).toBe(true);
    expect(tagOf(html, 'data-role="reply-cards"')).toContain(
      'class="mt-3 w-fit max-w-full rounded-md border border-line bg-app p-1 has-[[data-role=ask-user-bubble]]:w-auto"',
    );
    // In the panel's order: files, subtasks, to-dos, reminders, memos.
    const order = [
      "file-cards",
      "subtask-cards",
      "todo-cards",
      "reminder-cards",
      "memo-cards",
    ].map((role) => html.indexOf(`data-role="${role}"`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // No frame, ground or gap of their own.
    expect(html.match(/border-line[ "]/g)).toHaveLength(1);
    expect(html).not.toContain("gap-2 mt-");
    expect(html).not.toContain("min-h-10");
  });

  it("draws every item as one 24px line at the step size", () => {
    const line =
      'class="flex h-6 min-w-0 items-center rounded-sm px-2 [font-size:var(--conversation-step-size)]';
    // A file, two subtasks, a to-do, a reminder, a memo.
    expect(count(html, line)).toBe(6);
  });

  // Ticket 132b: a title button reaches over its line by padding a
  // negative margin takes back; no positioned pseudo-element (WebKit
  // leaves the CJK / Latin autospace out of such a box's max-content).
  it("opens from anywhere on a line by the title's reach, with no ::after or ::before", () => {
    const reach =
      "-ml-[30px] -mr-[100vw] min-w-0 pl-[30px] pr-[100vw] text-left outline-none";
    // Two subtasks, the to-do, the reminder, the memo.
    expect(count(html, reach)).toBe(5);
    expect(count(html, "group/line overflow-hidden hover:bg-hover")).toBe(5);
    expect(html).not.toMatch(/(after|before):/);
    expect(html).not.toContain("hover:underline");
    expect(html).not.toContain(
      "focus-visible:ring-2 focus-visible:ring-brand/30",
    );
  });

  it("lets the light things through, and keeps the box, 取消 and a word with a reason", () => {
    // The to-do's day, the reminder's time and state.
    expect(tagOf(html, 'data-role="todo-meta"')).toContain(
      "pointer-events-none",
    );
    const reminder = html.slice(html.indexOf('data-role="reminder-card"'));
    expect(
      reminder.match(/<span class="pointer-events-none ml-2 shrink-0[^"]*"/g),
    ).toHaveLength(2);
    expect(tagOf(html, ">待提醒<")).toContain("pointer-events-none");
    // 「出错」 has its reason on hover: its own pointer.
    const word = tagOf(html, 'data-role="subtask-card-word"');
    expect(word).toContain('title="出错：网页打不开"');
    expect(word).not.toContain("pointer-events-none");
    // 「取消」 comes after the title and keeps its click.
    expect(tagOf(html, ">取消<")).not.toContain("pointer-events-none");
    // The box comes before the title: lifted over its reach.
    expect(html).toContain("[&amp;&gt;label]:relative [&amp;&gt;label]:z-10");
  });

  // Ticket 132b: a percentage cap is not known while the frame sizes
  // itself to its content; a long folder set its width.
  it("caps the folder and the to-do's day at 16em, never a share", () => {
    expect(count(html, "max-w-[16em]")).toBe(2);
    expect(html).not.toMatch(/max-w-\[\d+%\]/);
  });

  // lib/todo-flight-run.ts finds where a new card takes off by it.
  it("keeps data-card-icon on the to-do, the reminder and the memo", () => {
    expect(count(html, "data-card-icon")).toBe(3);
  });
});
