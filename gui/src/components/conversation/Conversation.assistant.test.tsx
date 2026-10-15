import * as Tooltip from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Conversation } from "./Conversation";
import { zhCopy } from "@/i18n/locales/zh";
import { LocalFilesContext } from "@/lib/local-files";
import { userTimeMarks } from "@/lib/message-time";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

// The steps under 「N 步 ›」 open on a click, which a static render cannot
// make: with `expand.all` set, every ExpandSection renders as open.
const expand = vi.hoisted(() => ({ all: false }));
vi.mock("@/components/conversation/ExpandSection", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/conversation/ExpandSection")
    >();
  return {
    ExpandSection: (props: ComponentProps<typeof actual.ExpandSection>) => (
      <actual.ExpandSection {...props} open={props.open || expand.all} />
    ),
  };
});

afterEach(() => {
  expand.all = false;
});

function tool(name: string, args: Record<string, unknown> = {}) {
  return {
    id: `t-${name}-${Math.random()}`,
    name,
    status: "success-historical",
    args,
  } as ConversationToolEvent;
}

function user(content: string, createdAt?: string): UserTurn {
  return { role: "user", content, createdAt, messageId: `u-${content}` };
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
    summary: "问用户",
    tools: [tool("ask_user", { question, candidates })],
    telemetry: { elapsedMs: 5_000 },
  };
}

// Local times on a fixed day; three hours apart, so each user message
// but the answer to the question sits at a break.
const at = (hour: number, minute = 0) =>
  new Date(2026, 9, 12, hour, minute).toISOString();

function greeting(createdAt?: string): AgentTurn {
  return {
    role: "agent",
    turnIndex: -1,
    finalAnswer: "你好。以后有什么事，直接在这里跟我说就行。",
    tools: [],
    greeting: true,
    messageId: "a-greeting",
    createdAt,
  };
}

/** The greeting (no time); a one-step answer; a three-step run; a run
 * where it asks and the user picks a candidate; another one-step
 * answer. */
function conversation(): Turn[] {
  return [
    greeting(),
    user("早，天气怎么样？", at(9)),
    answer("多云，记得带伞。", 1),
    user("帮我排个行程", at(12)),
    step("我先查一下船票。", 1),
    step("我看一下天气。", 2),
    answer("排好了。", 3),
    user("再加一顿晚饭", at(15)),
    step("我先看看评分高的晚饭。", 1),
    ask("晚饭想吃哪一类？", ["闽南菜", "海鲜", "西餐"], 2),
    user("闽南菜", at(15, 2)),
    step("我挑几家闽南菜馆。", 3),
    answer("那就订老别墅。", 4),
    user("谢谢", at(18)),
    answer("不客气。", 1),
  ];
}

function render(
  turns: Turn[],
  props: Partial<ComponentProps<typeof Conversation>> = {},
): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <Conversation turns={turns} {...props} />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

const assistant = (turns: Turn[], props = {}) =>
  render(turns, { assistant: true, ...props });

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** The markup's text, tags out. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

const cards = (id: string): ReactNode =>
  id === "a-排好了。" ? <div data-role="subtask-cards">cards</div> : null;

describe("the assistant's conversation: only where asked", () => {
  it("leaves every other conversation in the workbench rendering", () => {
    const html = render(conversation());
    // Folded runs behind their headers, the user's words on the left,
    // replies as prose, the times above the bubbles.
    expect(count(html, 'data-role="run-fold"')).toBeGreaterThan(0);
    expect(html).not.toContain('data-role="assistant-bubble"');
    expect(html).not.toContain('data-role="assistant-run-entry"');
    expect(html).not.toContain('data-role="assistant-time-divider"');
    expect(html).not.toContain("ml-auto");
    expect(html).not.toContain("right-full");
    expect(html).toContain('class="group relative my-5"');
    const pinned = [...userTimeMarks(conversation()).values()].filter(
      (m) => m.pinned,
    );
    expect(count(html, "<time")).toBe(pinned.length);
    // The same turns, as the assistant's.
    const im = assistant(conversation());
    expect(im).not.toContain('data-role="run-fold"');
    expect(im).toContain('data-role="assistant-bubble"');
  });
});

