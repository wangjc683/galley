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
  BrowserFacts,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

// The steps under a reply open on its process button, which a static
// render cannot press: with `expand.all` set, every ExpandSection renders
// as open (the button's own pressed state: MessageActions.test.tsx);
// with `expand.cards`, only the sections that sweep a margin with them —
// the process card — and not a step's detail inside it.
const expand = vi.hoisted(() => ({ all: false, cards: false }));
vi.mock("@/components/conversation/ExpandSection", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/conversation/ExpandSection")
    >();
  return {
    ExpandSection: (props: ComponentProps<typeof actual.ExpandSection>) => (
      <actual.ExpandSection
        {...props}
        open={
          props.open ||
          expand.all ||
          (expand.cards && props.openClassName !== undefined)
        }
      />
    ),
  };
});

afterEach(() => {
  expand.all = false;
  expand.cards = false;
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
    // Folded runs behind their headers, replies as prose, no IM row
    // gaps. Since the workbench's ticket 01 the two share the grammar:
    // the user's words on the right, the times as centred lines.
    expect(count(html, 'data-role="run-fold"')).toBeGreaterThan(0);
    expect(html).not.toContain('data-role="assistant-bubble"');
    expect(html).not.toContain('data-role="assistant-run-summary"');
    expect(buttons(html, zhCopy.conversation.foldExpand).length).toBe(0);
    expect(html).not.toContain("right-full");
    // Five user messages: four openers and the answer to the question,
    // out before its run's header (workbench ticket 02).
    expect(count(html, "ml-auto max-w-[min(80%,560px)]")).toBe(5);
    expect(count(html, 'class="group relative mt-5 mb-7.5 mr-[')).toBe(5);
    const pinned = [...userTimeMarks(conversation()).values()].filter(
      (m) => m.pinned,
    );
    expect(count(html, 'data-role="message-time-divider"')).toBe(pinned.length);
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
    expect(html).toContain("max-w-[88%]");
    expect(html).toContain("bg-assistant-tint");
    const first = html.indexOf('data-role="assistant-bubble"');
    expect(html.indexOf("你好。以后有什么事")).toBeGreaterThan(first);
    // No hover copy on the user's bubbles (ruling 73): each is a
    // selection-copy scope instead, and no copy chip rides beside it.
    expect(count(html, 'data-selection-copy-scope="user-message"')).toBe(5);
    expect(html).not.toContain("right-full ml-0 mr-1.5");
    expect(html).not.toContain("left-full bottom-[calc(10px");
  });

  it("keeps the hover copy and no selection scope on the workbench's user messages", () => {
    const html = render(conversation());
    // Under each bubble (workbench ticket 01), not beside it; the answer
    // to the question is out too (ticket 02).
    expect(count(html, "absolute top-full right-0 z-10 mt-1.5")).toBe(5);
    expect(html).not.toContain("left-full bottom-[calc(10px");
    expect(html).not.toContain('data-selection-copy-scope="user-message"');
    // The assistant's bubbles have neither the chip row nor the inset
    // the question rail asks for (it has no rail).
    const im = assistant(conversation());
    expect(im).not.toContain("absolute top-full right-0 z-10 mt-1.5");
    expect(im).not.toContain("100cqw");
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
    expect(html.slice(at - 80, at)).toContain("max-w-[88%]");
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

  it("heads the card with the round's numbers: steps, duration, ↑ ↓, no context", () => {
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
    // The card's first line, above its steps; no rail anywhere.
    for (const card of html.split('data-role="process-card"').slice(1)) {
      expect(card.indexOf('data-role="assistant-run-summary"')).toBeGreaterThan(
        -1,
      );
      expect(card.indexOf('data-role="assistant-run-summary"')).toBeLessThan(
        card.indexOf('data-role="process-steps"'),
      );
    }
    expect(html).not.toContain("absolute bottom-0 left-[5px] w-px bg-line");
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

  it("opens a card without the question's step, the answer's step, the question or the answer", () => {
    expand.all = true;
    const html = assistant(conversation());
    expect(count(html, 'data-role="process-card"')).toBe(2);
    const last = html.slice(html.lastIndexOf('data-role="process-card"'));
    const card = last.slice(0, last.indexOf("谢谢"));
    // Four steps (「4 步」), two rows: the question's step and the
    // answer's are out.
    expect(rowsOf(card)).toEqual([
      ["我先看看评分高的晚饭。", null],
      ["我挑几家闽南菜馆。", null],
    ]);
    expect(text(card)).not.toContain("问用户");
    expect(text(card)).not.toContain(zhCopy.conversation.stepDirectAnswer);
    expect(card).not.toContain('data-role="answered-ask-user"');
    expect(card).not.toContain("user-msg-reply");
    expect(card).not.toContain('data-role="step-marker"');
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
    expect(html).not.toContain('data-role="process-card"');
    // The workbench's step region: numerals, the rail, the tool pills.
    expect(html).toContain(">01</span>");
    expect(html).toContain("absolute bottom-0 left-[5px] w-px bg-line");
    expect(html).toContain(zhCopy.tools.web_scan);
  });
});

// ---- The process card (ruling 69) ----------------------------------------

const SHIPS: BrowserFacts = {
  kind: "scan",
  tabsOnly: false,
  activeTabId: "7",
  tabs: [
    { id: "7", url: "https://www.ctrip.com/ferry?day=sat", title: "携程船票" },
    { id: "8", url: "https://www.weather.com.cn/xiamen", title: "厦门天气" },
  ],
};

function did(
  narration: string,
  index: number,
  ...tools: ConversationToolEvent[]
): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: narration,
    summary: narration,
    tools,
  };
}

