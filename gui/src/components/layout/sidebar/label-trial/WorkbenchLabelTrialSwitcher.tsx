import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  type LabelLine,
  type LabelTier,
  LABEL_LINES,
  LABEL_TIERS,
  useWorkbenchLabelTrialStore,
} from "./label-trial";

/*
 * TEMPORARY — 票 68 临时切换器，定档后由拆除票删掉 (see label-trial.ts).
 */

const TIER_LABELS: Record<LabelTier, string> = {
  now: "现状",
  A: "A",
  B: "B",
};

const TIER_TITLES: Record<LabelTier, string> = {
  now: "现状：字坐在线的断口里，底色在字的中线转",
  A: "A 字落进工作台：通栏的线就是底色交界，字在线下的 app 上",
  B: "B 字站在线上：字整个在 chrome 上，通栏的线在字下面",
};

const LINE_LABELS: Record<LabelLine, string> = {
  strong: "加重",
  default: "默认",
};

const LINE_TITLES: Record<LabelLine, string> = {
  strong: "线 加重：line-strong（现在）",
  default: "线 默认：line",
};

const OPTION =
  "min-w-5 whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

function Option({
  pressed,
  title,
  onClick,
  children,
}: {
  pressed: boolean;
  title: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cn(
        OPTION,
        pressed
          ? "bg-selected text-ink"
          : "text-ink-muted hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The trial's pill (ruling 120): 「区名 现状 A B」 picks where the word
 * sits, 「线 加重 默认」 the line's weight, in any tier — one click each,
 * stored (label-trial.ts). Portalled to <body> with `pointer-events:
 * auto` above every overlay tier, so an open menu or dialog never blocks
 * it; under the main header's right end, where the earlier trial pills
 * sat (tickets 55, 62), off the sidebar it is there to compare. App
 * renders it only in a dev build, in the managed runtime with a main
 * chat.
 */
export function WorkbenchLabelTrialSwitcher() {
  const tier = useWorkbenchLabelTrialStore((s) => s.tier);
  const line = useWorkbenchLabelTrialStore((s) => s.line);
  const setTier = useWorkbenchLabelTrialStore((s) => s.setTier);
  const setLine = useWorkbenchLabelTrialStore((s) => s.setLine);
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：工作台区名"
      data-role="label-trial-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed right-3 top-[50px] z-[1000] flex items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card"
    >
      <span className="select-none">临时 · 区名</span>
      {LABEL_TIERS.map((value) => (
        <Option
          key={value}
          pressed={tier === value}
          title={TIER_TITLES[value]}
          onClick={() => setTier(value)}
        >
          {TIER_LABELS[value]}
        </Option>
      ))}
      <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />
      <span className="select-none">线</span>
      {LABEL_LINES.map((value) => (
        <Option
          key={value}
          pressed={line === value}
          title={LINE_TITLES[value]}
          onClick={() => setLine(value)}
        >
          {LINE_LABELS[value]}
        </Option>
      ))}
    </div>,
    document.body,
  );
}
