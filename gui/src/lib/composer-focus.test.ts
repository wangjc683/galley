import { describe, expect, it } from "vitest";

import {
  altArrowBelongsToField,
  hasOpenLayer,
  pressKeepsComposerFocus,
  typeToFocusAction,
  type TypeToFocusKey,
  yieldsToActiveElement,
} from "./composer-focus";

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

// ---------------------------------------------------------------------
// Ticket 03 rules. A small element tree stands in for the DOM: each node
// has a tag, attributes and a parent, and `closest` / `hasAttribute` /
// `getAttribute` read them. Selectors are the plain kinds the rules use:
// a tag, `[attr]`, or `[attr="value"]`, comma-separated.

interface Node {
  tagName: string;
  attrs?: Record<string, string>;
  parent?: Node;
  isContentEditable?: boolean;
  value?: string;
}

function matchesOne(node: Node, selector: string): boolean {
  const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (attr) {
    const value = node.attrs?.[attr[1]];
    return value !== undefined && (attr[2] === undefined || value === attr[2]);
  }
  return node.tagName === selector.toUpperCase();
}

function el(node: Node): Element {
  const element = {
    tagName: node.tagName,
    isContentEditable: node.isContentEditable ?? false,
    value: node.value,
    hasAttribute: (name: string) => node.attrs?.[name] !== undefined,
    getAttribute: (name: string) => node.attrs?.[name] ?? null,
    closest: (selectors: string) => {
      const list = selectors.split(",").map((part) => part.trim());
      for (let at: Node | undefined = node; at; at = at.parent) {
        if (list.some((selector) => matchesOne(at, selector))) return el(at);
      }
      return null;
    },
  };
  return element as unknown as Element;
}

function key(
  value: string,
  overrides: Partial<TypeToFocusKey> = {},
): TypeToFocusKey {
  return {
    key: value,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 0,
    defaultPrevented: false,
    ...overrides,
  };
}

const body = el({ tagName: "BODY" });
const area: Node = { tagName: "DIV", attrs: { "data-conversation-area": "" } };
const backdrop: Node = {
  tagName: "DIV",
  attrs: { "data-conversation-backdrop": "" },
  parent: area,
};
const column: Node = { tagName: "DIV", parent: backdrop };

describe("typeToFocusAction (ticket 03)", () => {
  it("takes a printable key when nothing that takes keys has focus", () => {
    expect(typeToFocusAction(key("n"), body, false, "pass")).toBe("focus");
    expect(typeToFocusAction(key("你"), null, false, "pass")).toBe("focus");
    // A button in the conversation (Windows gives clicked buttons focus).
    const button = el({ tagName: "BUTTON", parent: column });
    expect(typeToFocusAction(key("a"), button, false, "pass")).toBe("focus");
  });

  it("takes Shift, not ⌘ / Ctrl / Alt", () => {
    expect(
      typeToFocusAction(key("A", { metaKey: false }), body, false, "pass"),
    ).toBe("focus");
    expect(
      typeToFocusAction(key("c", { metaKey: true }), body, false, "pass"),
    ).toBe("none");
    expect(
      typeToFocusAction(key("c", { ctrlKey: true }), body, false, "pass"),
    ).toBe("none");
    expect(
      typeToFocusAction(key("å", { altKey: true }), body, false, "pass"),
    ).toBe("none");
  });

  it("leaves space and non-printable keys alone", () => {
    for (const name of [
      " ",
      "Enter",
      "Tab",
      "Escape",
      "ArrowUp",
      "Shift",
      "Dead",
      "Process",
    ]) {
      expect(typeToFocusAction(key(name), body, false, "pass")).toBe("none");
    }
  });

  it("leaves keys to fields, type-ahead widgets and open layers", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(typeToFocusAction(key("a"), el({ tagName }), false, "pass")).toBe(
        "none",
      );
    }
    const editable = el({ tagName: "DIV", isContentEditable: true });
    expect(typeToFocusAction(key("a"), editable, false, "pass")).toBe("none");
    const option = el({
      tagName: "DIV",
      parent: { tagName: "DIV", attrs: { role: "listbox" } },
    });
    expect(typeToFocusAction(key("a"), option, false, "pass")).toBe("none");
    expect(typeToFocusAction(key("a"), body, true, "pass")).toBe("none");
  });

  it("leaves an IME's keys and handled keys alone", () => {
    expect(
      typeToFocusAction(key("n", { isComposing: true }), body, false, "pass"),
    ).toBe("none");
    expect(
      typeToFocusAction(key("n", { keyCode: 229 }), body, false, "pass"),
    ).toBe("none");
    expect(
      typeToFocusAction(
        key("n", { defaultPrevented: true }),
        body,
        false,
        "pass",
      ),
    ).toBe("none");
  });

  it("follows the switch: swallow the key, or off", () => {
    expect(typeToFocusAction(key("n"), body, false, "swallow")).toBe(
      "focus-swallow",
    );
    expect(typeToFocusAction(key("n"), body, false, "off")).toBe("none");
  });
});