function browsed(facts?: BrowserFacts, name = "web_scan") {
  return { ...tool(name), ...(facts ? { browser: facts } : {}) };
}

/** A round of nine steps: two browser steps that resolve to a site and
 * one that does not, a file read, a script whose model wrote its own
 * summary, the question, a file write, a step that is only a sentence,
 * the answer. */
function round(): Turn[] {
  return [
    user("帮我订周六去鼓浪屿的船票", at(9)),
    did("我先打开携程看周六的船班。", 1, browsed(SHIPS)),
    did(
      "我点进 8:30 那一班看余票。",
      2,
      browsed({ kind: "script", tabId: "7", newTabs: [] }, "web_execute_js"),
    ),
    did(
      "我再确认一下那个页面。",
      3,
      browsed({ kind: "script", tabId: "42", newTabs: [] }, "web_execute_js"),
    ),
    did(
      "我读一下你的行程文件。",
      4,
      tool("file_read", { path: "~/Documents/行程/鼓浪屿.md" }),
    ),
    {
      ...did(
        "我算一下往返要多久。",
        5,
        tool("code_run", { script: "python3 plan.py" }),
      ),
      summary: "算往返时间",
    },
    ask("订哪一班？", ["8:30", "9:00"], 6),
    user("8:30", at(9, 2)),
    did("我把船票信息写进清单。", 7, {
      ...tool("file_write", { path: "./清单.md" }),
      resolvedPath: "/Users/me/Documents/清单.md",
    }),
    {
      role: "agent",
      turnIndex: 8,
      finalAnswer: null,
      summary: "想好怎么回你",
      tools: [tool("no_tool")],
    },
    answer("订好了 8:30 的船。", 9),
  ];
}

/** The card's rows as [sentence, what it touched]: each row's line, up
 * to its end (a step's detail follows it). */
function rowsOf(html: string): [string, string | null][] {
  return html
    .split('data-role="process-step"')
    .slice(1)
    .map((rest) => {
      const line = rest.slice(0, rest.indexOf("</div>"));
      const object = /data-role="process-object"[^>]*>([^<]*)/.exec(line);
      const sentence = /<span title="[^"]*" class="min-w-0[^"]*">([^<]*)/.exec(
        line,
      );
      return [sentence?.[1] ?? "", object ? object[1] : null];
    });
}

/** The card (first one) in a render. */
function cardOf(html: string): string {
  const at = html.indexOf('data-role="process-card"');
  return html.slice(at, html.indexOf('data-role="process-fade"', at));
}

