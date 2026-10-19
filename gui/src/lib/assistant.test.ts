import { describe, expect, it } from "vitest";

import {
  type AssistantStateInput,
  assistantCardLine,
  assistantState,
  lastVisibleMessage,
  plainLine,
} from "@/lib/assistant";
import { copyForLanguage } from "@/lib/i18n";
import type {
  AgentTurn,
  MessageAttachment,
  SystemTurn,
  Turn,
  UserTurn,
} from "@/types/conversation";

const zh = copyForLanguage("zh-CN");
const en = copyForLanguage("en-US");

const base: AssistantStateInput = {
  status: "idle",
  hasPendingAskUser: false,
  open: false,
  sentence: "我查一下厦门明天的天气。",
};
const state = (input: Partial<AssistantStateInput> = {}, copy = zh) =>
  assistantState({ ...base, ...input }, copy);

const user = (content: string, extra: Partial<UserTurn> = {}): UserTurn => ({
  role: "user",
  content,
  messageId: `u-${content}`,
  createdAt: "2026-10-14T03:50:00.000Z",
  ...extra,
});
const reply = (finalAnswer: string | null, extra: Partial<AgentTurn> = {}) =>
  ({
    role: "agent",
    tools: [],
    finalAnswer,
    turnIndex: 1,
    ...extra,
  }) as AgentTurn;
const image = (id: string): MessageAttachment => ({
  id,
  messageId: "u",
  sessionId: "s-main",
  kind: "image",
  path: `/tmp/${id}.png`,
  mimeType: "image/png",
  byteSize: 4,
  createdAt: "2026-10-14T03:50:00.000Z",
});

describe("the assistant's state, in a session row's priority", () => {
  it("puts an error over a question over running over a new reply", () => {
    expect(state().kind).toBe("idle");
    expect(state({ hasUnread: true }).kind).toBe("unread");
    expect(state({ hasUnread: true, open: true }).kind).toBe("idle");
    expect(state({ status: "running", hasUnread: true }).kind).toBe("running");
    expect(state({ status: "running", hasPendingAskUser: true }).kind).toBe(
      "ask",
    );
    expect(state({ status: "running", subtaskState: "ask" }).kind).toBe("ask");
    expect(state({ hasPendingAskUser: true, subtaskState: "error" }).kind).toBe(
      "error",
    );
    expect(state({ status: "error", subtaskState: "ask" }).kind).toBe("error");
    // A stop or a step-cap pause is nothing: back to the last message.
    expect(state({ status: "cancelled" }).kind).toBe("idle");
  });

  it("words the state for the header: its own ahead of a subtask's, nothing at rest", () => {
    // Running: the sentence the conversation's line says, else 「思考中」
    // (ruling 68) — never a step count.
    expect(state({ status: "running" }).line).toEqual({
      text: "我查一下厦门明天的天气。",
      tone: "running",
    });
    for (const sentence of [null, undefined, ""]) {
      expect(state({ status: "running", sentence }).line).toEqual({
        text: "思考中",
        tone: "running",
      });
    }
    expect(state({ status: "running", sentence: null }, en).line?.text).toBe(
      "Thinking",
    );
    // The header, while it writes words (ruling 104): 「正在输入…」, the
    // same running tone; 「思考中」 the rest of the time.
    expect(
      state({ status: "running", sentence: null, writing: true }).line,
    ).toEqual({
      text: "正在输入…",
      tone: "running",
    });
    expect(
      state({ status: "running", sentence: null, writing: false }).line?.text,
    ).toBe("思考中");
    expect(
      state({ status: "running", sentence: null, writing: true }, en).line
        ?.text,
    ).toBe("Typing…");
    // Not running, writing says nothing: a question, an error, rest.
    expect(state({ hasPendingAskUser: true, writing: true }).line?.text).toBe(
      "等你回复",
    );
    expect(state({ status: "error", writing: true }).line?.text).toBe("出错");
    expect(state({ writing: true }).line).toBeNull();
    expect(state({ status: "error", errorCount: 3 }).line?.text).toBe(
      "出错 · 3",
    );
    expect(state({ subtaskState: "error" }).line?.text).toBe("子任务出错");
    expect(state({ subtaskState: "error" }).fromSubtask).toBe(true);
    expect(state({ hasPendingAskUser: true }).line?.text).toBe("等你回复");
    expect(
      state({ hasPendingAskUser: true, subtaskState: "ask" }).fromSubtask,
    ).toBe(false);
    expect(state({ subtaskState: "ask" }).line?.text).toBe("子任务在问你");
    expect(state({ hasUnread: true }).line).toBeNull();
    expect(state().line).toBeNull();
  });
});

