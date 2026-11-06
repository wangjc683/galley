import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { LocalFilesContext } from "@/lib/local-files";
import type { MessageTelemetry } from "@/types/conversation";

import { MessageActions } from "./MessageActions";
import { MessageAgent } from "./MessageAgent";
import { MessageMenuProvider, type MessageMenuWiring } from "./MessageMenu";

/**
 * A reply's action bar, the workbench's and the assistant's (main chat
 * PRD rulings 68, 99): the assistant's is icons only — copy, quote,
 * save, the process button for a reply of two steps or more, then ⋯ —
 * with no numbers; pressed while its steps are open, and then the whole
 * bar stays up. Since ruling 199 it hangs beside the bubble, out of
 * flow; the workbench's stays under its answer. Quote and ⋯ come with
 * the conversation's message menu (MessageMenuProvider, which MainView
 * wires for the main chat); what quote does is
 * Conversation.quote.test.tsx's.
 */

const TELEMETRY: MessageTelemetry = {
  elapsedMs: 45_000,
  inputTokens: 33_000,
  outputTokens: 1_100,
  contextUsedChars: 39_000,
  contextLimitChars: 300_000,
};

const HIDDEN =
  "pointer-events-none opacity-0 group-hover/answer:pointer-events-auto group-hover/answer:opacity-100";

function html(node: ReactNode): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        {node}
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

/** The bar's opening tag. */
function barTag(markup: string): string {
  const at = markup.indexOf("data-hover-row");
  return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
}

/** The workbench's bar: under its answer, in flow. */
const WORKBENCH_BAR =
  '<div data-hover-row="" class="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1';
/** The assistant's: beside its bubble, out of flow, 6px off (ruling 199). */
const BESIDE_BAR =
  '<div data-hover-row="" class="absolute bottom-0 left-full flex w-max items-center pl-1.5';

/** The element whose opening tag starts at `start`, whole. */
function elementAt(markup: string, start: number): string {
  let depth = 0;
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = start;
  for (let m = tags.exec(markup); m; m = tags.exec(markup)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return markup.slice(start, m.index + 6);
  }
  throw new Error("unbalanced");
}

/** The `<button>` tags, in order. */
function buttonTags(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
}

const label = (tag: string) => /aria-label="([^"]*)"/.exec(tag)?.[1];

/** The main chat's menus, for the reply on row `a1`. */
const MENU: MessageMenuWiring = {
  has: (id) => id === "a1",
  canQuote: (id) => id === "a1",
  model: () => null,
};

function withMenu(node: ReactNode): ReactNode {
  return <MessageMenuProvider value={MENU}>{node}</MessageMenuProvider>;
}

describe("the workbench's reply bar", () => {
  it("is copy, save | ↑ ↓ and the context, on hover", () => {
    // No quote and no ⋯, even under a conversation that has the menu.
    const markup = html(
      withMenu(
        <MessageActions source="好的。" telemetry={TELEMETRY} messageId="a1" />,
      ),
    );
    expect(barTag(markup)).toContain(HIDDEN);
    // Under its answer, in flow, as before ruling 199.
    expect(barTag(markup)).toBe(`${WORKBENCH_BAR} ${HIDDEN}">`);
    expect(buttonTags(markup).map(label)).toEqual([
      zhCopy.conversation.copy,
      zhCopy.conversation.save,
    ]);
    expect(markup).toContain('class="h-3 w-px bg-line"');
    expect(markup).toContain(
      `aria-label="${zhCopy.conversation.telemetryInputTip("33k")}"`,
    );
    expect(markup).toContain(
      `aria-label="${zhCopy.conversation.telemetryOutputTip("1.1k")}"`,
    );
    expect(markup).toContain(">13%<");
    expect(markup).not.toContain('aria-expanded="');
  });
});

describe("the workbench's reply, around its bar", () => {
  it("draws the answer, then the bar under it, in flow: no bubble, nothing beside", () => {
    const markup = html(
      <MessageAgent messageId="a1" telemetry={TELEMETRY}>
        好的，**明早 9 点**提醒你。
      </MessageAgent>,
    );
    expect(markup).not.toContain('data-role="assistant-bubble"');
    expect(markup).not.toContain("left-full");
    expect(markup).not.toContain("calc(100%-134px)");
    const bar = markup.indexOf(WORKBENCH_BAR);
    expect(bar).toBeGreaterThan(markup.indexOf("明早 9 点"));
    // The answer's row holds the prose, then the bar, nothing else.
    expect(markup.startsWith('<div data-message-id="a1"')).toBe(true);
    expect(markup).toContain('class="group/answer"');
  });
});

