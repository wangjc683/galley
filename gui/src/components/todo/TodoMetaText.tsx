import { BellSimple } from "@phosphor-icons/react";

import type { TodoMetaPart } from "@/lib/todo-panel";

/**
 * A to-do's second line as text, the panel's rows and the cards under
 * replies alike: the parts joined by 「 · 」, overdue in warning; the
 * reminder a bell and its time, set apart by a gap instead of the dot
 * (main chat PRD ruling 97).
 */
export function TodoMetaText({ parts }: { parts: readonly TodoMetaPart[] }) {
  return parts.map((part, index) => (
    <span key={index}>
      {index > 0 && !part.bell && " · "}
      {part.bell ? (
        // Inline, not flex: a flex box here sits on its own baseline and
        // grows the line.
        <span
          title={part.title}
          aria-label={part.title}
          className={index > 0 ? "ml-2 whitespace-nowrap" : "whitespace-nowrap"}
        >
          <BellSimple
            aria-hidden
            size={11}
            weight="regular"
            className="inline-block align-[-1px]"
          />
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
