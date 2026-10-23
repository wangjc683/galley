import { describe, expect, it } from "vitest";

import { type AssistantDraft, assistantCardLine } from "@/lib/assistant";
import { assistantSettledSentence } from "@/lib/assistant-conversation";
import {
  assistantDoing,
  assistantProgressElapsed,
  assistantProgressHalf,
  assistantRunMinutes,
  msToNextRunMinute,
  streamedStepSummary,
} from "@/lib/assistant-progress";
import { copyForLanguage } from "@/lib/i18n";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

/*
 * TEMP variant switcher (main chat 90) — 「新」's rules (main chat PRD
 * ruling 134). Kept with lib/assistant-progress.ts if 「新」 wins.
 */

const zh = copyForLanguage("zh-CN");
const en = copyForLanguage("en-US");

function tool(name: string): ConversationToolEvent {
  return {
    id: `t-${name}`,
    name,
    status: "success-historical",
    args: {},
  } as ConversationToolEvent;
}

function user(content: string): UserTurn {
  return { role: "user", content, messageId: `u-${content}` };
}

/** A settled tool step that wrote only its summary (as the runner sends
 * it: GA's `<summary>`, one line, `smart_format`ted). */
function toolStep(summary: string | undefined, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: null,
    summary,
    tools: [tool("web_scan")],
  };
}

/** The round's closing reply: no tools, its summary and its words. */
function answer(text: string, summary: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: text,
    summary,
    tools: [tool("no_tool")],
    messageId: `a-${index}`,
  };
}

function ask(index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: null,
    summary: "需要用户选东部还是西部；我问用户",
    tools: [tool("ask_user")],
    telemetry: { elapsedMs: 26_000 },
  };
}

const REPORT: UserTurn = {
  role: "user",
  content: "[Galley — not a message from the user] …",
  messageId: "u-report",
  origin: { via: "system", supervisor: "galley-report", reason: "s-2" },
};

/** GA's verbose dispatch marker after the reply (agent_loop: `\n\n` once
 * the reply has streamed, then the marker; the runner drops the
 * 5-backtick output fence after it, workbench_bridge `_FenceFilter`). */
function dispatch(name = "web_scan"): string {
  return `\n\n🛠️ Tool: \`${name}\`  📥 args:\n\`\`\`\`text\n{\n  "tabs_only": false\n}\n\`\`\`\`\n`;
}

/** A step's stream with native tool calls (llmcore NativeToolClient):
 * the reasoning in-band as `<thinking>` (Galley's `_GalleyThinkTag`),
 * then the model's text — its `<summary>` — and the call, which is not
 * in the stream at all; then GA's dispatch marker. */
function nativeStream(summary: string): string[] {
  return [
    "\n**LLM Running (Turn 2) ...**\n\n",
    "<thinking>",
    "伤病名单要看最新的，",
    "先看东部几支热门队。",
    "</thinking>",
    "<summary>",
    summary.slice(0, 6),
    summary.slice(6),
    "</summary>",
    dispatch(),
  ];
}

/** The same step in GA's text protocol (llmcore ToolClient): the model
 * writes `<summary>` and then `<tool_use>{…}</tool_use>` as text; then
 * GA's dispatch marker. */
function textProtocolStream(summary: string): string[] {
  return [
    "\n**LLM Running (Turn 2) ...**\n\n",
    "<summary>",
    summary,
    "</summary>\n",
    '<tool_use>{"name": "web_scan", ',
    '"arguments": {"tabs_only": false}}</tool_use>',
    dispatch(),
  ];
}

/** Every prefix of a stream, one chunk more each time. */
function prefixes(chunks: string[]): string[] {
  const out: string[] = [];
  let stream = "";
  for (const chunk of chunks) {
    stream += chunk;
    out.push(stream);
  }
  return out;
}

/** What GA keeps as the step's summary (ga.py turn_end_callback →
 * smart_format → the runner's `_clean_turn_summary`), for summaries short
 * of `smart_format`'s cut and free of markup: the inside, trimmed. */
const settledAs = (summary: string) => summary.trim().replace(/\n/g, "");

// ---- 后半句 -----------------------------------------------------------------

