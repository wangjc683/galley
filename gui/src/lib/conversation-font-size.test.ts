import { describe, expect, it } from "vitest";

import {
  ASSISTANT_BUBBLE_TEXT_CLASS,
  CONVERSATION_FONT_SIZE_VALUES,
  assistantBubbleTextStyle,
  conversationTypographyStyle,
  stepConversationFontSize,
} from "@/lib/conversation-font-size";

describe("stepConversationFontSize", () => {
  it("moves one tier at a time", () => {
    expect(stepConversationFontSize("small", 1)).toBe("standard");
    expect(stepConversationFontSize("standard", 1)).toBe("large");
    expect(stepConversationFontSize("large", -1)).toBe("standard");
    expect(stepConversationFontSize("standard", -1)).toBe("small");
  });

  it("stays put at either end", () => {
    expect(stepConversationFontSize("large", 1)).toBe("large");
    expect(stepConversationFontSize("small", -1)).toBe("small");
  });
});

describe("the main chat's bubble text (telegram-details ruling 8)", () => {
  const vars = (style: object) => style as Record<string, string>;

  it("is a step tighter than the tier's prose: the leading and the gap", () => {
    expect(vars(assistantBubbleTextStyle("small"))).toEqual({
      "--conversation-bubble-leading": "1.5",
      "--conversation-bubble-block-gap": "9.5px",
    });
    expect(vars(assistantBubbleTextStyle("standard"))).toEqual({
      "--conversation-bubble-leading": "1.55",
      "--conversation-bubble-block-gap": "10.5px",
    });
    expect(vars(assistantBubbleTextStyle("large"))).toEqual({
      "--conversation-bubble-leading": "1.6",
      "--conversation-bubble-block-gap": "12.5px",
    });
  });

  it("drops the leading 0.15 at every tier and keeps the gap near 0.47 of the line box", () => {
    for (const tier of CONVERSATION_FONT_SIZE_VALUES) {
      const prose = vars(conversationTypographyStyle(tier));
      const bubble = vars(assistantBubbleTextStyle(tier));
      const size = Number.parseFloat(prose["--conversation-body-size"]);
      const leading = Number(bubble["--conversation-bubble-leading"]);
      expect(leading).toBeCloseTo(
        Number(prose["--conversation-body-leading"]) - 0.15,
        5,
      );
      const gap = Number.parseFloat(bubble["--conversation-bubble-block-gap"]);
      expect(gap / (size * leading)).toBeGreaterThan(0.44);
      expect(gap / (size * leading)).toBeLessThan(0.48);
    }
  });

  it("re-declares the tier's variables on the two bubbles only", () => {
    expect(ASSISTANT_BUBBLE_TEXT_CLASS.split(" ")).toEqual([
      "[&_[data-role=assistant-bubble]]:[--conversation-body-leading:var(--conversation-bubble-leading)]",
      "[&_[data-role=assistant-bubble]]:[--conversation-block-gap:var(--conversation-bubble-block-gap)]",
      "[&_[data-role^=user-msg]]:[--conversation-body-leading:var(--conversation-bubble-leading)]",
    ]);
  });
});