describe("the card's second line: error > question > running > draft > last message", () => {
  const last = { fromUser: false, text: "好的，明早九点提醒你。" };
  const draft = { text: "下周三的会", imageCount: 0 };
  const line = (
    input: Partial<AssistantStateInput>,
    extra: Partial<Parameters<typeof assistantCardLine>[1]> = {},
  ) =>
    assistantCardLine(
      state(input),
      {
        question: "去哪个花市？",
        draft,
        lastMessage: last,
        open: false,
        ...extra,
      },
      zh,
    );

  it("says an error first", () => {
    expect(line({ status: "error", hasPendingAskUser: true })).toEqual({
      kind: "error",
      text: "出错",
    });
    expect(line({ subtaskState: "error" })).toEqual({
      kind: "error",
      text: "子任务出错",
    });
  });

  it("quotes the question after 「等你回复：」, or says 「等你回复」 without it", () => {
    expect(line({ hasPendingAskUser: true, status: "running" })).toEqual({
      kind: "ask",
      prefix: "等你回复：",
      text: "去哪个花市？",
    });
    for (const question of [null, "", "  "]) {
      expect(line({ hasPendingAskUser: true }, { question })).toEqual({
        kind: "ask",
        prefix: null,
        text: "等你回复",
      });
    }
    // A subtask's question is the subtask's to quote.
    expect(line({ subtaskState: "ask" })).toEqual({
      kind: "ask",
      prefix: null,
      text: "子任务在问你",
    });
    // The question runs on in one plain line.
    expect(
      line(
        { hasPendingAskUser: true },
        { question: "**哪天**出发？\n- 周五\n- 周六" },
      ),
    ).toMatchObject({ text: "哪天出发？ 周五 周六" });
  });

  // Ruling 104 (ticket 52), overturning ruling 87's 2nd and 3rd points:
  // with the main chat on screen the card is the list's selected row and
  // says the last message whatever the state; the avatar and the name
  // carry the state.
  it("says only the last message with the main chat on screen, whatever the state", () => {
    const message = {
      kind: "message",
      prefix: null,
      text: "好的，明早九点提醒你。",
    };
    const states: Partial<AssistantStateInput>[] = [
      { status: "running" },
      { status: "running", sentence: null },
      { status: "running", writing: true },
      { status: "error", errorCount: 3 },
      { subtaskState: "ask" },
      { subtaskState: "error" },
      { status: "running", subtaskState: "ask" },
      { hasUnread: true },
      {},
    ];
    for (const input of states) {
      // A draft waits in the composer right there, too.
      expect(line(input, { open: true })).toEqual(message);
    }
    // 「你：」 as at rest.
    expect(
      line(
        { status: "running" },
        { open: true, lastMessage: { fromUser: true, text: "订周五的票" } },
      ),
    ).toEqual({ kind: "message", prefix: "你：", text: "订周五的票" });
    // Nothing said yet: no second line (the name sits centred).
    expect(
      line({ status: "running" }, { open: true, lastMessage: null }),
    ).toBeNull();
  });

  it("says the question it asks as its last message with the main chat on screen", () => {
    // What it asked is what it said: the question, plain, no 「等你回复：」
    // — even when the asking step's own words are the last message.
    expect(
      line(
        { hasPendingAskUser: true, status: "running" },
        {
          open: true,
          question: "**哪天**出发？",
          lastMessage: { fromUser: false, text: "我先确认一下日期。" },
        },
      ),
    ).toEqual({ kind: "message", prefix: null, text: "哪天出发？" });
    // Without the question at hand: the last message.
    for (const question of [null, "", "  "]) {
      expect(
        line({ hasPendingAskUser: true }, { open: true, question }),
      ).toEqual({
        kind: "message",
        prefix: null,
        text: "好的，明早九点提醒你。",
      });
    }
    // A subtask's question is the subtask's: the last message.
    expect(
      line({ subtaskState: "ask" }, { open: true, question: "这个不是它的" }),
    ).toEqual({
      kind: "message",
      prefix: null,
      text: "好的，明早九点提醒你。",
    });
    // Its own error outranks its question: the last message too.
    expect(
      line(
        { status: "error", hasPendingAskUser: true },
        { open: true, question: "哪天出发？" },
      ),
    ).toMatchObject({ kind: "message", text: "好的，明早九点提醒你。" });
  });

  it("writes it all out while the main chat is not on screen, as before", () => {
    expect(line({ status: "running" })).toEqual({
      kind: "running",
      text: "我查一下厦门明天的天气。",
    });
    expect(line({ status: "running", sentence: null })).toEqual({
      kind: "running",
      text: "思考中",
    });
    expect(line({ hasPendingAskUser: true })).toEqual({
      kind: "ask",
      prefix: "等你回复：",
      text: "去哪个花市？",
    });
    expect(line({ status: "error" })).toEqual({ kind: "error", text: "出错" });
    expect(line({ subtaskState: "ask" })).toMatchObject({
      text: "子任务在问你",
    });
    expect(line({ subtaskState: "error" })).toMatchObject({
      text: "子任务出错",
    });
    expect(line({})).toMatchObject({ kind: "draft", text: "下周三的会" });
  });

  it("says what the conversation's line says while it runs, 「思考中」 before it says anything", () => {
    expect(line({ status: "running" })).toEqual({
      kind: "running",
      text: "我查一下厦门明天的天气。",
    });
    expect(line({ status: "running", sentence: null })).toEqual({
      kind: "running",
      text: "思考中",
    });
  });

  it("shows an unsent draft only while the assistant is not open", () => {
    expect(line({})).toEqual({
      kind: "draft",
      prefix: "草稿：",
      text: "下周三的会",
    });
    expect(line({ hasUnread: true })).toMatchObject({ kind: "draft" });
    expect(line({}, { draft: { text: "", imageCount: 2 } })).toEqual({
      kind: "draft",
      prefix: "草稿：",
      text: "[图片]",
    });
    // Open, the draft is in the composer right there.
    expect(line({}, { open: true })).toEqual({
      kind: "message",
      prefix: null,
      text: "好的，明早九点提醒你。",
    });
  });

  it("falls back to the last message, 「你：」 before the user's own", () => {
    expect(line({}, { draft: null })).toEqual({
      kind: "message",
      prefix: null,
      text: "好的，明早九点提醒你。",
    });
    expect(
      line(
        {},
        { draft: null, lastMessage: { fromUser: true, text: "订周五的票" } },
      ),
    ).toEqual({ kind: "message", prefix: "你：", text: "订周五的票" });
    expect(line({}, { draft: null, lastMessage: null })).toBeNull();
  });

  it("speaks English in the English UI", () => {
    const draftLine = assistantCardLine(
      state(),
      { draft, lastMessage: null, open: false },
      en,
    );
    expect(draftLine).toMatchObject({ prefix: "Draft: " });
    const asking = assistantCardLine(
      assistantState({ ...base, hasPendingAskUser: true }, en),
      { question: "Which day?", open: false },
      en,
    );
    expect(asking).toEqual({
      kind: "ask",
      prefix: "Waiting for you: ",
      text: "Which day?",
    });
    expect(
      assistantCardLine(
        state(),
        { lastMessage: { fromUser: true, text: "Book it" }, open: false },
        en,
      ),
    ).toMatchObject({ prefix: "You: " });
  });
});

