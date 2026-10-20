import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Composer } from "./Composer";

/**
 * The composer's ChatGPT plan mark, three steps of the SIWC 票 04 临时切换器
 * (04b), each only while the conversation's model is on the plan. The
 * plan's model ids and the step come from hooks a static render can't
 * feed through their stores, so both are mocked.
 */

const trial = vi.hoisted(() => ({
  step: "1" as "1" | "2" | "3",
  planKeys: new Set<string>(["mm_plan"]),
}));

vi.mock("@/hooks/useChatGptPlanModelIds", () => ({
  useChatGptPlanModelIds: () => trial.planKeys,
}));

vi.mock("@/components/conversation/plan-mark-trial/plan-mark-trial", () => ({
  usePlanMarkVariant: () => trial.step,
}));

afterEach(() => {
  trial.step = "1";
  trial.planKeys = new Set(["mm_plan"]);
});

const LLMS = [
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

describe("the composer's ChatGPT plan mark", () => {
  for (const oneLine of [false, true]) {
    const form = oneLine ? "one-line" : "card";

    it(`step 1 puts the mark in the model pill, before the name, with no words (${form})`, () => {
      const out = render(oneLine);
      const mark = out.indexOf('data-role="chatgpt-mark"');
      expect(mark).toBeGreaterThan(-1);
      expect(mark).toBeLessThan(out.indexOf("gpt-5.6-sol"));
      expect(out).toContain("size-[13px] text-ink-muted");
      expect(out).not.toContain("ChatGPT 订阅");
    });

    it(`step 2 writes it just left of send, nothing after the phrase (${form})`, () => {
      trial.step = "2";
      const out = render(oneLine);
      const words = out.indexOf("ChatGPT 订阅");
      expect(words).toBeGreaterThan(out.indexOf("gpt-5.6-sol"));
      expect(out).toContain('data-role="chatgpt-mark"');
      expect(out).toContain("size-3");
      expect(out).not.toContain("bg-brand-tint");
      // The send / stop control comes after it.
      expect(out.indexOf("<button", words)).toBeGreaterThan(words);
    });

    it(`step 3 tags the phrase on the apricot tint, at the row's size (${form})`, () => {
      trial.step = "3";
      const out = render(oneLine);
      expect(out).toContain("bg-brand-tint");
      expect(out).toContain("ChatGPT 订阅");
      expect(out).not.toContain('data-role="chatgpt-mark"');
      expect(out).toMatch(/bg-brand-tint[^"]*text-\[12\.5px\]/);
    });
  }

  it("shows nothing in any step when the conversation's model is not on the plan", () => {
    trial.planKeys = new Set(["mm_other"]);
    for (const step of ["1", "2", "3"] as const) {
      trial.step = step;
      const out = render(false);
      expect(out, step).not.toContain('data-role="chatgpt-mark"');
      expect(out, step).not.toContain("ChatGPT 订阅");
    }
  });
});
