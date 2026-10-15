import * as Tooltip from "@radix-ui/react-tooltip";
import {
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";

import { Composer, type ComposerProps } from "./Composer";

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

describe("the one-line form (the main chat's)", () => {
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

  it("opens the model phrase's popovers right-aligned (the card keeps them left)", () => {
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
    expect(aligns(true)).toEqual(["end", "end"]);
    expect(aligns(false)).toEqual([undefined, undefined]);
  });
});
