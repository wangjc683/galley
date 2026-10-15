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

// The steps under a reply open on its process button, which a static
// render cannot press: with `expand.all` set, every ExpandSection renders
// as open (the button's own pressed state: MessageActions.test.tsx).
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
    // ↑33k ↓1.1k, the context 13% (13k of a 100k window).
    telemetry: {
      elapsedMs: 9_000,
      inputTokens: 33_000,
      outputTokens: 1_100,
      contextUsedChars: 39_000,
      contextLimitChars: 300_000,
    },
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

/** The `<button>` tags named `label` (the workbench's fold header is a
 * div with the same words). */
function buttons(html: string, label: string): string[] {
  return [...html.matchAll(/<button[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes(`aria-label="${label}"`));
}

const BAR = 'class="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1';
const HIDDEN =
  "pointer-events-none opacity-0 group-hover/answer:pointer-events-auto group-hover/answer:opacity-100";
const INPUT = `aria-label="${zhCopy.conversation.telemetryInputTip("33k")}"`;
const OUTPUT = `aria-label="${zhCopy.conversation.telemetryOutputTip("1.1k")}"`;
const CONTEXT = zhCopy.conversation.telemetryContextTip("13k", "100k", "13%");

const cards = (id: string): ReactNode =>
  id === "a-排好了。" ? <div data-role="subtask-cards">cards</div> : null;

describe("the assistant's conversation: only where asked", () => {
  it("leaves every other conversation in the workbench rendering", () => {
    const html = render(conversation());
    // Folded runs behind their headers, the user's words on the left,
    // replies as prose, the times above the bubbles.
    expect(count(html, 'data-role="run-fold"')).toBeGreaterThan(0);
    expect(html).not.toContain('data-role="assistant-bubble"');
    expect(html).not.toContain('data-role="assistant-run-summary"');
    expect(buttons(html, zhCopy.conversation.foldExpand).length).toBe(0);
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
  it("shows nothing under a reply at rest: its bar comes in on hover, icons only, no numbers", () => {
    const html = assistant(conversation());
    // Every reply's bar (the greeting's and four answers') holds its place,
    // hidden.
    const bars = html.split(BAR).slice(1);
    expect(bars.length).toBe(5);
    for (const bar of bars) expect(bar.startsWith(` ${HIDDEN}"`)).toBe(true);
    // No step count, no duration, no tokens, no context.
    expect(text(html)).not.toMatch(/\d+ 步/);
    expect(text(html)).not.toContain("用时");
    expect(html).not.toContain(INPUT);
    expect(html).not.toContain(OUTPUT);
    expect(html).not.toContain(CONTEXT);
    expect(html).not.toContain("13%");
    expect(html).not.toContain('class="h-3 w-px bg-line"');
    expect(html).not.toContain('data-role="assistant-run-steps"');
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toContain("我先查一下船票。");
    // The question and the answer are out in the conversation.
    expect(count(html, 'data-role="answered-ask-user"')).toBe(1);
    expect(count(html, 'data-role="user-msg-reply"')).toBe(1);
  });

  it("gives replies of two steps or more a process button after copy and save, and one-step replies none", () => {
    const html = assistant(conversation());
    const process = buttons(html, zhCopy.conversation.foldExpand);
    expect(process.length).toBe(2);
    // Each bar: copy and save (the user's bubbles have a copy of their
    // own, outside any bar).
    const bars = html
      .split(BAR)
      .slice(1)
      .map((rest) => rest.slice(0, rest.indexOf("</div></div>")));
    expect(bars.length).toBe(5);
    for (const bar of bars) {
      expect(buttons(bar, zhCopy.conversation.copy).length).toBe(1);
      expect(buttons(bar, zhCopy.conversation.save).length).toBe(1);
    }
    expect(
      bars.filter((bar) => bar.includes(zhCopy.conversation.foldExpand)),
    ).toHaveLength(2);
    for (const tag of process) {
      // The chips' family: pointer-first, closed, no number.
      expect(tag).toContain('tabindex="-1"');
      expect(tag).toContain('aria-expanded="false"');
      expect(tag).toContain("size-6 border border-transparent text-ink-muted");
      expect(tag).not.toMatch(/\d+ 步/);
    }
    // Last in its bar: copy, save, then it.
    for (const tag of process) {
      const at = html.indexOf(tag);
      const bar = html.slice(html.lastIndexOf(BAR, at), at);
      expect(
        bar.indexOf(`aria-label="${zhCopy.conversation.copy}"`),
      ).toBeLessThan(bar.indexOf(`aria-label="${zhCopy.conversation.save}"`));
      expect(bar).toContain(`aria-label="${zhCopy.conversation.save}"`);
      expect(
        html.slice(at + tag.length, html.indexOf("</div>", at)),
      ).not.toContain("<button");
    }
    // Under the one-step answers: copy and save only.
    for (const reply of ["多云，记得带伞。", "不客气。"]) {
      const at = html.indexOf(reply);
      const bar = html.slice(html.indexOf(BAR, at));
      const end = bar.indexOf("</div></div>");
      expect(bar.slice(0, end)).not.toContain(zhCopy.conversation.foldExpand);
    }
  });

  it("heads the opened steps with the round's numbers: steps, duration, ↑ ↓, no context", () => {
    expand.all = true;
    const html = assistant(conversation());
    const summaries = html
      .split('data-role="assistant-run-summary"')
      .slice(1)
      .map((rest) => rest.slice(0, rest.indexOf("</div>")));
    expect(summaries.length).toBe(2);
    // One segment with tokens: 「3 步 · 用时 9 秒 · ↑33k ↓1.1k」, the
    // figures one rung up, ↑ ↓ with the action bar's tips.
    const [three, four] = summaries;
    expect(text(`<x ${three}`)).toMatch(/^3 步 · 用时 9 秒 · 33k1.1k/);
    expect(three).toContain(INPUT);
    expect(three).toContain(OUTPUT);
    expect(three).toContain('<span class="text-ink-soft">3</span>');
    expect(three).toContain(
      '<span class="leading-none text-ink-soft">33k</span>',
    );
    expect(three).toContain(
      "text-ink-muted [font-size:var(--conversation-step-size)]",
    );
    // The question's segment has no tokens: the steps and duration alone.
    expect(text(`<x ${four}`)).toMatch(/^4 步 · 用时 14 秒$/);
    expect(four).not.toContain("aria-label=");
    // No context percentage, opened or not; not a control.
    expect(html).not.toContain(CONTEXT);
    expect(html).not.toContain("13%");
    for (const summary of summaries) {
      expect(summary).not.toContain('role="button"');
      expect(summary).not.toContain("hover:bg-hover");
      expect(summary).not.toContain(
        '<svg class="shrink-0 transition-transform',
      );
    }
    // It sits above the rail, which hangs from under it.
    const steps = html.indexOf('data-role="assistant-run-steps"');
    const region = html.slice(steps);
    expect(region.indexOf('data-role="assistant-run-summary"')).toBeLessThan(
      region.indexOf("absolute bottom-0 left-[5px] w-px bg-line -top-2.5"),
    );
  });

  it("keeps the workbench's reply bar: copy, save | ↑ ↓ and the context", () => {
    const html = render(conversation());
    expect(html).toContain(INPUT);
    expect(html).toContain(OUTPUT);
    expect(html).toContain(CONTEXT);
    expect(html).toContain('class="h-3 w-px bg-line"');
    expect(buttons(html, zhCopy.conversation.foldExpand).length).toBe(0);
    expect(html).not.toContain('data-role="assistant-run-summary"');
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
    expect(buttons(html, zhCopy.conversation.foldExpand).length).toBe(0);
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
