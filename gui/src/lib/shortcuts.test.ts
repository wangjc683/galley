import { afterEach, describe, expect, it, vi } from "vitest";

async function loadShortcuts(mac: boolean) {
  vi.resetModules();
  vi.doMock("@/lib/platform", () => ({ isMac: mac }));
  return import("./shortcuts");
}

afterEach(() => {
  vi.doUnmock("@/lib/platform");
});

describe("isSymbolGlyph", () => {
  it("matches exactly one glyph the mono stack lacks", async () => {
    const { isSymbolGlyph } = await loadShortcuts(true);
    for (const glyph of ["⌘", "⌥", "⌃", "⇧", "←", "→", "↵"]) {
      expect(isSymbolGlyph(glyph)).toBe(true);
    }
    // ↑ ↓ are in the JetBrains Mono subset and stay mono.
    for (const part of ["K", "Enter", "Ctrl", "Alt", "↑", "↓", "⌘K", ""]) {
      expect(isSymbolGlyph(part)).toBe(false);
    }
  });
});

describe("splitSymbolGlyphs", () => {
  it("separates symbol glyph runs from the rest", async () => {
    const { splitSymbolGlyphs } = await loadShortcuts(true);
    expect(splitSymbolGlyphs("⌘N")).toEqual([
      { text: "⌘", symbol: true },
      { text: "N", symbol: false },
    ]);
    expect(splitSymbolGlyphs("⌘ + ,")).toEqual([
      { text: "⌘", symbol: true },
      { text: " + ,", symbol: false },
    ]);
    expect(splitSymbolGlyphs("⌘⇧P")).toEqual([
      { text: "⌘⇧", symbol: true },
      { text: "P", symbol: false },
    ]);
  });

  it("passes Windows labels through as one plain run", async () => {
    const { splitSymbolGlyphs } = await loadShortcuts(false);
    expect(splitSymbolGlyphs("Ctrl+K")).toEqual([
      { text: "Ctrl+K", symbol: false },
    ]);
    expect(splitSymbolGlyphs("")).toEqual([]);
  });
});

describe("shortcutParts", () => {
  it("splits compact macOS chords one chip per key", async () => {
    const { shortcutParts } = await loadShortcuts(true);
    expect(shortcutParts("⌘K")).toEqual(["⌘", "K"]);
    expect(shortcutParts("⌥↑")).toEqual(["⌥", "↑"]);
    expect(shortcutParts("⌘⇧P")).toEqual(["⌘", "⇧", "P"]);
    expect(shortcutParts("⌘")).toEqual(["⌘"]);
    expect(shortcutParts("Esc")).toEqual(["Esc"]);
    expect(shortcutParts("→")).toEqual(["→"]);
  });

  it("splits `+` chords, including the project-dialog submit on both OSes", async () => {
    const mac = await loadShortcuts(true);
    expect(mac.shortcutParts(`${mac.formatShortcut("Mod")}+Enter`)).toEqual([
      "⌘",
      "Enter",
    ]);
    expect(mac.shortcutParts("Shift+Enter")).toEqual(["Shift", "Enter"]);

    const win = await loadShortcuts(false);
    expect(win.shortcutParts(`${win.formatShortcut("Mod")}+Enter`)).toEqual([
      "Ctrl",
      "Enter",
    ]);
    expect(win.shortcutParts(win.formatShortcut("Mod+K"))).toEqual([
      "Ctrl",
      "K",
    ]);
  });
});
