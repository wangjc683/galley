import * as Tooltip from "@radix-ui/react-tooltip";
import {
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { dropComposerDraft, saveComposerDraft } from "@/lib/composer-draft";

import { Composer, type ComposerProps } from "./Composer";
import { ComposerActionSlot } from "./ComposerActionSlot";

/**
 * Enter in the Composer, and its one-line form. A static render runs no
 * handlers, so the Composer's own render function (it is a `forwardRef`)
 * runs inside a probe component and the test calls the textarea's
 * keydown handler from the element tree it returned.
 */

type ComposerRender = (props: ComposerProps, ref: null) => ReactNode;

/** Every element in a tree, props included: the one-line form gets its
 * pieces as ComposerOneLine's props, not as children. */
function elements(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
  } else if (isValidElement(node)) {
    out.push(node);
    for (const value of Object.values(node.props as Record<string, unknown>)) {
      elements(value, out);
    }
  }
  return out;
}

/** The elements the Composer returns after one render with `props`. */
function composerTree(props: Partial<ComposerProps>): ReactElement[] {
  const render = (Composer as unknown as { render: ComposerRender }).render;
  let tree: ReactNode = null;
  function Probe() {
    tree = render({ llmDisplayName: "model", ...props }, null);
    return tree;
  }
  renderToStaticMarkup(
    <Tooltip.Provider>
      <Probe />
    </Tooltip.Provider>,
  );
  return elements(tree);
}

/** The textarea's keydown handler after one render with `props`. */
function keydownOf(
  props: Partial<ComposerProps>,
): (event: KeyboardEvent<HTMLTextAreaElement>) => void {
  const textarea = composerTree(props).find(
    (element) => element.type === "textarea",
  );
  expect(textarea, "the Composer's textarea").toBeDefined();
  return (
    textarea!.props as {
      onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    }
  ).onKeyDown;
}

