import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { type LabelLine, labelLineClass } from "./label-trial";

/*
 * TEMPORARY — 票 68 临时切换器，定档后由拆除票删掉 (see label-trial.ts).
 *
 * The two trial tiers of 「工作台」 (ruling 120). In both the word keeps
 * today's recipe — the label size (text-ui-label, 11px) in the regular
 * weight, ink-muted, upright and untracked, on the sidebar grid's left
 * line (18px), in its own 13px line box — and the line is one unbroken
 * 1px rule from the sidebar's left edge to its right: the boundary
 * between the card block's chrome and the workbench's app ground, never
 * crossed by the word. Only where the word sits differs.
 */
const TEXT =
  "shrink-0 whitespace-nowrap pl-4.5 pr-2 text-ui-label leading-[13px] text-ink-muted";

/**
 * A: the word drops into the workbench, its first row. The line sits
 * right under the card block (where the name's row begins today), the
 * chrome above it and the app ground from it down; the word's row is 4px
 * under the line (`mt-1`, on the app ground) and 6px over the new-chat
 * button (the sticky row's own `pt-1.5`, unchanged): 1 + 4 + 13 = 18px
 * where today's row is 13px, +5.
 */
function TierA({ word, line }: { word: string; line: LabelLine }) {
  return (
    <div
      data-sidebar-zone-label="workbench"
      data-label-trial="A"
      className="shrink-0 bg-app"
    >
      <div aria-hidden className={cn("h-px", labelLineClass(line))} />
      <div className="mt-1 flex h-[13px] items-center">
        <span className={TEXT}>{word}</span>
      </div>
    </div>
  );
}

/**
 * B: the word stands on the line, all of it on the chrome. Its row stays
 * where today's is (6px under the card block, so the card's hover fill,
 * on the card's own rounded block, ends 6px over the row); the line is
 * 1px under the row (`mt-px`: the type's ink ends about 1.5px above the
 * row's foot, so about 3px over the line), and 3px of app ground under
 * the line then the sticky row's 6px put the new-chat button 10px under
 * the line's top: 13 + 1 + 1 + 3 = 18px, +5.
 */
function TierB({ word, line }: { word: string; line: LabelLine }) {
  return (
    <div
      data-sidebar-zone-label="workbench"
      data-label-trial="B"
      className="shrink-0"
    >
      <div className="flex h-[13px] items-center">
        <span className={TEXT}>{word}</span>
      </div>
      <div aria-hidden className={cn("mt-px h-px", labelLineClass(line))} />
      <div aria-hidden className="h-[3px] bg-app" />
    </div>
  );
}

/** 「工作台」 in the trial tier A or B (SidebarWorkbenchLabel draws 现状). */
export function SidebarWorkbenchLabelTrial({
  tier,
  line,
}: {
  tier: "A" | "B";
  line: LabelLine;
}) {
  const copy = useCopy();
  const word = copy.sidebar.zoneWorkbench;
  return tier === "A" ? (
    <TierA word={word} line={line} />
  ) : (
    <TierB word={word} line={line} />
  );
}
