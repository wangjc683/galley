// @vitest-environment jsdom
import { Command } from "cmdk";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CopyProvider } from "@/lib/i18n";

import {
  CommandPalette,
  SwitchLLMPage,
  type LLMOption,
} from "./CommandPalette";

/**
 * ⌘K → 切换模型 follows the model menu (SIWC decision 18): a model that
 * spends the ChatGPT plan has the ChatGPT mark in the Cube's place, and
 * rows whose names match and the mark can't tell apart keep their
 * provider name shown. Real cmdk in jsdom: two rows with one name must
 * still be two rows to the keyboard.
 */

const plan = vi.hoisted(() => ({ keys: new Set<string>() }));
vi.mock("@/hooks/useChatGptPlanModelIds", () => ({
  useChatGptPlanModelIds: () => plan.keys,
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // cmdk sizes its list with a ResizeObserver and scrolls the selected
  // row into view; jsdom has neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  plan.keys = new Set();
});

function mount(node: React.ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CopyProvider language="zh-CN">{node}</CopyProvider>);
  });
  return container;
}

/** The page as the palette shows it: cmdk does not filter it. */
function page(
  llms: LLMOption[],
  planKeys: ReadonlySet<string>,
  onPick: (index: number) => void = () => {},
): HTMLElement {
  return mount(
    <Command shouldFilter={false}>
      <Command.List>
        <SwitchLLMPage
          llms={llms}
          chatGptPlanKeys={planKeys}
          onPick={onPick}
          onBack={() => {}}
        />
      </Command.List>
    </Command>,
  );
}

function option(
  index: number,
  key: string,
  displayName: string,
  providerDisplayName: string,
): LLMOption {
  return {
    index,
    key,
    displayName,
    providerDisplayName,
    isCurrent: index === 0,
  };
}

/** The model rows (the back row left out), in list order. */
function modelRows(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[cmdk-item]"),
  ).filter((row) => row.getAttribute("data-value")?.startsWith("llm "));
}

/** The row's leading icon place (PaletteRow's first slot). */
const iconSlot = (row: HTMLElement) =>
  row.firstElementChild!.firstElementChild as HTMLElement;

const mark = (row: HTMLElement) =>
  row.querySelector('[data-role="chatgpt-mark"]');

/** The shown provider name: the row's truncating aside. */
const providerShown = (row: HTMLElement) =>
  row.querySelector("span.max-w-\\[160px\\]")?.textContent ?? null;

describe("⌘K → 切换模型", () => {
  it("puts the ChatGPT mark in a plan row's icon place, in a 16px box", () => {
    const container = page(
      [
        option(0, "mm_plan", "gpt-6.1-sol", "ChatGPT"),
        option(1, "mm_other", "claude-5", "Anthropic"),
      ],
      new Set(["mm_plan"]),
    );
    const [onPlan, other] = modelRows(container);
    const planMark = mark(onPlan);
    expect(planMark).not.toBeNull();
    expect(planMark!.className).toContain("size-[14px] text-ink-muted");
    expect(planMark!.parentElement!.className).toContain(
      "size-4 items-center justify-center",
    );
    // The mark takes the Cube's place; other rows keep the Cube.
    expect(iconSlot(onPlan).contains(planMark)).toBe(true);
    expect(iconSlot(onPlan).querySelector("svg")).toBeNull();
    expect(mark(other)).toBeNull();
    expect(iconSlot(other).querySelector("svg")).not.toBeNull();
  });

  it("keeps the provider name on same-name rows the mark can't tell apart", () => {
    const bothOnPlan = page(
      [
        option(0, "mm_a", "gpt-6.1-sol", "ChatGPT"),
        option(1, "mm_b", "gpt-6.1-sol", "ChatGPT Team"),
        option(2, "mm_c", "claude-5", "Anthropic"),
      ],
      new Set(["mm_a", "mm_b"]),
    );
    expect(modelRows(bothOnPlan).map(providerShown)).toEqual([
      "ChatGPT",
      "ChatGPT Team",
      null,
    ]);
    act(() => root?.unmount());

    const neither = page(
      [
        option(0, "mm_a", "gpt-6.1-sol", "CPA"),
        option(1, "mm_b", "gpt-6.1-sol", "OpenAI"),
      ],
      new Set(),
    );
    const [first] = modelRows(neither);
    expect(modelRows(neither).map(providerShown)).toEqual(["CPA", "OpenAI"]);
    // Long names truncate, the full one on hover.
    expect(first.querySelector("span.max-w-\\[160px\\]")!.className).toContain(
      "truncate",
    );
    expect(
      first.querySelector("span.max-w-\\[160px\\]")!.getAttribute("title"),
    ).toBe("CPA");
  });

  it("shows no provider name where the mark already tells the pair apart", () => {
    const container = page(
      [
        option(0, "mm_cpa", "gpt-6.1-sol", "CPA"),
        option(1, "mm_plan", "gpt-6.1-sol", "ChatGPT"),
      ],
      new Set(["mm_plan"]),
    );
    expect(modelRows(container).map(providerShown)).toEqual([null, null]);
  });

  it("selects each of two same-name rows on its own, by keyboard and by click", () => {
    const picks: number[] = [];
    const container = page(
      [
        option(0, "mm_cpa", "gpt-6.1-sol", "CPA"),
        option(1, "mm_plan", "gpt-6.1-sol", "ChatGPT"),
        option(2, "mm_other", "claude-5", "Anthropic"),
      ],
      new Set(["mm_plan"]),
      (index) => picks.push(index),
    );
    const cmdkRoot = container.querySelector("[cmdk-root]")!;
    const press = (key: string) =>
      act(() => {
        cmdkRoot.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });
    const lit = () =>
      Array.from(
        container.querySelectorAll('[cmdk-item][aria-selected="true"]'),
      ).map((row) => row.getAttribute("data-value"));

    const values = modelRows(container).map((row) =>
      row.getAttribute("data-value"),
    );
    expect(new Set(values).size).toBe(3);
    for (const value of values) {
      press("ArrowDown");
      expect(lit()).toEqual([value]);
      press("Enter");
    }
    expect(picks).toEqual([0, 1, 2]);

    act(() => modelRows(container)[1].click());
    expect(picks).toEqual([0, 1, 2, 1]);
    expect(lit()).toEqual([values[1]]);
  });
});

describe("⌘K's palette hands the page the plan's models", () => {
  it("marks the plan row once 切换模型 is open; none on a set that is empty", () => {
    const llms = [
      option(0, "mm_plan", "gpt-6.1-sol", "ChatGPT"),
      option(1, "mm_other", "claude-5", "Anthropic"),
    ];
    const open = () => {
      mount(
        <CommandPalette
          open
          onOpenChange={() => {}}
          sessions={[]}
          runtimeKind="managed"
          llms={llms}
        />,
      );
      const entry = document.querySelector<HTMLElement>(
        '[cmdk-item][data-value="switch llm 切换"]',
      );
      expect(entry).not.toBeNull();
      act(() => entry!.click());
      return modelRows(document.body);
    };

    plan.keys = new Set(["mm_plan"]);
    const rows = open();
    expect(rows).toHaveLength(2);
    expect(mark(rows[0])).not.toBeNull();
    expect(mark(rows[1])).toBeNull();
    act(() => root?.unmount());
    document.body.innerHTML = "";

    // The external runtime: the hook's set is empty, nothing changes.
    plan.keys = new Set();
    expect(open().map(mark)).toEqual([null, null]);
  });
});
