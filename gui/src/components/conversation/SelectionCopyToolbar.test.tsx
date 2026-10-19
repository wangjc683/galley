import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { LocalFilesContext } from "@/lib/local-files";
import {
  selectionToolbarServes,
  useYieldsToSelection,
} from "@/lib/selection-copy";

import { MessageAgent } from "./MessageAgent";
import { MessageMenuProvider, type MessageMenuWiring } from "./MessageMenu";
import { MessageUser } from "./MessageUser";
import { SelectionToolbarShell } from "./SelectionCopyToolbar";

/**
 * The selection toolbar and the hover rows as one family (main chat PRD
 * ruling 108, ticket 56): one floating shell holding the hover rows' own
 * bare chips, and while it shows, the message it serves keeps its hover
 * row down. A static render cannot select or hover: the toolbar names the
 * message it serves the way it does on a selection (`selectionToolbarServes`
 * with the key on the message's `data-selection-yield`), and the rows
 * render as they would.
 */

afterEach(() => {
  selectionToolbarServes(null);
});

function html(node: ReactNode): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        {node}
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

/** The `<button>` tags, in order. */
function buttonTags(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
}

const label = (tag: string) => /aria-label="([^"]*)"/.exec(tag)?.[1];

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

/** Every message's key for the selection toolbar, in order. */
function yieldKeys(markup: string): string[] {
  return [...markup.matchAll(/data-selection-yield="([^"]+)"/g)].map(
    (m) => m[1],
  );
}

describe("the selection toolbar's shell", () => {
  const shell = (props: { copied?: boolean; quote?: boolean } = {}) =>
    html(
      <SelectionToolbarShell
        side="right"
        left={900}
        top={300}
        copied={props.copied ?? false}
        onCopy={() => {}}
        onQuote={props.quote === false ? undefined : () => {}}
      />,
    );

  it("is one floating shell: solid elevated ground, a 1px line border, the float shadow, no glass", () => {
    const markup = shell();
    expect(count(markup, "data-selection-copy-toolbar")).toBe(1);
    const tag = /<div[^>]*data-selection-copy-toolbar[^>]*>/.exec(markup)![0];
    expect(tag).toContain(
      "rounded-md border border-line bg-elevated p-1.5 shadow-[var(--shadow-float)]",
    );
    // Copy over quote, the hover row's 2px apart.
    expect(tag).toContain("flex flex-col gap-0.5");
    expect(markup).not.toContain("backdrop-blur");
    // The armour is worn once: no chip has a border, ground or shadow.
    expect(count(markup, "border-line")).toBe(1);
    expect(count(markup, "shadow-[")).toBe(1);
  });

  it("holds the hover rows' own chips: 24px, bare, out of the Tab order", () => {
    const tags = buttonTags(shell());
    expect(tags.map(label)).toEqual([
      zhCopy.conversation.copySelection,
      zhCopy.conversation.quoteSelection,
    ]);
    for (const tag of tags) {
      expect(tag).toContain("size-6 border border-transparent");
      expect(tag).toContain(
        "text-ink-muted hover:bg-hover hover:text-ink-soft",
      );
      expect(tag).toContain('tabindex="-1"');
      expect(tag).not.toContain("size-7");
      expect(tag).not.toContain("bg-elevated");
    }
  });

  it("flashes the check after a copy, and holds copy alone without quote", () => {
    const copied = buttonTags(shell({ copied: true }));
    expect(label(copied[0])).toBe(zhCopy.conversation.copied);
    expect(copied[0]).toContain("text-success");

    const alone = shell({ quote: false });
    expect(count(alone, "data-selection-copy-toolbar")).toBe(1);
    expect(buttonTags(alone).map(label)).toEqual([
      zhCopy.conversation.copySelection,
    ]);
  });

  it("sits left of its anchor on the left side, right of it on the right", () => {
    const left = html(
      <SelectionToolbarShell
        side="left"
        left={60}
        top={300}
        copied={false}
        onCopy={() => {}}
      />,
    );
    expect(left).toContain("-translate-x-full");
    expect(shell()).not.toContain("-translate-x-full");
  });
});

