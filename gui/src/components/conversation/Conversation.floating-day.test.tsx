// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Conversation } from "./Conversation";
import { LocalFilesContext } from "@/lib/local-files";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

/*
 * The rows carry their moment for the main chat's floating day (ruling
 * 171, ticket 124): each row that draws a message has it as `data-at`
 * (ms) — your message its send time, a reply, a question it asked, the
 * greeting and the line of a run without an answer when that step
 * landed. A time line, a process card and the like have none (the
 * floating day takes the row below). The workbench's rows carry none.
 */

// The process card mounts on its button's first press, which a static
// render cannot make: with `open.cards` set, the sections that sweep a
// margin with them (the card) render open.
const open = vi.hoisted(() => ({ cards: false }));
vi.mock("@/components/conversation/ExpandSection", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/conversation/ExpandSection")
    >();
  return {
    ExpandSection: (props: ComponentProps<typeof actual.ExpandSection>) => (
      <actual.ExpandSection
        {...props}
        open={props.open || (open.cards && props.openClassName !== undefined)}
      />
    ),
  };
});

afterEach(() => {
  open.cards = false;
});

function tool(name: string, args: Record<string, unknown> = {}) {
  return {
    id: `t-${name}-${Math.random()}`,
    name,
    status: "success-historical",
    args,
  } as ConversationToolEvent;
}

const iso = (m: number, d: number, h: number, min = 0) =>
  new Date(2026, m, d, h, min).toISOString();
const ms = (stamp: string) => Date.parse(stamp);

function user(content: string, createdAt: string): UserTurn {
  return { role: "user", content, createdAt, messageId: `u-${content}` };
}

function step(narration: string, index: number, settledAt: string): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: narration,
    summary: narration,
    tools: [tool("web_scan")],
    settledAt,
  };
}

function answer(text: string, index: number, settledAt: string): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: text,
    tools: [tool("no_tool")],
    messageId: `a-${text}`,
    settledAt,
  };
}

function ask(
  question: string,
  candidates: string[],
  index: number,
  settledAt: string,
): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: null,
    summary: "问用户",
    tools: [tool("ask_user", { question, candidates })],
    messageId: `a-ask-${index}`,
    settledAt,
  };
}

const GREETED = iso(9, 28, 9);
const T = {
  first: iso(9, 28, 9, 30),
  firstReply: iso(9, 28, 9, 31),
  plan: iso(10, 1, 21),
  planStep: iso(10, 1, 21, 1),
  asked: iso(10, 1, 21, 2),
  picked: iso(10, 1, 21, 3),
  pickedStep: iso(10, 1, 21, 4),
  planned: iso(10, 1, 21, 5),
  late: iso(10, 1, 23, 58),
  // Its reply came after midnight: the row is the day it was said.
  lateReply: iso(10, 2, 0, 3),
  stop: iso(10, 2, 9, 10),
  stopSteps: [iso(10, 2, 9, 11), iso(10, 2, 9, 12)],
};

/** The greeting, a reply, a run that asks, a reply past midnight, a run
 * stopped without an answer. */
function conversation(): Turn[] {
  return [
    {
      role: "agent",
      turnIndex: -1,
      finalAnswer: "你好。以后有什么事，直接在这里跟我说就行。",
      tools: [],
      greeting: true,
      messageId: "a-greeting",
      createdAt: GREETED,
      settledAt: GREETED,
    },
    user("早，天气怎么样？", T.first),
    answer("多云，记得带伞。", 1, T.firstReply),
    user("帮我排个行程", T.plan),
    step("我先查一下船票。", 1, T.planStep),
    ask("晚饭想吃哪一类？", ["闽南菜", "海鲜"], 2, T.asked),
    user("闽南菜", T.picked),
    step("我挑几家闽南菜馆。", 3, T.pickedStep),
    answer("那就订老别墅。", 4, T.planned),
    user("还醒着吗", T.late),
    answer("醒着。", 1, T.lateReply),
    user("看看网络", T.stop),
    step("我先看一下进程。", 1, T.stopSteps[0]),
    step("再看日志。", 2, T.stopSteps[1]),
  ];
}

function rows(turns: Turn[], assistant: boolean): Element[] {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <Conversation turns={turns} assistant={assistant} />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
  return [...host.querySelector('[data-role="conversation"]')!.children];
}

/** What a row draws, by the marks inside it. */
function kind(row: Element): string {
  const has = (role: string) =>
    row.getAttribute("data-role") === role ||
    row.querySelector(`[data-role="${role}"]`) !== null;
  if (has("message-time-divider")) return "time";
  if (has("user-msg") || has("user-msg-reply")) return "user";
  if (has("answered-ask-user")) return "question";
  if (has("assistant-stopped")) return "stopped";
  if (has("assistant-bubble")) return "reply";
  return "other";
}

describe("the rows' moments (the main chat's floating day)", () => {
  it("puts each message's moment on its row, and none on a time line or a process card", () => {
    const n = (stamp: string) => String(ms(stamp));
    const drawn = (turns: Turn[]) =>
      rows(turns, true).map((row) => [kind(row), row.getAttribute("data-at")]);
    const planned = [
      ["time", null],
      ["reply", n(GREETED)],
      ["user", n(T.first)],
      ["reply", n(T.firstReply)],
      ["time", null],
      ["user", n(T.plan)],
      ["question", n(T.asked)],
      ["user", n(T.picked)],
      ["reply", n(T.planned)],
    ];
    // The steps under the process button, once it opened them.
    open.cards = true;
    expect(drawn(conversation()).slice(0, planned.length + 1)).toEqual([
      ...planned,
      ["other", null],
    ]);
    open.cards = false;
    expect(drawn(conversation())).toEqual([
      ...planned,
      ["time", null],
      ["user", n(T.late)],
      ["reply", n(T.lateReply)],
      ["time", null],
      ["user", n(T.stop)],
      ["stopped", n(T.stopSteps[1])],
    ]);
  });

  it("puts it on the row itself, the element the floating day reads", () => {
    for (const row of rows(conversation(), true)) {
      if (kind(row) === "time" || kind(row) === "other") {
        expect(row.querySelector("[data-at]")).toBe(null);
      } else {
        expect(row.hasAttribute("data-at")).toBe(true);
      }
    }
  });

  it("leaves the workbench's rows as they were", () => {
    const workbench = rows(conversation(), false);
    expect(workbench.length).toBeGreaterThan(0);
    for (const row of workbench) {
      expect(row.hasAttribute("data-at")).toBe(false);
      expect(row.querySelector("[data-at]")).toBe(null);
    }
  });
});