describe("assistantProgressHalf: the half of a summary the line says", () => {
  it("takes what follows 「；」, without its period (real summaries from the database)", () => {
    expect(
      assistantProgressHalf(
        "提醒规则已确认；我读取当前时间并检查是否已有喝水提醒。",
      ),
    ).toBe("我读取当前时间并检查是否已有喝水提醒");
  });

  it("takes what follows 「;」 too", () => {
    expect(
      assistantProgressHalf("Found the schedule; checking the tickets."),
    ).toBe("checking the tickets");
    expect(assistantProgressHalf("赛程已拿到;我查伤病")).toBe("我查伤病");
  });

  it("cuts at the last separator of two or more, either kind", () => {
    expect(assistantProgressHalf("凯尔特人已查；尼克斯已查；我查雄鹿。")).toBe(
      "我查雄鹿",
    );
    expect(assistantProgressHalf("A; B；C; 我查雄鹿")).toBe("我查雄鹿");
  });

  it("says the whole sentence without a separator, its period off", () => {
    expect(
      assistantProgressHalf(
        "我先核对当前时间和提醒命令，设置三分钟后的喝水提醒。",
      ),
    ).toBe("我先核对当前时间和提醒命令，设置三分钟后的喝水提醒");
    // Not cut further: no cut at a comma.
    expect(assistantProgressHalf("读完伤病，对比战绩，再看赛程")).toBe(
      "读完伤病，对比战绩，再看赛程",
    );
  });

  it("drops the periods it ends with and the whitespace around it", () => {
    expect(assistantProgressHalf("已查；  我查雄鹿。。 ")).toBe("我查雄鹿");
    expect(assistantProgressHalf("Done; checking v1.2.")).toBe("checking v1.2");
    expect(assistantProgressHalf("我查雄鹿.")).toBe("我查雄鹿");
  });

  it("says the whole sentence, without its separator, when nothing follows it", () => {
    expect(assistantProgressHalf("提醒规则已确认；")).toBe("提醒规则已确认");
    expect(assistantProgressHalf("提醒规则已确认；。")).toBe("提醒规则已确认");
    expect(assistantProgressHalf("提醒规则已确认;  ")).toBe("提醒规则已确认");
  });

  it("is cleaned as the header cleans a summary first", () => {
    // An old row's 「第 N 步 · 」, markdown, GA's 「...」 elision.
    expect(
      assistantProgressHalf("第 2 步 · 读取 **提醒列表** ... 接下来；新建"),
    ).toBe("新建");
    expect(assistantProgressHalf("读取 **提醒列表** ... 接下来新建")).toBe(
      "读取 提醒列表 … 接下来新建",
    );
  });

  it("says nothing for a turn-protocol failure's summary", () => {
    expect(assistantProgressHalf("回合协议错误：工具调用未能送达")).toBeNull();
    expect(
      assistantProgressHalf('<invoke name="code_run"><parameter name="x">'),
    ).toBeNull();
  });

  it("says nothing when nothing is left once cleaned", () => {
    for (const empty of [
      undefined,
      null,
      "",
      "   ",
      "** **",
      "<b></b>",
      "。",
    ]) {
      expect([empty, assistantProgressHalf(empty)]).toEqual([empty, null]);
    }
  });
});

// ---- 流里的 summary -----------------------------------------------------------

describe("streamedStepSummary: the step's summary once its dispatch shows", () => {
  it("is nothing before the dispatch, a closed summary or not", () => {
    expect(streamedStepSummary("")).toBeNull();
    expect(streamedStepSummary("<summary>伤病已查；我对比战绩</summary>")).toBe(
      null,
    );
    expect(
      streamedStepSummary(
        "<summary>伤病已查；我对比战绩</summary>\n\n🛠️ Tool: `web",
      ),
    ).toBe("伤病已查；我对比战绩");
  });

  it("reads it as GA does: the first one, outside reasoning and code fences, its breaks out", () => {
    expect(
      streamedStepSummary(
        `<thinking>写 <summary>草稿</summary></thinking>\n\`\`\`\n<summary>代码里</summary>\n\`\`\`\n<summary> 伤病已查；\n我对比战绩 </summary><summary>第二个</summary>${dispatch()}`,
      ),
    ).toBe("伤病已查；我对比战绩");
    // `<think>` blocks too (GA's parsers drop them before it looks).
    expect(
      streamedStepSummary(
        `<think><summary>想法</summary></think><summary>真的</summary>${dispatch()}`,
      ),
    ).toBe("真的");
  });

  it("is not one inside a <thinking> that never closed, nor without a summary", () => {
    expect(
      streamedStepSummary(`<thinking>想 <summary>半截</summary>${dispatch()}`),
    ).toBeNull();
    expect(streamedStepSummary(`我先查一下。${dispatch()}`)).toBeNull();
    expect(streamedStepSummary(`<summary>没闭合${dispatch()}`)).toBeNull();
  });

  it("is shortened as GA shortens it (smart_format: under 90 as is, else 40 … 40)", () => {
    const long = `${"东".repeat(50)}；${"西".repeat(50)}`;
    expect(streamedStepSummary(`<summary>${long}</summary>${dispatch()}`)).toBe(
      `${"东".repeat(40)} ... ${"西".repeat(40)}`,
    );
    const short = "东".repeat(89);
    expect(
      streamedStepSummary(`<summary>${short}</summary>${dispatch()}`),
    ).toBe(short);
  });

  it("ignores what the tool prints after the dispatch", () => {
    expect(
      streamedStepSummary(
        `<summary>伤病已查；我对比战绩</summary>${dispatch()}<summary>输出里的</summary>`,
      ),
    ).toBe("伤病已查；我对比战绩");
  });
});

