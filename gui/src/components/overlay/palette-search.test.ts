import { describe, expect, it } from "vitest";

import { ASSISTANT_SEARCH_KEYWORDS } from "@/lib/assistant";

import { paletteSessionMatches, paletteSessionValue } from "./palette-search";

describe("⌘K finds the assistant", () => {
  it("as Galley, and still as 主对话, 助手 and their English", () => {
    for (const query of [
      "galley",
      "主对话",
      "助手",
      "main chat",
      "assistant",
    ]) {
      expect(
        paletteSessionMatches(query, "Galley", "", ASSISTANT_SEARCH_KEYWORDS),
      ).toBe(true);
    }
    expect(
      paletteSessionMatches("订机票", "Galley", "", ASSISTANT_SEARCH_KEYWORDS),
    ).toBe(false);
    // Without the keywords only the title and the recap count.
    expect(paletteSessionMatches("主对话", "Galley", "")).toBe(false);
    expect(paletteSessionMatches("营养土", "Galley", "买一袋营养土")).toBe(
      true,
    );
  });

  it("gives cmdk the same words", () => {
    expect(
      paletteSessionValue("Galley", undefined, ASSISTANT_SEARCH_KEYWORDS),
    ).toBe("session Galley 主对话 助手 main chat assistant ");
    // Without keywords the value is what it always was.
    expect(paletteSessionValue("订机票", "已订好")).toBe(
      "session 订机票 已订好",
    );
  });
});