describe("the assistant's reply bar", () => {
  const reply = (process?: { open: boolean }) =>
    html(
      withMenu(
        <MessageAgent
          bubble
          messageId="a1"
          telemetry={TELEMETRY}
          process={process && { ...process, onToggle: () => {} }}
        >
          好的，**明早 9 点**提醒你。
        </MessageAgent>,
      ),
    );

  it("hangs beside the bubble: its last child, off its right edge, bottom edges flush, 6px off", () => {
    const markup = reply();
    const bubble = elementAt(
      markup,
      markup.lastIndexOf(
        "<div",
        markup.indexOf('data-role="assistant-bubble"'),
      ),
    );
    // In the bubble (its containing block, `relative`), after the words.
    expect(bubble).toMatch(
      /^<div data-role="assistant-bubble" class="relative /,
    );
    expect(bubble).toContain("calc(100%-134px)");
    expect(bubble.indexOf(BESIDE_BAR)).toBeGreaterThan(
      bubble.indexOf("明早 9 点"),
    );
    expect(bubble.endsWith("</div></div></div>")).toBe(true);
    expect(markup).not.toContain(WORKBENCH_BAR);
    // One line, the room the cap leaves it.
    expect(barTag(markup)).not.toContain("flex-wrap");
    expect(barTag(markup)).toBe(`${BESIDE_BAR} ${HIDDEN}">`);
  });

  it("is copy, quote, save and ⋯ beside a one-step reply, with no numbers, on hover", () => {
    const markup = reply();
    expect(barTag(markup)).toContain(HIDDEN);
    expect(buttonTags(markup).map(label)).toEqual([
      zhCopy.conversation.copy,
      zhCopy.conversation.quoteSelection,
      zhCopy.conversation.save,
      zhCopy.common.more,
    ]);
    expect(markup).not.toContain('class="h-3 w-px bg-line"');
    expect(markup).not.toContain("33k");
    expect(markup).not.toContain("13%");
    expect(markup).not.toMatch(/\d+ 步/);
  });

  it("puts the process button after save, before ⋯, for a reply of two steps or more, in the chips' family", () => {
    const markup = reply({ open: false });
    expect(barTag(markup)).toContain(HIDDEN);
    const tags = buttonTags(markup);
    expect(tags.map(label)).toEqual([
      zhCopy.conversation.copy,
      zhCopy.conversation.quoteSelection,
      zhCopy.conversation.save,
      zhCopy.conversation.foldExpand,
      zhCopy.common.more,
    ]);
    const process = tags[3];
    expect(process).toContain('aria-expanded="false"');
    expect(process).toContain('tabindex="-1"');
    // Copy's skin exactly: the same size, ink and hover ground; quote's
    // too, and it is no disclosure.
    const skin = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1];
    expect(skin(process)).toBe(skin(tags[0]));
    const quote = tags[1];
    expect(skin(quote)).toBe(skin(tags[0]));
    expect(quote).toContain('tabindex="-1"');
    expect(quote).not.toContain("aria-expanded");
    expect(markup).not.toContain("33k");
  });

  it("pressed while its steps are open, it keeps the whole bar up", () => {
    const markup = reply({ open: true });
    expect(barTag(markup)).not.toContain("opacity-0");
    expect(barTag(markup)).toBe(`${BESIDE_BAR}">`);
    const process = buttonTags(markup)[3];
    expect(label(process)).toBe(zhCopy.conversation.foldCollapse);
    expect(process).toContain('aria-expanded="true"');
    // The hover ground held, the ink a rung up; not the success check.
    expect(process).toContain("bg-hover text-ink");
    expect(process).not.toContain("text-ink-muted");
    expect(process).not.toContain("text-success");
    // Copy and save keep their resting skin.
    expect(buttonTags(markup)[0]).toContain(
      "text-ink-muted hover:bg-hover hover:text-ink-soft",
    );
  });

  it("has no quote where the menu has no 引用 (canQuote), the rest as ever", () => {
    const markup = html(
      <MessageMenuProvider value={{ ...MENU, canQuote: () => false }}>
        <MessageAgent bubble messageId="a1">
          ![猫](/tmp/cat.png)
        </MessageAgent>
      </MessageMenuProvider>,
    );
    expect(buttonTags(markup).map(label)).toEqual([
      zhCopy.conversation.copy,
      zhCopy.conversation.save,
      zhCopy.common.more,
    ]);
  });

  it("is the process button and ⋯ alone for leaked tool-call markup, beside its notice at the bubble's cap", () => {
    const markup = html(
      withMenu(
        <MessageAgent
          bubble
          messageId="a1"
          process={{ open: false, onToggle: () => {} }}
        >
          {
            '<invoke name="web_scan"><parameter name="url">x</parameter></invoke>'
          }
        </MessageAgent>,
      ),
    );
    expect(buttonTags(markup).map(label)).toEqual([
      zhCopy.conversation.foldExpand,
      zhCopy.common.more,
    ]);
    expect(barTag(markup)).toContain(HIDDEN);
    expect(markup).toContain('class="group/answer"');
    // No bubble: the notice takes the bubble's cap in a box of its own,
    // and the bar hangs beside that box.
    const box = '<div class="relative max-w-[calc(100%-134px)]">';
    expect(markup).toContain(box);
    const inBox = elementAt(markup, markup.indexOf(box));
    expect(inBox).toContain(BESIDE_BAR);
    expect(inBox.indexOf(BESIDE_BAR)).toBeGreaterThan(
      inBox.indexOf('class="relative my-3 overflow-hidden rounded-md'),
    );
  });

  it("hangs the bar beside a ChatGPT plan error the same way", () => {
    const markup = html(
      withMenu(
        <MessageAgent bubble messageId="a1">
          {
            "!!!Error: HTTP 429: ChatGPT plan usage limit reached (subscription_sharing_usage_limit_exceeded): this is your plan's limit or the limit you set for Galley; manage usage at https://chatgpt.com/settings/usage"
          }
        </MessageAgent>,
      ),
    );
    const box = '<div class="relative max-w-[calc(100%-134px)]">';
    expect(markup).toContain(box);
    expect(elementAt(markup, markup.indexOf(box))).toContain(BESIDE_BAR);
    expect(buttonTags(markup).map(label)).toContain(zhCopy.common.more);
    // The workbench's plan error has no bar and no box.
    const today = html(
      <MessageAgent messageId="a1">
        {
          "!!!Error: HTTP 429: ChatGPT plan usage limit reached (subscription_sharing_usage_limit_exceeded): this is your plan's limit or the limit you set for Galley; manage usage at https://chatgpt.com/settings/usage"
        }
      </MessageAgent>,
    );
    expect(today).not.toContain(box);
    expect(today).not.toContain("data-hover-row");
  });
});