// ---- 在做什么 ----------------------------------------------------------------

describe("assistantDoing: what the line under the dots says", () => {
  const SENT: Turn[] = [user("新赛季 NBA 东部你怎么预测？")];
  const STEP_ONE = "已拿到东部各队休赛期动向；我查各队伤病与轮换。";
  const STEP_TWO = "伤病已查完；我对比各队近三季的胜场";

  it("says 「思考中」 from the send until a step dispatches", () => {
    for (const stream of [
      "",
      "\n**LLM Running (Turn 1) ...**\n\n",
      "<thinking>先想想",
      "<thinking>想好了</thinking>",
      "<summary>先查休赛期动向</summary>",
    ]) {
      expect([stream, assistantDoing(SENT, stream, zh)]).toEqual([
        stream,
        "思考中",
      ]);
    }
    expect(assistantDoing(SENT, "", en)).toBe("Thinking");
  });

  it("says the streamed summary's half once the dispatch shows, not when the summary closes", () => {
    const stepped: Turn[] = [...SENT, toolStep(STEP_ONE, 1)];
    // Closed but not dispatched yet: still the step before.
    expect(assistantDoing(stepped, `<summary>${STEP_TWO}</summary>`, zh)).toBe(
      "我查各队伤病与轮换",
    );
    // Dispatched: this step's.
    expect(
      assistantDoing(
        stepped,
        `<summary>${STEP_TWO}</summary>${dispatch()}`,
        zh,
      ),
    ).toBe("我对比各队近三季的胜场");
  });

  it("keeps the last step's between two steps, and says the same once the step settles", () => {
    const streaming = `<thinking>想</thinking><summary>${STEP_TWO}</summary>${dispatch()}`;
    const live = assistantDoing(
      [...SENT, toolStep(STEP_ONE, 1)],
      streaming,
      zh,
    );
    expect(live).toBe("我对比各队近三季的胜场");
    // turn_end: the step lands, the stream clears, the next one starts.
    const settled: Turn[] = [
      ...SENT,
      toolStep(STEP_ONE, 1),
      toolStep(settledAs(STEP_TWO), 2),
    ];
    for (const next of [
      "",
      "\n**LLM Running (Turn 3) ...**\n\n",
      "<thinking>再看",
    ]) {
      expect(assistantDoing(settled, next, zh)).toBe(live);
    }
  });

  it("says the same before and after settling for a summary GA shortens", () => {
    const long = `${"东部".repeat(30)}；我对比${"各队".repeat(30)}的胜场`;
    const streamed = streamedStepSummary(
      `<summary>${long}</summary>${dispatch()}`,
    );
    expect(streamed).not.toBe(long);
    const live = assistantDoing(
      SENT,
      `<summary>${long}</summary>${dispatch()}`,
      zh,
    );
    // The runner sends GA's `smart_format`ted summary with 「...」 as 「…」.
    const runnerSent = streamed!.replace(/\s*\.\.\.\s*/g, " … ");
    expect(assistantDoing([...SENT, toolStep(runnerSent, 1)], "", zh)).toBe(
      live,
    );
  });

  it("says 「正在写回复」 while it writes words, and gives way to the dispatch", () => {
    const stepped: Turn[] = [...SENT, toolStep(STEP_ONE, 1)];
    expect(assistantDoing(stepped, "东部我看好", zh)).toBe("正在写回复");
    expect(assistantDoing(SENT, "<thinking>想好了</thinking>\n东部", zh)).toBe(
      "正在写回复",
    );
    expect(assistantDoing(SENT, "东部", en)).toBe("Writing the reply");
    // Narration before a tool call: 「正在写回复」 until its dispatch.
    expect(
      assistantDoing(stepped, `<summary>${STEP_TWO}</summary>我再查一下。`, zh),
    ).toBe("正在写回复");
    expect(
      assistantDoing(
        stepped,
        `<summary>${STEP_TWO}</summary>我再查一下。${dispatch()}`,
        zh,
      ),
    ).toBe("我对比各队近三季的胜场");
  });

  it("never says the closing step's summary: no dispatch, no new sentence", () => {
    const stepped: Turn[] = [...SENT, toolStep(STEP_ONE, 1)];
    const closing = "<summary>都查完了；结论是凯尔特人第一</summary>";
    const reply = `${closing}\n东部我看好凯尔特人。`;
    const seen = new Set(
      prefixes([...closing, ...reply.slice(closing.length)]).map((stream) =>
        assistantDoing(stepped, stream, zh),
      ),
    );
    expect(seen).toEqual(new Set(["我查各队伤病与轮换", "正在写回复"]));
    // Landed (before run_complete): the answer is no step.
    expect(
      assistantDoing(
        [
          ...stepped,
          answer("东部我看好凯尔特人。", "都查完了；结论是凯尔特人第一", 2),
        ],
        "",
        zh,
      ),
    ).toBe("我查各队伤病与轮换");
  });

  it("passes over a step without a summary it can say, for the one before", () => {
    expect(
      assistantDoing(
        [
          ...SENT,
          toolStep(STEP_ONE, 1),
          toolStep(undefined, 2),
          toolStep("回合协议错误：工具调用未能送达", 3),
        ],
        "",
        zh,
      ),
    ).toBe("我查各队伤病与轮换");
    // A dispatch without a summary: the step before too.
    expect(
      assistantDoing(
        [...SENT, toolStep(STEP_ONE, 1)],
        `我再查。${dispatch()}`,
        zh,
      ),
    ).toBe("我查各队伤病与轮换");
  });

  it("goes back to 「思考中」 once you answer its question", () => {
    const answered: Turn[] = [
      ...SENT,
      toolStep(STEP_ONE, 1),
      ask(2),
      user("东部"),
    ];
    expect(assistantDoing(answered, "", zh)).toBe("思考中");
    expect(assistantSettledSentence(answered)).toBeNull();
  });

  it("stops at your last message: an earlier round's steps are not this one's", () => {
    expect(
      assistantDoing(
        [
          ...SENT,
          toolStep(STEP_ONE, 1),
          answer("好的。", "答完", 2),
          user("那西部呢？"),
        ],
        "",
        zh,
      ),
    ).toBe("思考中");
  });

  it("draws nothing in a round Core woke it for", () => {
    const woken: Turn[] = [
      ...SENT,
      answer("交给子任务了。", "派活", 1),
      REPORT,
    ];
    for (const stream of [
      "",
      "子任务查好了，",
      `<summary>a；b</summary>${dispatch()}`,
    ]) {
      expect(assistantDoing(woken, stream, zh)).toBeNull();
    }
    expect(
      assistantDoing([...woken, toolStep(STEP_ONE, 1)], "", zh),
    ).toBeNull();
  });

  describe("both streams, chunk by chunk", () => {
    const stepped: Turn[] = [...SENT, toolStep(STEP_ONE, 1)];

    it("native tool calls: the step before until the marker, then this one's", () => {
      const said = prefixes(nativeStream(STEP_TWO)).map((stream) =>
        assistantDoing(stepped, stream, zh),
      );
      expect(said.slice(0, -1).every((s) => s === "我查各队伤病与轮换")).toBe(
        true,
      );
      expect(said[said.length - 1]).toBe("我对比各队近三季的胜场");
    });

    it("GA's text protocol: the same", () => {
      const said = prefixes(textProtocolStream(STEP_TWO)).map((stream) =>
        assistantDoing(stepped, stream, zh),
      );
      expect(said.slice(0, -1).every((s) => s === "我查各队伤病与轮换")).toBe(
        true,
      );
      expect(said[said.length - 1]).toBe("我对比各队近三季的胜场");
    });

    it("native, a reply of reasoning and a call only: GA's summary from the reasoning's first line", () => {
      // llmcore `_ensure_text_block`: no text block, so GA writes one from
      // the reasoning's first line and yields it after the stream.
      const stream = `<thinking>先查雄鹿的伤病\n再看赛程</thinking><summary>先查雄鹿的伤病</summary>${dispatch()}`;
      expect(assistantDoing(stepped, stream, zh)).toBe("先查雄鹿的伤病");
    });
  });
});