function Probe({ id }: { id?: string }) {
  return <i>{String(useYieldsToSelection(id))}</i>;
}

describe("useYieldsToSelection", () => {
  it("answers true only for the message the toolbar serves, and none once it goes", () => {
    const probes = () =>
      html(
        <>
          <Probe id="a" />
          <Probe id="b" />
          <Probe />
        </>,
      );
    expect(probes()).toBe("<i>false</i><i>false</i><i>false</i>");
    selectionToolbarServes("a");
    expect(probes()).toBe("<i>true</i><i>false</i><i>false</i>");
    selectionToolbarServes("b");
    expect(probes()).toBe("<i>false</i><i>true</i><i>false</i>");
    selectionToolbarServes(null);
    expect(probes()).toBe("<i>false</i><i>false</i><i>false</i>");
  });
});

/** The main chat's menus, for the replies and bubbles below. */
const MENU: MessageMenuWiring = {
  has: () => true,
  canQuote: () => true,
  model: () => null,
};

const BAR = 'class="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1';
const HOVER_HIDDEN =
  "pointer-events-none opacity-0 group-hover/answer:pointer-events-auto group-hover/answer:opacity-100";

/** Each reply's bar's class, in order. */
function barClasses(markup: string): string[] {
  return [...markup.matchAll(/class="(mt-1\.5 flex flex-wrap[^"]*)"/g)].map(
    (m) => m[1],
  );
}

describe("a reply's bar yields to the selection toolbar", () => {
  const replies = (process?: { open: boolean }, bubble = true) =>
    html(
      <MessageMenuProvider value={MENU}>
        <MessageAgent
          bubble={bubble}
          messageId="a1"
          process={process && { ...process, onToggle: () => {} }}
        >
          多云，记得带伞。
        </MessageAgent>
        <MessageAgent bubble={bubble} messageId="a2">
          排好了。
        </MessageAgent>
      </MessageMenuProvider>,
    );

  it("gives each reply a key of its own on its hover region", () => {
    const markup = replies();
    const keys = yieldKeys(markup);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    // On the hover region (`group/answer`), around the selection scope.
    expect(markup).toMatch(
      /<div data-message-id="a1" data-selection-yield="[^"]+" class="group\/answer/,
    );
  });

  it("is down, hover or not, for the reply the toolbar serves; the other reply is untouched", () => {
    const [first] = yieldKeys(replies());
    selectionToolbarServes(first);
    const [served, other] = barClasses(replies());
    expect(served).toContain("pointer-events-none opacity-0");
    expect(served).not.toContain("group-hover/answer");
    expect(other).toContain(HOVER_HIDDEN);
  });

  it("comes back on hover when the toolbar goes", () => {
    const [first] = yieldKeys(replies());
    selectionToolbarServes(first);
    selectionToolbarServes(null);
    for (const bar of barClasses(replies())) {
      expect(bar).toContain(HOVER_HIDDEN);
    }
  });

  it("is down even while its open steps hold it up, and held up again after", () => {
    const open = { open: true };
    // Held up: no hiding at all.
    expect(barClasses(replies(open))[0]).not.toContain("opacity-0");
    const [first] = yieldKeys(replies(open));
    selectionToolbarServes(first);
    const markup = replies(open);
    expect(barClasses(markup)[0]).toContain("pointer-events-none opacity-0");
    // The steps stay open: the process button is still pressed.
    expect(markup).toContain('aria-expanded="true"');
    selectionToolbarServes(null);
    expect(barClasses(replies(open))[0]).not.toContain("opacity-0");
  });

  it("yields the same way in the workbench", () => {
    const workbench = replies(undefined, false);
    expect(count(workbench, BAR)).toBe(2);
    const [first] = yieldKeys(workbench);
    selectionToolbarServes(first);
    const [served, other] = barClasses(replies(undefined, false));
    expect(served).toContain("pointer-events-none opacity-0");
    expect(served).not.toContain("group-hover/answer");
    expect(other).toContain(HOVER_HIDDEN);
  });
});

