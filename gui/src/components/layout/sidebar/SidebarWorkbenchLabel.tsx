import { useCopy } from "@/lib/i18n";

/*
 * The workbench's name, 「工作台 ━━━━」 (main chat PRD rulings 114, 118
 * point 5; ticket 62 picked C). With a main chat the sidebar has two
 * zones, the assistant above and the workbench below; only the
 * workbench is named, and its name is part of the frame, not a heading
 * in the list: it sits on the line where its zone begins, the line drawn
 * on from after the word, outside the scrolling list.
 *
 * The type is the faintest text ink, ink-muted (light 3.29:1 on chrome,
 * 3.63:1 on app; dark 4.98 / 5.24 — a step fainter, /85, falls to
 * 2.66–2.87:1 in light, under 3:1), at the label size (text-ui-label,
 * 11px) in the regular weight, upright and untracked. The buckets'
 * labels (今天, 本周, 项目) are the eyebrow recipe — 10px semibold,
 * uppercase in English, tracked 0.08em — inside the list with their
 * counts; this one is a size up but two weights lighter, has no count,
 * and carries a line.
 *
 * Its row is 13px, the type's own line box, with the 1px line at 6px
 * (items-center): the line runs through the word's middle, so the word
 * reads as on the boundary, neither a caption under the zone above nor a
 * heading inside the zone below. It starts on the sidebar grid's left
 * line (18px) and the line 8px after it, to the sidebar's right edge.
 */
const TEXT =
  "shrink-0 whitespace-nowrap pl-4.5 pr-2 text-ui-label leading-[13px] text-ink-muted";

/** The sidebar's chrome above the line, the workbench's app ground from
 * it down: the ground turns where the line is, and goes on turning under
 * the word, where the line is not drawn. The upper half is transparent,
 * not painted chrome, so the selected card's shadow falls on it as it
 * falls on the card block, and is cut only at the line. */
const WORKBENCH_GROUND =
  "linear-gradient(to bottom, transparent 6px, var(--color-app) 6px)";

/** 「工作台」 on the strong line between the card block and the list. */
export function SidebarWorkbenchLabel() {
  const copy = useCopy();
  return (
    <div
      data-sidebar-zone-label="workbench"
      className="flex h-[13px] shrink-0 items-center"
      style={{ background: WORKBENCH_GROUND }}
    >
      <span className={TEXT}>{copy.sidebar.zoneWorkbench}</span>
      <span aria-hidden className="h-px min-w-0 flex-1 bg-line-strong" />
    </div>
  );
}
