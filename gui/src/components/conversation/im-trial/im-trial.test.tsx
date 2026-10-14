// TEMPORARY — the IM rendering trial's tests (ticket 19; see im-trial.ts).
// Remove with the trial; the winner's cases move into the components'
// own tests.
import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Conversation } from "@/components/conversation/Conversation";
import { MainView } from "@/components/screens/MainView";
import { zhCopy } from "@/i18n/locales/zh";
import { CopyProvider } from "@/lib/i18n";
import { LocalFilesContext } from "@/lib/local-files";
import { userTimeMarks } from "@/lib/message-time";
import { buildRunGroups, liveRunGroup } from "@/lib/run-groups";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

import {
  IM_ALL_CURRENT,
  IM_ALL_RECOMMENDED,
  type ImConversationOptions,
  type ImRendering,
  imFirstLine,
  imFollowBottom,
  imFollowTop,
  imLineClock,
  imLinePlan,
  imLineSentence,
  imRenderingFor,
  imRowGap,
  imScrollToBottom,
} from "./im-trial";
import { buildImDemo, imDemoLanded, IM_DEMO_STEP_MS } from "./im-trial-demo";
import { ImLiveLine, ImRunEntry } from "./ImTrialParts";

// ---- Fixtures ------------------------------------------------------------

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

function answer(text: string, index: number, id = text): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: text,
    tools: [tool("no_tool")],
    telemetry: { elapsedMs: 9_000 },
    messageId: `a-${id}`,
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

const GREETING: AgentTurn = {
  role: "agent",
  turnIndex: -1,
  finalAnswer: "你好。以后有什么事，直接在这里跟我说就行。",
  tools: [],
  greeting: true,
  messageId: "a-greeting",
};

// Local times on a fixed day; three hours apart, so each user message
// but the reply sits at a break (first / more than an hour later).
const at = (hour: number, minute = 0) =>
  new Date(2026, 9, 12, hour, minute).toISOString();

/** The greeting; a one-step answer; a three-step run; a run where it
 * asks and the user picks a candidate; another one-step answer. */