/** The whole `<div>` opening at `start`. */
function elementAt(markup: string, start: number): string {
  let depth = 0;
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = start;
  for (let m = tags.exec(markup); m; m = tags.exec(markup)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return markup.slice(start, m.index + 6);
  }
  throw new Error("unbalanced div");
}

/** The row under each of your bubbles: its chips' container class. */
function chipGroups(markup: string): string[] {
  return [...markup.matchAll(/class="(flex items-center gap-0\.5[^"]*)"/g)].map(
    (m) => m[1],
  );
}

describe("the row under your bubble yields to the selection toolbar", () => {
  const bubbles = () =>
    html(
      <MessageMenuProvider value={MENU}>
        <MessageUser content="早，天气怎么样？" messageId="u1" assistant />
        <MessageUser content="帮我排个行程" messageId="u2" assistant />
      </MessageMenuProvider>,
    );

  it("is down for the bubble the toolbar serves, the other untouched, and back when it goes", () => {
    const keys = yieldKeys(bubbles());
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    // On the row (MessageUser's outer div), around the bubble.
    expect(bubbles()).toMatch(
      /<div class="group relative[^"]*" data-selection-yield="[^"]+">/,
    );

    expect(chipGroups(bubbles())).toEqual([
      "flex items-center gap-0.5",
      "flex items-center gap-0.5",
    ]);
    selectionToolbarServes(keys[1]);
    const [other, served] = chipGroups(bubbles());
    expect(served).toBe(
      "flex items-center gap-0.5 pointer-events-none opacity-0",
    );
    expect(other).toBe("flex items-center gap-0.5");
    selectionToolbarServes(null);
    expect(chipGroups(bubbles())).toEqual([
      "flex items-center gap-0.5",
      "flex items-center gap-0.5",
    ]);
  });

  it("keeps a long message's toggle, which is no hover action", () => {
    const long = Array.from({ length: 9 }, (_, i) => `第 ${i + 1} 行`).join(
      "\n",
    );
    const markup = () =>
      html(
        <MessageMenuProvider value={MENU}>
          <MessageUser content={long} messageId="u3" assistant />
        </MessageMenuProvider>,
      );
    const [key] = yieldKeys(markup());
    selectionToolbarServes(key);
    const yielded = markup();
    expect(chipGroups(yielded)).toEqual([
      "flex items-center gap-0.5 pointer-events-none opacity-0",
    ]);
    // The toggle stands beside the chips, outside what yields.
    const group = elementAt(
      yielded,
      yielded.lastIndexOf("<div", yielded.indexOf("gap-0.5 pointer-events")),
    );
    const expand = zhCopy.conversation.expandLines(9);
    expect(group).not.toContain(expand);
    const at = yielded.indexOf(expand);
    expect(at).toBeGreaterThan(-1);
    const toggle = yielded.slice(yielded.lastIndexOf("<button", at), at);
    expect(toggle).not.toContain("opacity-0");
  });

  it("leaves the workbench's hover copy alone: no selection toolbar there, nothing to yield to", () => {
    const workbench = html(
      <MessageUser content="帮我排个行程" messageId="u2" />,
    );
    // Not a selection scope, so the toolbar never names it.
    expect(workbench).not.toContain("data-selection-copy-scope");
    expect(workbench).not.toContain("data-selection-yield");
    selectionToolbarServes("anything");
    const after = html(<MessageUser content="帮我排个行程" messageId="u2" />);
    expect(after).toBe(workbench);
    expect(buttonTags(after).map(label)).toEqual([zhCopy.conversation.copy]);
  });
});
