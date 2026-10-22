import { describe, expect, it } from "vitest";

import {
  assistantCachedSettledSentence,
  assistantFirstLine,
  assistantFollowBottom,
  assistantFollowTop,
  assistantLinePlan,
  assistantRowGap,
  assistantScrollToBottom,
  assistantSettledSentence,
  assistantTyping,
  assistantWriting,
  endsWithActionRow,
  typingBubbleShown,
} from "@/lib/assistant-conversation";
import { lastVisibleMessage } from "@/lib/assistant";
import { copyForLanguage } from "@/lib/i18n";
import { buildRunGroups, liveRunGroup } from "@/lib/run-groups";
import { hiddenReportTurns } from "@/lib/subtasks";
import { rowsToTurns } from "@/stores/messages/rowsToTurns";
import {
  DISPATCH_REPLY_ID,
  DISPATCH_TAG,
  dispatchRoundRows,
  EARLIER_REPLY,
} from "@/test/dispatch-round";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

const zh = copyForLanguage("zh-CN");

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

  it("adds nothing under your message's row of chips either (ruling 105): 30px both ways, two of yours included", () => {
    // You → it: the row's 30px, no longer 20px.
    expect(assistantRowGap("user-bar", "agent")).toBe("mt-0");
    // Two of yours in a row: 30px, no 4px group.
    expect(assistantRowGap("user-bar", "user")).toBe("mt-0");
  });

  it("names the rows whose action row is the gap: a reply's, your message's", () => {
    expect(endsWithActionRow("agent-bar")).toBe(true);
    expect(endsWithActionRow("user-bar")).toBe(true);
    // A question ends at its candidates; the workbench's user message
    // as the time line reads it; nothing above.
    expect(endsWithActionRow("agent")).toBe(false);
    expect(endsWithActionRow("user")).toBe(false);
    expect(endsWithActionRow(null)).toBe(false);
  });
});

