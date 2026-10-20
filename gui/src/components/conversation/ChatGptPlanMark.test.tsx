import * as Tooltip from "@radix-ui/react-tooltip";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";

import { Composer } from "./Composer";
import { LLMPill, type ComposerLLMOption } from "./LLMPill";

/**
 * The composer's ChatGPT plan mark (SIWC decision 13): a 13px ChatGPT
 * mark in ink-muted before the model name in the pill, while the
 * conversation's model is on the plan. The plan's model ids come from
 * a hook a static render can't feed through its stores, so it is
 * mocked.
 */

const plan = vi.hoisted(() => ({ keys: new Set<string>(["mm_plan"]) }));

vi.mock("@/hooks/useChatGptPlanModelIds", () => ({
  useChatGptPlanModelIds: () => plan.keys,
}));

afterEach(() => {
  plan.keys = new Set(["mm_plan"]);
});

const LLMS: ComposerLLMOption[] = [
  { index: 0, key: "mm_plan", displayName: "gpt-5.6-sol", isCurrent: true },
  { index: 1, key: "mm_other", displayName: "claude", isCurrent: false },
];

function render(oneLine: boolean): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <Composer
        llmDisplayName="gpt-5.6-sol"
        llms={LLMS}
        oneLine={oneLine}
        reasoningEffort={{
          effective: "high",
          configured: "high",
          override: null,
          onSelect: () => {},
        }}
      />
    </Tooltip.Provider>,
  );
}

/** The pill's TooltipLabel text after one render (the tooltip itself
 * only renders on hover). */
function pillTooltip(planKeys: ReadonlySet<string>): ReactNode {
  let tree: ReactNode = null;
  function Probe() {
    tree = LLMPill({
      llmDisplayName: "gpt-5.6-sol",
      llms: LLMS,
      disabled: false,
      stopMode: false,
      chatGptPlanKeys: planKeys,
    });
    return tree;
  }
  renderToStaticMarkup(
    <Tooltip.Provider>
      <Probe />
    </Tooltip.Provider>,
  );
  // Assigned inside Probe: TypeScript can't see it there.
  const root = tree as unknown as ReactElement<{ children: ReactNode }>;
  const children = Array.isArray(root.props.children)
    ? root.props.children
    : [root.props.children];
  const label = children.find(
    (child: unknown): child is ReactElement<{ text: ReactNode }> =>
      isValidElement(child) &&
      (child.props as { text?: unknown }).text !== undefined,
  );
  expect(label, "the pill's TooltipLabel").toBeDefined();
  return label!.props.text;
}

describe("the composer's ChatGPT plan mark", () => {
  for (const oneLine of [false, true]) {
    const form = oneLine ? "one-line" : "card";

    it(`puts the mark in the model pill, before the name, with no words (${form})`, () => {
      const out = render(oneLine);
      const mark = out.indexOf('data-role="chatgpt-mark"');
      expect(mark).toBeGreaterThan(-1);
      expect(mark).toBeLessThan(out.indexOf("gpt-5.6-sol"));
      expect(out).toContain("size-[13px] text-ink-muted");
      expect(out).not.toContain(zhCopy.chatgptPlan.planLabel);
      // No tag on the apricot tint, nothing left of send.
      expect(out).not.toContain("bg-brand-tint");
    });
  }

  it("shows nothing when the conversation's model is not on the plan", () => {
    plan.keys = new Set(["mm_other"]);
    for (const oneLine of [false, true]) {
      const out = render(oneLine);
      expect(out).not.toContain('data-role="chatgpt-mark"');
      expect(out).not.toContain(zhCopy.chatgptPlan.planLabel);
    }
  });

  it("says what the mark means as the tooltip's second line", () => {
    const onPlan = renderToStaticMarkup(
      <>{pillTooltip(new Set(["mm_plan"]))}</>,
    );
    expect(onPlan).toContain(zhCopy.composer.switchLlm);
    expect(onPlan.indexOf(zhCopy.chatgptPlan.usingPlan)).toBeGreaterThan(
      onPlan.indexOf(zhCopy.composer.switchLlm),
    );
    expect(pillTooltip(new Set(["mm_other"]))).toBe(zhCopy.composer.switchLlm);
  });
});
