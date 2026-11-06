import * as Tooltip from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Conversation } from "./Conversation";
import { zhCopy } from "@/i18n/locales/zh";
import { CopyProvider } from "@/lib/i18n";
import { LocalFilesContext } from "@/lib/local-files";
import { userTimeMarks } from "@/lib/message-time";
import { rowsToTurns } from "@/stores/messages/rowsToTurns";
import {
  DISPATCH_REPLY_ID,
  dispatchRoundRows,
  EARLIER_REPLY,
  STEP_ONE_SUMMARY,
  STEP_TWO_SUMMARY,
} from "@/test/dispatch-round";
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

/** A reply's action bar in the assistant's conversation: beside its
 * bubble, out of flow (ruling 199). */
const BAR = 'class="absolute bottom-0 left-full flex w-max items-center pl-1.5';
/** The workbench's: under its answer, in flow. */
const WORKBENCH_BAR =
  'class="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1';
/** The reply bubble's cap (AssistantParts `ASSISTANT_BUBBLE_MAX`). */
const CAP = "max-w-[calc(100%-134px)]";
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

// Ruling 199 is the main chat's alone: the workbench keeps every gap and
// both hover rows where they were.
describe("the workbench: spacing and hover rows untouched by ruling 199", () => {
  it("keeps 30px under each bubble of yours and each reply, the bars under them, in flow", () => {
    const turns: Turn[] = [
      ...conversation().slice(1),
      user("晚上好", at(21)),
      answer("晚上好。", 1),
    ];
    const html = render(turns, { messageMenu: MENU });
    // Your rows: 20px above, the copy row's 30px under (mb-7.5), the
    // rail's inset; the copy under the bubble, its hit band over the
    // margin; nothing beside the bubble.
    const rows = [...html.matchAll(/<div class="group relative ([^"]*)"/g)].map(
      (m) => m[1].replace(/ mr-\[.*$/, ""),
    );
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row).toBe("mt-5 mb-7.5");
    expect(count(html, WORKBENCH_CHIP_ROW)).toBe(6);
    expect(
      count(
        html,
        '<span aria-hidden="true" class="absolute inset-x-0 top-full h-7.5"></span>',
      ),
    ).toBe(6);
    expect(html).not.toContain(CHIP_ROW);
    // The replies' bars: under the answer, in flow, the numbers after
    // them; none beside anything, no bubble, no cap.
    expect(count(html, WORKBENCH_BAR)).toBe(5);
    expect(html).not.toContain(BAR);
    expect(html).not.toContain("left-full");
    expect(html).not.toContain("right-full");
    expect(html).not.toContain(CAP);
    expect(html).not.toContain('data-role="assistant-bubble"');
    // Each bar the last thing of its answer's row, after the prose.
    const answers = html.split('class="group/answer"').slice(1);
    expect(answers).toHaveLength(5);
    for (const row of answers) {
      const bar = row.indexOf(WORKBENCH_BAR);
      expect(bar).toBeGreaterThan(row.indexOf("<p"));
      expect(row.indexOf("<p")).toBeGreaterThan(-1);
    }
    // No IM gaps and no tail mark.
    expect(html).not.toMatch(/class="group\/answer mt-/);
    expect(html).not.toContain("data-last-side");
    expect(html).not.toContain('class="peer"');
    // A time line right under a reply adds nothing above: the bar's
    // 30px is the gap.
    const lines = [
      ...html.matchAll(/data-role="message-time-divider" class="([^"]*)"/g),
    ].map((m) => m[1]);
    expect(lines[lines.length - 1]).toBe("flex justify-center mb-4");
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
    expect(html).toContain(CAP);
    expect(html).not.toContain("max-w-[88%]");
    expect(html).toContain("bg-assistant-tint");
    const first = html.indexOf('data-role="assistant-bubble"');
    expect(html.indexOf("你好。以后有什么事")).toBeGreaterThan(first);
    // Each of the user's bubbles is still a selection-copy scope (ruling
    // 73's floating copy stays beside its hover row, ruling 105); ticket
    // 20's chip beside it (ruling 73 took it away) does not come back.
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
    // The assistant's bubbles have their chips beside them since ruling
    // 199 (under them before, ruling 105), and not the inset the question
    // rail asks for (it has no rail).
    const im = assistant(conversation());
    expect(count(im, "absolute top-full right-0 z-10 mt-1.5")).toBe(0);
    expect(count(im, CHIP_ROW)).toBe(5);
    expect(im).not.toContain("100cqw");
  });

  it("spaces the bubbles as an IM: 4px within a side, 16px across (ruling 199)", () => {
    const told: AgentTurn = {
      role: "agent",
      turnIndex: 2,
      finalAnswer: "小票看清了，在记。",
      tools: [],
      interim: true,
      messageId: "t-小票",
    };
    const turns: Turn[] = [
      user("这张小票帮我记一下账", at(8)),
      user("还有打车 46", at(8, 1)),
      user("午饭 32", at(8, 1)),
      step("我先看小票。", 1),
      told,
      step("我记一下打车。", 3),
      answer("记好了。", 4),
      user("谢谢", at(8, 3)),
    ];
    const html = assistant(turns);
    const rows = [...html.matchAll(/class="group relative ([^"]*)"/g)].map(
      (m) => m[1],
    );
    // Your rows: the first under its centred time (20px), two of yours
    // 4px apart, then 16px after its reply. No bottom margin: the chips
    // beside the bubble reserve nothing under it.
    expect(rows).toEqual(["mt-5", "mt-1", "mt-1", "mt-4"]);
    expect(html).not.toContain("mb-7.5");
    // Its rows: 16px under your bubble, then 4px — the line it told
    // mid-run, the reply after it.
    const answers = [...html.matchAll(/class="group\/answer ([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(answers).toEqual(["mt-4", "mt-1"]);
    expect(html).not.toContain('class="group/answer mt-0"');
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

  it("holds the subtask cards right under the reply bubble, at its width, the action row beside the bubble", () => {
    const html = assistant(conversation(), { renderAfterAnswer: cards });
    const at = html.indexOf('data-role="subtask-cards"');
    expect(at).toBeGreaterThan(html.indexOf("排好了。"));
    // Inside the reply's group, after its bubble — and the bubble's
    // action row, which hangs beside the bubble (ruling 199).
    const group = html.lastIndexOf('class="group/answer', at);
    expect(group).toBeGreaterThan(-1);
    const reply = html.slice(group, at);
    expect(reply).toContain("排好了。");
    expect(reply.indexOf(BAR)).toBeGreaterThan(reply.indexOf("排好了。"));
    expect(reply.lastIndexOf('data-role="assistant-bubble"')).toBeLessThan(
      reply.indexOf(BAR),
    );
    expect(html.slice(at - 80, at)).toContain(CAP);
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

// ---- The chips beside your bubble (ticket 53, PRD rulings 105, 199) -----

/** The main chat's message menu, as MainView hands it over. */
const MENU = {
  running: false,
  asking: false,
  hasSubtasks: () => false,
  onQuote: () => {},
  onDelete: () => {},
};

/** Your bubble's chips in the assistant's conversation: beside it on its
 * left, out of flow (ruling 199). */
const CHIP_ROW =
  'class="absolute right-full bottom-0 flex w-max items-center gap-0.5 pr-1.5"';
/** The workbench's copy: under the bubble, in the row's bottom margin. */
const WORKBENCH_CHIP_ROW =
  'class="absolute top-full right-0 z-10 mt-1.5 flex h-6 items-center gap-1"';

/** The whole row (MessageUser's outer div) holding `content`. */
function rowOf(html: string, content: string): string {
  const at = html.indexOf(content);
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
}

/** The `<button>` tags of a row's chips, in order. */
function chipTags(row: string): string[] {
  const at = row.indexOf(CHIP_ROW);
  const chips = row.slice(at > -1 ? at : row.indexOf(WORKBENCH_CHIP_ROW));
  return [...chips.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
}

/** The bubble (`data-role="user-msg"`…) inside a row, whole. */
function bubbleOf(row: string): string {
  const start = row.indexOf("<div data-role=");
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = start;
  for (let m = tags.exec(row); m; m = tags.exec(row)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return row.slice(start, m.index + 6);
  }
  throw new Error("unbalanced bubble");
}

const label = (tag: string) => /aria-label="([^"]*)"/.exec(tag)?.[1];

describe("the assistant's conversation: the chips beside your bubble", () => {
  const words = zhCopy.conversation;

  it("puts copy · quote · ⋯ beside your bubble on its left, out of flow, hidden but in its place", () => {
    const html = assistant(conversation(), { messageMenu: MENU });
    const row = rowOf(html, "帮我排个行程");
    // The bubble's last child, after its words: off its left edge, its
    // bottom edge on the bubble's, 6px off (its own right padding).
    const bubble = bubbleOf(row);
    expect(bubble.indexOf(CHIP_ROW)).toBeGreaterThan(
      bubble.indexOf("帮我排个行程"),
    );
    expect(CHIP_ROW).toContain("absolute right-full bottom-0");
    expect(CHIP_ROW).toContain("pr-1.5");
    // Nothing of them under the bubble any more.
    expect(row).not.toContain(WORKBENCH_CHIP_ROW);
    expect(row).not.toContain("top-full");
    const tags = chipTags(row);
    // The menu's order, ⋯ last (ruling 99).
    expect(tags.map(label)).toEqual([
      words.copy,
      words.quoteSelection,
      zhCopy.common.more,
    ]);
    for (const tag of tags) {
      expect(tag).toContain("pointer-events-none opacity-0");
      expect(tag).toContain('aria-hidden="true"');
      expect(tag).toContain('tabindex="-1"');
      // The bar's chip: 24px, no border showing.
      expect(tag).toContain("size-6 border border-transparent");
    }
    // ⋯ is the menu's trigger, closed.
    expect(tags[2]).toContain('aria-haspopup="menu"');
    // 2px apart, as on a reply's bar; the row a deleted copy hides.
    expect(row).toContain(`<div data-hover-row="" ${CHIP_ROW}>`);
    // Every bubble of yours has them, your answer to its question too.
    expect(count(html, CHIP_ROW)).toBe(5);
  });

  it("gives your answer to its question the same row: it is your bubble, with a menu", () => {
    const html = assistant(conversation(), { messageMenu: MENU });
    const row = rowOf(html, 'data-message-id="u-闽南菜"');
    expect(row).toContain('data-role="user-msg-reply"');
    expect(chipTags(row).map(label)).toEqual([
      words.copy,
      words.quoteSelection,
      zhCopy.common.more,
    ]);
  });

  it("keeps only ⋯ under a bubble of images alone, as its menu has only 删除", () => {
    const image: UserTurn = {
      role: "user",
      content: "",
      messageId: "u-image",
      attachments: [
        {
          id: "img-1",
          messageId: "u-image",
          sessionId: "s-main",
          kind: "image",
          path: "data:image/png;base64,AAAA",
          mimeType: "image/png",
          byteSize: 4,
          createdAt: at(9),
        },
      ],
    };
    const html = assistant([image, answer("收到图片。", 1)], {
      messageMenu: MENU,
    });
    const row = rowOf(html, 'data-message-id="u-image"');
    expect(chipTags(row).map(label)).toEqual([zhCopy.common.more]);
  });

  it("copies alone without the main chat's menu, as a message not yet stored has no row id", () => {
    const html = assistant(conversation());
    expect(chipTags(rowOf(html, "帮我排个行程")).map(label)).toEqual([
      words.copy,
    ]);
    const unsent: UserTurn = { role: "user", content: "刚发出去" };
    const fresh = assistant([unsent], { messageMenu: MENU });
    expect(chipTags(rowOf(fresh, "刚发出去")).map(label)).toEqual([words.copy]);
  });

  it("keeps the workbench's single hover copy under the bubble, whatever it is handed", () => {
    const html = render(conversation(), { messageMenu: MENU });
    const row = rowOf(html, "帮我排个行程");
    expect(chipTags(row).map(label)).toEqual([words.copy]);
    expect(row).not.toContain(zhCopy.common.more);
    expect(row).not.toContain(CHIP_ROW);
    expect(row).toContain(WORKBENCH_CHIP_ROW);
    expect(row).toMatch(/^<div class="group relative mt-5 mb-7\.5 mr-\[/);
    expect(bubbleOf(row)).not.toContain("<button");
  });

  it("makes the 30px under your bubble part of its hover region in the workbench only (ruling 109)", () => {
    const BAND =
      '<span aria-hidden="true" class="absolute inset-x-0 top-full h-7.5"></span>';
    const today = render(conversation());
    // Every bubble of yours, your answer to its question too.
    expect(count(today, BAND)).toBe(5);
    const row = rowOf(today, "帮我排个行程");
    // A child of the row (the hover region), over exactly its bottom
    // margin: out of flow, as tall as `mb-7.5`, the whole row wide.
    expect(row).toMatch(/^<div class="group relative [^"]*mb-7\.5/);
    expect(count(row, BAND)).toBe(1);
    // Before the chip, which paints over it (z-10) and stays clickable.
    expect(row.indexOf(BAND)).toBeLessThan(row.indexOf(WORKBENCH_CHIP_ROW));
    expect(row.indexOf(BAND)).toBeGreaterThan(row.indexOf("帮我排个行程"));
    // The assistant's row has no bottom margin to cover (ruling 199): the
    // chips are beside the bubble, inside the row, the column wide.
    const im = assistant(conversation(), { messageMenu: MENU });
    expect(count(im, BAND)).toBe(0);
    expect(rowOf(im, "帮我排个行程")).not.toContain("mb-7.5");
  });

  it("puts a long message's toggle under the bubble, on the right, in flow and always there", () => {
    const long = Array.from({ length: 9 }, (_, i) => `第 ${i + 1} 行`).join(
      "\n",
    );
    const html = assistant([user(long, at(9)), answer("好。", 1)], {
      messageMenu: MENU,
    });
    const row = rowOf(html, "第 1 行");
    // The chips first, then the toggle's button.
    expect(chipTags(row).slice(0, 3).map(label)).toEqual([
      words.copy,
      words.quoteSelection,
      zhCopy.common.more,
    ]);
    // Not with the chips: a row of its own under the bubble, 6px down,
    // right-aligned, in flow (the next message measures from its foot).
    const toggleRow = '<div class="mt-1.5 flex justify-end"><button';
    expect(bubbleOf(row)).not.toContain(words.expandLines(9));
    expect(row.indexOf(toggleRow)).toBeGreaterThan(
      row.indexOf(bubbleOf(row)) + bubbleOf(row).length - 1,
    );
    expect(row.slice(row.indexOf(toggleRow))).toContain(words.expandLines(9));
    // The toggle is no hover chip: no reveal on it.
    const toggle = row.slice(row.indexOf(toggleRow) + toggleRow.length - 7);
    expect(toggle.slice(0, toggle.indexOf(">"))).not.toContain("opacity-0");
    // The workbench keeps it in the chip's row, outermost on the right.
    const today = rowOf(
      render([user(long, at(9)), answer("好。", 1)]),
      "第 1 行",
    );
    const chips = today.slice(today.indexOf(WORKBENCH_CHIP_ROW));
    expect(chips.indexOf(words.expandLines(9))).toBeGreaterThan(
      chips.indexOf(`aria-label="${words.copy}"`),
    );
    expect(today).not.toContain(toggleRow);
  });

  it("gives a message through Galley CLI on the right the same row", () => {
    const turns: Turn[] = [
      {
        ...user("帮我看看日程", at(9)),
        origin: { via: "supervisor", supervisor: "ga-claude-1" },
      },
      answer("今天没有安排。", 1),
    ];
    const row = rowOf(assistant(turns, { messageMenu: MENU }), "帮我看看日程");
    expect(row).toContain(`aria-label="${words.cliCreatedAria}"`);
    expect(chipTags(row).map(label)).toEqual([
      words.copy,
      words.quoteSelection,
      zhCopy.common.more,
    ]);
  });

  it("keeps a time line's 16px above it right under your bubble or a reply (ruling 199)", () => {
    // Two of yours hours apart with nothing between: the second's time
    // line sits right under the first's row; then a reply, and yours
    // again hours later.
    const turns: Turn[] = [
      user("早", at(9)),
      user("下午好", at(15)),
      answer("下午好。", 1),
      user("晚上好", at(20)),
    ];
    const lines = [
      ...assistant(turns).matchAll(
        /data-role="message-time-divider" class="([^"]*)"/g,
      ),
    ].map((m) => m[1]);
    expect(lines).toEqual([
      "flex justify-center my-4",
      "flex justify-center my-4",
      "flex justify-center my-4",
    ]);
    // The workbench's stays as it was: nothing above it right under a
    // reply, whose action row is the gap.
    const today = [
      ...render(turns).matchAll(
        /data-role="message-time-divider" class="([^"]*)"/g,
      ),
    ].map((m) => m[1]);
    expect(today).toEqual([
      "flex justify-center my-4",
      "flex justify-center my-4",
      "flex justify-center mb-4",
    ]);
  });
});

describe("the assistant's conversation: the process", () => {
  it("shows nothing beside a reply at rest: its bar comes in on hover, icons only, no numbers", () => {
    const html = assistant(conversation());
    // Every reply's bar (the greeting's and four answers') is there,
    // hidden, beside its bubble (ruling 199) — none under it.
    const bars = html.split(BAR).slice(1);
    expect(bars.length).toBe(5);
    for (const bar of bars) expect(bar.startsWith(` ${HIDDEN}"`)).toBe(true);
    expect(html).not.toContain(WORKBENCH_BAR);
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
});

// ---- A run without an answer (ruling 159) --------------------------------

/** Stopped at its third step (as the Tailscale round of 10-30): three
 * script steps, the second failed, no answer, not running. */
function stoppedRun(): Turn[] {
  return [
    user("早，天气怎么样？", at(9)),
    answer("多云，记得带伞。", 1),
    user("看看 Tailscale 为什么连不上", at(15, 59)),
    did("我先看一下进程。", 1, tool("code_run", { script: "ps aux" })),
    did("再看安装日志。", 2, {
      ...tool("code_run", { script: "log show" }),
      status: "failed-historical",
    }),
    did("结束卡住的进程。", 3, tool("code_run", { script: "kill 4242" })),
  ];
}

/** The line in a render, from its tag to the end of its words. */
function stoppedLineOf(html: string): string {
  const at = html.indexOf('data-role="assistant-stopped"');
  if (at < 0) return "";
  const start = html.lastIndexOf("<div", at);
  return html.slice(start, html.indexOf("</div>", at) + "</div>".length);
}

describe("the assistant's conversation: a run without an answer", () => {
  it("draws one line where its reply would be, 「中途停下 · 3 步」, none of the workbench's region", () => {
    const html = assistant(stoppedRun());
    expect(count(html, 'data-role="assistant-stopped"')).toBe(1);
    const line = stoppedLineOf(html);
    expect(text(line)).toBe("中途停下 · 3 步");
    // Words ink-muted, the figure ink-soft, at the step size, on a 24px
    // line; the process button's Footprints first.
    expect(line).toContain("text-ink-muted");
    expect(line).toContain("[font-size:var(--conversation-step-size)]");
    expect(line).toContain("h-6");
    expect(line).toMatch(/<span class="[^"]*text-ink-soft[^"]*">3<\/span>/);
    expect(line.indexOf("<svg")).toBeGreaterThan(-1);
    expect(line.indexOf("<svg")).toBeLessThan(line.indexOf("中途停下"));
    // The whole line is the toggle: a disclosure you can tab to.
    expect(line).toContain('role="button"');
    expect(line).toContain('tabindex="0"');
    expect(line).toContain('aria-expanded="false"');
    expect(line).toContain("hover:bg-hover");
    expect(line).toContain("focus-visible:bg-hover");
    // No bubble ground, no menu (no row id to right-click).
    expect(line).not.toContain("bg-assistant-tint");
    expect(line).not.toContain("data-message-id");
    // After your message, on its side: 16px, the change of side (ruling
    // 199), where the typing bubble stood.
    expect(html.indexOf("看看 Tailscale 为什么连不上")).toBeLessThan(
      html.indexOf('data-role="assistant-stopped"'),
    );
    // Nothing of the steps: no numerals, rail, markers, tool pills,
    // narration; no card while it is closed.
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toContain(">01</span>");
    expect(html).not.toContain("absolute bottom-0 left-[5px] w-px bg-line");
    expect(html).not.toContain(zhCopy.tools.code_run);
    expect(html).not.toContain("我先看一下进程。");
    expect(html).not.toContain("结束卡住的进程。");
    expect(html).not.toContain('data-role="process-card"');
    // The reply before it is its only left bubble.
    expect(count(html, 'data-role="assistant-bubble"')).toBe(1);
  });

  it("takes its side's gaps above and below, and nothing of its own under it (ruling 199)", () => {
    /** The line's row: the wrapper right around the line. */
    const rowTag = (html: string) => {
      const line = html.lastIndexOf(
        "<div",
        html.indexOf('data-role="assistant-stopped"'),
      );
      const start = html.lastIndexOf("<div", line - 1);
      return html.slice(start, html.indexOf(">", start) + 1);
    };
    // Under your bubble: 16px; no 24px under it where a reply's bar was.
    const html = assistant([
      ...stoppedRun(),
      user("那先别动它", at(16, 1)),
      user("等我回来", at(16, 1)),
    ]);
    expect(rowTag(html)).toMatch(/^<div (data-at="\d+" )?class="mt-4">$/);
    expect(html).not.toContain("pb-6");
    expect(html).not.toContain("transition-[padding-bottom]");
    // Your next bubble 16px under it, the one after 4px under that.
    const rows = [...html.matchAll(/class="group relative ([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(rows.slice(-2)).toEqual(["mt-4", "mt-1"]);
    // Right after a reply of its own (a woken round that stopped): 4px.
    const woken = assistant([
      ...stoppedRun().slice(0, 2),
      {
        role: "user",
        content: "[Galley — not a message from the user] …",
        messageId: "u-report",
        origin: { via: "system", supervisor: "galley-report", reason: "s-2" },
        createdAt: at(9, 30),
      },
      did("我先看一下进程。", 1, tool("code_run", { script: "ps aux" })),
      did("再看安装日志。", 2, tool("code_run", { script: "log show" })),
    ]);
    expect(rowTag(woken)).toMatch(/^<div (data-at="\d+" )?class="mt-1">$/);
    // Opened, its card comes in 4px under it, nothing of its own below.
    expand.cards = true;
    const opened = assistant(stoppedRun());
    expect(opened).toContain(
      'opacity-100 mt-1"><div class="overflow-hidden"><div data-role="process-card"',
    );
  });

  it("opens the reply's process card under it: one row a step, no first line (the line is its heading)", () => {
    expand.all = true;
    const html = assistant(stoppedRun());
    expect(count(html, 'data-role="process-card"')).toBe(1);
    const card = cardOf(html);
    expect(html.indexOf('data-role="assistant-stopped"')).toBeLessThan(
      html.indexOf('data-role="process-card"'),
    );
    expect(rowsOf(card)).toEqual([
      ["我先看一下进程。", null],
      ["再看安装日志。", null],
      ["结束卡住的进程。", null],
    ]);
    // Ruling 159 item 8: no 「3 步」 under 「中途停下 · 3 步」; the card
    // starts at its first step, 4px under its top edge, as the
    // workbench's card does.
    expect(card).not.toContain('data-role="assistant-run-summary"');
    expect(card).toMatch(
      /^data-role="process-card" class="[^"]*\bpt-1\b[^"]*"><div class="relative"><div data-role="process-steps"/,
    );
    // A step opens to its tools: the failed script is there.
    expect(card).toContain(zhCopy.tools.code_run);
  });

  it("keeps the first line on the card under a reply, and drops it only from the line's card", () => {
    expand.all = true;
    const turns: Turn[] = [
      ...stoppedRun(),
      user("那先别动它，帮我排个行程", at(16, 30)),
      step("我先查一下船票。", 1),
      answer("排好了。", 2),
    ];
    const html = assistant(turns);
    const cards = html.split('data-role="process-card"').slice(1);
    expect(cards).toHaveLength(2);
    // The stopped round's card first, then the reply's.
    expect(cards[0]).not.toContain('data-role="assistant-run-summary"');
    expect(cards[1]).toContain('data-role="assistant-run-summary"');
    const summary = cards[1].slice(
      cards[1].indexOf('data-role="assistant-run-summary"'),
    );
    expect(text(`<x ${summary.slice(0, summary.indexOf("</div>"))}`)).toMatch(
      /^2 步 · 用时 9 秒/,
    );
  });

  it("keeps a question and your answer out as messages, before the line", () => {
    const turns: Turn[] = [
      user("订船票", at(9)),
      step("我先看船班。", 1),
      ask("订哪一班？", ["8:30", "9:00"], 2),
      user("8:30", at(9, 1)),
      step("我去下单。", 3),
    ];
    const html = assistant(turns);
    expect(count(html, 'data-role="answered-ask-user"')).toBe(1);
    expect(count(html, 'data-role="user-msg-reply"')).toBe(1);
    expect(text(stoppedLineOf(html))).toBe("中途停下 · 3 步");
    expect(html.indexOf('data-role="user-msg-reply"')).toBeLessThan(
      html.indexOf('data-role="assistant-stopped"'),
    );
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toContain("我去下单。");
    // Opened: the steps but the one that only asked.
    expand.all = true;
    expect(rowsOf(cardOf(assistant(turns)))).toEqual([
      ["我先看船班。", null],
      ["我去下单。", null],
    ]);
  });

  it("is plain words when every step only asked: nothing to open", () => {
    const turns: Turn[] = [
      user("订船票", at(9)),
      ask("订哪一班？", ["8:30", "9:00"], 1),
      user("8:30", at(9, 1)),
    ];
    expand.all = true;
    const html = assistant(turns);
    const line = stoppedLineOf(html);
    expect(text(line)).toBe("中途停下 · 1 步");
    expect(line).not.toContain(' role="');
    expect(line).not.toContain("tabindex");
    expect(line).not.toContain("aria-expanded");
    expect(line).not.toContain("hover:bg-hover");
    expect(html).not.toContain('data-role="process-card"');
  });

  it("says it in English, one step or more", () => {
    const en = (turns: Turn[]) =>
      text(
        stoppedLineOf(
          renderToStaticMarkup(
            <CopyProvider language="en-US">
              <Tooltip.Provider>
                <LocalFilesContext.Provider value={() => undefined}>
                  <Conversation turns={turns} assistant />
                </LocalFilesContext.Provider>
              </Tooltip.Provider>
            </CopyProvider>,
          ),
        ),
      );
    expect(en(stoppedRun())).toBe("Stopped partway · 3 steps");
    expect(en(stoppedRun().slice(0, 4))).toBe("Stopped partway · 1 step");
  });

  it("leaves the workbench its own rendering of the same turns: the live window, frozen", () => {
    // Workbench conversation PRD ruling 9 (ticket 04): the fold header
    // 「中途停下 · 3 步」 and the last step in the step region's reading
    // form; no line.
    const html = render(stoppedRun());
    expect(html).not.toContain('data-role="assistant-stopped"');
    expect(count(html, 'data-role="run-fold"')).toBe(1);
    expect(count(html, 'data-role="step-marker"')).toBe(1);
    expect(html).toContain(">03</span>");
    expect(html).toContain("absolute bottom-0 left-[5px] w-px bg-line");
    expect(html).toContain(zhCopy.tools.code_run);
    expect(html).toContain("结束卡住的进程。");
    expect(html).not.toContain("我先看一下进程。");
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
    expect(open).toContain(CAP);
    expect(open).not.toContain("shadow");
    expect(cardOf(html)).not.toContain("w-[3px]");
    // 4px under the reply, as one thing of its side after another
    // (ruling 199), and nothing of its own under it: the next row's IM
    // gap is measured from its foot.
    expect(html).toContain(
      'class="grid transition-[grid-template-rows,margin-top,opacity] duration-(--motion-slow) ease-firm motion-reduce:transition-none grid-rows-[1fr] opacity-100 mt-1"><div class="overflow-hidden"><div data-role="process-card"',
    );
    expect(html).not.toContain('<div class="pb-5">');
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
    // Right under the earlier reply: its 16px above (ruling 199; nothing
    // reserved under the reply any more).
    expect(html.slice(lines[1], reply)).toContain(
      'class="flex justify-center my-4"',
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

  it("draws a report round with no answer as the line, its time above it (ruling 159)", () => {
    const turns: Turn[] = [
      ...before,
      reportRow(at(14)),
      step("我让它再查一家。", 1),
      step("再核对一处。", 2),
    ];
    const html = assistant(turns);
    expect(html).not.toContain("我让它再查一家。");
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toContain("A subtask you started");
    expect(text(stoppedLineOf(html))).toBe("中途停下 · 2 步");
    // Its time sits above the line, which comes right under the reply
    // before it (that reply's action row is the gap above the time).
    const lines = [...html.matchAll(/data-role="message-time-divider"/g)];
    expect(lines).toHaveLength(2);
    expect(lines[1].index).toBeLessThan(
      html.indexOf('data-role="assistant-stopped"'),
    );
    expect(text(html.slice(lines[1].index))).toContain("14:00");
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

  // Ruling 125 (ticket 76): the rows as Core wrote them, the subtask's
  // card keyed on the reply that dispatched it.
  const dispatchCards = (id: string): ReactNode =>
    id === DISPATCH_REPLY_ID ? (
      <div data-role="subtask-cards">cards</div>
    ) : null;

  it("draws nothing of a woken round that only dispatched: no steps, no card, no time", () => {
    const turns = rowsToTurns(dispatchRoundRows({ woken: true }));
    const html = assistant(turns, { renderAfterAnswer: dispatchCards });
    expect(html).not.toContain('data-role="subtask-cards"');
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toContain(STEP_ONE_SUMMARY);
    expect(html).not.toContain(STEP_TWO_SUMMARY);
    expect(html).not.toContain("A subtask you started");
    // Your message and the reply before it, nothing after.
    expect(count(html, 'data-role="assistant-bubble"')).toBe(1);
    expect(html.slice(html.indexOf(EARLIER_REPLY))).not.toContain(
      'data-role="message-time-divider"',
    );
  });

  it("keeps the card under the user's own dispatch, with <no-reply/> or without", () => {
    const [bare, tagged] = [false, true].map((noReply) =>
      assistant(rowsToTurns(dispatchRoundRows({ woken: false, noReply })), {
        renderAfterAnswer: dispatchCards,
      }),
    );
    expect(tagged).toBe(bare);
    expect(count(bare, 'data-role="subtask-cards"')).toBe(1);
    // Drawn the workbench way: the steps, then the reply with its card.
    expect(bare).toContain(STEP_TWO_SUMMARY);
    expect(bare.indexOf('data-role="subtask-cards"')).toBeGreaterThan(
      bare.indexOf(STEP_TWO_SUMMARY),
    );
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

describe("the assistant's conversation: a line told mid-run (ticket 137)", () => {
  function told(line: string, index: number): AgentTurn {
    return {
      role: "agent",
      turnIndex: index,
      finalAnswer: line,
      tools: [],
      interim: true,
      messageId: `t-${line}`,
    };
  }

  const run: Turn[] = [
    user("查明天天气", at(9)),
    step("我先查一下城市。", 1),
    told("记上了，天气还在查。", 2),
    { ...user("顺便提醒我买牛奶", at(9, 1)), interjected: true },
    step("我查上海的预报。", 3),
    answer("上海明天晴。", 4),
  ];

  it("is its own bubble on its side, between your words and the reply, with no process", () => {
    const html = assistant(run);
    const bubbles = count(html, 'data-role="assistant-bubble"');
    expect(bubbles).toBe(2);
    const line = html.indexOf("记上了，天气还在查。");
    const yours = html.indexOf("查明天天气");
    const reply = html.indexOf("上海明天晴。");
    expect(yours).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(yours);
    expect(reply).toBeGreaterThan(line);
    // One process button, under the reply; the steps behind it.
    expect(buttons(html, zhCopy.conversation.foldExpand)).toHaveLength(1);
    expect(html).not.toContain("我查上海的预报。");
  });

  it("while it runs, is drawn and the steps are not", () => {
    const html = assistant(run.slice(0, 4), { agentRunning: true });
    expect(html).toContain("记上了，天气还在查。");
    expect(html).not.toContain("我先查一下城市。");
    expect(buttons(html, zhCopy.conversation.foldExpand)).toHaveLength(0);
  });
});
