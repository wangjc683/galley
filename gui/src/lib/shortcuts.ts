import { isMac } from "@/lib/platform";

/**
 * Semantic → display formatter for keyboard shortcuts.
 *
 *   formatShortcut("Mod+K")        // Mac: "⌘K"     · Win: "Ctrl+K"
 *   formatShortcut("Mod+Shift+P")  // Mac: "⌘⇧P"    · Win: "Ctrl+Shift+P"
 *   formatShortcutReadable("Mod+K") // Mac: "⌘ + K" · Win: "Ctrl + K"
 *   formatShortcut("Alt+↑")        // Mac: "⌥↑"     · Win: "Alt+↑"
 *   formatShortcut("Enter")        // both:  "Enter"
 *
 * Input combo uses `+` to separate modifier tokens. Tokens that
 * appear in the OS map (Mod / Cmd / Ctrl / Alt / Option / Shift /
 * Enter / Esc) are translated; anything else (letters, arrows,
 * punctuation) passes through unchanged.
 *
 * Mac output: glyphs concatenated with no separator — `⌘K` reads as
 * one chord on macOS chrome (Slack, Notion, Linear convention). Terse
 * hints (sidebar, command palette) show it as is; Settings → Shortcuts
 * has room and splits it into one chip per key (`shortcutParts`).
 *
 * Win output: word names joined with `+` — `Ctrl+K` is the universal
 * Win/Linux convention; `shortcutParts` splits on `+`, one chip per
 * token.
 *
 * The `Mod` token is the canonical "platform-modifier" placeholder:
 * use it instead of hard-coding `Cmd` or `Ctrl` so the same input
 * works for both OSes.
 */

const MAC_GLYPHS: Record<string, string> = {
  Mod: "⌘",
  Cmd: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
  Enter: "↵",
  Escape: "Esc",
  Esc: "Esc",
};

const WIN_NAMES: Record<string, string> = {
  Mod: "Ctrl",
  Cmd: "Ctrl",
  Ctrl: "Ctrl",
  Alt: "Alt",
  Option: "Alt",
  Shift: "Shift",
  Enter: "Enter",
  Escape: "Esc",
  Esc: "Esc",
};

export function formatShortcut(combo: string): string {
  const parts = combo.split("+");
  if (isMac) {
    return parts.map((p) => MAC_GLYPHS[p] ?? p).join("");
  }
  return parts.map((p) => WIN_NAMES[p] ?? p).join("+");
}

export function formatShortcutReadable(combo: string): string {
  const parts = combo.split("+");
  const names = isMac ? MAC_GLYPHS : WIN_NAMES;
  return parts.map((p) => names[p] ?? p).join(" + ");
}

/**
 * Key glyphs the mono stack draws badly: the macOS modifiers the
 * formatters above emit (⌘ ⌥ ⌃ ⇧) plus the arrows and return the
 * JetBrains Mono subset lacks (← → ↵; it does have ↑ ↓).
 *
 * Shortcut labels are set in the mono stack. "SF Mono" does not resolve
 * by that name in the Mac webview, so these fall back to Menlo, where ⌘
 * is only ~69% of the letter height and → is a short thin stroke.
 * Wherever a label is shown, each such glyph is set in the system UI
 * font instead (SF Pro's are letter height) via the `.shortcut-glyph`
 * class in globals.css. Windows labels spell modifiers out ("Ctrl",
 * "Alt"), so only the arrows can match there.
 */
const MODIFIER_GLYPHS = new Set(["⌘", "⌥", "⌃", "⇧"]);
const SYMBOL_GLYPHS = new Set([...MODIFIER_GLYPHS, "←", "→", "↵"]);

/** True when `part` is exactly one such glyph — a key chip that should
 * take `.shortcut-glyph`. */
export function isSymbolGlyph(part: string): boolean {
  return SYMBOL_GLYPHS.has(part);
}

export interface ShortcutTextRun {
  text: string;
  /** Run of symbol glyphs, to be set with `.shortcut-glyph`. */
  symbol: boolean;
}

/**
 * Splits shortcut display text into runs of symbol glyphs and
 * everything else, for labels rendered as one string rather than
 * chips:
 *
 *   splitSymbolGlyphs("⌘N")     // [{ "⌘", symbol }, { "N" }]
 *   splitSymbolGlyphs("⌘ + ,")  // [{ "⌘", symbol }, { " + ," }]
 *   splitSymbolGlyphs("Ctrl+K") // [{ "Ctrl+K" }]
 */
export function splitSymbolGlyphs(text: string): ShortcutTextRun[] {
  const runs: ShortcutTextRun[] = [];
  for (const char of text) {
    const symbol = SYMBOL_GLYPHS.has(char);
    const last = runs[runs.length - 1];
    if (last && last.symbol === symbol) {
      last.text += char;
    } else {
      runs.push({ text: char, symbol });
    }
  }
  return runs;
}

/**
 * Splits one chord into key chips: "Shift+Enter" and "Ctrl+K" on `+`,
 * compact macOS chords by glyph ("⌘K" → ⌘, K; "⌥↑" → ⌥, ↑). A chord
 * with a literal `+` key is not supported (none is listed today).
 */
export function shortcutParts(chord: string): string[] {
  if (chord.includes("+")) {
    return chord.split("+").filter(Boolean);
  }
  const chars = [...chord];
  const modifierCount = chars.findIndex((c) => !MODIFIER_GLYPHS.has(c));
  if (modifierCount <= 0) return [chord];
  return [
    ...chars.slice(0, modifierCount),
    chars.slice(modifierCount).join(""),
  ];
}