describe("hasOpenLayer (ticket 03)", () => {
  it("looks for dialogs and menus, not tooltips", () => {
    let asked = "";
    const root = {
      querySelector: (selector: string) => {
        asked = selector;
        return null;
      },
    };
    expect(hasOpenLayer(root)).toBe(false);
    expect(asked).toContain('[role="dialog"]');
    expect(asked).toContain('[role="alertdialog"]');
    expect(asked).toContain('[role="menu"]');
    expect(asked).not.toContain("tooltip");
    expect(hasOpenLayer({ querySelector: () => ({}) as Element })).toBe(true);
  });
});

describe("pressKeepsComposerFocus (ticket 03)", () => {
  const never = () => false;

  it("keeps it for the scroller's own blank backdrop, not what is inside", () => {
    expect(pressKeepsComposerFocus(el(backdrop), never)).toBe(true);
    expect(pressKeepsComposerFocus(el(column), never)).toBe(false);
    const paragraph = el({ tagName: "P", parent: column });
    expect(pressKeepsComposerFocus(paragraph, () => true)).toBe(false);
  });

  it("keeps it for a button in the conversation area or the selection toolbar", () => {
    const button: Node = { tagName: "BUTTON", parent: column };
    const glyph = el({ tagName: "svg", parent: button });
    expect(pressKeepsComposerFocus(glyph, never)).toBe(true);
    // Jump to latest and the question rail sit beside the scroller.
    const jump = el({ tagName: "BUTTON", parent: area });
    expect(pressKeepsComposerFocus(jump, never)).toBe(true);
    const toolbar: Node = {
      tagName: "DIV",
      attrs: { "data-selection-copy-toolbar": "" },
    };
    expect(
      pressKeepsComposerFocus(
        el({ tagName: "BUTTON", parent: toolbar }),
        never,
      ),
    ).toBe(true);
  });

  it("not for a button elsewhere or one that opens a menu or dialog", () => {
    const sidebar = el({ tagName: "BUTTON", parent: { tagName: "NAV" } });
    expect(pressKeepsComposerFocus(sidebar, never)).toBe(false);
    const menu = el({
      tagName: "BUTTON",
      attrs: { "aria-haspopup": "menu" },
      parent: column,
    });
    expect(pressKeepsComposerFocus(menu, never)).toBe(false);
    const notPopup = el({
      tagName: "BUTTON",
      attrs: { "aria-haspopup": "false" },
      parent: column,
    });
    expect(pressKeepsComposerFocus(notPopup, never)).toBe(true);
  });

  it("a role=button row keeps it, except on its selectable text", () => {
    const row: Node = {
      tagName: "DIV",
      attrs: { role: "button" },
      parent: column,
    };
    const caret = el({ tagName: "svg", parent: row });
    const summary = el({ tagName: "SPAN", parent: row });
    const selectable = (target: Element) => target === summary;
    expect(pressKeepsComposerFocus(caret, selectable)).toBe(true);
    expect(pressKeepsComposerFocus(summary, selectable)).toBe(false);
    // A real button keeps it even inside selectable prose.
    const codeCopy = el({ tagName: "BUTTON", parent: column });
    expect(pressKeepsComposerFocus(codeCopy, () => true)).toBe(true);
  });
});

describe("altArrowBelongsToField (ticket 03)", () => {
  const composerInput = (value: string) =>
    el({ tagName: "TEXTAREA", attrs: { "data-composer-input": "" }, value });

  it("an empty composer gives ⌥↑ / ⌥↓ to the jump; with text it keeps them", () => {
    expect(altArrowBelongsToField(composerInput(""))).toBe(false);
    expect(altArrowBelongsToField(composerInput("还在写"))).toBe(true);
    expect(altArrowBelongsToField(composerInput("\n"))).toBe(true);
  });

  it("other fields keep them; nothing focused or a button does not", () => {
    expect(altArrowBelongsToField(el({ tagName: "TEXTAREA", value: "" }))).toBe(
      true,
    );
    expect(altArrowBelongsToField(el({ tagName: "INPUT" }))).toBe(true);
    expect(
      altArrowBelongsToField(el({ tagName: "DIV", isContentEditable: true })),
    ).toBe(true);
    expect(altArrowBelongsToField(null)).toBe(false);
    expect(altArrowBelongsToField(body)).toBe(false);
    expect(altArrowBelongsToField(el({ tagName: "BUTTON" }))).toBe(false);
  });
});
