import * as Tooltip from "@radix-ui/react-tooltip";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Composer } from "@/components/conversation/Composer";
import { Conversation } from "@/components/conversation/Conversation";
import { MessageUser } from "@/components/conversation/MessageUser";
import { dropComposerDraft, saveComposerDraft } from "@/lib/composer-draft";
import { LocalFilesContext } from "@/lib/local-files";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

import { TdVariantsPill } from "./TdVariantsPill";
import { TD_DEMO_TURNS } from "./td-demo";
import { composerGrowTiming, useTdVariants } from "./td-variants";

// TEMP variant switcher (telegram-details 05): goes with the switcher.

// A static render reads a zustand store's initial state; the hook here
// reads what the test set.
vi.mock("./td-variants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./td-variants")>();
  const store = actual.useTdVariants;
  const hook = (<T,>(
    selector?: (state: ReturnType<typeof store.getState>) => T,
  ) =>
    selector
      ? selector(store.getState())
      : store.getState()) as unknown as typeof store;
  Object.assign(hook, store);
  return { ...actual, useTdVariants: hook };
});

afterEach(() => {
  useTdVariants.setState({
    grow: 1,
    corners: 1,
    demo: false,
    strip: 1,
    bubble: 1,
  });
});

const at = (h: number, m = 0) =>
  `2026-10-16T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`;

function user(content: string, createdAt?: string): UserTurn {
  return { role: "user", content, createdAt, messageId: `u-${content}` };
}

function answer(text: string): AgentTurn {
  return {
    role: "agent",
    finalAnswer: text,
    tools: [
      {
        id: `t-${text}`,
        name: "no_tool",
        status: "success-historical",
        args: {},
      } as ConversationToolEvent,
    ],
    messageId: `a-${text}`,
  };
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

/** Two bursts of the user's: three in a row, then (past a time line)
 * two; a message alone between them, right under a reply. */
const BURSTS: Turn[] = [
  user("对了", at(8)),
  user("周六想去鼓浪屿", at(8, 1)),
  user("两个人", at(8, 1)),
  answer("记下了。"),
  user("谢谢", at(8, 3)),
  user("还有一件事", at(10)),
  user("下周二提醒我打电话", at(10, 1)),
];

/** The user rows' classes, in order. */
function userRows(html: string): string[] {
  return [...html.matchAll(/class="group relative ([^"]*)"/g)].map((m) =>
    m[1].replace(/&amp;/g, "&").replace(/&gt;/g, ">"),
  );
}

const TR = "[&>[data-role^=user-msg]]:rounded-tr-(--bubble-group-radius)";
const BR = "[&>[data-role^=user-msg]]:rounded-br-(--bubble-group-radius)";

describe("the switcher's defaults", () => {
  it("starts on today's composer and corners, the demo off", () => {
    const state = useTdVariants.getState();
    expect(state.grow).toBe(1);
    expect(state.corners).toBe(1);
    expect(state.demo).toBe(false);
    expect(composerGrowTiming()).toBe("instant");
  });

  it("maps A2 / A3 to the composer's timings", () => {
    useTdVariants.getState().setGrow(2);
    expect(composerGrowTiming()).toBe("fixed");
    useTdVariants.getState().setGrow(3);
    expect(composerGrowTiming()).toBe("distance");
  });

  it("renders no pill without a document (a static render)", () => {
    expect(renderToStaticMarkup(<TdVariantsPill />)).toBe("");
  });
});