describe("the last visible message", () => {
  it("is the assistant's greeting on the first open: a message too", () => {
    const greeting = reply(
      "你好。以后有什么事，直接在这里跟我说就行，不用再想是开新对话还是接着哪个旧的。",
      { greeting: true },
    );
    expect(lastVisibleMessage([greeting], zh)).toEqual({
      fromUser: false,
      text: "你好。以后有什么事，直接在这里跟我说就行，不用再想是开新对话还是接着哪个旧的。",
    });
  });

  it("puts the user's own words, with what they attached, and their send time", () => {
    const sent = user("这是什么花？\n\n  在花市拍的", {
      attachments: [image("a"), image("b")],
    });
    expect(lastVisibleMessage([reply("早"), sent], zh)).toEqual({
      fromUser: true,
      text: "[图片] 这是什么花？ 在花市拍的",
      sentAt: "2026-10-14T03:50:00.000Z",
    });
    const file: MessageAttachment = {
      ...image("c"),
      kind: "file",
      path: "/tmp/downloads/报价单.pdf",
    };
    expect(
      lastVisibleMessage([user("", { attachments: [file] })], zh)?.text,
    ).toBe("[文件] 报价单.pdf");
    // An optimistic send (no row id yet) is the user's message already.
    expect(
      lastVisibleMessage(
        [
          reply("早"),
          user("刚发的", { messageId: undefined, clientRequestId: "c1" }),
        ],
        zh,
      )?.text,
    ).toBe("刚发的");
  });

  it("flattens a reply's markdown and names the files it pointed at", () => {
    const answer = [
      "## 结论",
      "",
      "明天**多云**，22–27 度，见 [天气网](https://example.com)。",
      "",
      "- 早上 *有雾*",
      "- 带上 `umbrella_v2`",
      "",
      "| 时段 | 天气 |",
      "| --- | --- |",
      "| 上午 | 雾 |",
    ].join("\n");
    expect(
      lastVisibleMessage(
        [reply(answer, { files: ["/tmp/out/forecast.png", "C:\\out\\r.pdf"] })],
        zh,
      )?.text,
    ).toBe(
      "结论 明天多云，22–27 度，见 天气网。 早上 有雾 带上 umbrella_v2 时段 天气 上午 雾 [文件] forecast.png [文件] r.pdf",
    );
  });

  it("skips what is not a message: tool-only steps, /btw, narration", () => {
    const step = reply(null, {
      tools: [{ id: "t1", name: "web_scan", status: "success-historical" }],
    });
    const btwQuestion: UserTurn = { role: "user", content: "/btw 几点了" };
    const btwReply: SystemTurn = {
      role: "system",
      content: "三点",
      variant: "side_question",
    };
    const narration: SystemTurn = {
      role: "system",
      content: "checkpoint",
      variant: "narration",
    };
    const turns: Turn[] = [
      user("查天气"),
      reply("晴"),
      step,
      btwQuestion,
      btwReply,
      narration,
    ];
    expect(lastVisibleMessage(turns, zh)).toEqual({
      fromUser: false,
      text: "晴",
    });
    expect(lastVisibleMessage([], zh)).toBeNull();
    expect(lastVisibleMessage([step], zh)).toBeNull();
  });

  it("counts a question the assistant asked as what it said", () => {
    const asked = reply(null, {
      tools: [
        {
          id: "t1",
          name: "ask_user",
          status: "success-historical",
          args: {
            question: "哪天<summary>问日期</summary>出发？",
            candidates: [],
          },
        },
      ],
    });
    expect(lastVisibleMessage([user("订票"), asked], zh)).toEqual({
      fromUser: false,
      text: "哪天出发？",
    });
    // Answered, the answer is the last message.
    expect(
      lastVisibleMessage([user("订票"), asked, user("周五")], zh)?.text,
    ).toBe("周五");
  });

  // Ticket 31: a subtask report wakes the main chat with a row of its
  // own, and the reply may say nothing (`<no-reply/>`). Neither is a
  // message: the card says the one before, with its own time.
  it("skips a subtask report and a reply that said nothing, keeping that message's time", () => {
    const report = user("[Galley — not a message from the user] …", {
      messageId: "u-report",
      createdAt: "2026-10-14T06:00:00.000Z",
      origin: { via: "system", supervisor: "galley-report", reason: "s-sub" },
    });
    const sendBack = reply("我让它再查一家。", {
      tools: [{ id: "c", name: "code_run", status: "success-historical" }],
      settledAt: "2026-10-14T06:00:20.000Z",
    });
    const silent = reply(null, {
      silent: true,
      settledAt: "2026-10-14T06:00:30.000Z",
    });
    const earlier = reply("好，交给子任务了。", {
      settledAt: "2026-10-14T03:51:00.000Z",
    });
    expect(
      lastVisibleMessage(
        [user("帮我比价"), earlier, report, sendBack, silent],
        zh,
      ),
    ).toEqual({
      fromUser: false,
      text: "好，交给子任务了。",
      sentAt: "2026-10-14T03:51:00.000Z",
    });
    // The user's own message before it, with its send time.
    expect(
      lastVisibleMessage([user("帮我比价"), report, sendBack, silent], zh),
    ).toEqual({
      fromUser: true,
      text: "帮我比价",
      sentAt: "2026-10-14T03:50:00.000Z",
    });
    // A report round that answered: its reply is the last message.
    const told = reply("查好了：第二家最便宜。", {
      settledAt: "2026-10-14T06:01:00.000Z",
    });
    expect(
      lastVisibleMessage([user("帮我比价"), earlier, report, told], zh),
    ).toEqual({
      fromUser: false,
      text: "查好了：第二家最便宜。",
      sentAt: "2026-10-14T06:01:00.000Z",
    });
  });
});

