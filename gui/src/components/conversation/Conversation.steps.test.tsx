import * as Tooltip from "@radix-ui/react-tooltip";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Conversation } from "./Conversation";
import { zhCopy } from "@/i18n/locales/zh";
import { LocalFilesContext } from "@/lib/local-files";
import type {
  AgentTurn,
  BrowserFacts,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

// The workbench's run fold opens the steps one line a step (workbench
// conversation PRD ruling 6, ticket 02). A static render cannot press
// the fold header or a row: with `expand.all` every ExpandSection
// renders open (the header's card, a row's detail), as if pressed.
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

const SHIPS: BrowserFacts = {
  kind: "scan",
  tabsOnly: false,
  activeTabId: "7",
  tabs: [
    { id: "7", url: "https://www.ctrip.com/ferry?day=sat", title: "携程船票" },
  ],
};

let ids = 0;
function tool(
  name: string,
  args: Record<string, unknown> = {},
  extra: Partial<ConversationToolEvent> = {},
): ConversationToolEvent {
  ids += 1;
  return {
    id: `t-${ids}`,
    name,
    status: "success-historical",
    args,
    ...extra,
  };
}

function user(content: string): UserTurn {
  return { role: "user", content, messageId: `u-${content}` };
}

/** A step whose sentence is its narration (GA's summary echoes it). */
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
    tools:
      tools.length > 0 ? tools : [tool("web_scan", {}, { browser: SHIPS })],
  };
}

function answer(text: string, index: number, elapsedMs = 9_000): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: text,
    summary: text,
    tools: [tool("no_tool")],
    telemetry: { elapsedMs, inputTokens: 33_000, outputTokens: 1_100 },
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
    telemetry: { elapsedMs: 30_000 },
  };
}

/** One request and a settled run of `n` steps (n - 1 and the answer). */
function run(n: number): Turn[] {
  return [
    user("把这一周的船票都查一遍"),
    ...Array.from({ length: n - 1 }, (_, i) =>
      did(`我查第 ${i + 1} 天的船班。`, i + 1),
    ),
    answer("都查完了。", n),
  ];
}

/** A settled run of five steps where the model wrote its own summary on
 * one, reasoned on another and read a file on a third. */
function rich(): Turn[] {
  return [
    user("帮我排一下周六的行程"),
    did("我先打开携程看周六的船班。", 1),
    {
      ...did(
        "我算一下往返要多久。",
        2,
        tool("code_run", { script: "python3 plan.py" }),
      ),
      summary: "算往返时间",
      thinking: "往返要算上排队。",
    },
    did(
      "我读一下你的行程文件。",
      3,
      tool("file_read", { path: "/a/鼓浪屿.md" }),
    ),
    {
      role: "agent",
      turnIndex: 4,
      finalAnswer: null,
      summary: "核对一遍，没有冲突",
      tools: [tool("no_tool")],
    },
    answer("排好了。", 5),
  ];
}

