import * as Tooltip from "@radix-ui/react-tooltip";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MainView } from "@/components/screens/MainView";
import {
  CONVERSATION_FONT_SIZE_VALUES,
  conversationTypographyStyle,
} from "@/lib/conversation-font-size";
import { LocalFilesContext } from "@/lib/local-files";
import type { AgentTurn, Turn } from "@/types/conversation";

import { TdDensityPill } from "./TdDensityPill";
import {
  BUBBLE_DENSITY,
  BUBBLE_DENSITY_CLASS,
  bubbleDensity,
  useTdDensity,
} from "./td-density";

// TEMP variant switcher (telegram-details 10): goes with the switcher.

// A static render reads a zustand store's initial state; the hook here
// reads what the test set.
vi.mock("./td-density", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./td-density")>();
  const store = actual.useTdDensity;
  const hook = (<T,>(
    selector?: (state: ReturnType<typeof store.getState>) => T,
  ) =>
    selector
      ? selector(store.getState())
      : store.getState()) as unknown as typeof store;
  Object.assign(hook, store);
  return { ...actual, useTdDensity: hook };
});

afterEach(() => {
  useTdDensity.setState({ variant: 0 });
});

describe("the options", () => {
  it("starts on today's", () => {
    expect(useTdDensity.getState().variant).toBe(0);
    for (const tier of CONVERSATION_FONT_SIZE_VALUES) {
      expect(bubbleDensity(0, tier)).toBeNull();
    }
  });

  it("names today's values as V0, tier by tier", () => {
    for (const tier of CONVERSATION_FONT_SIZE_VALUES) {
      const vars = conversationTypographyStyle(tier) as Record<string, string>;
      const v0 = BUBBLE_DENSITY[0][tier];
      expect(`${v0.size}px`).toBe(vars["--conversation-body-size"]);
      expect(String(v0.leading)).toBe(vars["--conversation-body-leading"]);
      expect(`${v0.gap}px`).toBe(vars["--conversation-block-gap"]);
    }
  });

  it("keeps the ticket's standard values", () => {
    expect(BUBBLE_DENSITY[1].standard).toEqual({
      size: 15,
      leading: 1.55,
      gap: 10.5,
    });
    expect(BUBBLE_DENSITY[2].standard).toEqual({
      size: 14,
      leading: 1.6,
      gap: 10.5,
    });
    expect(BUBBLE_DENSITY[3].standard).toEqual({
      size: 14,
      leading: 1.5,
      gap: 9.5,
    });
  });

  it("steps small and large as today's tiers do, the gap near 0.47 of the line box", () => {
    for (const variant of [1, 2, 3] as const) {
      const { small, standard, large } = BUBBLE_DENSITY[variant];
      expect(small.size).toBe(standard.size - 1.5);
      expect(large.size).toBe(standard.size + 1.5);
      expect(small.leading).toBeCloseTo(standard.leading - 0.05, 5);
      expect(large.leading).toBeCloseTo(standard.leading + 0.05, 5);
      for (const body of [small, large]) {
        // The nearest 0.5px to 0.47 of the line box.
        const ideal = 0.47 * body.size * body.leading;
        expect(Math.abs(body.gap - ideal)).toBeLessThanOrEqual(0.25);
        expect(body.gap * 2).toBe(Math.round(body.gap * 2));
      }
    }
  });

  it("re-declares the three variables on the bubbles from the column's", () => {
    // Both bubbles: the assistant's (all three, for its markdown) and
    // the user's (size and leading on itself; it has no paragraphs).
    expect(BUBBLE_DENSITY_CLASS.split(" ")).toEqual([
      "[&_[data-role=assistant-bubble]]:[--conversation-body-size:var(--bubble-body-size)]",
      "[&_[data-role=assistant-bubble]]:[--conversation-body-leading:var(--bubble-body-leading)]",
      "[&_[data-role=assistant-bubble]]:[--conversation-block-gap:var(--bubble-block-gap)]",
      "[&_[data-role^=user-msg]]:[--conversation-body-size:var(--bubble-body-size)]",
      "[&_[data-role^=user-msg]]:[--conversation-body-leading:var(--bubble-body-leading)]",
    ]);
    const at = bubbleDensity(2, "large");
    expect(at?.className).toBe(BUBBLE_DENSITY_CLASS);
    expect(at?.style).toEqual({
      "--bubble-body-size": "15.5px",
      "--bubble-body-leading": "1.65",
      "--bubble-block-gap": "12px",
    });
  });

  it("renders no pill without a document (a static render)", () => {
    expect(renderToStaticMarkup(<TdDensityPill tier="standard" />)).toBe("");
  });
});

const GREETING: AgentTurn = {
  role: "agent",
  turnIndex: -1,
  finalAnswer: "你好。以后有什么事，直接在这里跟我说就行。",
  tools: [],
  greeting: true,
  messageId: "a-greeting",
};

function conversation(): Turn[] {
  return [
    GREETING,
    { role: "user", content: "早，天气怎么样？", messageId: "u-1" },
    {
      role: "agent",
      turnIndex: 1,
      finalAnswer: "多云，**记得带伞**。\n\n- 上午 23℃\n- 下午 30℃",
      tools: [],
      messageId: "a-1",
    },
  ];
}

function render(props: Partial<ComponentProps<typeof MainView>>): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <MainView
          turns={conversation()}
          llmDisplayName="model"
          activeSessionId="s-1"
          {...props}
        />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

describe("MainView", () => {
  it("carries nothing at V0", () => {
    const main = render({ isMainChat: true });
    expect(main).not.toContain("--bubble-body-size");
    expect(main).not.toContain("data-role=assistant-bubble]]:[--conversation");
  });

  it("puts an option's values for the tier on the main chat's column only", () => {
    const workbench = render({ isMainChat: false });
    const workbenchLarge = render({
      isMainChat: false,
      conversationFontSize: "large",
    });
    useTdDensity.setState({ variant: 2 });
    const main = render({ isMainChat: true });
    expect(main).toContain(
      'style="--bubble-body-size:14px;--bubble-body-leading:1.6;--bubble-block-gap:10.5px"',
    );
    expect(main).toContain(
      "[&amp;_[data-role=assistant-bubble]]:[--conversation-body-size:var(--bubble-body-size)]",
    );
    // ⌘= : the large tier's.
    const large = render({ isMainChat: true, conversationFontSize: "large" });
    expect(large).toContain("--bubble-body-size:15.5px");
    // The workbench, byte for byte as at V0.
    expect(render({ isMainChat: false })).toBe(workbench);
    expect(render({ isMainChat: false, conversationFontSize: "large" })).toBe(
      workbenchLarge,
    );
  });
});