describe("the assistant's conversation: bubbles", () => {
  it("puts the user's words on the right and every reply, the question and the greeting in a left bubble", () => {
    const html = assistant(conversation());
    // Five user messages (four openers and the answer to the question),
    // all on the right, capped.
    expect(count(html, "ml-auto max-w-[min(80%,560px)]")).toBe(5);
    // The greeting, four answers and the answered question.
    expect(count(html, 'data-role="assistant-bubble"')).toBe(6);
    expect(html).toContain("max-w-[min(88%,680px)]");
    expect(html).toContain("bg-assistant-tint");
    const first = html.indexOf('data-role="assistant-bubble"');
    expect(html.indexOf("你好。以后有什么事")).toBeGreaterThan(first);
    // The hover copy moves to the bubble's left.
    expect(html).toContain("left-auto right-full ml-0 mr-1.5");
  });

  it("groups one side's messages 4px apart and restores the gap across sides", () => {
    const turns: Turn[] = [
      user("这张小票帮我记一下账", at(8)),
      user("还有打车 46", at(8, 1)),
      user("午饭 32", at(8, 1)),
      answer("记好了。", 1),
      user("谢谢", at(8, 3)),
    ];
    const rows = [
      ...assistant(turns).matchAll(/class="group relative ([^"]*)"/g),
    ].map((m) => m[1]);
    // Three in a row (the first under its centred time); after the
    // reply, its action row is the gap.
    expect(rows).toEqual(["mt-5", "mt-1", "mt-1", "mt-0"]);
  });

  it("draws an answered question as a bubble with its candidates listed under it", () => {
    const html = assistant(conversation());
    const echo = html.indexOf('data-role="answered-ask-user"');
    expect(echo).toBeGreaterThan(-1);
    const after = html.slice(echo);
    expect(after.indexOf('data-role="assistant-bubble"')).toBeLessThan(
      after.indexOf("晚饭想吃哪一类？"),
    );
    expect(after).toContain('data-picked="true"');
    expect(html).not.toContain(zhCopy.conversation.askedYou);
  });

  it("holds the subtask cards right under the reply bubble, at its width, before the action row", () => {
    const html = assistant(conversation(), { renderAfterAnswer: cards });
    const at = html.indexOf('data-role="subtask-cards"');
    expect(at).toBeGreaterThan(html.indexOf("排好了。"));
    // Inside the reply's group, before its action row.
    const group = html.lastIndexOf('class="group/answer', at);
    expect(group).toBeGreaterThan(-1);
    expect(html.slice(group, at)).toContain("排好了。");
    expect(html.slice(group, at)).not.toContain(zhCopy.conversation.copy);
    expect(html.slice(at - 80, at)).toContain("max-w-[min(88%,680px)]");
    // The workbench hangs them after the whole reply, action row and all.
    const today = render(conversation(), { renderAfterAnswer: cards });
    expect(
      today.slice(
        today.indexOf("排好了。"),
        today.indexOf('data-role="subtask-cards"'),
      ),
    ).toContain(zhCopy.conversation.copy);
  });
});

