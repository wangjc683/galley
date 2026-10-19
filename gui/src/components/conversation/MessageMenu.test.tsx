import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import type { MessageMenuEntry } from "@/lib/message-menu";

import {
  MessageMenuButton,
  MessageMenuProvider,
  type MessageMenuWiring,
} from "./MessageMenu";

/**
 * The menu as drawn (main chat ticket 38): its rows in the order the
 * model gives them, 删除 last in the destructive style and alone greyed
 * with its reason; the ⋯ only where the conversation wires a menu. A
 * closed Radix menu renders nothing statically and its content is
 * portalled, so the dropdown and the sidebar seam's rows stand in as
 * plain markup; the right-click menu draws the same rows from the same
 * model (`MessageMenuRows`, `wiring.model`), which a static render cannot
 * open.
 */

vi.mock("@radix-ui/react-dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  // The edge the menu opens from, as Radix is handed it.
  const Content = ({
    children,
    align,
  }: {
    children?: ReactNode;
    align?: string;
  }) => <div data-align={align}>{children}</div>;
  return { Root: Pass, Trigger: Pass, Portal: Pass, Content };
});

vi.mock("@/components/layout/sidebar/SidebarRowMenu", () => ({
  SidebarRowMenuItem: ({
    children,
    disabled,
  }: {
    children?: ReactNode;
    disabled?: boolean;
  }) => (
    <div data-row="item" data-disabled={disabled ? "" : undefined}>
      {children}
    </div>
  ),
  SidebarRowMenuSeparator: () => <div data-row="separator" />,
}));

const words = zhCopy.conversation;

function wiring(entries: MessageMenuEntry[]): MessageMenuWiring {
  return {
    has: (id) => id === "a1",
    canQuote: (id) => id === "a1",
    model: (id) => (id === "a1" ? { entries, onSelect: () => {} } : null),
  };
}

function render(node: ReactNode, value?: MessageMenuWiring): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      {value ? (
        <MessageMenuProvider value={value}>{node}</MessageMenuProvider>
      ) : (
        node
      )}
    </Tooltip.Provider>,
  );
}

/** The rows: `item:…` (with `!` when greyed), `separator`, `note:…`. */
function rows(markup: string): string[] {
  const text = (inner: string) => inner.replace(/<[^>]+>/g, "");
  return [
    ...markup.matchAll(
      /<div data-row="item"( data-disabled="")?>(.*?)<\/div>|<div data-row="separator"><\/div>|<div class="px-2\.5 pb-1\.5[^"]*">(.*?)<\/div>/g,
    ),
  ].map(([match, greyed, inner, note]) => {
    if (note !== undefined) return `note:${text(note)}`;
    if (inner !== undefined) return `item:${greyed ? "!" : ""}${text(inner)}`;
    expect(match).toContain("separator");
    return "separator";
  });
}

const REPLY: MessageMenuEntry[] = [
  { kind: "copy" },
  { kind: "quote" },
  { kind: "save" },
  { kind: "process", open: false },
  { kind: "separator" },
  { kind: "delete", block: null },
];

describe("the ⋯ menu", () => {
  it("draws the rows in the model's order, 删除 last", () => {
    const markup = render(
      <MessageMenuButton messageId="a1" open onOpenChange={() => {}} />,
      wiring(REPLY),
    );
    expect(rows(markup)).toEqual([
      `item:${words.copy}`,
      `item:${words.quoteSelection}`,
      `item:${words.save}`,
      `item:${words.foldExpand}`,
      "separator",
      `item:${words.deleteMessage.menuItem}`,
    ]);
    // The trigger is the bar's chip, named 更多, pressed while open.
    expect(markup).toContain(`aria-label="${zhCopy.common.more}"`);
    expect(markup).toContain('aria-expanded="true"');
  });

  it("greys 删除 alone, its reason under it", () => {
    const blocked = REPLY.map((entry) =>
      entry.kind === "delete"
        ? { ...entry, block: "subtasks" as const }
        : entry,
    );
    const markup = render(
      <MessageMenuButton messageId="a1" open onOpenChange={() => {}} />,
      wiring(blocked),
    );
    expect(rows(markup).slice(-3)).toEqual([
      "separator",
      `item:!${words.deleteMessage.menuItem}`,
      `note:${words.deleteMessage.blockedSubtasks}`,
    ]);
    expect(rows(markup).filter((row) => row.startsWith("item:!"))).toHaveLength(
      1,
    );
  });

  it("reads 收起过程 while the process card is open", () => {
    const open = REPLY.map((entry) =>
      entry.kind === "process" ? { ...entry, open: true } : entry,
    );
    const markup = render(
      <MessageMenuButton messageId="a1" open onOpenChange={() => {}} />,
      wiring(open),
    );
    expect(rows(markup)).toContain(`item:${words.foldCollapse}`);
  });

  it("opens from its right edge under your bubble, its left under a reply (ticket 53)", () => {
    const yours = render(
      <MessageMenuButton
        messageId="a1"
        open
        onOpenChange={() => {}}
        align="end"
      />,
      wiring(REPLY),
    );
    expect(yours).toContain('data-align="end"');
    const reply = render(
      <MessageMenuButton messageId="a1" open onOpenChange={() => {}} />,
      wiring(REPLY),
    );
    expect(reply).toContain('data-align="start"');
  });

  it("hides with the row under your bubble, keeping its place (`revealed`)", () => {
    const tag = (markup: string) => {
      const at = markup.indexOf("<button");
      return markup.slice(at, markup.indexOf(">", at) + 1);
    };
    const hidden = render(
      <MessageMenuButton
        messageId="a1"
        open={false}
        onOpenChange={() => {}}
        revealed={false}
      />,
      wiring(REPLY),
    );
    expect(tag(hidden)).toContain("pointer-events-none opacity-0");
    expect(tag(hidden)).toContain('aria-hidden="true"');
    // A reply's bar hides as a whole: its ⋯ is never hidden by itself.
    const shown = render(
      <MessageMenuButton messageId="a1" open={false} onOpenChange={() => {}} />,
      wiring(REPLY),
    );
    expect(tag(shown)).not.toContain("opacity-0");
  });

  it("is not there without the conversation's menu, nor on a reply that has none", () => {
    const more = `aria-label="${zhCopy.common.more}"`;
    expect(
      render(
        <MessageMenuButton
          messageId="a1"
          open={false}
          onOpenChange={() => {}}
        />,
      ),
    ).not.toContain(more);
    expect(
      render(
        <MessageMenuButton
          messageId="a9"
          open={false}
          onOpenChange={() => {}}
        />,
        wiring(REPLY),
      ),
    ).not.toContain(more);
  });
});