// Rulings 107, 110 (tickets 55, 58): the header's second line while it
// runs, from the steps that settled; what streams is never read.
describe("the header's sentence", () => {
  it("takes this stretch's newest settled narration, nothing before one", () => {
    const run: Turn[] = [user("查一下天气"), step("我先查一下明天的天气。", 1)];
    expect(assistantSettledSentence(run)).toBe("我先查一下明天的天气。");
    // Nothing settled yet: 「思考中」.
    expect(assistantSettledSentence([user("查一下天气")])).toBeNull();
    // An answer starts a new stretch: the narration before the question
    // is not the latest thing it wrote any more.
    const answered: Turn[] = [
      user("订船票"),
      step("我先看船班。", 1),
      ask("订哪一班？", ["8:30"], 2),
      user("8:30"),
    ];
    expect(assistantSettledSentence(answered)).toBeNull();
    expect(assistantFirstLine("  > 1. `code_run` 跑完了")).toBe(
      "code_run 跑完了",
    );
  });

  it("is no step's sentence when it is the round's answer", () => {
    // The answer lands as the bubble, and run_complete follows: the
    // header keeps the step before it until then.
    expect(
      assistantSettledSentence([
        user("查一下天气"),
        step("我先查一下明天的天气。", 1),
        answer("明天多云，22 到 27 度。", 2),
      ]),
    ).toBe("我先查一下明天的天气。");
    expect(
      assistantSettledSentence([user("早"), answer("早，今天多云。", 1)]),
    ).toBeNull();
  });

  // Ruling 100 (ticket 47): a step that wrote no narration says its
  // summary; the newest step with words wins.
  describe("a step without narration says its summary", () => {
    /** A tool step that wrote only `<summary>`: no narration. */
    function summaryOnly(summary: string, index: number): AgentTurn {
      return {
        role: "agent",
        turnIndex: index,
        finalAnswer: null,
        summary,
        tools: [tool("code_run")],
      };
    }
    /** A tool step that wrote nothing at all (no summary either). */
    function bare(index: number): AgentTurn {
      return {
        role: "agent",
        turnIndex: index,
        finalAnswer: null,
        tools: [tool("code_run")],
      };
    }
    const water = "本机时间为10月19日10:34；先检查是否已有喝水提醒，避免重复。";

    it("the newest step only has a summary: the summary", () => {
      expect(
        assistantSettledSentence([user("提醒我喝水"), summaryOnly(water, 1)]),
      ).toBe(water);
    });

    it("the newest step has narration: the narration, not its summary", () => {
      const narrated: AgentTurn = {
        ...summaryOnly("已列出提醒；接下来新建。", 2),
        finalAnswer: "我先看看有没有重复的提醒。",
      };
      expect(
        assistantSettledSentence([
          user("提醒我喝水"),
          summaryOnly(water, 1),
          narrated,
        ]),
      ).toBe("我先看看有没有重复的提醒。");
    });

    it("step 1 narrated, step 2 only a summary: step 2's summary", () => {
      expect(
        assistantSettledSentence([
          user("提醒我喝水"),
          step("我先看一下现在几点。", 1),
          summaryOnly("没有重复的提醒；接下来建一个每小时的。", 2),
        ]),
      ).toBe("没有重复的提醒；接下来建一个每小时的。");
    });

    it("a step with no words at all is passed over for the one before it", () => {
      expect(
        assistantSettledSentence([
          user("提醒我喝水"),
          summaryOnly(water, 1),
          bare(2),
        ]),
      ).toBe(water);
    });

    it("stops at your last message: an older round's summary is not this one's", () => {
      expect(
        assistantSettledSentence([
          user("提醒我喝水"),
          summaryOnly(water, 1),
          user("改成半小时"),
        ]),
      ).toBeNull();
      // Your answer to its question too.
      expect(
        assistantSettledSentence([
          user("提醒我喝水"),
          summaryOnly(water, 1),
          ask("多久一次？", ["每小时"], 2),
          user("每小时"),
        ]),
      ).toBeNull();
    });

    it("cleans the summary as the narration, and a protocol failure's says nothing", () => {
      // An old row's 「第 N 步 · 」 prefix, markdown, GA's 「...」 elision.
      expect(
        assistantSettledSentence([
          user("提醒我喝水"),
          summaryOnly("第 2 步 · 读取 **提醒列表** ... 接下来新建", 2),
        ]),
      ).toBe("读取 提醒列表 … 接下来新建");
      // The runner's fixed marker, and raw leaked markup: no sentence.
      for (const failed of [
        "回合协议错误：工具调用未能送达",
        '<invoke name="code_run"><parameter name="code">x',
      ]) {
        expect(
          assistantSettledSentence([
            user("提醒我喝水"),
            summaryOnly(failed, 1),
          ]),
        ).toBeNull();
      }
    });
  });

  it("keeps the sentence for the last turns array", () => {
    const run: Turn[] = [user("查一下天气"), step("我先查一下明天的天气。", 1)];
    expect(assistantCachedSettledSentence(run)).toBe("我先查一下明天的天气。");
    expect(assistantCachedSettledSentence(run)).toBe(
      assistantSettledSentence(run),
    );
    const next = [...run, step("再看看后天。", 2)];
    expect(assistantCachedSettledSentence(next)).toBe("再看看后天。");
  });
});

// Rulings 107, 110 (tickets 55, 58): the conversation ends in the typing
// bubble while the round is live; the card's 「正在输入…」 reads the same
// rule.
describe("the typing bubble", () => {
  const report: UserTurn = {
    role: "user",
    content: "[Galley — not a message from the user] …",
    messageId: "u-report",
    origin: { via: "system", supervisor: "galley-report", reason: "s-2" },
  };
  const DISPATCH =
    '🛠️ Tool: `web_scan`  📥 args:\n````text\n{"url": "x"}\n````\n';

  it("shows throughout a live round you started, from the send on, words or not", () => {
    const sent: Turn[] = [...conversation(), user("顺便看看船票")];
    for (const stream of ["", "<thinking>想一下", "周六有船。", DISPATCH]) {
      expect(typingBubbleShown(true, sent, stream)).toBe(true);
      expect(assistantTyping(sent, stream)).toBe(true);
    }
    expect(
      typingBubbleShown(true, [...sent, step("我先查一下船班。", 1)], ""),
    ).toBe(true);
  });

  it("shows in a woken round only while it writes words", () => {
    const woken: Turn[] = [...conversation(), report];
    expect(typingBubbleShown(true, woken, "")).toBe(false);
    expect(typingBubbleShown(true, woken, "<thinking>看看结果")).toBe(false);
    expect(typingBubbleShown(true, woken, "我先看一下结果。")).toBe(true);
    // A dispatch follows the words: they are done, the dots go…
    expect(
      typingBubbleShown(true, woken, `我先看一下结果。\n${DISPATCH}`),
    ).toBe(false);
    // …and come back with the next step's words.
    const after: Turn[] = [...woken, step("我先看一下结果。", 1)];
    expect(typingBubbleShown(true, after, "")).toBe(false);
    expect(typingBubbleShown(true, after, "好了，")).toBe(true);
  });

  it("never shows for a silent reply, whole or half-written", () => {
    const woken: Turn[] = [...conversation(), report];
    for (const stream of [
      "<no-re",
      "<no-reply",
      "<no-reply/>",
      "<No-Reply />",
    ]) {
      expect(typingBubbleShown(true, woken, stream)).toBe(false);
    }
  });

  it("is not drawn while the round is not live: settled, asking, at rest, the workbench", () => {
    const sent: Turn[] = [...conversation(), user("顺便看看船票")];
    expect(typingBubbleShown(false, sent, "周六有船。")).toBe(false);
    expect(typingBubbleShown(false, [...conversation(), report], "好了")).toBe(
      false,
    );
  });
});

