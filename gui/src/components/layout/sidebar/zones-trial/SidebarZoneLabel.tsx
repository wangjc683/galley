import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/*
 * TEMPORARY — 票 62 临时切换器，定档后由拆除票删掉 (see zones-trial.ts).
 *
 * A zone's name is part of the frame, not a heading in the list: it sits
 * on the line where its zone begins, the line drawn on from after the
 * word (「工作台 ━━━━」), outside the scrolling list. The type is the
 * faintest text ink, ink-muted (light 3.29:1 on chrome, 3.63:1 on app;
 * dark 4.98 / 5.24 — a step fainter, /85, falls to 2.66–2.87:1 in light,
 * under 3:1), at the label size (text-ui-label, 11px) in the regular
 * weight, upright and untracked. The buckets' labels (今天, 本周, 项目)
 * are the eyebrow recipe — 10px semibold, uppercase in English, tracked
 * 0.08em — inside the list with their counts; this one is a size up but
 * two weights lighter, has no count, and carries a line.
 *
 * Its row is 13px, the type's own line box, with the 1px line at 6px
 * (items-center): the line runs through the word's middle, so the word
 * reads as on the boundary, neither a caption under the zone above nor a
 * heading inside the zone below. It starts on the sidebar grid's left
 * line (18px) and the line 8px after it, to the sidebar's right edge as
 * the strong line runs today.
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

/** 「工作台」 on the strong line between the card block and the list (A,
 * B, C): the row between them, the line drawn from after the word. */
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

/** 「助理」 on the masthead's line (B), the same row as the first thing
 * in the card block: pulled 7px up (-mt-[7px]; a flex item's margins do
 * not collapse), its 6px line row lands on the masthead's border, and the
 * word's chrome ground covers that border up to 8px after the word, so
 * the masthead's own line is the one that runs on; 4px under it (mb-1)
 * the card. In flow, not absolute: a positioned card block would paint
 * after the rows under it, and the selected card's shadow would fall
 * across 「工作台」 and the strong line. Clicks fall through to the
 * masthead (a window drag region) and the card block under the row. */
export function SidebarAssistantLabel() {
  const copy = useCopy();
  return (
    <div
      data-sidebar-zone-label="assistant"
      className="pointer-events-none -mt-[7px] mb-1 flex h-[13px] items-center"
    >
      <span className={cn(TEXT, "bg-chrome")}>
        {copy.sidebar.zoneAssistant}
      </span>
    </div>
  );
}
