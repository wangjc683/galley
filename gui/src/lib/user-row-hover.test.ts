import { describe, expect, it } from "vitest";

import { pointerInRegion, userRowChipsShown } from "./user-row-hover";

const AT_REST = { hovered: false, copied: false, menuOpen: false };

describe("the row under your bubble (ruling 109)", () => {
  it("shows while the pointer is in the region, the band under the bubble included", () => {
    // The band is part of the region (Conversation.assistant.test.tsx),
    // so on the way from the bubble to a chip `hovered` stays true.
    expect(userRowChipsShown({ ...AT_REST, hovered: true })).toBe(true);
  });

  it("hides the moment the pointer leaves: the rule is the state, no timer between", () => {
    const shown = { ...AT_REST, hovered: true };
    expect(userRowChipsShown(shown)).toBe(true);
    expect(userRowChipsShown({ ...shown, hovered: false })).toBe(false);
  });

  it("stays pinned through the copied check and while the ⋯ menu is open, wherever the pointer is", () => {
    expect(userRowChipsShown({ ...AT_REST, copied: true })).toBe(true);
    expect(userRowChipsShown({ ...AT_REST, menuOpen: true })).toBe(true);
    // The pin let go with the pointer gone: the row goes with it.
    expect(userRowChipsShown(AT_REST)).toBe(false);
  });

  it("hides at once when the menu closes with the pointer outside the region", () => {
    const outside = { matches: (selector: string) => selector !== ":hover" };
    const inside = { matches: (selector: string) => selector === ":hover" };
    const closed = (region: { matches: (s: string) => boolean } | null) =>
      userRowChipsShown({
        hovered: pointerInRegion(region),
        copied: false,
        menuOpen: false,
      });
    expect(closed(outside)).toBe(false);
    expect(closed(inside)).toBe(true);
    // Not mounted (or not known): hidden, not left hanging.
    expect(closed(null)).toBe(false);
  });
});