describe("markdown as one plain line", () => {
  it("drops marks, keeps words and code as written", () => {
    expect(plainLine("# 标题\n> 引用里 **粗** 和 _斜_ 和 ~~删~~", zh)).toBe(
      "标题 引用里 粗 和 斜 和 删",
    );
    expect(plainLine("snake_case_name 与 2 * 3 * 4 不动", zh)).toBe(
      "snake_case_name 与 2 * 3 * 4 不动",
    );
    expect(plainLine("```ts\nconst a = b * c; // *x*\n```", zh)).toBe(
      "const a = b * c; // *x*",
    );
    expect(plainLine("用 `__init__` 和 `**kw`", zh)).toBe(
      "用 __init__ 和 **kw",
    );
    expect(plainLine("1. 一\n2. 二\n- [x] 完成", zh)).toBe("一 二 完成");
    expect(plainLine("前\n\n---\n\n后", zh)).toBe("前 后");
  });

  it("keeps a link's text, names images and file markers", () => {
    expect(plainLine("看 ![图](a.png) 和 [文档](https://x.y)", zh)).toBe(
      "看 [图片] 和 文档",
    );
    expect(plainLine("做好了：[FILE:/tmp/out/x.png]", zh)).toBe(
      "做好了：[文件] x.png",
    );
    expect(plainLine("Done: [FILE:/tmp/r.pdf] ![p](q.png)", en)).toBe(
      "Done: [File] r.pdf [Image]",
    );
    expect(plainLine("换行<br>之后 <b>粗</b>", zh)).toBe("换行 之后 粗");
  });

  it("collapses whitespace and returns nothing for nothing", () => {
    expect(plainLine("  a\n\n\tb  ", zh)).toBe("a b");
    expect(plainLine("", zh)).toBe("");
    expect(plainLine("```\n```", zh)).toBe("");
  });
});

