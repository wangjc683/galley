import { Fragment } from "react";

import { splitSymbolGlyphs } from "@/lib/shortcuts";

/**
 * Shortcut display text ("⌘N", "⌘ + ,") with each symbol glyph the mono
 * stack lacks (⌘ ⌥ ⌃ ⇧ ← → ↵) set in the system UI font (`.shortcut-glyph`, see lib/shortcuts.ts for
 * why). Renders inline runs only — the caller's span keeps its own mono
 * styling for the rest. Windows labels ("Ctrl+N") have no glyphs and
 * come through as plain text.
 */
export function ShortcutGlyphs({ text }: { text: string }) {
  return (
    <>
      {splitSymbolGlyphs(text).map((run, index) =>
        run.symbol ? (
          <span key={index} className="shortcut-glyph">
            {run.text}
          </span>
        ) : (
          <Fragment key={index}>{run.text}</Fragment>
        ),
      )}
    </>
  );
}
