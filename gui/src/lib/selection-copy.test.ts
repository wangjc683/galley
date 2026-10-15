import { describe, expect, it } from "vitest";

import { SELECTION_COPY_SCOPE } from "./selection-copy";

describe("SELECTION_COPY_SCOPE", () => {
  it("covers the assistant's answers and, in its conversation, the user's bubbles", () => {
    const scopes = SELECTION_COPY_SCOPE.split(",").map((s) => s.trim());
    expect(scopes).toEqual([
      '[data-selection-copy-scope="assistant-answer"]',
      '[data-selection-copy-scope="user-message"]',
    ]);
  });
});
