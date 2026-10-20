import * as Popover from "@radix-ui/react-popover";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";

import { LLMMenu, type ComposerLLMOption } from "./LLMPill";

/**
 * The model menu (LLMPill's popover body; a static render never opens
 * the popover, so the body is rendered on its own). SIWC decision 14:
 * plan rows carry the ChatGPT mark, the plan's usage link sits in the
 * action block, and the mark counts in the duplicate-name rule.
 */

const ALWAYS = 'max-w-[96px] opacity-100">';
const HOVER_ONLY = "max-w-0 opacity-0 group-hover/llm-option:max-w-[96px]";
const FOOTER = `${zhCopy.chatgptPlan.planLabel} · ${zhCopy.chatgptPlan.manageUsage}`;

function menu(
  llms: ComposerLLMOption[],
  planKeys: ReadonlySet<string> = new Set(),
  { configureLink = true }: { configureLink?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <Popover.Root>
      <LLMMenu
        llms={llms}
        chatGptPlanKeys={planKeys}
        disabled={false}
        stopMode={false}
        onConfigureModels={configureLink ? () => {} : undefined}
        footerHint="footer hint"
      />
    </Popover.Root>,
  );
}

/** Each model row's markup, in list order. */
function rows(out: string): string[] {
  return out
    .split("<button")
    .slice(1)
    .filter((row) => row.includes("group/llm-option"));
}

function option(
  index: number,
  key: string,
  displayName: string,
  providerDisplayName: string,
): ComposerLLMOption {
  return {
    index,
    key,
    displayName,
    providerDisplayName,
    isCurrent: index === 0,
  };
}

describe("the model menu's ChatGPT plan rows (SIWC decision 14)", () => {
  it("puts the pill's 13px mark before a plan model's name, not before the others", () => {
    const [planRow, otherRow] = rows(
      menu(
        [
          option(0, "mm_plan", "gpt-6.1-sol", "ChatGPT"),
          option(1, "mm_cpa", "grok-4.7", "CPA"),
        ],
        new Set(["mm_plan"]),
      ),
    );
    const mark = planRow.indexOf('data-role="chatgpt-mark"');
    expect(mark).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(planRow.indexOf("gpt-6.1-sol"));
    expect(planRow).toContain("size-[13px] text-ink-muted");
    expect(otherRow).not.toContain('data-role="chatgpt-mark"');
  });

  it("has no header in the list: the plan's line is in the action block, after 「配置模型…」", () => {
    const out = menu(
      [
        option(0, "mm_cpa", "grok-4.7", "CPA"),
        option(1, "mm_plan", "gpt-6.1-sol", "ChatGPT"),
        option(2, "mm_other", "claude", "Anthropic"),
      ],
      new Set(["mm_plan"]),
    );
    const block = out.indexOf("border-t border-line/60");
    expect(out.indexOf(FOOTER)).toBeGreaterThan(block);
    expect(out.indexOf(FOOTER)).toBeGreaterThan(
      out.indexOf(zhCopy.composer.configureModels),
    );
    // In the action rows' register, its mark at their 11px.
    const footerRow = out.slice(
      out.lastIndexOf("<button", out.indexOf(FOOTER)),
    );
    expect(footerRow).toContain("text-[11px] leading-[1.35] text-ink-muted/70");
    expect(footerRow).toContain("size-[11px]");
    // Nothing between the rows any more.
    expect(out.slice(0, block)).not.toContain(zhCopy.chatgptPlan.planLabel);
  });

  it("keeps the line when the menu has no settings link", () => {
    const out = menu(
      [option(0, "mm_plan", "gpt-6.1-sol", "ChatGPT")],
      new Set(["mm_plan"]),
      { configureLink: false },
    );
    expect(out).toContain(FOOTER);
    expect(out).not.toContain(zhCopy.composer.configureModels);
    expect(out).not.toContain("footer hint");
  });

  it("has no plan line without a plan model", () => {
    const out = menu([
      option(0, "mm_cpa", "gpt-6.1-sol", "CPA"),
      option(1, "mm_other", "claude", "Anthropic"),
    ]);
    expect(out).toContain(zhCopy.composer.configureModels);
    expect(out).not.toContain(zhCopy.chatgptPlan.planLabel);
    expect(out).not.toContain('data-role="chatgpt-mark"');
    // Without the settings link either, the footer hint as before.
    const bare = menu([option(0, "mm_cpa", "gpt-6.1-sol", "CPA")], new Set(), {
      configureLink: false,
    });
    expect(bare).toContain("footer hint");
    expect(bare).not.toContain(zhCopy.chatgptPlan.planLabel);
  });
});

describe("the model menu's duplicate-name rule", () => {
  it("shows the provider on hover only when the mark tells same-name rows apart", () => {
    const [planRow, cpaRow] = rows(
      menu(
        [
          option(0, "mm_plan", "gpt-6.1-sol", "ChatGPT"),
          option(1, "mm_cpa", "gpt-6.1-sol", "CPA"),
        ],
        new Set(["mm_plan"]),
      ),
    );
    for (const row of [planRow, cpaRow]) {
      expect(row).toContain(HOVER_ONLY);
      expect(row).not.toContain(ALWAYS);
    }
  });

  it("keeps the provider shown on same-name rows the mark can't tell apart", () => {
    const [first, second, unique] = rows(
      menu([
        option(0, "mm_a", "gpt-6.1-sol", "CPA"),
        option(1, "mm_b", "gpt-6.1-sol ", "OpenRouter"),
        option(2, "mm_c", "claude", "Anthropic"),
      ]),
    );
    expect(first).toContain(ALWAYS);
    expect(second).toContain(ALWAYS);
    expect(unique).toContain(HOVER_ONLY);
  });
});
