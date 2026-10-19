import * as Tooltip from "@radix-ui/react-tooltip";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { assistantLinePlan } from "@/lib/assistant-conversation";
import { LocalFilesContext } from "@/lib/local-files";
import { messageMenuEntries, messageMenuTarget } from "@/lib/message-menu";
import { buildRunGroups, liveRunGroup } from "@/lib/run-groups";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

import { Conversation } from "./Conversation";

/**
 * 引用 on a reply's action bar (main chat ticket 47, PRD ruling 99) does
 * what the message menu's 引用 does: the conversation hands MainView's
 * `onQuote` the reply's whole-message quote, cut short when long — the
 * very text the menu's target holds. So does 引用 on the row under your
 * bubble (ticket 53, PRD ruling 105). A static render cannot click, so
 * the chips are stood in for by a plain button that keeps each chip's
 * action, in render order (your row's, then the reply's, and so on);
 * the bar's order and skin are MessageActions.test.tsx's.
 */

const chips = vi.hoisted(() => ({
  seen: [] as { label: string; onClick?: () => void }[],
}));

vi.mock("@/components/conversation/ActionChip", () => ({
  ActionChip: ({
    idleLabel,
    onClick,
  }: {
    idleLabel: string;
    onClick?: () => void;
  }) => {
    chips.seen.push({ label: idleLabel, onClick });
    return <button type="button" aria-label={idleLabel} />;
  },
}));

beforeEach(() => {
  chips.seen = [];
});

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
function answer(text: string): AgentTurn {
  return {
    role: "agent",
    finalAnswer: text,
    tools: [tool("no_tool")],
    messageId: `a-${text.slice(0, 4)}`,
  };
}

const LONG = [
  "## 每小时提醒你喝水",
  "",
  "- **从 10:00 开始**，到 22:00 为止，每小时一次，共 13 次；",
  "- 每次提醒都会带上今天已经喝了几杯，方便你心里有数；",
  "- 周末也照常提醒，想停的时候跟我说一声就行。",
  "",
  "另外，如果你想把提醒改成每半小时一次，或者换个时间段，也可以直接告诉我。",
].join("\n");

const TURNS: Turn[] = [
  user("提醒我喝水"),
  answer(LONG),
  user("谢谢"),
  answer("不客气。"),
];

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

/** The menu's quote of row `index`, as the conversation builds it. */
function menuQuote(turns: Turn[], index: number): string | null {
  const groups = buildRunGroups(turns, { splitAfterAnswer: true });
  const plan = assistantLinePlan(
    groups,
    turns,
    liveRunGroup(groups, false, false),
  );
  return messageMenuTarget(turns, plan, groups, index)?.quoteText ?? null;
}

function menu(onQuote: (text: string) => void) {
  return {
    running: false,
    asking: false,
    hasSubtasks: () => false,
    onQuote,
    onDelete: () => {},
  };
}

const quoteChips = () =>
  chips.seen.filter(
    (chip) => chip.label === zhCopy.conversation.quoteSelection,
  );

describe("引用 on a reply's bar", () => {
  it("quotes the reply as the menu's 引用 does, cut short when long", () => {
    const onQuote = vi.fn();
    render(TURNS, { assistant: true, messageMenu: menu(onQuote) });
    // One under each reply, and one under each of your bubbles (ticket
    // 53): yours, the reply, yours, the reply.
    const quotes = quoteChips();
    expect(quotes).toHaveLength(4);

    quotes[1].onClick?.();
    expect(onQuote).toHaveBeenCalledTimes(1);
    const long = menuQuote(TURNS, 1);
    expect(long).not.toBeNull();
    expect(onQuote).toHaveBeenLastCalledWith(long);
    // The whole-message quote: markers out, three lines at most, 「…」.
    expect(long).toBe(
      [
        "每小时提醒你喝水",
        "• 从 10:00 开始，到 22:00 为止，每小时一次，共 13 次；",
        "• 每次提醒都会带上今天已经喝了几杯，方便你心里有数…",
      ].join("\n"),
    );

    quotes[3].onClick?.();
    expect(onQuote).toHaveBeenLastCalledWith(menuQuote(TURNS, 3));
    expect(onQuote).toHaveBeenLastCalledWith("不客气。");
  });

  it("quotes your message from the row under its bubble, as its menu's 引用 does", () => {
    const onQuote = vi.fn();
    render(TURNS, { assistant: true, messageMenu: menu(onQuote) });
    const quotes = quoteChips();
    quotes[0].onClick?.();
    expect(onQuote).toHaveBeenLastCalledWith(menuQuote(TURNS, 0));
    expect(onQuote).toHaveBeenLastCalledWith("提醒我喝水");
    quotes[2].onClick?.();
    expect(onQuote).toHaveBeenLastCalledWith("谢谢");
    expect(onQuote).toHaveBeenCalledTimes(2);
  });

  it("is not under a reply that is an image alone, as its menu has no 引用", () => {
    const turns: Turn[] = [
      ...TURNS,
      user("画一只猫"),
      answer("![猫](/tmp/cat.png)"),
    ];
    render(turns, { assistant: true, messageMenu: menu(() => {}) });
    // Three replies, three saves; 引用 under the two with words only
    // (and under your three bubbles, ticket 53).
    expect(
      chips.seen.filter((chip) => chip.label === zhCopy.conversation.save),
    ).toHaveLength(3);
    expect(quoteChips()).toHaveLength(2 + 3);
    // The menu's own judgment says the same.
    const groups = buildRunGroups(turns, { splitAfterAnswer: true });
    const plan = assistantLinePlan(
      groups,
      turns,
      liveRunGroup(groups, false, false),
    );
    const target = messageMenuTarget(turns, plan, groups, 5);
    expect(target).not.toBeNull();
    expect(
      messageMenuEntries(target!, { processOpen: false, block: null }).map(
        (entry) => entry.kind,
      ),
    ).not.toContain("quote");
    expect(menuQuote(turns, 5)).toBeNull();
  });

  it("is not on the workbench's bar, nor without the main chat's menu", () => {
    render(TURNS, { messageMenu: menu(() => {}) });
    expect(quoteChips()).toHaveLength(0);
    // The bars are there: save under each reply.
    expect(
      chips.seen.filter((chip) => chip.label === zhCopy.conversation.save),
    ).toHaveLength(2);
    chips.seen = [];
    render(TURNS, { assistant: true });
    expect(quoteChips()).toHaveLength(0);
  });
});