// Rulings 104, 110 (tickets 52, 58): whether the step's raw stream is
// writing words — a woken round's typing bubble and the card's
// 「正在输入…」 in it.
describe("assistantWriting", () => {
  const DISPATCH =
    '🛠️ Tool: `web_scan`  📥 args:\n````text\n{"url": "x"}\n````\n';

  it("is writing only with words, no open thinking and no dispatch yet", () => {
    const cases: [string, boolean][] = [
      // Nothing streamed yet.
      ["", false],
      // Only an open thinking block: reasoning, not writing.
      ["<thinking>先想一下用哪个工具", false],
      ["<thinking>", false],
      // Closed, nothing after it yet.
      ["<thinking>想好了</thinking>", false],
      ["<thinking>想好了</thinking>\n\n", false],
      // Words after the thinking closed.
      ["<thinking>想好了</thinking>\n\n明早九点", true],
      ["明早九点提醒你喝水。", true],
      // A second thinking opened after the words: reasoning again.
      ["我看一下。<thinking>再想想", false],
      // The start of a closing tag at the tail is still the block.
      ["<thinking>想好了</thin", false],
      // Words, then a tool dispatch: the words are done.
      [`我先查一下船班。\n${DISPATCH}`, false],
      [`我先查一下船班。\n${DISPATCH}\`\`\`\`\`\n[Action] 读取网页\n`, false],
      // A dispatch on its way: partial verbose and compact markers, the
      // output fence.
      ["我先查一下船班。\n🛠️ Tool: `web_sc", false],
      ["我先查一下船班。\n🛠️ web_scan(", false],
      ["我先查一下船班。\n🛠 web_scan(url='x')\n", false],
      ["`````\n[Action] 读取网页\n", false],
      // A silent reply says nothing, whole or half-written.
      ["<no-reply/>", false],
      ["<No-Reply />", false],
      ["<no-re", false],
      ["<thinking>打回去</thinking>\n<no-reply/>", false],
      // Words beside the tag still show.
      ["我打回去了。<no-rep", true],
      // Whitespace, tags and GA's markers are no words.
      ["   \n\n\t", false],
      ["<summary>先读本机时间</summary>", false],
      ["**LLM Running (Turn 2) ...**\n", false],
      ["当前阶段：读取提醒列表", false],
      // A tool call the provider sent as text is no words either.
      ['<invoke name="code_run"><parameter name="code">x', false],
    ];
    for (const [stream, expected] of cases) {
      expect([stream, assistantWriting(stream)]).toEqual([stream, expected]);
    }
  });

  it("flips once each way across a step: thinking, words, the dispatch", () => {
    const chunks = [
      "<thinking>",
      ...Array.from({ length: 10 }, (_, i) => `第 ${i + 1} 段思考。`),
      "</thinking>\n\n",
      ...Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 句话。`),
      "\n",
      DISPATCH,
      ...Array.from({ length: 8 }, (_, i) => `\`\`\`\`\`\n输出 ${i}\n`),
    ];
    let stream = "";
    const seen: boolean[] = [];
    for (const chunk of chunks) {
      stream += chunk;
      const writing = assistantWriting(stream);
      if (seen[seen.length - 1] !== writing) seen.push(writing);
    }
    expect(chunks.length).toBeGreaterThan(40);
    expect(seen).toEqual([false, true, false]);
  });

  // Ticket 76: a woken round that only dispatched writes the subtask tag
  // and `<no-reply/>` — no words at any point of the stream, so its
  // typing bubble never comes.
  it("is never writing while a dispatch and its <no-reply/> stream", () => {
    const reply = `<summary>派子任务查船票</summary>\n${DISPATCH_TAG}\n<no-reply/>`;
    for (let end = 1; end <= reply.length; end++) {
      const stream = reply.slice(0, end);
      expect([stream, assistantWriting(stream)]).toEqual([stream, false]);
    }
    // Words before the tag are words.
    expect(
      assistantWriting(`交给子任务了。\n${DISPATCH_TAG.slice(0, 12)}`),
    ).toBe(true);
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

  it("draws a reply whose message was deleted as the reply it was (ticket 32)", () => {
    const turns: Turn[] = [
      user("第一问"),
      answer("第一答", 1),
      // Your second message went: its reply follows the first answer.
      step("我先查一下。", 1),
      step("再核对一处。", 2),
      answer("第二答", 3),
    ];
    const groups = buildRunGroups(turns, { splitAfterAnswer: true });
    const plan = assistantLinePlan(groups, turns, null);
    // Both answers are messages; the second keeps its process button,
    // keyed by its first step (there is no opener).
    expect([...plan.message].sort()).toEqual([0, 1, 4]);
    expect(plan.flat.size).toBe(0);
    expect(plan.steps.get(4)?.opener).toBe(2);
    expect(plan.steps.get(4)?.members).toEqual([2, 3, 4]);
    expect(plan.steps.has(1)).toBe(false);
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

  // Ruling 125 (ticket 76): a woken round that only dispatched and said
  // `<no-reply/>` — the rows as Core wrote them — draws nothing: no
  // steps, no reply (the cards of what it dispatched hang on it), no
  // time for its report; the sidebar card's last message is the reply
  // before it.
  const planOf = (turns: Turn[]) =>
    assistantLinePlan(
      buildRunGroups(turns, { splitAfterAnswer: true }),
      turns,
      null,
    );

  it("draws nothing of a woken round that only dispatched", () => {
    const turns = rowsToTurns(dispatchRoundRows({ woken: true }));
    expect(turns.map((t) => t.role)).toEqual([
      "user",
      "agent",
      "user",
      "agent",
      "agent",
      "agent",
    ]);
    expect((turns[5] as AgentTurn).messageId).toBe(DISPATCH_REPLY_ID);
    const plan = planOf(turns);
    // The exchange before it, and nothing of the round.
    expect([...plan.message]).toEqual([0, 1]);
    expect(plan.flat.size).toBe(0);
    expect(plan.steps.size).toBe(0);
    expect(plan.question.size).toBe(0);
    // No entry for its report: it dates nothing (Conversation's skip).
    expect(plan.reports.size).toBe(0);
    expect([...hiddenReportTurns(turns)].sort()).toEqual([2, 3, 4, 5]);
    expect(lastVisibleMessage(turns, zh)?.text).toBe(EARLIER_REPLY);
  });

  it("draws the user's own dispatch as before, with <no-reply/> or without", () => {
    const [bare, tagged] = [false, true].map((noReply) =>
      rowsToTurns(dispatchRoundRows({ woken: false, noReply })),
    );
    for (const turns of [bare, tagged]) {
      const plan = planOf(turns);
      // No answer: the workbench way, the steps and the reply in the
      // run's region, the reply's cards under it.
      expect([...plan.message]).toEqual([0, 1, 2]);
      expect([...plan.flat]).toEqual([
        [3, 2],
        [4, 2],
        [5, 2],
      ]);
      expect(plan.steps.size).toBe(0);
      expect(plan.reports.size).toBe(0);
      expect(hiddenReportTurns(turns).size).toBe(0);
    }
    expect(lastVisibleMessage(tagged, zh)).toEqual(
      lastVisibleMessage(bare, zh),
    );
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
