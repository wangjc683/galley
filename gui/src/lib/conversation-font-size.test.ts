import { describe, expect, it } from "vitest";

import { stepConversationFontSize } from "@/lib/conversation-font-size";

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
