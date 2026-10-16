import * as Tooltip from "@radix-ui/react-tooltip";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { Conversation } from "./Conversation";
import { zhCopy } from "@/i18n/locales/zh";
import { LocalFilesContext } from "@/lib/local-files";
import { withoutHiddenTurns } from "@/lib/message-delete";
import { useMessagesStore } from "@/stores/messages";
import { resetStores } from "@/test/store-reset";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

/**
 * A bubble's message menu and deleting it, in the conversation (main
 * chat tickets 32, 38): only the assistant's conversation has the menu —
 * on a right-click and on the ⋯ ending a reply's bar — a question bubble
 * names its row for it, a bubble deleted on the page is gone at once
 * (hidden until Core deletes it), and the bubbles Core deleted are gone.
 * The menu's rows are lib/message-menu.test.ts's; a static render cannot
 * right-click.
 */

function tool(name: string, args: Record<string, unknown> = {}) {
  return {
    id: `t-${name}`,
    name,
    status: "success-historical",
    args,
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
    messageId: `a-${text}`,
  };
}
function ask(question: string): AgentTurn {
  return {
    role: "agent",
    finalAnswer: null,
    tools: [tool("ask_user", { question })],
    messageId: `q-${question}`,
  };
}

const menu = {
  running: false,
  asking: false,
  hasSubtasks: () => false,
  onQuote: () => {},
  onDelete: () => {},
};

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

/** The conversation root, as rendered. */
function root(html: string): string {
  const at = html.indexOf('data-role="conversation"');
  return html.slice(html.lastIndexOf("<div", at), html.indexOf(">", at) + 1);
}

const TURNS: Turn[] = [
  user("订票"),
  ask("哪天出发？"),
  user("周五"),
  answer("订好了"),
];

describe("the message menu", () => {
  it("is on the assistant's conversation only (its root is the trigger)", () => {
    expect(
      root(render(TURNS, { assistant: true, messageMenu: menu })),
    ).toContain('data-state="closed"');
    // The workbench never gets one, whatever it is handed; nor an
    // assistant's conversation without MainView's wiring.
    expect(root(render(TURNS, { messageMenu: menu }))).not.toContain(
      "data-state",
    );
    expect(root(render(TURNS, { assistant: true }))).not.toContain(
      "data-state",
    );
  });

  it("finds every bubble by its row: yours, a question, an answer", () => {
    const html = render(TURNS, { assistant: true, messageMenu: menu });
    for (const id of ["u-订票", "q-哪天出发？", "u-周五", "a-订好了"]) {
      expect(html).toContain(`data-message-id="${id}"`);
    }
  });

  it("ends a reply's bar in ⋯ (更多), in the assistant's conversation only", () => {
    const more = `aria-label="${zhCopy.common.more}"`;
    const html = render(TURNS, { assistant: true, messageMenu: menu });
    // One reply, one ⋯: the menu trigger, closed.
    expect(html.split(more)).toHaveLength(2);
    expect(html).toContain('aria-haspopup="menu"');
    expect(render(TURNS, { assistant: true })).not.toContain(more);
    expect(render(TURNS, { messageMenu: menu })).not.toContain(more);
  });
});

describe("a bubble deleted on the page, its undo toast up", () => {
  it("is gone at once, and the rows after it keep their keys", () => {
    const turns: Turn[] = [
      user("我的密钥是蓝鲸4721"),
      answer("收到"),
      user("今天天气"),
      answer("晴"),
    ];
    const shown = withoutHiddenTurns(
      turns,
      0,
      [],
      new Set(["u-我的密钥是蓝鲸4721"]),
    );
    expect(shown.removedOrdinals).toEqual([0]);
    const html = render(shown.turns, {
      assistant: true,
      messageMenu: menu,
      removedOrdinals: shown.removedOrdinals,
    });
    expect(html).not.toContain("蓝鲸4721");
    for (const text of ["收到", "今天天气", "晴"]) expect(html).toContain(text);
    // Nothing hidden: the same arrays, nothing re-rendered for it.
    const none = withoutHiddenTurns(turns, 0, [], new Set());
    expect(none.turns).toBe(turns);
  });
});

describe("after a deletion", () => {
  const SID = "s-main";
  beforeEach(() => {
    resetStores();
    useMessagesStore.getState().ensureMessages(SID);
    useMessagesStore.setState((s) => ({
      byId: {
        ...s.byId,
        [SID]: {
          ...s.byId[SID],
          turns: [
            user("我的密钥是蓝鲸4721"),
            answer("收到"),
            user("今天天气"),
            answer("晴"),
          ],
        },
      },
    }));
  });

  it("the bubbles Core deleted are gone, and nothing else", () => {
    const store = useMessagesStore.getState();
    expect(render(store.byId[SID].turns, { assistant: true })).toContain(
      "蓝鲸4721",
    );
    store.applyMessagesDeleted(SID, ["u-我的密钥是蓝鲸4721"]);
    const slice = useMessagesStore.getState().byId[SID];
    const html = render(slice.turns, {
      assistant: true,
      removedOrdinals: slice.removedOrdinals,
    });
    expect(html).not.toContain("蓝鲸4721");
    for (const text of ["收到", "今天天气", "晴"]) expect(html).toContain(text);
  });
});