function conversation(): Turn[] {
  return [
    GREETING,
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

function wrap(node: ReactNode, language?: "zh-CN" | "en-US"): string {
  const tree = (
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        {node}
      </LocalFilesContext.Provider>
    </Tooltip.Provider>
  );
  return renderToStaticMarkup(
    language ? <CopyProvider language={language}>{tree}</CopyProvider> : tree,
  );
}

function conv(
  turns: Turn[],
  im?: ImConversationOptions,
  extra: Partial<Parameters<typeof Conversation>[0]> = {},
): string {
  return wrap(<Conversation turns={turns} im={im} {...extra} />);
}

function main(
  props: Partial<Parameters<typeof MainView>[0]> & { turns: Turn[] },
  language?: "zh-CN" | "en-US",
): string {
  return wrap(
    <MainView llmDisplayName="model" activeSessionId="s-1" {...props} />,
    language,
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** The markup's text, tags out. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

const rendering = (settings: Partial<ImRendering> = {}): ImRendering => ({
  ...IM_ALL_CURRENT,
  demo: "off",
  ...settings,
});

const LINE: ImConversationOptions = {
  bubble: "current",
  process: "line",
  time: "current",
};

// ---- Scope ----------------------------------------------------------------

describe("IM rendering trial — scope", () => {
  it("reaches MainView only for the main chat, and not when everything is current", () => {
    const recommended = { ...IM_ALL_RECOMMENDED, demo: "off" as const };
    expect(
      imRenderingFor(recommended, { mainChatOpen: false }),
    ).toBeUndefined();
    expect(
      imRenderingFor(
        { ...IM_ALL_CURRENT, demo: "off" },
        { mainChatOpen: true },
      ),
    ).toBeUndefined();
    expect(imRenderingFor(recommended, { mainChatOpen: true })).toEqual(
      recommended,
    );
    // The demo alone is a choice too.
    expect(
      imRenderingFor(
        { ...IM_ALL_CURRENT, demo: "still" },
        { mainChatOpen: true },
      ),
    ).toEqual({ ...IM_ALL_CURRENT, demo: "still" });
  });

  it("leaves an ordinary conversation (a subtask, the external runtime) exactly as today in every choice", () => {
    const turns = conversation();
    const today = main({ turns, isMainChat: false });
    for (const im of [
      rendering(IM_ALL_RECOMMENDED),
      rendering({ bubble: "b" }),
      rendering({ bubble: "c", demo: "still" }),
      rendering({ process: "line", demo: "running" }),
      rendering({ time: "centered", scroll: "bottom", demo: "asking" }),
    ]) {
      expect(main({ turns, isMainChat: false, im })).toBe(today);
    }
  });

  it("renders the main chat as today when every piece is current", () => {
    const turns = conversation();
    expect(
      conv(turns, { bubble: "current", process: "current", time: "current" }),
    ).toBe(conv(turns));
    expect(main({ turns, isMainChat: true, im: rendering() })).toBe(
      main({ turns, isMainChat: true }),
    );
  });
});

// ---- Bubbles -------------------------------------------------------------

describe("IM rendering trial — bubbles", () => {
  it("B moves only the user's bubble to the right, capped; replies stay prose", () => {
    const html = conv(conversation(), {
      ...LINE,
      process: "current",
      bubble: "b",
    });
    // Four openers in view (the answer to the question is in its fold).
    expect(count(html, 'data-role="user-msg"')).toBe(4);
    expect(count(html, "ml-auto")).toBe(4);
    expect(html).toContain("max-w-[min(80%,560px)]");
    expect(html).not.toContain('data-role="im-agent-bubble"');
    expect(html).toContain("多云，记得带伞。");
  });

  it("C puts every reply and the greeting in a left bubble", () => {
    const html = conv(conversation(), {
      ...LINE,
      process: "current",
      bubble: "c",
    });
    // Greeting + four answers.
    expect(count(html, 'data-role="im-agent-bubble"')).toBe(5);
    const bubble = html.indexOf('data-role="im-agent-bubble"');
    expect(html.indexOf("你好。以后有什么事")).toBeGreaterThan(bubble);
    expect(html).toContain("max-w-[min(88%,680px)]");
  });

  it("moves the hover copy to the bubble's left in B and C only", () => {
    const today = conv(conversation());
    expect(today).not.toContain("right-full");
    for (const bubble of ["b", "c"] as const) {
      expect(
        conv(conversation(), { ...LINE, process: "current", bubble }),
      ).toContain("left-auto right-full ml-0 mr-1.5");
    }
  });

  it("groups messages on one side 4px apart and restores the gap across sides", () => {
    const turns: Turn[] = [
      user("这张小票帮我记一下账", at(8)),
      user("还有打车 46", at(8, 1)),
      user("午饭 32", at(8, 1)),
      answer("记好了。", 1),
      user("谢谢", at(8, 3)),
    ];
    const html = conv(turns, { ...LINE, process: "current", bubble: "c" });
    const rows = [...html.matchAll(/class="group relative ([^"]*)"/g)].map(
      (m) => m[1],
    );
    // Three in a row; after the reply, its action row is the gap.
    expect(rows).toEqual(["mt-5", "mt-1", "mt-1", "mt-0"]);
    expect(conv(turns)).not.toContain('class="group relative mt-1"');
    expect(imRowGap("user", "user")).toBe("mt-1");
    expect(imRowGap("user", "agent")).toBe("mt-5");
    expect(imRowGap("agent-bar", "user")).toBe("mt-0");
  });

  it("C keeps the subtask cards right under the reply bubble, at its width", () => {
    const html = conv(
      conversation(),
      { ...LINE, process: "current", bubble: "c" },
      {
        renderAfterAnswer: (id) =>
          id === "a-排好了。" ? (
            <div data-role="subtask-cards">cards</div>
          ) : null,
      },
    );
    const cards = html.indexOf('data-role="subtask-cards"');
    const reply = html.indexOf("排好了。");
    expect(cards).toBeGreaterThan(reply);
    // Inside the reply's group, before its action row.
    const group = html.lastIndexOf('class="group/answer', cards);
    expect(group).toBeGreaterThan(-1);
    expect(html.slice(group, cards)).toContain("排好了。");
    expect(html.slice(cards - 80, cards)).toContain("max-w-[min(88%,680px)]");
    // Today the cards follow the whole reply, action row included.
    const today = conv(conversation(), undefined, {
      renderAfterAnswer: (id) =>
        id === "a-排好了。" ? <div data-role="subtask-cards">cards</div> : null,
    });
    expect(
      today.slice(
        today.indexOf("排好了。"),
        today.indexOf('data-role="subtask-cards"'),
      ),
    ).toContain("复制");
  });

  it("C asks as a plain left bubble with the candidates under it", () => {
    const turns: Turn[] = [
      user("顺便订船票", at(9)),
      ask("订哪一班？", ["8:30", "9:00", "9:30"], 1),
    ];
    const pendingAskUser = {
      question: "订哪一班？",
      candidates: ["8:30", "9:00", "9:30"],
    };
    const today = main({ turns, isMainChat: true, pendingAskUser });
    expect(today).toContain(zhCopy.conversation.waitingForYou);
    const html = main({
      turns,
      isMainChat: true,
      pendingAskUser,
      im: rendering({ bubble: "c" }),
    });
    expect(html).not.toContain(zhCopy.conversation.waitingForYou);
    expect(html).not.toContain("border-warning bg-warning");
    const bubble = html.indexOf('data-role="ask-user-bubble"');
    const question = html.indexOf("订哪一班？", bubble);
    const firstChip = html.indexOf("8:30", question);
    expect(question).toBeGreaterThan(bubble);
    expect(firstChip).toBeGreaterThan(question);
    expect(html.slice(bubble, question)).toContain("bg-hover");
  });

  it("C draws an answered question as a bubble, the candidates listed under it", () => {
    const html = conv(conversation(), { ...LINE, bubble: "c" });
    const echo = html.indexOf('data-role="answered-ask-user"');
    expect(echo).toBeGreaterThan(-1);
    expect(html.slice(echo, echo + 600)).toContain("bg-hover");
    expect(html).not.toContain(zhCopy.conversation.askedYou);
    expect(html.slice(echo)).toContain('data-picked="true"');
  });
});

// ---- Process: one line ----------------------------------------------------

describe("IM rendering trial — the one-line process", () => {
  it("takes the first line of what streams, else this stretch's latest narration", () => {
    const run: Turn[] = [user("查一下天气"), step("我先查一下明天的天气。", 1)];
    expect(imLineSentence(run, "")).toBe("我先查一下明天的天气。");
    expect(imLineSentence(run, "## 明天多云\n\n22 到 27 度")).toBe("明天多云");
    expect(imLineSentence(run, "\n\n- **东北风** 3 级")).toBe("东北风 3 级");
    expect(imLineSentence([user("查一下天气")], "")).toBeNull();
    // An answer starts a new stretch: the narration before the question
    // is not the latest thing it wrote any more.
    const answered: Turn[] = [
      user("订船票"),
      step("我先看船班。", 1),
      ask("订哪一班？", ["8:30"], 2),
      user("8:30"),
    ];
    expect(imLineSentence(answered, "")).toBeNull();
    expect(imFirstLine("  > 1. `code_run` 跑完了")).toBe("code_run 跑完了");
  });

  it("shows the round's clock only past 3 seconds, in the corner clock's words", () => {
    expect(imLineClock(2_999, zhCopy)).toBeNull();
    expect(imLineClock(3_000, zhCopy)).toBe("3 秒");
    expect(imLineClock(81_400, zhCopy)).toBe("1 分 21 秒");
  });

  it("plans the settled runs: questions and answers outside, steps under the entry", () => {
    const turns = conversation();
    const groups = buildRunGroups(turns);
    const plan = imLinePlan(groups, turns, null);
    // Two runs of two steps or more get an entry; the one-step ones none.
    expect([...plan.steps.keys()]).toEqual([6, 12]);
    // The question and the answer stay messages, in order…
    expect(plan.question).toEqual(new Set([9]));
    expect(plan.message.has(9)).toBe(true);
    expect(plan.message.has(10)).toBe(true);
    // …and the step list holds the question's step but not the answer.
    expect(plan.steps.get(12)?.members).toEqual([8, 9, 11, 12]);
    expect(plan.steps.get(12)?.stats.stepCount).toBe(4);
    // The steps themselves are not messages.
    expect(plan.message.has(4)).toBe(false);
    expect(plan.message.has(8)).toBe(false);
  });

  it("plans a live run as its opener and its asked-and-answered pairs", () => {
    const turns: Turn[] = [
      user("订船票", at(9)),
      step("我先看船班。", 1),
      ask("订哪一班？", ["8:30"], 2),
      user("8:30", at(9, 1)),
      step("我去下单。", 3),
    ];
    const groups = buildRunGroups(turns);
    const live = liveRunGroup(groups, true, false);
    const plan = imLinePlan(groups, turns, live);
    expect([...plan.message].sort()).toEqual([0, 2, 3]);
    expect(plan.steps.size).toBe(0);
    // Without an answer and not running: drawn as today, in full.
    const aborted = imLinePlan(groups, turns, null);
    expect([...aborted.flat.keys()]).toEqual([1, 2, 3, 4]);
  });

  it("draws a quiet 「N 步」 entry under replies of two steps or more, and nothing under one-step ones", () => {
    const html = conv(conversation(), LINE);
    expect(count(html, 'data-role="im-run-entry"')).toBe(2);
    expect(text(html)).toContain("3 步 · 用时 9 秒");
    expect(text(html)).toContain("4 步 · 用时 14 秒");
    // No fold header, and the steps stay closed.
    expect(html).not.toContain('data-role="run-fold"');
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toContain("我先查一下船票。");
    // The question and the answer are out in the conversation.
    expect(count(html, 'data-role="answered-ask-user"')).toBe(1);
    expect(count(html, 'data-role="user-msg-reply"')).toBe(1);
  });

  it("opens the steps in place without repeating the question or the answer", () => {
    const html = conv(conversation(), { ...LINE, stepsOpen: true });
    expect(count(html, 'data-role="im-run-steps"')).toBe(2);
    const steps = html.slice(html.lastIndexOf('data-role="im-run-steps"'));
    expect(steps).toContain("我先看看评分高的晚饭。");
    expect(steps).toContain("我挑几家闽南菜馆。");
    // The four markers (the question's step and the answer's included)…
    expect(
      count(steps.slice(0, steps.indexOf("谢谢")), 'data-role="step-marker"'),
    ).toBe(4);
    // …but not the question's echo nor the user's answer.
    expect(steps.slice(0, steps.indexOf("谢谢"))).not.toContain(
      'data-role="answered-ask-user"',
    );
    expect(steps.slice(0, steps.indexOf("谢谢"))).not.toContain(
      "user-msg-reply",
    );
    // The entry says it is open.
    expect(html).toContain('aria-expanded="true"');
  });

  it("while it runs, shows only one line: the latest sentence, no steps, no streaming prose", () => {
    const turns: Turn[] = [
      ...conversation(),
      user("顺便看看船票", at(20)),
      step("我先查一下周六的船班。", 1),
    ];
    const html = main({
      turns,
      isMainChat: true,
      isRunning: true,
      im: rendering({ process: "line" }),
    });
    const line = html.indexOf('data-role="im-live-line"');
    expect(line).toBeGreaterThan(-1);
    expect(html.slice(line, line + 400)).toContain("我先查一下周六的船班。");
    expect(count(html, 'data-role="im-live-line"')).toBe(1);
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toContain("streaming-prose");
    const today = main({ turns, isMainChat: true, isRunning: true });
    expect(today).toContain('data-role="step-marker"');
    expect(today).not.toContain('data-role="im-live-line"');
  });

  it("writes 「思考中」 before any sentence, and drops the line once the round has its answer or asks", () => {
    const sent: Turn[] = [...conversation(), user("顺便看看船票", at(20))];
    const thinking = main({
      turns: sent,
      isMainChat: true,
      isRunning: true,
      im: rendering({ process: "line" }),
    });
    const line = thinking.indexOf('data-role="im-live-line"');
    expect(thinking.slice(line, line + 400)).toContain("思考中");
    // The answer landed before the run closed: the line goes.
    const settled = main({
      turns: [...sent, answer("还有票。", 1)],
      isMainChat: true,
      isRunning: true,
      im: rendering({ process: "line" }),
    });
    expect(settled).not.toContain('data-role="im-live-line"');
    // Asking: it waits, it is not busy.
    const asking = main({
      turns: [...sent, ask("订哪一班？", ["8:30"], 1)],
      isMainChat: true,
      pendingAskUser: { question: "订哪一班？", candidates: ["8:30"] },
      im: rendering({ process: "line" }),
    });
    expect(asking).not.toContain('data-role="im-live-line"');
    expect(asking).toContain('data-role="ask-user-bubble"');
  });

  it("hides the corner clock in line mode and puts the clock in the line past 3 seconds", () => {
    const turns = conversation();
    // The running demo has a round clock: the corner shows it today…
    const today = main({
      turns,
      isMainChat: true,
      im: rendering({ demo: "running" }),
    });
    expect(today).toContain(`aria-label="${zhCopy.conversation.runWorking}`);
    // …and not in line mode.
    const line = main({
      turns,
      isMainChat: true,
      im: rendering({ demo: "running", process: "line" }),
    });
    expect(line).not.toContain(`aria-label="${zhCopy.conversation.runWorking}`);
    expect(line).toContain('data-role="im-live-line"');
    const ten = wrap(
      <ImLiveLine
        sentence="我先查一下。"
        startedAtMs={Date.now() - 10_400}
        baseMs={0}
      />,
    );
    expect(ten).toContain("· 10 秒");
    const one = wrap(
      <ImLiveLine
        sentence="我先查一下。"
        startedAtMs={Date.now() - 1_000}
        baseMs={0}
      />,
    );
    expect(one).not.toContain("·");
  });

  it("names the entry by the fold header's structure words and its state", () => {
    const stats = buildRunGroups(conversation())[2].stats;
    const closed = wrap(
      <ImRunEntry stats={stats} open={false} onToggle={() => {}} />,
    );
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain(zhCopy.conversation.foldExpand);
    expect(closed).not.toContain("读取网页");
  });
});

// ---- Time: centred ---------------------------------------------------------

describe("IM rendering trial — the centred time", () => {
  it("keeps the same breaks, each as a centred line of its own", () => {
    const turns = conversation();
    const pinned = [...userTimeMarks(turns).values()].filter((m) => m.pinned);
    const html = conv(turns, { ...LINE, process: "current", time: "centered" });
    expect(count(html, 'data-role="im-time-divider"')).toBe(pinned.length);
    // No time is left on a bubble.
    expect(count(html, "<time")).toBe(pinned.length);
    expect(count(conv(turns), "<time")).toBe(pinned.length);
    expect(conv(turns)).not.toContain('data-role="im-time-divider"');
  });

  it("puts a line above the greeting when its time is known", () => {
    const turns = conversation();
    const withTime = conv(turns, {
      ...LINE,
      process: "current",
      time: "centered",
      greetingAt: at(8, 40),
    });
    const first = withTime.indexOf('data-role="im-time-divider"');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(withTime.indexOf("你好。以后有什么事"));
    expect(withTime).toContain("08:40");
    const withoutTime = conv(turns, {
      ...LINE,
      process: "current",
      time: "centered",
    });
    expect(withoutTime.indexOf('data-role="im-time-divider"')).toBeGreaterThan(
      withoutTime.indexOf("你好。以后有什么事"),
    );
  });
});

// ---- Scroll: bottom ----------------------------------------------------------

describe("IM rendering trial — sticking to the bottom", () => {
  it("stacks a short conversation up from the composer", () => {
    const turns = [GREETING];
    const html = main({
      turns,
      isMainChat: true,
      im: rendering({ scroll: "bottom" }),
    });
    expect(html).toContain("overflow-y-auto px-8 py-6 flex flex-col");
    expect(html).toContain("mt-auto w-full");
    const today = main({ turns, isMainChat: true });
    expect(today).not.toContain("mt-auto w-full");
  });

  it("goes to the bottom on a send", () => {
    const box = { scrollTop: 120, scrollHeight: 2_400, clientHeight: 700 };
    imScrollToBottom({ ...box, getBoundingClientRect: () => ({ top: 0 }) });
    const el = { ...box, getBoundingClientRect: () => ({ top: 0 }) };
    imScrollToBottom(el);
    expect(el.scrollTop).toBe(2_400);
  });

  it("follows the growth until the reply's start reaches the anchor line, then stops there", () => {
    // Bottom 1300; the start sits 500px down at scrollTop 400 → limit 868.
    expect(
      imFollowTop({
        scrollTop: 400,
        scrollHeight: 2_000,
        clientHeight: 700,
        replyStartOffset: 500,
        anchor: 32,
      }),
    ).toEqual({ top: 868, detach: true });
    // Everything fits: plain bottom.
    expect(
      imFollowTop({
        scrollTop: 400,
        scrollHeight: 1_300,
        clientHeight: 700,
        replyStartOffset: 500,
        anchor: 32,
      }),
    ).toEqual({ top: 600, detach: false });
    // Already scrolled past it, or none: plain bottom.
    expect(
      imFollowTop({
        scrollTop: 400,
        scrollHeight: 2_000,
        clientHeight: 700,
        replyStartOffset: -40,
        anchor: 32,
      }),
    ).toEqual({ top: 1_300, detach: false });
    expect(
      imFollowTop({
        scrollTop: 0,
        scrollHeight: 2_000,
        clientHeight: 700,
        replyStartOffset: null,
        anchor: 32,
      }),
    ).toEqual({ top: 1_300, detach: false });
  });

  it("finds the reply's start as the first thing after the user's message", () => {
    // A stand-in DOM: container › row › bubble, then the reply row.
    const reply = {
      getBoundingClientRect: () => ({ top: 640, height: 900 }),
      nextElementSibling: null,
    };
    const row: Record<string, unknown> = {
      nextElementSibling: reply,
      getBoundingClientRect: () => ({ top: 560, height: 60 }),
    };
    const bubble = { parentElement: row };
    const container = {
      scrollTop: 1_000,
      scrollHeight: 3_000,
      clientHeight: 700,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelectorAll: () => [bubble],
    };
    row.parentElement = container;
    const detached = imFollowBottom(
      container as unknown as HTMLElement & typeof container,
      32,
    );
    expect(detached).toBe(true);
    // The start (540px down) parks 32px under the top.
    expect(container.scrollTop).toBe(1_000 + 540 - 32);
  });
});

// ---- The demo -----------------------------------------------------------------

describe("IM rendering trial — the demo conversation", () => {
  const NOW = new Date(2026, 9, 14, 15, 0).getTime();

  it("covers the ticket's list", () => {
    const view = buildImDemo("still", "zh-CN", NOW);
    const turns = view.turns;
    expect(turns[0]).toMatchObject({ role: "agent", greeting: true });
    const users = turns.filter((t): t is UserTurn => t.role === "user");
    const days = new Set(users.map((u) => new Date(u.createdAt!).getDate()));
    expect(days.size).toBe(3);
    const groups = buildRunGroups(turns);
    expect(groups.some((g) => g.stats.stepCount === 9)).toBe(true);
    expect(
      groups.filter((g) => g.foldable && g.stats.stepCount === 1).length,
    ).toBeGreaterThan(1);
    expect(groups.some((g) => g.stats.askUserCount === 1)).toBe(true);
    const answers = turns.filter(
      (t): t is AgentTurn => t.role === "agent" && t.finalAnswer !== null,
    );
    expect(answers.some((a) => a.finalAnswer?.includes("|---|"))).toBe(true);
    expect(answers.some((a) => a.finalAnswer?.includes("```python"))).toBe(
      true,
    );
    expect(users.some((u) => (u.attachments ?? []).length === 1)).toBe(true);
    // Three user messages in a row.
    const roles = turns.map((t) => t.role).join(",");
    expect(roles).toContain("user,user,user");
    const cards = [...view.cards.values()].flat().map((c) => c.state.kind);
    expect(cards).toEqual(["running", "done"]);
    expect(view.greetingAt).toBeTruthy();
  });

  it("runs a round whose narration moves every few seconds, and waits on a question", () => {
    const start = NOW - 3 * IM_DEMO_STEP_MS - 2_000;
    const running = buildImDemo("running", "zh-CN", NOW, start);
    expect(running.running).toBe(true);
    expect(imDemoLanded(NOW - start)).toBe(3);
    expect(running.currentTurnIndex).toBe(4);
    expect(running.inFlight.length).toBeGreaterThan(0);
    expect(running.runStartedAtMs).toBe(start);
    const asking = buildImDemo("asking", "en-US", NOW);
    expect(asking.pendingAskUser?.candidates).toHaveLength(3);
    expect(asking.turns[0]).toMatchObject({ greeting: true });
    expect((asking.turns[0] as AgentTurn).finalAnswer).toMatch(/^Hi\./);
  });

  it("stands in for the chat on screen only, with the composer off", () => {
    const turns = conversation();
    const html = main({
      turns,
      isMainChat: true,
      im: rendering({ demo: "still" }),
    });
    expect(html).not.toContain("早，天气怎么样？");
    expect(html).toContain("周六想带爸妈去鼓浪屿玩一天");
    expect(html).toContain("演示中，关掉演示才能发消息");
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    const english = main(
      { turns, isMainChat: true, im: rendering({ demo: "still" }) },
      "en-US",
    );
    expect(english).toContain("Demo on. Turn it off to send a message.");
  });
});
