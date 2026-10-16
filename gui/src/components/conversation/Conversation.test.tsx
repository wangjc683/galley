import * as Tooltip from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Conversation } from "./Conversation";
import { zhCopy } from "@/i18n/locales/zh";
import { toolEventsFromRaw } from "@/lib/agent-turn";
import { LocalFilesContext } from "@/lib/local-files";
import { userTimeMarks } from "@/lib/message-time";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

// A static render cannot click a fold header open: with `expand.all`
// set, every ExpandSection renders open (the fold sections included).
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

// One user request and one settled tool step, no closing turn: an
// incomplete run that is not running renders flat in full, so the
// step's marker and body are both in the markup.
function renderStep(step: Omit<AgentTurn, "role" | "tools">): string {
  const turns: Turn[] = [
    { role: "user", content: "帮我查一下营业时间" },
    {
      role: "agent",
      turnIndex: 1,
      tools: [{ id: "t1", name: "web_scan", status: "success-historical" }],
      ...step,
    },
  ];
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <Conversation turns={turns} />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

/** The step's marker row, up to the end of its own <div>. */
function markerRow(html: string): string {
  const start = html.indexOf('data-role="step-marker"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</div>", start));
}

/** The marker row's whole opening tag. React renders the row's role /
 * tabindex / aria-expanded ahead of its data-role, where markerRow's
 * slice would miss them. */
function markerTag(html: string): string {
  const attr = html.indexOf('data-role="step-marker"');
  expect(attr).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<", attr), html.indexOf(">", attr) + 1);
}

function narrationRows(html: string): number {
  return html.split('data-role="agent-narration"').length - 1;
}

describe("Conversation main chat greeting", () => {
  const greeting: AgentTurn = {
    role: "agent",
    tools: [],
    finalAnswer: "你好。以后有什么事，直接在这里跟我说就行。",
    turnIndex: -1,
    greeting: true,
  };
  const html = (turns: Turn[]) =>
    renderToStaticMarkup(
      <Tooltip.Provider>
        <LocalFilesContext.Provider value={() => undefined}>
          <Conversation turns={turns} />
        </LocalFilesContext.Provider>
      </Tooltip.Provider>,
    );

  // Ticket 04c: a plain AI message — no step marker, no rule, no run
  // fold — alone and with a conversation after it.
  it("renders as a plain answer, without a step, rule or fold", () => {
    for (const out of [
      html([greeting]),
      html([
        greeting,
        { role: "user", content: "早" },
        { role: "agent", tools: [], finalAnswer: "早上好", turnIndex: 1 },
      ]),
    ]) {
      expect(out).toContain("你好。以后有什么事，直接在这里跟我说就行。");
      const head = out.slice(0, out.indexOf("你好。"));
      expect(head).not.toContain('data-role="step-marker"');
      expect(head).not.toContain("<hr");
      expect(head).not.toContain('data-role="run-fold"');
    }
  });

  it("would carry a marker without the flag (the control)", () => {
    const { greeting: _flag, ...plain } = greeting;
    const out = html([plain]);
    const head = out.slice(0, out.indexOf("你好。"));
    expect(head).toContain('data-role="step-marker"');
  });
});

describe("Conversation echo-narration step", () => {
  it("puts the narration on the marker line and drops its own row", () => {
    const narration = "营业时间只在搜索摘要里，我去 `厦门网` 原文核对。";
    // GA's fallback: no `<summary>`, so the summary echoes the reply.
    const html = renderStep({ finalAnswer: narration, summary: narration });
    // Cleaned the way the sidebar cleans GA's recap: backticks out.
    expect(markerRow(html)).toContain(
      "营业时间只在搜索摘要里，我去 厦门网 原文核对。",
    );
    expect(narrationRows(html)).toBe(0);
    expect(html).not.toContain("调用了 web_scan");
  });

  it("keeps the summary and the narration row on a step with its own summary", () => {
    const html = renderStep({
      finalAnswer: "我去厦门网原文核对。",
      summary: "核对营业时间",
    });
    expect(markerRow(html)).toContain("核对营业时间");
    expect(markerRow(html)).not.toContain("我去厦门网原文核对。");
    expect(narrationRows(html)).toBe(1);
    expect(html).toContain("我去厦门网原文核对。");
  });
});

describe("Conversation step marker disclosure", () => {
  // `thinking` and `preamble` are what feed the marker's DetailPanel;
  // either one makes the row a disclosure.
  it.each([
    ["thinking", { thinking: "先看搜索摘要，再去原文核对。" }],
    ["preamble", { preamble: "当前阶段：核对营业时间" }],
  ])("makes a settled step with %s a keyboard disclosure", (_, detail) => {
    const html = renderStep({
      finalAnswer: null,
      summary: "核对营业时间",
      ...detail,
    });
    const tag = markerTag(html);
    expect(tag).toContain('role="button"');
    expect(tag).toContain('tabindex="0"');
    expect(tag).toContain('aria-expanded="false"');
    // Named by its content (sr-only step label + summary), not a label.
    expect(tag).not.toContain("aria-label");
  });

  it("leaves a settled step without detail a plain row", () => {
    const html = renderStep({ finalAnswer: null, summary: "核对营业时间" });
    const tag = markerTag(html);
    expect(tag).not.toContain('role="button"');
    expect(tag).not.toContain("tabindex");
    expect(tag).not.toContain("aria-expanded");
  });
});

describe("Conversation browser step site", () => {
  // Sanitized GA results (lib/browser-site.test.ts holds the full set).
  const scan = (tabsOnly: boolean) =>
    `{"status": "success", "metadata": {"tabs_count": 2, "tabs": [{"id": "11", "url": "https://movie.douban.com/top250", "title": "豆瓣电影 Top 250"}, {"id": "12", "url": "https://www.google.com/", "title": "Google"}], "active_tab": "11"}}` +
    (tabsOnly ? "" : "\n```html\n豆瓣电影 Top 250\n```");

  function render(
    steps: { name: string; args: Record<string, unknown>; content: string }[],
  ): string {
    const turns: Turn[] = [
      { role: "user", content: "看看豆瓣电影榜单" },
      ...steps.map(
        (step, i): Turn => ({
          role: "agent",
          turnIndex: i + 1,
          finalAnswer: null,
          summary: `第 ${i + 1} 步`,
          tools: toolEventsFromRaw(
            [{ toolName: step.name, args: step.args }],
            [{ content: step.content }],
            "t-",
          ),
        }),
      ),
    ];
    return renderToStaticMarkup(
      <Tooltip.Provider>
        <LocalFilesContext.Provider value={() => undefined}>
          <Conversation turns={turns} />
        </LocalFilesContext.Provider>
      </Tooltip.Provider>,
    );
  }

  it("puts the page title and host on a scan, the host on a script", () => {
    const html = render([
      { name: "web_scan", args: { switch_tab_id: "11" }, content: scan(false) },
      {
        name: "web_execute_js",
        args: { script: "document.title" },
        content: `{"status": "success", "js_return": "豆瓣电影 Top 250", "tab_id": "11"}`,
      },
    ]);
    expect(html).toContain("· 豆瓣电影 Top 250");
    expect(html.split("· movie.douban.com").length - 1).toBe(2);
  });

  it("counts tabs on a tab-list scan and shows nothing for an unknown tab", () => {
    const html = render([
      { name: "web_scan", args: { tabs_only: true }, content: scan(true) },
      {
        name: "web_execute_js",
        args: { script: "document.title" },
        content: `{"status": "success", "js_return": 1, "tab_id": "99"}`,
      },
    ]);
    expect(html).toContain("· 2 个标签页");
    expect(html).not.toContain("douban.com");
  });
});

describe("Conversation paged history (main-chat ticket 12)", () => {
  // The loaded part of a longer conversation: its first user message
  // was sent half an hour after the last one before the page.
  const loaded: Turn[] = [
    {
      role: "user",
      content: "接着说",
      createdAt: "2026-10-13T08:30:00.000Z",
    },
    { role: "agent", tools: [], finalAnswer: "好的", turnIndex: 1 },
  ];
  const html = (props: {
    keyBase?: number;
    previousUserCreatedAt?: string | null;
  }) =>
    renderToStaticMarkup(
      <Tooltip.Provider>
        <LocalFilesContext.Provider value={() => undefined}>
          <Conversation turns={loaded} {...props} />
        </LocalFilesContext.Provider>
      </Tooltip.Provider>,
    );

  it("measures the first loaded message's send time against the one before the page", () => {
    // No earlier message known: it is the first, so it shows its time.
    expect(html({})).toContain("<time");
    // Half an hour after the previous one: no break, as with the whole
    // conversation loaded.
    expect(
      html({ previousUserCreatedAt: "2026-10-13T08:00:00.000Z" }),
    ).not.toContain("<time");
  });

  it("renders the same whatever the key base", () => {
    expect(html({ keyBase: 37 })).toBe(html({}));
  });
});

describe("Conversation slot under a reply (main chat ticket 06a)", () => {
  const turns: Turn[] = [
    { role: "user", content: "把下载文件夹里的 PDF 按内容分类" },
    {
      role: "agent",
      tools: [{ id: "t1", name: "file_read", status: "success-historical" }],
      finalAnswer: null,
      turnIndex: 1,
      messageId: "msg_s_1_assistant",
    },
    {
      role: "agent",
      tools: [],
      finalAnswer: "交给一个子任务了，卡片里能看到进度。",
      turnIndex: 2,
      messageId: "msg_s_2_assistant",
    },
  ];
  const render = (renderAfterAnswer?: (id: string) => ReactNode) =>
    renderToStaticMarkup(
      <Tooltip.Provider>
        <LocalFilesContext.Provider value={() => undefined}>
          <Conversation turns={turns} renderAfterAnswer={renderAfterAnswer} />
        </LocalFilesContext.Provider>
      </Tooltip.Provider>,
    );

  it("hangs what the caller gives under the reply it names, after its answer", () => {
    const html = render((id) =>
      id === "msg_s_2_assistant" ? <div data-role="cards">CARDS</div> : null,
    );
    expect(html.split('data-role="cards"').length - 1).toBe(1);
    expect(html.indexOf("CARDS")).toBeGreaterThan(
      html.indexOf("交给一个子任务了"),
    );
  });

  it("renders nothing more without it", () => {
    expect(render()).toBe(render(() => null));
  });

  it("marks a subtask's instructions as the main chat's, not the user's", () => {
    const html = renderToStaticMarkup(
      <Tooltip.Provider>
        <LocalFilesContext.Provider value={() => undefined}>
          <Conversation
            turns={[
              {
                role: "user",
                content: "把下载文件夹里的 PDF 按内容分类",
                origin: { via: "subtask" },
              },
              { role: "user", content: "顺便把发票单独放" },
            ]}
          />
        </LocalFilesContext.Provider>
      </Tooltip.Provider>,
    );
    expect(html.split('aria-label="主对话派来的"').length - 1).toBe(1);
    expect(html.indexOf('aria-label="主对话派来的"')).toBeLessThan(
      html.indexOf("把下载文件夹里的 PDF"),
    );
  });
});

// ---- The workbench speaks the assistant's grammar (ticket 01) -------------

describe("the workbench's grammar (workbench conversation ticket 01)", () => {
  const at = (hour: number, minute = 0) =>
    new Date(2026, 9, 12, hour, minute).toISOString();
  let seq = 0;
  const user = (
    content: string,
    createdAt?: string,
    extra: Partial<UserTurn> = {},
  ): UserTurn => ({
    role: "user",
    content,
    createdAt,
    messageId: `u-${++seq}`,
    ...extra,
  });
  const tool = (name: string): ConversationToolEvent => ({
    id: `t-${++seq}`,
    name,
    status: "success-historical",
    args: {},
  });
  const step = (narration: string, index: number): AgentTurn => ({
    role: "agent",
    turnIndex: index,
    finalAnswer: narration,
    summary: narration,
    tools: [tool("web_scan")],
  });
  const answer = (text: string, index: number): AgentTurn => ({
    role: "agent",
    turnIndex: index,
    finalAnswer: text,
    tools: [tool("no_tool")],
    telemetry: { elapsedMs: 9_000, inputTokens: 33_000, outputTokens: 1_100 },
    messageId: `a-${++seq}`,
  });
  const ask = (question: string, index: number): AgentTurn => ({
    role: "agent",
    turnIndex: index,
    finalAnswer: null,
    summary: "问用户",
    tools: [
      {
        ...tool("ask_user"),
        args: { question, candidates: ["闽南菜", "海鲜"] },
      },
    ],
  });
  const render = (
    turns: Turn[],
    props: Partial<ComponentProps<typeof Conversation>> = {},
  ) =>
    renderToStaticMarkup(
      <Tooltip.Provider>
        <LocalFilesContext.Provider value={() => undefined}>
          <Conversation turns={turns} {...props} />
        </LocalFilesContext.Provider>
      </Tooltip.Provider>,
    );
  const count = (html: string, needle: string) => html.split(needle).length - 1;
  /** A user message's row, its opening tag to its matching close. */
  const rowOf = (html: string, content: string) => {
    // The bubble's text span (the content may also be a candidate of a
    // question above it).
    const at = html.search(
      new RegExp(`break-words[^"]*">${content.split("\n")[0]}`),
    );
    expect(at).toBeGreaterThan(-1);
    const start = html.lastIndexOf('<div class="group relative', at);
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    const tags = /<div\b|<\/div>/g;
    tags.lastIndex = start;
    for (let m = tags.exec(html); m; m = tags.exec(html)) {
      depth += m[0] === "</div>" ? -1 : 1;
      if (depth === 0) return html.slice(start, m.index + 6);
    }
    throw new Error("unbalanced row");
  };

  const ROW =
    'class="group relative mt-5 mb-7.5 mr-[clamp(0px,calc(8px-(100cqw-var(--conversation-column,100cqw))/2),8px)]"';
  const CHIP_ROW =
    'class="absolute top-full right-0 z-10 mt-1.5 flex h-6 items-center gap-1"';
  const HIDDEN = "pointer-events-none opacity-0";
  const INPUT = `aria-label="${zhCopy.conversation.telemetryInputTip("33k")}"`;

  it("puts your words on the right, capped as in the assistant's, kept off the rail", () => {
    const html = render([user("帮我查一下天气", at(9)), answer("多云。", 1)]);
    const row = rowOf(html, "帮我查一下天气");
    expect(row.startsWith(`<div ${ROW}>`)).toBe(true);
    const bubble = row.slice(row.indexOf('data-role="user-msg"'));
    expect(bubble.slice(0, bubble.indexOf(">"))).toContain(
      "ml-auto max-w-[min(80%,560px)]",
    );
    expect(row).not.toContain("max-w-full");
    // No selection scope: the workbench copies by hovering.
    expect(row).not.toContain("data-selection-copy-scope");
  });

  it("hangs the hover copy under the bubble, right edges flush, hidden but in its place", () => {
    const html = render([user("帮我查一下天气", at(9)), answer("多云。", 1)]);
    const row = rowOf(html, "帮我查一下天气");
    // After the bubble, inside the row, in its bottom margin.
    expect(row.indexOf(CHIP_ROW)).toBeGreaterThan(
      row.indexOf("帮我查一下天气"),
    );
    const chip = row.slice(row.indexOf(CHIP_ROW));
    const tag = chip.slice(
      chip.indexOf("<button"),
      chip.indexOf(">", chip.indexOf("<button")),
    );
    expect(tag).toContain(`aria-label="${zhCopy.conversation.copy}"`);
    expect(tag).toContain(HIDDEN);
    expect(tag).toContain('aria-hidden="true"');
    // Not beside the bubble any more.
    expect(html).not.toContain("left-full");
  });

  it("puts a long message's expand toggle in the copy row, outermost on the right", () => {
    const long = Array.from({ length: 9 }, (_, i) => `第 ${i + 1} 行`).join(
      "\n",
    );
    const html = render([user(long, at(9)), answer("好。", 1)]);
    const row = rowOf(html, "第 1 行");
    const chips = row.slice(row.indexOf(CHIP_ROW));
    const copy = chips.indexOf(`aria-label="${zhCopy.conversation.copy}"`);
    const toggle = chips.indexOf(zhCopy.conversation.expandLines(9));
    expect(copy).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(copy);
    // One row under the bubble, not a toggle row of its own.
    expect(row).not.toContain('<div class="mt-1');
  });

  it("draws the send time as a centred line before the row, the provenance above the bubble on the right", () => {
    const turns: Turn[] = [
      user("把 PDF 分类", at(9), { origin: { via: "subtask" } }),
      answer("分好了。", 1),
      // Within the hour, but a Supervisor message always shows its time.
      user("发票按月份分", at(9, 4), {
        origin: { via: "supervisor", supervisor: "galley-assistant" },
      }),
      answer("分好了。", 1),
      user("谢谢", at(9, 6)),
      answer("不客气。", 1),
    ];
    const html = render(turns);
    const pinned = [...userTimeMarks(turns).values()].filter((m) => m.pinned);
    expect(pinned).toHaveLength(2);
    expect(count(html, 'data-role="message-time-divider"')).toBe(2);
    expect(count(html, "<time")).toBe(2);
    // The lines sit outside the rows; the rows hold no time.
    for (const content of ["把 PDF 分类", "发票按月份分", "谢谢"]) {
      expect(rowOf(html, content)).not.toContain("<time");
    }
    const supervisor = rowOf(html, "发票按月份分");
    expect(
      html.lastIndexOf(
        'data-role="message-time-divider"',
        html.indexOf(supervisor),
      ),
    ).toBeGreaterThan(html.indexOf("分好了。"));
    expect(supervisor).toContain(
      '<div class="mb-1 flex items-center gap-1.5 justify-end">',
    );
    expect(
      supervisor.indexOf(zhCopy.conversation.supervisorMessage),
    ).toBeLessThan(supervisor.indexOf('data-role="user-msg"'));
    expect(rowOf(html, "把 PDF 分类")).toContain(
      `aria-label="${zhCopy.subtask.fromMainChat}"`,
    );
  });

  it("adds nothing above a time line right under a reply, 16px at the top", () => {
    const html = render([
      user("早", at(9)),
      answer("早。", 1),
      user("下午好", at(15)),
      answer("下午好。", 1),
    ]);
    const lines = [
      ...html.matchAll(/data-role="message-time-divider" class="([^"]*)"/g),
    ].map((m) => m[1]);
    expect(lines).toEqual([
      "flex justify-center my-4",
      "flex justify-center mb-4",
    ]);
  });

  it("measures the first loaded message against the one before the page", () => {
    const turns: Turn[] = [user("接着说", at(9, 30)), answer("好的", 1)];
    expect(count(render(turns), 'data-role="message-time-divider"')).toBe(1);
    expect(
      count(
        render(turns, { previousUserCreatedAt: at(9) }),
        'data-role="message-time-divider"',
      ),
    ).toBe(0);
    expect(
      count(
        render(turns, { previousUserCreatedAt: at(7) }),
        'data-role="message-time-divider"',
      ),
    ).toBe(1);
  });

  it("draws a one-step reply alone: no fold header, step marker or rule; its tokens still in the hover row", () => {
    expand.all = true;
    const html = render([user("早", at(9)), answer("早，今天多云。", 1)]);
    expect(html).not.toContain('data-role="run-fold"');
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toContain("<hr");
    expect(html).toContain("早，今天多云。");
    expect(html).toContain(INPUT);
  });

  it("keeps the fold header, and the rule behind it, from two steps up", () => {
    expand.all = true;
    const html = render([
      user("排个行程", at(9)),
      step("我先查一下船票。", 1),
      answer("排好了。", 2),
    ]);
    expect(count(html, 'data-role="run-fold"')).toBe(1);
    expect(count(html, 'data-role="step-marker"')).toBe(2);
    expect(count(html, "<hr")).toBe(1);
    expect(html.indexOf("<hr")).toBeLessThan(html.indexOf("排好了。"));
  });

  it("folds a two-step run behind its header and a one-step one not at all, side by side", () => {
    const html = render([
      user("早", at(9)),
      answer("早。", 1),
      user("排个行程", at(9, 1)),
      step("我先查一下船票。", 1),
      answer("排好了。", 2),
      user("谢谢", at(9, 2)),
      answer("不客气。", 1),
    ]);
    expect(count(html, 'data-role="run-fold"')).toBe(1);
    const header = html.indexOf('data-role="run-fold"');
    expect(header).toBeGreaterThan(html.indexOf("排个行程"));
    expect(header).toBeLessThan(html.indexOf("排好了。"));
  });

  it("unfolds a run without an answer in full, as before", () => {
    const html = render([
      user("订船票", at(9)),
      step("我先看船班。", 1),
      step("我点进 8:30 那一班。", 2),
    ]);
    expect(html).not.toContain('data-role="run-fold"');
    expect(count(html, 'data-role="step-marker"')).toBe(2);
    expect(html).toContain("absolute bottom-0 left-[5px] w-px bg-line");
  });

  it("puts the answer to a question on the right too, the question on the left", () => {
    expand.all = true;
    const html = render([
      user("订晚饭", at(9)),
      ask("晚饭想吃哪一类？", 1),
      user("闽南菜", at(9, 1)),
      answer("订好了。", 2),
    ]);
    const reply = rowOf(html, "闽南菜");
    expect(reply).toContain('data-role="user-msg-reply"');
    expect(reply).toContain("ml-auto max-w-[min(80%,560px)]");
    expect(html).toContain('data-role="answered-ask-user"');
    expect(html).not.toContain('data-role="assistant-bubble"');
  });
});
