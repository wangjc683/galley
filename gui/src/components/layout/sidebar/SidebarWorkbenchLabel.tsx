import { useCopy } from "@/lib/i18n";

/*
 * The workbench's name, 「━━ 工作台 ━━」 (main chat PRD rulings 114, 118
 * point 5, 120 point 6; tickets 62, 68, 69). With a main chat the
 * sidebar has two zones, the assistant above and the workbench below;
 * only the workbench is named, and its name is part of the frame, not a
 * heading in the list: it sits on the line where its zone begins,
 * outside the scrolling list, staying put with the card.
 *
 * On the line, because that is what it names: where the zones meet.
 * Ticket 68 tried the word dropped into the workbench as its first row
 * (A: one more heading in the list) and standing on the line over it
 * (B: on the chrome, it hung from the card whenever the card was
 * hovered); JC kept neither.
 *
 * Centred on the sidebar's axis, the stage card's (ticket 67), the line
 * in two equal halves 8px off the word, out to the sidebar's two edges.
 * Ticket 62 hung it on the grid's left line (18px) when the card was a
 * row with its avatar on that line; the stage changed that. Outside the
 * scrolling list, the axis is the card's on Windows too: the list's
 * 10px scrollbar lane begins under the name's row, and the line's right
 * half runs on above it to the sidebar's edge (the list's own content,
 * left of the lane, is centred 5px left of this axis).
 *
 * The type is the faintest text ink, ink-muted (light 3.29:1 on chrome,
 * 3.63:1 on app; dark 4.98 / 5.24 — a step fainter, /85, falls to
 * 2.66–2.87:1 in light, under 3:1), at the label size (text-ui-label,
 * 11px) in the regular weight, upright and untracked. The buckets'
 * labels (今天, 本周, 项目) are the eyebrow recipe — 10px semibold,
 * uppercase in English, tracked 0.08em — on the grid's left line inside
 * the list with their counts; this one is centred, a size up but two
 * weights lighter, has no count, and carries a line. The line stays
 * line-strong: light `line` is ΔL* 2.45 off the chrome, fainter than
 * the ground's own step (3.85), so it would vanish into it.
 */
const TEXT =
  "shrink-0 whitespace-nowrap px-2 text-ui-label leading-[13px] text-ink-muted";
const LINE = "h-px min-w-0 flex-1 bg-line-strong";

/** The ground under the name: the line is also where the card block's
 * chrome gives way to the workbench's app ground. Until ticket 69 the
 * ground turned hard at the line, 6px into the row: the line covered the
 * step where it was drawn, and the step showed where it was not, in the
 * 18px before it began and in the gap round the word, through the
 * word's middle — the block of colour behind the word. So the step goes,
 * and the word stays: chrome to app in one linear gradient over the
 * element's 19px, from the card block's foot to the row's (ruling 120
 * point 6). Its top is the chrome the card block stands on, its foot the
 * app the list is painted on, so neither end has an edge. */
const WORKBENCH_GROUND =
  "linear-gradient(to bottom, var(--color-chrome), var(--color-app))";

/**
 * 「工作台」 on the strong line between the card block and the list.
 *
 * 19px: the 6px under the card (the card block's foot until ticket 69,
 * moved here so one element owns the whole run of the gradient), then
 * the type's own 13px line box with the 1px line at 6px (items-center):
 * the line runs through the word's middle, so the word reads as on the
 * boundary, neither a caption under the zone above nor a heading inside
 * the zone below. Measured from the sidebar's top (296px): the card ends
 * at 180.8, the row is 186.8–199.8, the line 192.8, and the new-chat
 * button starts at 205.8, as before ticket 69.
 */
export function SidebarWorkbenchLabel() {
  const copy = useCopy();
  return (
    <div
      data-sidebar-zone-label="workbench"
      className="flex h-[19px] shrink-0 items-center pt-1.5"
      style={{ background: WORKBENCH_GROUND }}
    >
      <span aria-hidden className={LINE} />
      <span className={TEXT}>{copy.sidebar.zoneWorkbench}</span>
      <span aria-hidden className={LINE} />
    </div>
  );
}