describe("quotes in the card's line (telegram-details ticket 07)", () => {
  it("says your own words, not the quotes a message opens with", () => {
    expect(
      lastVisibleMessage([user("> 第一处\n\n> 第二处\n\n这两处什么意思")], zh)
        ?.text,
    ).toBe("这两处什么意思");
  });

  it("says 「[引用]」 for a message that is quotes only", () => {
    expect(lastVisibleMessage([user("> 只有引用")], zh)?.text).toBe("[引用]");
    expect(lastVisibleMessage([user("> only a quote")], en)?.text).toBe(
      "[Quote]",
    );
  });

  it("says a draft's words, or 「[引用]」 when it holds only quotes", () => {
    const line = (draft: Parameters<typeof assistantCardLine>[1]["draft"]) =>
      assistantCardLine(state(), { draft, open: false }, zh);
    expect(line({ text: "接着写", imageCount: 0, quoteCount: 2 })).toEqual({
      kind: "draft",
      prefix: "草稿：",
      text: "接着写",
    });
    expect(line({ text: "", imageCount: 0, quoteCount: 1 })).toEqual({
      kind: "draft",
      prefix: "草稿：",
      text: "[引用]",
    });
    expect(line({ text: "", imageCount: 1, quoteCount: 1 })?.text).toBe(
      "[图片]",
    );
  });
});
