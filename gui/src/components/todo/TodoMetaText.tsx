import { BellSimple, Repeat } from "@phosphor-icons/react";

import type { TodoMetaPart } from "@/lib/todo-panel";
import { cn } from "@/lib/utils";

import { TODO_META_SEGMENT } from "./todo-styles";

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
 * (「周一 ↻ 每周 🔔 9:00」) — `Repeat`, the bell's size and weight, in
 * the line's ink; on a card the glyph alone (its part's words left
 * empty), the rule in its hover.
 *
 * `wrap` (main chat ticket 159, PRD ruling 207 point 4): the open row's
 * line, which goes onto a second line where it does not fit, part by
 * part. Each part is one segment (`TODO_META_SEGMENT`) and the gap before
 * it a `TodoMetaBreak`; the line around them is `whitespace-nowrap`, so
 * those breaks are its only ones. Folded rows and cards draw it as before:
 * one line, cut at its end by the box around it.
 */
export function TodoMetaText({
  parts,
  wrap = false,
}: {
  parts: readonly TodoMetaPart[];
  wrap?: boolean;
}) {
  if (wrap) {
    return parts.map((part, index) => {
      const marked = part.bell || part.repeat;
      return (
        <span key={index}>
          {index > 0 &&
            (marked ? (
              <TodoMetaBreak />
            ) : (
              <>
                {" · "}
                <TodoMetaBreak gap={false} />
              </>
            ))}
          <span
            data-segment=""
            title={part.title}
            aria-label={part.title}
            data-role={part.repeat ? "todo-meta-repeat" : undefined}
            className={cn(
              TODO_META_SEGMENT,
              part.tone === "warning" && "font-medium text-warning",
            )}
          >
            {marked ? (
              <>
                {part.bell ? <BellSimple {...GLYPH} /> : <Repeat {...GLYPH} />}
                {part.text && (
                  <span aria-hidden className="ml-[3px]">
                    {part.text}
                  </span>
                )}
              </>
            ) : (
              part.text
            )}
          </span>
        </span>
      );
    });
  }
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

/**
 * Where the open row's time line may go onto its next line (main chat
 * ticket 159): the 8px between two parts (`gap`), then a break
 * opportunity (`<wbr>`, in the one `whitespace-normal` box on a nowrap
 * line). Broken there, the gap stays at the end of the line above and
 * the part below starts flush with the line's start, under when it is
 * due; its line is the line's own height, no more.
 */
export function TodoMetaBreak({ gap = true }: { gap?: boolean }) {
  return (
    <span
      data-role="todo-meta-break"
      className={gap ? "ml-2 whitespace-normal" : "whitespace-normal"}
    >
      <wbr />
    </span>
  );
}
