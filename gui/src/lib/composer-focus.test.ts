import { describe, expect, it } from "vitest";

import { yieldsToActiveElement } from "./composer-focus";

// Node vitest environment has no DOM — the policy function is written
// against structural element shape (tagName / isContentEditable /
// closest), so lightweight stubs stand in for real elements.
function stubElement(
  tagName: string,
  overrides: Partial<{
    isContentEditable: boolean;
    insideDialog: boolean;
  }> = {},
): Element {
  return {
    tagName,
    isContentEditable: overrides.isContentEditable ?? false,
    closest: (selector: string) =>
      overrides.insideDialog && selector.includes('[role="dialog"]')
        ? ({} as Element)
        : null,
  } as unknown as Element;
}

const composer = stubElement("TEXTAREA");

describe("yieldsToActiveElement", () => {
  it("takes focus when nothing holds it (null / body)", () => {
    expect(yieldsToActiveElement(null, composer)).toBe(false);
    expect(yieldsToActiveElement(stubElement("BODY"), composer)).toBe(false);
  });

  it("takes focus when the composer textarea itself is active — the Windows Chromium parked-activeElement case", () => {
    expect(yieldsToActiveElement(composer, composer)).toBe(false);
  });

  it("does not yield to buttons — Windows Chromium gives clicked buttons DOM focus", () => {
    expect(yieldsToActiveElement(stubElement("BUTTON"), composer)).toBe(false);
    expect(yieldsToActiveElement(stubElement("A"), composer)).toBe(false);
  });

  it("yields to other text-entry surfaces", () => {
    expect(yieldsToActiveElement(stubElement("INPUT"), composer)).toBe(true);
    expect(yieldsToActiveElement(stubElement("TEXTAREA"), composer)).toBe(true);
    expect(yieldsToActiveElement(stubElement("SELECT"), composer)).toBe(true);
  });

  it("yields to contentEditable hosts", () => {
    expect(
      yieldsToActiveElement(
        stubElement("DIV", { isContentEditable: true }),
        composer,
      ),
    ).toBe(true);
  });

  it("yields to anything inside an open dialog / popover", () => {
    expect(
      yieldsToActiveElement(
        stubElement("BUTTON", { insideDialog: true }),
        composer,
      ),
    ).toBe(true);
  });
});
