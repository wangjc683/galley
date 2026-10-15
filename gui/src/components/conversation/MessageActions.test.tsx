import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { LocalFilesContext } from "@/lib/local-files";
import type { MessageTelemetry } from "@/types/conversation";

import { MessageActions } from "./MessageActions";
import { MessageAgent } from "./MessageAgent";

/**
 * A reply's action bar, the workbench's and the assistant's (main chat
 * PRD ruling 68): the assistant's is icons only — copy, save, and the
 * process button last under a reply of two steps or more — with no
 * numbers; pressed while its steps are open, and then the whole bar
 * stays up.
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
  const at = markup.indexOf('class="mt-1.5 flex');
  return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
}

/** The `<button>` tags, in order. */
function buttonTags(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
}

const label = (tag: string) => /aria-label="([^"]*)"/.exec(tag)?.[1];

describe("the workbench's reply bar", () => {
  it("is copy, save | ↑ ↓ and the context, on hover", () => {
    const markup = html(
      <MessageActions source="好的。" telemetry={TELEMETRY} />,
    );
    expect(barTag(markup)).toContain(HIDDEN);
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

describe("the assistant's reply bar", () => {
  const reply = (process?: { open: boolean }) =>
    html(
      <MessageAgent
        bubble
        telemetry={TELEMETRY}
        process={process && { ...process, onToggle: () => {} }}
      >
        好的，**明早 9 点**提醒你。
      </MessageAgent>,
    );

  it("is copy and save only under a one-step reply, with no numbers, on hover", () => {
    const markup = reply();
    expect(barTag(markup)).toContain(HIDDEN);
    expect(buttonTags(markup).map(label)).toEqual([
      zhCopy.conversation.copy,
      zhCopy.conversation.save,
    ]);
    expect(markup).not.toContain('class="h-3 w-px bg-line"');
    expect(markup).not.toContain("33k");
    expect(markup).not.toContain("13%");
    expect(markup).not.toMatch(/\d+ 步/);
  });

  it("puts the process button last under a reply of two steps or more, in the chips' family", () => {
    const markup = reply({ open: false });
    expect(barTag(markup)).toContain(HIDDEN);
    const tags = buttonTags(markup);
    expect(tags.map(label)).toEqual([
      zhCopy.conversation.copy,
      zhCopy.conversation.save,
      zhCopy.conversation.foldExpand,
    ]);
    const process = tags[2];
    expect(process).toContain('aria-expanded="false"');
    expect(process).toContain('tabindex="-1"');
    // Copy's skin exactly: the same size, ink and hover ground.
    const skin = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1];
    expect(skin(process)).toBe(skin(tags[0]));
    expect(markup).not.toContain("33k");
  });

  it("pressed while its steps are open, it keeps the whole bar up", () => {
    const markup = reply({ open: true });
    expect(barTag(markup)).not.toContain("opacity-0");
    expect(barTag(markup)).toBe(
      '<div class="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">',
    );
    const process = buttonTags(markup)[2];
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

  it("is the process button alone under leaked tool-call markup", () => {
    const markup = html(
      <MessageAgent bubble process={{ open: false, onToggle: () => {} }}>
        {'<invoke name="web_scan"><parameter name="url">x</parameter></invoke>'}
      </MessageAgent>,
    );
    expect(buttonTags(markup).map(label)).toEqual([
      zhCopy.conversation.foldExpand,
    ]);
    expect(barTag(markup)).toContain(HIDDEN);
    expect(markup).toContain('class="group/answer"');
  });
});