describe("the assistant's conversation: the process card", () => {
  it("is closed at rest", () => {
    const html = assistant(round());
    expect(buttons(html, zhCopy.conversation.foldExpand).length).toBe(1);
    expect(html).not.toContain('data-role="process-card"');
  });

  it("writes one line a step: its sentence and the site or file it touched, no numerals, no tool names", () => {
    expand.cards = true;
    const card = cardOf(assistant(round()));
    expect(rowsOf(card)).toEqual([
      ["我先打开携程看周六的船班。", "ctrip.com"],
      ["我点进 8:30 那一班看余票。", "ctrip.com"],
      // A tab it cannot place: nothing, not a guess.
      ["我再确认一下那个页面。", null],
      ["我读一下你的行程文件。", "鼓浪屿.md"],
      // The model's own summary; code_run names nothing.
      ["算往返时间", null],
      ["我把船票信息写进清单。", "清单.md"],
      ["想好怎么回你", null],
    ]);
    const words = text(card);
    // No numerals, no tool names or their labels, no arguments.
    expect(card).not.toMatch(/>0\d</);
    expect(card).not.toContain('data-role="step-marker"');
    for (const name of [
      "web_scan",
      "web_execute_js",
      "file_read",
      "file_write",
      "code_run",
    ]) {
      expect(words).not.toContain(name);
      expect(words).not.toContain(
        (zhCopy.tools as Record<string, string>)[name],
      );
    }
    expect(words).not.toContain("python3 plan.py");
    expect(words).not.toContain("~/Documents");
    // No answer step, no question step, no caret, no rail.
    expect(words).not.toContain(zhCopy.conversation.stepDirectAnswer);
    expect(words).not.toContain("订好了 8:30 的船。");
    expect(words).not.toContain("订哪一班？");
    expect(card).not.toContain("<svg");
    expect(card).not.toContain("left-[5px]");
    // The sentence ink-soft and cut to its line with the whole of it on
    // hover; the object ink-muted and never pushed out.
    expect(card).toContain(
      '<span title="我先打开携程看周六的船班。" class="min-w-0 select-text truncate text-ink-soft',
    );
    expect(card).toContain(
      'class="ml-2 max-w-[40%] shrink-0 truncate text-ink-muted"',
    );
    // 24px rows at the step size.
    expect(count(card, "flex h-6 min-w-0 items-center rounded-sm px-2")).toBe(
      7,
    );
    expect(card).toContain("[font-size:var(--conversation-step-size)]");
  });

  it("writes the first of several things a step touched and 「+N」 for the rest", () => {
    expand.cards = true;
    const turns: Turn[] = [
      user("比一下", at(9)),
      did(
        "我把两个页面和两份笔记对一下。",
        1,
        browsed(SHIPS),
        tool("file_read", { path: "/a/笔记.md" }),
        tool("file_read", { path: "/b/笔记.md" }),
        tool("file_read", { path: "/c/船票.md" }),
      ),
      answer("对好了。", 2),
    ];
    const card = cardOf(assistant(turns));
    expect(rowsOf(card)).toEqual([
      ["我把两个页面和两份笔记对一下。", "ctrip.com +2"],
    ]);
    expect(card).toContain('title="ctrip.com · 笔记.md · 船票.md"');
  });

  it("makes a row with something to show a disclosure, and one without plain text", () => {
    expand.cards = true;
    const card = cardOf(assistant(round()));
    const lines = card
      .split('data-role="process-step"')
      .slice(1)
      .map((rest) => rest.slice(0, rest.indexOf(">") + 1));
    const [first] = card
      .split('data-role="process-step"')
      .slice(1)
      .map((rest) => rest.slice(rest.indexOf("<div"), rest.indexOf("<span")));
    expect(first).toContain('role="button"');
    expect(first).toContain('tabindex="0"');
    expect(first).toContain('aria-expanded="false"');
    expect(first).toContain("hover:bg-hover");
    expect(first).toContain("focus-visible:bg-hover");
    expect(lines).toHaveLength(7);
    // 「想好怎么回你」: only a sentence.
    const plain = card.slice(card.lastIndexOf('data-role="process-step"'));
    const head = plain.slice(plain.indexOf("<div"), plain.indexOf("<span"));
    expect(head).not.toContain("role=");
    expect(head).not.toContain("tabindex");
    expect(head).not.toContain("hover:bg-hover");
    expect(count(card, 'role="button"')).toBe(6);
  });

  it("opens a step in place, inside the card: its narration, its tools, its reasoning", () => {
    expand.all = true;
    const turns = round();
    (turns[5] as AgentTurn).thinking = "往返要算上排队。";
    const html = assistant(turns);
    const card = cardOf(html);
    const box = card.slice(card.indexOf('data-role="process-steps"'));
    // Six details (the plain row has none), inside the scroll box.
    expect(count(box, 'data-role="process-detail"')).toBe(6);
    const script = box.slice(
      box.indexOf("算往返时间"),
      box.indexOf("我把船票信息写进清单。"),
    );
    // The model wrote its own summary: the narration is the detail's.
    expect(script).toContain("我算一下往返要多久。");
    expect(script).toContain(zhCopy.tools.code_run);
    expect(script.indexOf(zhCopy.tools.code_run)).toBeLessThan(
      script.indexOf("往返要算上排队。"),
    );
    // An echo step: its narration is the row, not repeated under it.
    const read = box.slice(
      box.indexOf("我读一下你的行程文件。"),
      box.indexOf("算往返时间"),
    );
    expect(count(read, "我读一下你的行程文件。")).toBe(2); // title + text
    expect(read).toContain(zhCopy.tools.file_read);
  });

  it("is a card at the bubble's cap: hairline, its radius, no shadow, no status bar", () => {
    expand.cards = true;
    const html = assistant(round());
    const tag = html.slice(
      html.lastIndexOf("<div", html.indexOf('data-role="process-card"')),
    );
    const open = tag.slice(0, tag.indexOf(">") + 1);
    expect(open).toContain("rounded-md border border-line bg-app");
    expect(open).toContain("max-w-[88%]");
    expect(open).not.toContain("shadow");
    expect(cardOf(html)).not.toContain("w-[3px]");
    // 6px under the action row, 20px of its own under it.
    expect(html).toContain(
      'class="grid transition-[grid-template-rows,margin-top,opacity] duration-(--motion-slow) ease-firm motion-reduce:transition-none grid-rows-[1fr] opacity-100 mt-1.5"><div class="overflow-hidden"><div class="pb-5">',
    );
  });

  it("holds eight rows and scrolls the rest inside, the fade only while more is below", () => {
    expand.cards = true;
    const short = cardOf(assistant(round()));
    const steps = (n: number): Turn[] => [
      user("把这一周的船票都查一遍", at(9)),
      ...Array.from({ length: n }, (_, i) =>
        did(`我查第 ${i + 1} 天的船班。`, i + 1, browsed(SHIPS)),
      ),
      answer("都查完了。", n + 1),
    ];
    const eight = cardOf(assistant(steps(8)));
    const twelve = cardOf(assistant(steps(12)));
    expect(rowsOf(eight)).toHaveLength(8);
    expect(rowsOf(twelve)).toHaveLength(12);
    for (const card of [short, eight, twelve]) {
      // The cap: eight 24px rows and half of the ninth.
      expect(card).toContain("overflow-y-auto px-1 max-h-[204px]");
    }
    expect(short).toContain('data-overflow="false"');
    expect(eight).toContain('data-overflow="false"');
    expect(twelve).toContain('data-overflow="true"');
    const fade = (n: number) => {
      const html = assistant(steps(n));
      const at = html.indexOf('data-role="process-fade"');
      return html.slice(at, html.indexOf(">", at));
    };
    expect(fade(8)).toContain("opacity-0");
    expect(fade(12)).toContain("opacity-100");
    expect(fade(12)).toContain("h-3");
    // Nothing above at the first step.
    expect(twelve).toContain('data-role="process-fade-top"');
  });

  it("is the card the workbench's fold header opens, there without the numbers line or the cap", () => {
    // Workbench conversation PRD ruling 6; the workbench's side is
    // Conversation.steps.test.tsx.
    expand.all = true;
    const html = render(round());
    const card = cardOf(html);
    expect(html).toContain('data-role="run-fold"');
    expect(count(html, 'data-role="process-card"')).toBe(1);
    expect(rowsOf(card)).toEqual(rowsOf(cardOf(assistant(round()))));
    expect(card).not.toContain('data-role="assistant-run-summary"');
    expect(card).not.toContain("max-h-[204px]");
    expect(card).not.toContain("max-w-[88%]");
    expect(html).not.toContain('data-role="process-fade"');
  });
});

