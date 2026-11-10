import { BellSimple, Repeat } from "@phosphor-icons/react";

import type { TodoMetaPart } from "@/lib/todo-panel";

/** The glyphs' type: 11px regular, sat on the line's baseline. */
const GLYPH = {
  "aria-hidden": true,
  size: 11,
  weight: "regular",
  className: "inline-block align-[-1px]",
} as const;

/**
 * A to-do's second line as text, the panel's rows and the cards under
 * replies alike: the parts joined by 「 · 」, overdue in warning; the
 * reminder a bell and its time, set apart by a gap instead of the dot
 * (main chat PRD ruling 97). Since main chat ticket 157 (PRD ruling 204
 * point 7) a repeating period's rule the same way, after when it is due
 * and before the bell: the repeat glyph and the rule in words
 * (「周一 ↻ 每周一 🔔 9:00」) — `Repeat`, the bell's size and weight, in
 * the line's ink; on a card the glyph alone (its part's words left
 * empty), the rule in its hover.
 */
export function TodoMetaText({ parts }: { parts: readonly TodoMetaPart[] }) {
  return parts.map((part, index) => (
    <span key={index}>
      {index > 0 && !part.bell && !part.repeat && " · "}
      {part.bell || part.repeat ? (
        // Inline, not flex: a flex box here sits on its own baseline and
        // grows the line.
        <span
          title={part.title}
          aria-label={part.title}
          data-role={part.repeat ? "todo-meta-repeat" : undefined}
          className={index > 0 ? "ml-2 whitespace-nowrap" : "whitespace-nowrap"}
        >
          {part.bell ? <BellSimple {...GLYPH} /> : <Repeat {...GLYPH} />}
          {part.text && (
            <span aria-hidden className="ml-[3px]">
              {part.text}
            </span>
          )}
        </span>
      ) : (
        <span
          className={
            part.tone === "warning" ? "font-medium text-warning" : undefined
          }
        >
          {part.text}
        </span>
      )}
    </span>
  ));
}