// ---- 用时 -------------------------------------------------------------------

describe("assistantProgressElapsed: the line's time", () => {
  it("is nothing under a second", () => {
    for (const ms of [-5, 0, 999, Number.NaN]) {
      expect(assistantProgressElapsed(ms, zh)).toBeNull();
    }
  });

  it("speaks the corner clock's words: whole seconds, then minutes and seconds", () => {
    expect(assistantProgressElapsed(1_000, zh)).toBe("1 秒");
    expect(assistantProgressElapsed(59_999, zh)).toBe("59 秒");
    expect(assistantProgressElapsed(60_000, zh)).toBe("1 分 0 秒");
    expect(assistantProgressElapsed(72_400, zh)).toBe("1 分 12 秒");
    expect(assistantProgressElapsed(72_400, en)).toBe("1m 12s");
  });
});

describe("the card's minutes", () => {
  it("counts whole minutes of the same figure, rounded down, the banked segments in", () => {
    const start = 1_000_000;
    expect(assistantRunMinutes(0, start, start + 59_999)).toBe(0);
    expect(assistantRunMinutes(0, start, start + 60_000)).toBe(1);
    expect(assistantRunMinutes(0, start, start + 179_000)).toBe(2);
    expect(assistantRunMinutes(26_000, start, start + 34_000)).toBe(1);
    // A clock ahead of the page's: nothing yet.
    expect(assistantRunMinutes(0, start, start - 5_000)).toBe(0);
  });

  it("says how long until the next whole minute", () => {
    const start = 1_000_000;
    expect(msToNextRunMinute(0, start, start)).toBe(60_000);
    expect(msToNextRunMinute(0, start, start + 59_000)).toBe(1_000);
    expect(msToNextRunMinute(26_000, start, start + 30_000)).toBe(4_000);
    expect(msToNextRunMinute(0, start, start - 5_000)).toBe(60_000);
  });
});