describe("the assistant's conversation: the time", () => {
  it("keeps the same breaks, each as a centred line of its own", () => {
    const turns = conversation();
    const pinned = [...userTimeMarks(turns).values()].filter((m) => m.pinned);
    const html = assistant(turns);
    expect(count(html, 'data-role="message-time-divider"')).toBe(pinned.length);
    // No time is left on a bubble.
    expect(count(html, "<time")).toBe(pinned.length);
    expect(html).toContain("flex justify-center");
  });

  it("puts a line above the greeting, and the first message within the hour adds none", () => {
    const withTime = [greeting(at(8, 40)), ...conversation().slice(1)];
    const html = assistant(withTime);
    const line = html.indexOf('data-role="message-time-divider"');
    expect(line).toBeLessThan(html.indexOf("你好。以后有什么事"));
    expect(text(html.slice(line, html.indexOf("你好。")))).toContain("08:40");
    // 09:00 is 20 minutes after the greeting: no second line before it.
    const between = html.slice(
      html.indexOf("你好。"),
      html.indexOf("早，天气怎么样？"),
    );
    expect(between).not.toContain('data-role="message-time-divider"');
    // Without the greeting's time the first message keeps its line.
    const without = assistant(conversation());
    expect(without.slice(0, without.indexOf("你好。"))).not.toContain(
      'data-role="message-time-divider"',
    );
    expect(
      without.slice(
        without.indexOf("你好。"),
        without.indexOf("早，天气怎么样？"),
      ),
    ).toContain('data-role="message-time-divider"');
  });

  it("draws no greeting line outside the assistant's conversation", () => {
    const html = render([greeting(at(8, 40)), ...conversation().slice(1)]);
    expect(html.slice(0, html.indexOf("你好。"))).not.toContain("<time");
  });
});