describe("B: the corners inside a group", () => {
  it("adds nothing at B1: the rows are today's", () => {
    const html = render(BURSTS, { assistant: true });
    expect(html).not.toContain("bubble-group-radius");
    expect(userRows(html)).toEqual([
      "mt-5",
      "mt-1",
      "mt-1",
      "mt-0",
      "mt-5",
      "mt-1",
    ]);
  });

  it("rounds the sender's side less where a neighbour of the group is (B2–B4)", () => {
    useTdVariants.getState().setCorners(3);
    const rows = userRows(render(BURSTS, { assistant: true }));
    expect(rows).toEqual([
      // First, middle, last of three.
      `mt-5 ${BR}`,
      `mt-1 ${TR} ${BR}`,
      `mt-1 ${TR}`,
      // Alone under the reply's action row.
      "mt-0",
      // A time line ends the group above: a new one of two.
      `mt-5 ${BR}`,
      `mt-1 ${TR}`,
    ]);
  });

  it("rounds its side, the left, the same way when two of its rows meet", () => {
    useTdVariants.getState().setCorners(2);
    // A question with no answer of the user's after it, then its reply:
    // the one way two of its rows sit 4px apart.
    const ask: AgentTurn = {
      role: "agent",
      finalAnswer: null,
      tools: [
        {
          id: "t-ask",
          name: "ask_user",
          status: "success-historical",
          args: { question: "订哪一班？" },
        } as ConversationToolEvent,
      ],
    };
    const html = render([user("订船票", at(8)), ask, answer("订好了。")], {
      assistant: true,
    });
    expect(html).toContain(
      'class="mt-5 [&amp;&gt;[data-role=assistant-bubble]]:rounded-bl-(--bubble-group-radius)"',
    );
    expect(html).toContain(
      "mt-1 [&amp;&gt;[data-role=assistant-bubble]]:rounded-tl-(--bubble-group-radius)",
    );
  });

  it("never touches the workbench", () => {
    const before = render(BURSTS);
    useTdVariants.getState().setCorners(4);
    expect(render(BURSTS)).toBe(before);
    expect(before).not.toContain("bubble-group-radius");
  });
});

describe("「演示连发」", () => {
  it("shows the demo in the main chat in place of its conversation, nowhere else", () => {
    const own: Turn[] = [user("我自己的话", at(9)), answer("我的回复")];
    useTdVariants.getState().setDemo(true);
    const main = render(own, { assistant: true, agentRunning: true });
    expect(main).not.toContain("我自己的话");
    expect(main).toContain("周六想去鼓浪屿，帮我看看上午的船票还有没有");
    // As if nothing ran: every demo reply is drawn.
    expect(main).toContain("不客气。");
    // Seven messages of the user's: one, three, two, one.
    expect(userRows(main)).toEqual([
      "mt-5",
      "mt-0",
      "mt-1",
      "mt-1",
      "mt-0",
      "mt-1",
      "mt-0",
    ]);
    const workbench = render(own);
    expect(workbench).toContain("我自己的话");
    expect(workbench).not.toContain("鼓浪屿");
    expect(TD_DEMO_TURNS.filter((t) => t.role === "user")).toHaveLength(7);
  });
});

// TEMP variant switcher (telegram-details 07): C and D, how quotes look.
describe("C and D: quotes in the composer and in your bubble", () => {
  function bubble(content: string): string {
    return renderToStaticMarkup(
      <Tooltip.Provider>
        <MessageUser content={content} />
      </Tooltip.Provider>,
    );
  }

  it("start on the recommended C1 and D1", () => {
    const state = useTdVariants.getState();
    expect(state.strip).toBe(1);
    expect(state.bubble).toBe(1);
  });

  it("D1 draws the quotes above the bubble, D2 inside it", () => {
    const content = "> 那一句\n\n什么意思";
    const outside = bubble(content);
    expect(outside.indexOf('data-role="message-quotes"')).toBeLessThan(
      outside.indexOf('data-role="user-msg"'),
    );

    useTdVariants.getState().setBubble(2);
    const inside = bubble(content);
    expect(inside).not.toContain('data-role="message-quotes"');
    const message = inside.indexOf('data-role="user-msg"');
    expect(inside.indexOf("那一句")).toBeGreaterThan(message);
    expect(inside.indexOf("那一句")).toBeLessThan(inside.indexOf("什么意思"));
  });

  it("C1 draws a bar and two lines, C2 a ↳ glyph and one line", () => {
    const key = "td-variants-quote-strip";
    saveComposerDraft(key, { text: "", images: [], quotes: ["那一句"] });
    const strip = () =>
      renderToStaticMarkup(
        <Tooltip.Provider>
          <Composer llmDisplayName="model" draftKey={key} oneLine />
        </Tooltip.Provider>,
      );
    const c1 = strip();
    expect(c1).toContain("line-clamp-2");
    expect(c1).toContain("border-l-2");
    useTdVariants.getState().setStrip(2);
    const c2 = strip();
    expect(c2).not.toContain("line-clamp-2");
    expect(c2).toContain("truncate");
    dropComposerDraft(key);
  });
});