/** Asked twice mid-run, each answered; seven steps in all. */
function asked(): Turn[] {
  return [
    user("帮我订周六的船票"),
    did("我先看船班。", 1),
    ask("订哪一班？", ["8:30", "9:00"], 2),
    user("8:30"),
    did("我去下单。", 3),
    did("我核对订单。", 4),
    ask("回程要一起订吗？", [], 5),
    user("要，订 17:40 那一班"),
    did("我把船票写进清单。", 6, tool("file_write", { path: "./清单.md" })),
    answer("订好了。", 7),
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

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** The markup's text, tags out. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** The card behind the (first) fold header, up to the end of its rows. */
function cardOf(html: string): string {
  const at = html.indexOf('data-role="process-card"');
  expect(at).toBeGreaterThan(-1);
  const answerAt = html.indexOf('data-message-id="a-', at);
  return html.slice(at, answerAt === -1 ? undefined : answerAt);
}

/** Each row's sentence. */
function rowsOf(card: string): string[] {
  return card
    .split('data-role="process-step"')
    .slice(1)
    .map(
      (rest) =>
        /<span title="[^"]*" class="min-w-0[^"]*">([^<]*)/.exec(rest)?.[1] ??
        "",
    );
}

/** The opening tag of the element carrying `attr`. */
function tagOf(html: string, attr: string): string {
  const at = html.indexOf(attr);
  expect(at).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

describe("the workbench's fold header: one line a step", () => {
  it("opens the steps as the assistant's card does: a line a step, no numerals, tool names, rail or caret", () => {
    expand.all = true;
    const html = render(rich());
    const card = cardOf(html);
    expect(rowsOf(card)).toEqual([
      "我先打开携程看周六的船班。",
      "算往返时间",
      "我读一下你的行程文件。",
      "核对一遍，没有冲突",
    ]);
    // What each touched, lighter, after it.
    expect(card).toContain('data-role="process-object" title="ctrip.com"');
    expect(card).toContain('data-role="process-object" title="鼓浪屿.md"');
    // Nothing of the step region behind the header any more.
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toMatch(/>0\d<\/span>/);
    expect(html).not.toContain("absolute bottom-0 left-[5px] w-px bg-line");
    // No closing step: the answer is right under the card.
    expect(text(card)).not.toContain(zhCopy.conversation.stepDirectAnswer);
    expect(count(text(html), "排好了。")).toBe(1);
  });

  it("draws the card in the assistant's frame, across the column, without the numbers line", () => {
    expand.all = true;
    const html = render(rich());
    const open = tagOf(html, 'data-role="process-card"');
    expect(open).toContain(
      "overflow-hidden rounded-md border border-line bg-app pt-1",
    );
    expect(open).not.toContain("max-w-");
    expect(open).not.toContain("shadow");
    expect(html).not.toContain('data-role="assistant-run-summary"');
    // The header right above still says the numbers.
    const header = html.slice(
      html.indexOf('data-role="run-fold"'),
      html.indexOf('data-role="process-card"'),
    );
    expect(text(header)).toContain(zhCopy.conversation.foldSteps(5));
    expect(text(header)).toContain(zhCopy.conversation.foldDurationSeconds(9));
  });

  it("puts every step on the page: no cap, no scroll inside, no fade", () => {
    expand.all = true;
    const card = cardOf(render(run(20)));
    expect(rowsOf(card)).toHaveLength(19);
    expect(rowsOf(card)[18]).toBe("我查第 19 天的船班。");
    expect(card).not.toContain("max-h-");
    expect(card).not.toContain("overflow-y-auto");
    expect(card).not.toContain('data-role="process-fade');
    expect(tagOf(card, 'data-role="process-steps"')).toContain(
      'class="px-1 pb-1"',
    );
  });

  it("opens a row in place: its narration, its tools, then its reasoning", () => {
    expand.all = true;
    const card = cardOf(render(rich()));
    const script = card.slice(
      card.indexOf("算往返时间"),
      card.indexOf("我读一下你的行程文件。"),
    );
    // The model wrote its own summary: the narration is the detail's.
    expect(script).toContain('data-role="process-detail"');
    expect(script).toContain("我算一下往返要多久。");
    expect(script).toContain(zhCopy.tools.code_run);
    expect(script.indexOf(zhCopy.tools.code_run)).toBeLessThan(
      script.indexOf("往返要算上排队。"),
    );
    // Three rows have something to show; the last is only a sentence.
    expect(count(card, 'data-role="process-detail"')).toBe(3);
  });

  it("makes a row with something to show a keyboard disclosure, and one without plain text", () => {
    const html = render(rich(), {});
    expect(html).not.toContain('data-role="process-card"');
    expand.all = true;
    const card = cardOf(render(rich()));
    const heads = card
      .split('data-role="process-step"')
      .slice(1)
      .map((rest) => rest.slice(rest.indexOf("<div"), rest.indexOf("<span")));
    expect(heads).toHaveLength(4);
    for (const head of heads.slice(0, 3)) {
      expect(head).toContain('role="button"');
      expect(head).toContain('tabindex="0"');
      expect(head).toContain('aria-expanded="false"');
      expect(head).toContain("focus-visible:bg-hover");
    }
    expect(heads[3]).not.toContain("role=");
    expect(heads[3]).not.toContain("tabindex");
  });

  it("is closed at rest: the header hugs the answer, and no rule is drawn open or closed", () => {
    const closed = render(rich());
    expect(closed).toContain('data-role="run-fold"');
    expect(closed).not.toContain('data-role="process-card"');
    expect(closed).not.toContain("<hr");
    const between = closed.slice(
      closed.indexOf('data-role="run-fold"'),
      closed.indexOf('data-message-id="a-'),
    );
    expect(text(between)).not.toContain("我先打开携程");
    expand.all = true;
    const open = render(rich());
    expect(open).not.toContain("<hr");
    // The card sweeps with its own 16px under it, to the answer.
    expect(open).toContain('<div class="pb-4"><div data-role="process-card"');
  });

  it("opens the live header's steps as the same card, and keeps the window as it was", () => {
    expand.all = true;
    const turns: Turn[] = [
      user("把这一周的船票都查一遍"),
      did("我查第 1 天的船班。", 1),
      did("我查第 2 天的船班。", 2),
      did("我查第 3 天的船班。", 3),
    ];
    const html = render(turns, { agentRunning: true });
    expect(html.indexOf('data-role="run-fold"')).toBeLessThan(
      html.indexOf('data-role="process-card"'),
    );
    expect(text(html)).toContain(zhCopy.conversation.foldStepsLive(3));
    expect(rowsOf(cardOf(html))).toEqual([
      "我查第 1 天的船班。",
      "我查第 2 天的船班。",
    ]);
    // The window: the latest step in the step region's reading form.
    const window = html.slice(html.indexOf('data-role="step-marker"'));
    expect(window).toContain("我查第 3 天的船班。");
    expect(window).toContain(">03</span>");
    expect(window).toContain(zhCopy.tools.web_scan);
    expect(count(html, 'data-role="step-marker"')).toBe(1);
  });

  it("unfolds a run without an answer in full, the step region as before", () => {
    expand.all = true;
    const turns: Turn[] = [
      user("订船票"),
      did("我先看船班。", 1),
      ask("订哪一班？", ["8:30", "9:00"], 2),
      user("8:30"),
      did("我去下单。", 3),
    ];
    const html = render(turns);
    expect(html).not.toContain('data-role="run-fold"');
    expect(html).not.toContain('data-role="process-card"');
    expect(count(html, 'data-role="step-marker"')).toBe(3);
    expect(html).toContain(">01</span>");
    expect(html).toContain("absolute bottom-0 left-[5px] w-px bg-line");
    // Its question and the answer stay in the region, after its step.
    const region = html.slice(html.indexOf("absolute bottom-0 left-[5px]"));
    expect(region).toContain('data-role="answered-ask-user"');
    expect(region.indexOf("问用户")).toBeLessThan(region.indexOf("订哪一班？"));
  });
});

describe("the workbench's questions mid-run: out before the header", () => {
  it("draws each question and the user's answer in order before the header, the header hugging the answer", () => {
    for (const open of [false, true]) {
      expand.all = open;
      const html = render(asked());
      const at = (needle: string) => {
        const i = html.indexOf(needle);
        expect(i).toBeGreaterThan(-1);
        return i;
      };
      const order = [
        at('data-message-id="u-帮我订周六的船票"'),
        at("订哪一班？"),
        at('data-message-id="u-8:30"'),
        at("回程要一起订吗？"),
        at('data-message-id="u-要，订 17:40 那一班"'),
        at('data-role="run-fold"'),
        at('data-message-id="a-订好了。"'),
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(count(html, 'data-role="answered-ask-user"')).toBe(2);
      // Answers stay replies (the question rail indexes openers only).
      expect(count(html, 'data-role="user-msg-reply"')).toBe(2);
      expect(count(html, 'data-role="user-msg"')).toBe(1);
      // The picked candidate is checked, as in the step region.
      expect(count(html, "data-picked")).toBe(1);
      expect(html).toMatch(
        /data-picked="true"[^>]*>.*?<span class="select-text">8:30</,
      );
      if (open) {
        const card = cardOf(html);
        // The steps that only asked are no rows; the answers are not in it.
        expect(rowsOf(card)).toEqual([
          "我先看船班。",
          "我去下单。",
          "我核对订单。",
          "我把船票写进清单。",
        ]);
        expect(card).not.toContain("订哪一班？");
        expect(card).not.toContain("user-msg");
        expect(text(card)).not.toContain("问用户");
      }
    }
  });

  it("keeps the run's numbers: the steps and the time count the questions", () => {
    const html = render(asked());
    const header = text(
      html.slice(
        html.indexOf('data-role="run-fold"'),
        html.indexOf('data-message-id="a-'),
      ),
    );
    // Seven steps (both questions' included), 30 + 30 + 9 seconds of
    // work over three GA loops, two questions.
    expect(header).toContain(zhCopy.conversation.foldSteps(7));
    expect(header).toContain(zhCopy.conversation.foldDurationMinutes(1, 9));
    expect(header).toContain(zhCopy.conversation.foldAskUser(2));
  });

  it("keeps a step that asked and ran a tool as a row, its question out", () => {
    expand.all = true;
    const turns: Turn[] = [
      user("帮我订船票"),
      {
        ...did("我先看船班，顺便问你。", 1),
        tools: [
          tool("web_scan", {}, { browser: SHIPS }),
          tool("ask_user", { question: "订哪一班？", candidates: [] }),
        ],
      },
      user("8:30"),
      answer("订好了。", 2),
    ];
    const html = render(turns);
    const card = cardOf(html);
    expect(rowsOf(card)).toEqual(["我先看船班，顺便问你。"]);
    expect(card).not.toContain("订哪一班？");
    expect(html.indexOf("订哪一班？")).toBeLessThan(
      html.indexOf('data-role="run-fold"'),
    );
  });

  it("leaves a question and its answer in the live window while they are its tail", () => {
    const turns: Turn[] = [
      user("订船票"),
      did("我先看船班。", 1),
      did("我再看余票。", 2),
      ask("订哪一班？", ["8:30", "9:00"], 3),
      user("8:30"),
    ];
    const html = render(turns, { agentRunning: true });
    const header = html.indexOf('data-role="run-fold"');
    expect(header).toBeGreaterThan(-1);
    expect(html.indexOf("订哪一班？")).toBeGreaterThan(header);
    expect(html.indexOf('data-message-id="u-8:30"')).toBeGreaterThan(header);
  });
});