// ---- Subtask reports (ticket 31) -----------------------------------------

/** Core's row waking the main chat when a subtask's run ended (ticket
 * 29): never drawn. */
function reportRow(createdAt?: string): UserTurn {
  return {
    role: "user",
    content: "[Galley — not a message from the user] A subtask you started…",
    createdAt,
    messageId: `u-report-${createdAt}`,
    origin: { via: "system", supervisor: "galley-report", reason: "s-sub" },
  };
}

/** The reply that said nothing (`<no-reply/>`): it sent the subtask back. */
function silentReply(index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: null,
    tools: [tool("no_tool")],
    silent: true,
    messageId: `a-silent-${index}`,
  };
}

describe("the assistant's conversation: subtask reports", () => {
  const before: Turn[] = [
    user("帮我比三家报价", at(9)),
    answer("好，交给子任务去比。", 1),
  ];

  it("draws no bubble of yours for a report: its reply stands alone on the left", () => {
    const turns: Turn[] = [
      ...before,
      reportRow(at(9, 20)),
      answer("比好了：第二家最便宜。", 1),
    ];
    const html = assistant(turns);
    expect(html).not.toContain("A subtask you started");
    // The one user bubble is the user's own.
    expect(count(html, "ml-auto max-w-[min(80%,560px)]")).toBe(1);
    expect(count(html, 'data-role="assistant-bubble"')).toBe(2);
    expect(html).toContain("比好了：第二家最便宜。");
    // Twenty minutes on: no time line for it.
    expect(count(html, 'data-role="message-time-divider"')).toBe(1);
    // The workbench rendering would draw the row (it never gets one: the
    // main chat is always the assistant's).
    expect(render(turns)).toContain("A subtask you started");
  });

  it("dates the report's reply at a break, and the next message measures against it", () => {
    const turns: Turn[] = [
      ...before,
      reportRow(at(14)),
      answer("比好了：第二家最便宜。", 1),
      user("那就订第二家", at(14, 5)),
      answer("订好了。", 1),
    ];
    const html = assistant(turns);
    const reply = html.indexOf("比好了");
    const lines = [...html.matchAll(/data-role="message-time-divider"/g)].map(
      (m) => m.index,
    );
    // 09:00 above the user's first message, 14:00 above the reply — and
    // none above 14:05, five minutes after the report.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBeLessThan(reply);
    expect(text(html.slice(lines[1], reply))).toContain("14:00");
    // Right under the earlier reply, whose action row is the gap above.
    expect(html.slice(lines[1], reply)).toContain(
      'class="flex justify-center mb-4"',
    );
    expect(html.slice(reply, html.indexOf("那就订第二家"))).not.toContain(
      'data-role="message-time-divider"',
    );
  });

  it("draws nothing of a round that said nothing, and no time for it", () => {
    const turns: Turn[] = [
      ...before,
      reportRow(at(14)),
      step("我让它再查一家。", 1),
      silentReply(2),
      user("比得怎么样了", at(14, 30)),
    ];
    const html = assistant(turns);
    expect(html).not.toContain("我让它再查一家。");
    expect(html).not.toContain("A subtask you started");
    expect(count(html, 'data-role="assistant-bubble"')).toBe(1);
    expect(html).not.toContain('data-role="step-marker"');
    expect(buttons(html, zhCopy.conversation.foldExpand).length).toBe(0);
    // 14:30 measures against 09:00, not the silent report at 14:00.
    const lines = [...html.matchAll(/data-role="message-time-divider"/g)];
    expect(lines).toHaveLength(2);
    expect(text(html.slice(lines[1].index))).toContain("14:30");
  });

  it("keeps a silent round's question to you and your answer", () => {
    const turns: Turn[] = [
      ...before,
      reportRow(at(9, 30)),
      ask("要付定金吗？", ["付", "不付"], 1),
      user("付", at(9, 31)),
      step("我替你回了它。", 2),
      silentReply(3),
    ];
    const html = assistant(turns);
    expect(html).toContain("要付定金吗？");
    expect(count(html, "ml-auto max-w-[min(80%,560px)]")).toBe(2);
    expect(html).not.toContain("我替你回了它。");
  });

  it("draws a report round with no answer the workbench way, minus the report", () => {
    const turns: Turn[] = [
      ...before,
      reportRow(at(14)),
      step("我让它再查一家。", 1),
    ];
    const html = assistant(turns);
    expect(html).toContain("我让它再查一家。");
    expect(html).not.toContain("A subtask you started");
    // Its time sits above the region.
    const lines = [...html.matchAll(/data-role="message-time-divider"/g)];
    expect(lines).toHaveLength(2);
    expect(lines[1].index).toBeLessThan(html.indexOf("我让它再查一家。"));
  });

  it("keeps the report's time above a question still waiting for you", () => {
    const turns: Turn[] = [
      ...before,
      reportRow(at(14)),
      ask("要付定金吗？", ["付", "不付"], 1),
    ];
    const html = assistant(turns, { askUserPending: true });
    // The question itself is the live bubble at the tail (MainView).
    expect(html).not.toContain("要付定金吗？");
    const lines = [...html.matchAll(/data-role="message-time-divider"/g)];
    expect(lines).toHaveLength(2);
    expect(text(html.slice(lines[1].index))).toContain("14:00");
  });

  it("shows nothing of a report round while it runs: the line stands for it", () => {
    const turns: Turn[] = [
      ...before,
      reportRow(at(14)),
      step("我看看结果。", 1),
    ];
    const html = assistant(turns, { agentRunning: true });
    expect(html).not.toContain("我看看结果。");
    expect(html).not.toContain("A subtask you started");
  });
});
