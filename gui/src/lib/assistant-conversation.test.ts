import { describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import {
  assistantCachedSentence,
  assistantFirstLine,
  assistantFollowBottom,
  assistantFollowTop,
  assistantLineClock,
  assistantLinePlan,
  assistantLineSentence,
  assistantRowGap,
  assistantScrollToBottom,
} from "@/lib/assistant-conversation";
import { buildRunGroups, liveRunGroup } from "@/lib/run-groups";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

function tool(name: string, args: Record<string, unknown> = {}) {
  return {
    id: `t-${name}-${Math.random()}`,
    name,
    status: "success-historical",
    args,
  } as ConversationToolEvent;
}

function user(content: string): UserTurn {
  return { role: "user", content, messageId: `u-${content}` };
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

/** The greeting; a one-step answer; a three-step run; a run where it
 * asks and the user picks a candidate; another one-step answer. */
function conversation(): Turn[] {
  return [
    {
      role: "agent",
      turnIndex: -1,
      finalAnswer: "你好。以后有什么事，直接在这里跟我说就行。",
      tools: [],
      greeting: true,
    },
    user("早，天气怎么样？"),
    answer("多云，记得带伞。", 1),
    user("帮我排个行程"),
    step("我先查一下船票。", 1),
    step("我看一下天气。", 2),
    answer("排好了。", 3),
    user("再加一顿晚饭"),
    step("我先看看评分高的晚饭。", 1),
    ask("晚饭想吃哪一类？", ["闽南菜", "海鲜", "西餐"], 2),
    user("闽南菜"),
    step("我挑几家闽南菜馆。", 3),
    answer("那就订老别墅。", 4),
    user("谢谢"),
    answer("不客气。", 1),
  ];
}

describe("assistantRowGap", () => {
  it("groups one side's messages 4px apart, 20px across sides, nothing under a reply's action row", () => {
    expect(assistantRowGap("user", "user")).toBe("mt-1");
    expect(assistantRowGap("agent", "agent")).toBe("mt-1");
    expect(assistantRowGap("user", "agent")).toBe("mt-5");
    expect(assistantRowGap("agent", "user")).toBe("mt-5");
    expect(assistantRowGap(null, "user")).toBe("mt-5");
    // The reply's reserved 30px action row already is the gap.
    expect(assistantRowGap("agent-bar", "user")).toBe("mt-0");
    expect(assistantRowGap("agent-bar", "agent")).toBe("mt-0");
  });
});

describe("the live line", () => {
  it("takes the first line of what streams, else this stretch's latest narration", () => {
    const run: Turn[] = [user("查一下天气"), step("我先查一下明天的天气。", 1)];
    expect(assistantLineSentence(run, "")).toBe("我先查一下明天的天气。");
    expect(assistantLineSentence(run, "## 明天多云\n\n22 到 27 度")).toBe(
      "明天多云",
    );
    expect(assistantLineSentence(run, "\n\n- **东北风** 3 级")).toBe(
      "东北风 3 级",
    );
    // Nothing written yet: 「思考中」.
    expect(assistantLineSentence([user("查一下天气")], "")).toBeNull();
    // An answer starts a new stretch: the narration before the question
    // is not the latest thing it wrote any more.
    const answered: Turn[] = [
      user("订船票"),
      step("我先看船班。", 1),
      ask("订哪一班？", ["8:30"], 2),
      user("8:30"),
    ];
    expect(assistantLineSentence(answered, "")).toBeNull();
    expect(assistantFirstLine("  > 1. `code_run` 跑完了")).toBe(
      "code_run 跑完了",
    );
  });

  // Ticket 31: the line and the card clean the stream alike; a
  // `<no-reply/>` on its way never shows, not even half of it.
  it("never says the silent-reply tag, whole or half-written", () => {
    const run: Turn[] = [user("比三家报价")];
    for (const stream of [
      "<no-re",
      "<no-reply",
      "<no-reply/>",
      "<No-Reply />",
    ]) {
      expect(assistantCachedSentence(run, stream)).toBeNull();
    }
    expect(assistantCachedSentence(run, "我打回去了。<no-rep")).toBe(
      "我打回去了。",
    );
  });

  it("shows the round's clock only past 3 seconds, in the corner clock's words", () => {
    expect(assistantLineClock(2_999, zhCopy)).toBeNull();
    expect(assistantLineClock(3_000, zhCopy)).toBe("3 秒");
    expect(assistantLineClock(81_400, zhCopy)).toBe("1 分 21 秒");
  });
});

describe("assistantLinePlan", () => {
  it("keeps questions and answers out as messages and the steps of a run of two steps or more under its entry", () => {
    const turns = conversation();
    const plan = assistantLinePlan(buildRunGroups(turns), turns, null);
    // Two runs of two steps or more get an entry; the one-step ones none.
    expect([...plan.steps.keys()]).toEqual([6, 12]);
    // The question and the answer stay messages, in order…
    expect(plan.question).toEqual(new Set([9]));
    expect(plan.message.has(9)).toBe(true);
    expect(plan.message.has(10)).toBe(true);
    // …and the step list holds the question's step but not the answer.
    expect(plan.steps.get(12)?.members).toEqual([8, 9, 11, 12]);
    expect(plan.steps.get(12)?.stats.stepCount).toBe(4);
    // The steps themselves are not messages; the greeting is.
    expect(plan.message.has(4)).toBe(false);
    expect(plan.message.has(8)).toBe(false);
    expect(plan.message.has(0)).toBe(true);
    expect(plan.flat.size).toBe(0);
  });

  it("draws a live run as its opener and its asked-and-answered pairs, and a run without an answer in full", () => {
    const turns: Turn[] = [
      user("订船票"),
      step("我先看船班。", 1),
      ask("订哪一班？", ["8:30"], 2),
      user("8:30"),
      step("我去下单。", 3),
    ];
    const groups = buildRunGroups(turns);
    const live = assistantLinePlan(
      groups,
      turns,
      liveRunGroup(groups, true, false),
    );
    expect([...live.message].sort()).toEqual([0, 2, 3]);
    expect(live.steps.size).toBe(0);
    // Not running and no answer (stopped, failed, at the step cap): the
    // workbench way, every turn in its run's region.
    const stopped = assistantLinePlan(groups, turns, null);
    expect([...stopped.flat.keys()]).toEqual([1, 2, 3, 4]);
    expect(stopped.steps.size).toBe(0);
  });

  // Ticket 31: a round Core woke it for opens with a report row nobody
  // sees; a reply that said nothing (`<no-reply/>`) leaves nothing but
  // the questions it asked you.
  it("never draws a report row, and draws a silent report round's questions alone", () => {
    const report: UserTurn = {
      role: "user",
      content: "[Galley — not a message from the user] …",
      messageId: "u-report",
      origin: { via: "system", supervisor: "galley-report", reason: "s-1" },
    };
    const silent: AgentTurn = {
      role: "agent",
      turnIndex: 4,
      finalAnswer: null,
      tools: [tool("no_tool")],
      silent: true,
    };
    const turns: Turn[] = [
      user("比三家报价"),
      answer("好，交给子任务。", 1),
      report,
      step("我看一下它的结果。", 1),
      answer("比好了：第二家最便宜。", 2),
      report,
      ask("要付定金吗？", ["付"], 1),
      user("付"),
      step("我替你回了它。", 3),
      silent,
    ];
    const plan = assistantLinePlan(buildRunGroups(turns), turns, null);
    expect(plan.message.has(2)).toBe(false);
    expect(plan.message.has(5)).toBe(false);
    // The answered round: its reply, with its two steps behind the button.
    expect(plan.message.has(4)).toBe(true);
    expect(plan.steps.get(4)?.members).toEqual([3, 4]);
    // The silent one: the question and your answer, nothing else.
    expect([...plan.message].filter((i) => i > 5)).toEqual([6, 7]);
    expect(plan.flat.size).toBe(0);
    expect(plan.steps.has(9)).toBe(false);
    // Each report's time goes above its round's first row.
    expect([...plan.reports]).toEqual([
      [2, 4],
      [5, 6],
    ]);
    // A silent round with no question draws nothing and dates nothing.
    const quiet: Turn[] = [
      user("比三家报价"),
      report,
      step("打回。", 1),
      silent,
    ];
    const none = assistantLinePlan(buildRunGroups(quiet), quiet, null);
    expect([...none.message]).toEqual([0]);
    expect(none.reports.size).toBe(0);
  });
});

describe("贴底", () => {
  it("follows the growth until the reply's start reaches the anchor line, then stops there", () => {
    // Bottom 1300; the start sits 500px down at scrollTop 400 → limit 868.
    expect(
      assistantFollowTop({
        scrollTop: 400,
        scrollHeight: 2_000,
        clientHeight: 700,
        replyStartOffset: 500,
        anchor: 32,
      }),
    ).toEqual({ top: 868, detach: true });
    // Everything fits: plain bottom.
    expect(
      assistantFollowTop({
        scrollTop: 400,
        scrollHeight: 1_300,
        clientHeight: 700,
        replyStartOffset: 500,
        anchor: 32,
      }),
    ).toEqual({ top: 600, detach: false });
    // Already scrolled past it, or none: plain bottom.
    expect(
      assistantFollowTop({
        scrollTop: 400,
        scrollHeight: 2_000,
        clientHeight: 700,
        replyStartOffset: -40,
        anchor: 32,
      }),
    ).toEqual({ top: 1_300, detach: false });
    expect(
      assistantFollowTop({
        scrollTop: 0,
        scrollHeight: 2_000,
        clientHeight: 700,
        replyStartOffset: null,
        anchor: 32,
      }),
    ).toEqual({ top: 1_300, detach: false });
  });

  it("parks the reply's start, the first thing after the user's message, on the anchor line", () => {
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
    const detached = assistantFollowBottom(
      container as unknown as HTMLElement & typeof container,
      32,
    );
    expect(detached).toBe(true);
    // The start (540px down) parks 32px under the top.
    expect(container.scrollTop).toBe(1_000 + 540 - 32);
  });

  it("lands a send at the bottom", () => {
    const el = {
      scrollTop: 120,
      scrollHeight: 2_400,
      clientHeight: 700,
      getBoundingClientRect: () => ({ top: 0 }),
    };
    assistantScrollToBottom(el);
    expect(el.scrollTop).toBe(2_400);
  });
});