describe("the assistant's conversation: the process", () => {
  it("leaves a quiet 「N 步」 entry under replies of two steps or more, and nothing under one-step ones", () => {
    const html = assistant(conversation());
    expect(count(html, 'data-role="assistant-run-entry"')).toBe(2);
    expect(text(html)).toContain("3 步 · 用时 9 秒");
    expect(text(html)).toContain("4 步 · 用时 14 秒");
    expect(text(html)).not.toContain("1 步");
    // Closed: named as the fold header's toggle, the steps not drawn.
    const entry = html.indexOf('data-role="assistant-run-entry"');
    const tag = html.slice(
      html.lastIndexOf("<", entry),
      html.indexOf(">", entry) + 1,
    );
    expect(tag).toContain('role="button"');
    expect(tag).toContain('aria-expanded="false"');
    expect(tag).toContain(`aria-label="${zhCopy.conversation.foldExpand}"`);
    expect(html).not.toContain('data-role="assistant-run-steps"');
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toContain("我先查一下船票。");
    // The question and the answer are out in the conversation.
    expect(count(html, 'data-role="answered-ask-user"')).toBe(1);
    expect(count(html, 'data-role="user-msg-reply"')).toBe(1);
  });

  it("opens the steps in place without repeating the question or the answer", () => {
    expand.all = true;
    const html = assistant(conversation());
    expect(count(html, 'data-role="assistant-run-steps"')).toBe(2);
    const last = html.slice(
      html.lastIndexOf('data-role="assistant-run-steps"'),
    );
    const steps = last.slice(0, last.indexOf("谢谢"));
    expect(steps).toContain("我先看看评分高的晚饭。");
    expect(steps).toContain("我挑几家闽南菜馆。");
    // The four markers (the question's step and the answer's included)…
    expect(count(steps, 'data-role="step-marker"')).toBe(4);
    // …but not the question's echo nor the user's answer.
    expect(steps).not.toContain('data-role="answered-ask-user"');
    expect(steps).not.toContain("user-msg-reply");
    expect(count(html, 'data-role="answered-ask-user"')).toBe(1);
  });

  it("unfolds a run without an answer in full, the workbench way", () => {
    // Stopped after it asked and the user answered: not running, no
    // answer.
    const turns: Turn[] = [
      user("订船票", at(9)),
      step("我先看船班。", 1),
      ask("订哪一班？", ["8:30", "9:00"], 2),
      user("8:30", at(9, 1)),
      step("我去下单。", 3),
    ];
    const html = assistant(turns);
    expect(count(html, 'data-role="step-marker"')).toBe(3);
    expect(html).toContain("我去下单。");
    expect(html).not.toContain('data-role="assistant-run-entry"');
  });
});

describe("the assistant's conversation: the time", () => {
  it("keeps the same breaks, each as a centred line of its own", () => {
    const turns = conversation();
    const pinned = [...userTimeMarks(turns).values()].filter((m) => m.pinned);
    const html = assistant(turns);
    expect(count(html, 'data-role="assistant-time-divider"')).toBe(
      pinned.length,
    );
    // No time is left on a bubble.
    expect(count(html, "<time")).toBe(pinned.length);
    expect(html).toContain("flex justify-center");
  });

  it("puts a line above the greeting, and the first message within the hour adds none", () => {
    const withTime = [greeting(at(8, 40)), ...conversation().slice(1)];
    const html = assistant(withTime);
    const line = html.indexOf('data-role="assistant-time-divider"');
    expect(line).toBeLessThan(html.indexOf("你好。以后有什么事"));
    expect(text(html.slice(line, html.indexOf("你好。")))).toContain("08:40");
    // 09:00 is 20 minutes after the greeting: no second line before it.
    const between = html.slice(
      html.indexOf("你好。"),
      html.indexOf("早，天气怎么样？"),
    );
    expect(between).not.toContain('data-role="assistant-time-divider"');
    // Without the greeting's time the first message keeps its line.
    const without = assistant(conversation());
    expect(without.slice(0, without.indexOf("你好。"))).not.toContain(
      'data-role="assistant-time-divider"',
    );
    expect(
      without.slice(
        without.indexOf("你好。"),
        without.indexOf("早，天气怎么样？"),
      ),
    ).toContain('data-role="assistant-time-divider"');
  });

  it("draws no greeting line outside the assistant's conversation", () => {
    const html = render([greeting(at(8, 40)), ...conversation().slice(1)]);
    expect(html.slice(0, html.indexOf("你好。"))).not.toContain("<time");
  });
});