function enter(composing = false): KeyboardEvent<HTMLTextAreaElement> {
  return {
    key: "Enter",
    shiftKey: false,
    preventDefault: () => {},
    nativeEvent: { isComposing: composing, keyCode: composing ? 229 : 13 },
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

const EFFORT = {
  effective: null,
  configured: null,
  override: null,
  onSelect: () => {},
};

describe("Enter in the Composer", () => {
  for (const oneLine of [false, true]) {
    const form = oneLine ? "the one-line form" : "the card";
    it(`hands the draft to the send while the agent runs, in ${form}: its owner queues it, nothing opens in between (ruling 71)`, () => {
      const onSubmit = vi.fn();
      const onKeyDown = keydownOf({
        value: "顺便查下周五的天气",
        onChange: () => {},
        onSubmit,
        stopMode: true,
        oneLine,
      });
      onKeyDown(enter());
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith("顺便查下周五的天气", []);
    });

    it(`leaves an Enter that confirms an IME candidate to the IME, in ${form}`, () => {
      const onSubmit = vi.fn();
      const onKeyDown = keydownOf({
        value: "顺便",
        onChange: () => {},
        onSubmit,
        stopMode: true,
        oneLine,
      });
      onKeyDown(enter(true));
      expect(onSubmit).not.toHaveBeenCalled();
    });
  }
});

describe("the one-line form (every session's; the empty state keeps the card)", () => {
  function markup(props: Partial<ComposerProps>): string {
    return renderToStaticMarkup(
      <Tooltip.Provider>
        <Composer
          llmDisplayName="gpt-6.1-sol"
          llms={[{ index: 0, displayName: "gpt-6.1-sol", isCurrent: true }]}
          reasoningEffort={EFFORT}
          {...props}
        />
      </Tooltip.Provider>,
    );
  }

  it("draws one row: ＋, the input, 「模型 · 强度」, send — one line high, eight at most", () => {
    const html = markup({ oneLine: true });
    const box = html.slice(html.indexOf('data-role="composer-one-line"'));
    expect(box.length).toBeLessThan(html.length);
    const order = [
      `aria-label="${zhCopy.composer.addMenuTooltip}"`,
      "<textarea",
      `aria-label="${zhCopy.composer.switchLlm}"`,
      zhCopy.composer.reasoningEffort.default,
      `aria-label="${zhCopy.composer.send}"`,
    ].map((needle) => box.indexOf(needle));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(box).toContain('rows="1"');
    expect(box).toContain("7 * 1.55 * var(--conversation-composer-size)");
    expect(html).toContain("rounded-[24px]");
    expect(html).not.toContain("rounded-md border border-line bg-elevated");
  });

  it("is off by default: the card, two rows high", () => {
    const html = markup({});
    expect(html).not.toContain('data-role="composer-one-line"');
    expect(html).toContain(
      "relative rounded-md border border-line bg-elevated px-3.5",
    );
    expect(html).toContain('rows="2"');
  });

  it("puts the hint row under the box, at the input's text (44px in); under the card it is flush", () => {
    const ROW = '<div class="mt-1.5 text-[11px] text-ink-muted';
    const line = markup({ oneLine: true, showFooterHint: true });
    const box = line.indexOf('data-role="composer-one-line"');
    const row = line.indexOf(`${ROW} pl-[44px]">`);
    expect(row).toBeGreaterThan(box);
    expect(line.slice(row)).toContain(zhCopy.composer.dragToReferenceHint);
    // No hint row asked for (the main chat): none.
    expect(markup({ oneLine: true })).not.toContain(ROW);
    const card = markup({ showFooterHint: true });
    expect(card).toContain(`${ROW}">${zhCopy.composer.dragToReferenceHint}`);
    expect(card).not.toContain("pl-[44px]");
  });

  it("opens the model phrase's popovers centred on their pill (ruling 76; the card keeps them at its start)", () => {
    const aligns = (oneLine: boolean) =>
      composerTree({
        llms: [{ index: 0, displayName: "gpt-6.1-sol", isCurrent: true }],
        reasoningEffort: EFFORT,
        oneLine,
      })
        .filter((element) =>
          ["LLMPill", "EffortPill"].includes(
            (element.type as { name?: string }).name ?? "",
          ),
        )
        .map(
          (element) =>
            (element.props as { popoverAlign?: string }).popoverAlign,
        );
    expect(aligns(true)).toEqual(["center", "center"]);
    expect(aligns(false)).toEqual([undefined, undefined]);
  });
});

describe("quotes above the input (telegram-details ticket 07)", () => {
  const KEY = "composer-test-quotes";

  afterEach(() => dropComposerDraft(KEY));

  function seed(text: string, quotes: string[]): void {
    saveComposerDraft(KEY, { text, images: [], quotes });
  }

  it("sends the quotes ahead of your words, a blank line apart", () => {
    seed("这两处什么意思", ["第一处", "第二处"]);
    const onSubmit = vi.fn();
    keydownOf({ draftKey: KEY, onSubmit, oneLine: true })(enter());
    expect(onSubmit).toHaveBeenCalledWith(
      "> 第一处\n\n> 第二处\n\n这两处什么意思",
      [],
    );
  });

  it("queues the same text while the agent runs, and keeps /btw at the head", () => {
    seed("/btw 这句什么意思", ["这一句"]);
    const onSubmit = vi.fn();
    keydownOf({ draftKey: KEY, onSubmit, oneLine: true, stopMode: true })(
      enter(),
    );
    expect(onSubmit).toHaveBeenCalledWith(
      "/btw \n> 这一句\n\n这句什么意思",
      [],
    );
  });

  it("sends nothing with quotes alone: no words, no image — send stays off", () => {
    seed("", ["只是引用"]);
    const onSubmit = vi.fn();
    keydownOf({ draftKey: KEY, onSubmit, oneLine: true })(enter());
    expect(onSubmit).not.toHaveBeenCalled();
    const slot = composerTree({ draftKey: KEY, oneLine: true }).find(
      (element) => element.type === ComposerActionSlot,
    );
    expect(
      (slot?.props as { hasSendableContent: boolean }).hasSendableContent,
    ).toBe(false);
  });

  it("draws one row per quote inside the box, above the input, with a remove", () => {
    seed("", ["第一处", "第二处"]);
    const html = renderToStaticMarkup(
      <Tooltip.Provider>
        <Composer llmDisplayName="model" draftKey={KEY} oneLine />
      </Tooltip.Provider>,
    );
    const box = html.indexOf('data-role="composer-one-line"');
    const strip = html.indexOf('data-role="composer-quotes"');
    const input = html.indexOf("<textarea");
    expect(box).toBeGreaterThanOrEqual(0);
    expect(strip).toBeGreaterThan(box);
    expect(input).toBeGreaterThan(strip);
    expect(html).toContain("第一处");
    expect(html).toContain("第二处");
    expect(
      html.split(`aria-label="${zhCopy.composer.removeQuote}"`),
    ).toHaveLength(3);
  });

  it("draws a row as ↳ in ＋'s column and one line of the quote (C2, ticket 08)", () => {
    seed("", ["第一行\n第二行"]);
    const html = renderToStaticMarkup(
      <Tooltip.Provider>
        <Composer llmDisplayName="model" draftKey={KEY} oneLine />
      </Tooltip.Provider>,
    );
    const strip = html.slice(html.indexOf('data-role="composer-quotes"'));
    // The glyph's column is ＋'s, 32px wide; the quote one truncated line.
    expect(strip).toContain("w-8 justify-center");
    expect(strip).toContain("<svg");
    expect(strip).toContain("truncate");
    expect(strip).toContain(">第一行 第二行<");
    expect(strip).not.toContain("line-clamp");
    expect(strip).not.toContain("border-l-2");
  });
});