// ---- 卡片 -------------------------------------------------------------------

describe("assistantCardLine in 「新」: a round you started", () => {
  const running = {
    kind: "running" as const,
    line: { text: "思考中", tone: "running" as const },
    fromSubtask: false,
  };
  const lastMessage = { fromUser: true, text: "新赛季 NBA 东部你怎么预测？" };
  const draft: AssistantDraft = { text: "顺便", imageCount: 0 };
  const say = (
    open: boolean,
    working: { writing: boolean; minutes: number } | undefined,
    typing = true,
  ) =>
    assistantCardLine(
      running,
      { lastMessage, draft, open, typing, working },
      zh,
    );

  it("says only what the screen does not: the six cells", () => {
    // On screen: 「正在工作…」 throughout.
    expect(say(true, { writing: true, minutes: 0 })).toEqual({
      kind: "running",
      text: "正在工作…",
    });
    expect(say(true, { writing: false, minutes: 0 })?.text).toBe("正在工作…");
    expect(say(true, { writing: false, minutes: 3 })?.text).toBe("正在工作…");
    // Away: 「正在输入…」 while it writes, then the minutes from one on.
    expect(say(false, { writing: true, minutes: 2 })).toEqual({
      kind: "running",
      text: "正在输入…",
    });
    expect(say(false, { writing: false, minutes: 0 })?.text).toBe("正在工作…");
    expect(say(false, { writing: false, minutes: 1 })?.text).toBe(
      "正在工作 · 1 分钟",
    );
    expect(say(false, { writing: false, minutes: 12 })?.text).toBe(
      "正在工作 · 12 分钟",
    );
    expect(
      assistantCardLine(
        running,
        { open: false, working: { writing: false, minutes: 2 } },
        en,
      )?.text,
    ).toBe("Working · 2 min");
    expect(
      assistantCardLine(
        running,
        { open: true, working: { writing: false, minutes: 2 } },
        en,
      )?.text,
    ).toBe("Working…");
  });

  it("leaves a woken round (no `working`) as before: 「正在输入…」 while typing, else the last message", () => {
    expect(say(false, undefined, true)?.text).toBe("正在输入…");
    expect(say(true, undefined, true)?.text).toBe("正在输入…");
    expect(say(false, undefined, false)).toEqual({
      kind: "message",
      prefix: "你：",
      text: "新赛季 NBA 东部你怎么预测？",
    });
  });

  it("changes nothing but running: a question, an error, at rest", () => {
    const working = { writing: false, minutes: 4 };
    for (const state of [
      {
        kind: "ask" as const,
        line: { text: "等你回复", tone: "warning" as const },
        fromSubtask: false,
      },
      {
        kind: "error" as const,
        line: { text: "出错", tone: "error" as const },
        fromSubtask: false,
      },
      { kind: "idle" as const, line: null, fromSubtask: false },
    ]) {
      for (const open of [true, false]) {
        expect(
          assistantCardLine(state, { lastMessage, draft, open, working }, zh),
        ).toEqual(assistantCardLine(state, { lastMessage, draft, open }, zh));
      }
    }
  });
});
