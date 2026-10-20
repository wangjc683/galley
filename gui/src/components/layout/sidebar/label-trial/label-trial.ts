/**
 * TEMPORARY — 票 68 临时切换器，定档后由拆除票删掉 (main chat PRD ruling
 * 120). Where the workbench's name 「工作台」 sits against the line that
 * parts the assistant's card block (on the chrome) from the workbench (on
 * the app ground), compared live in tauri dev with a pill
 * (WorkbenchLabelTrialSwitcher), from the most restrained:
 *
 *   now  today's, pixel for pixel: the word in the line's gap, the
 *        ground turning 6px into its 13px row, through the word's middle
 *        (SidebarWorkbenchLabel); the only tier a production build has.
 *   A    the word drops into the workbench: the line runs unbroken from
 *        the sidebar's left edge to its right and is the boundary itself,
 *        chrome above it, app below; the word is the zone's first row,
 *        all of it on the app ground (SidebarWorkbenchLabelTrial).
 *   B    the word stands on the line: all of it on the chrome, the line
 *        unbroken under it, app below.
 *
 * and, in every tier, the line's weight: 加重 (`line-strong`, today's) or
 * 默认 (`line`).
 *
 * Measured from the sidebar's top (296px wide, the card 52–180.8, its
 * block's foot 186.8; the new-chat button's top in brackets):
 *
 *   now  the name's row 186.8–199.8, the line 192.8         (205.8)
 *   A    the line 186.8, the name's row 191.8–204.8         (210.8, +5)
 *   B    the name's row 186.8–199.8, the line 200.8         (210.8, +5)
 *
 * The card block (`pb-1.5 pt-2`), the sticky new-chat row (`pt-1.5`) and
 * so the list's `scroll-pt-[42px]` are the same in every tier: the extra
 * height lives in the name's own element, outside the scrolling list.
 *
 * Every branch point in the old files carries 「票 68 临时切换器，定档后
 * 由拆除票删掉」 (`grep -rn "票 68" gui/src`). Removal: delete this folder
 * and the pill's mount in App.tsx; in SidebarWorkbenchLabel.tsx keep the
 * winning tier's markup and line colour, and drop the trial's hook.
 */
import { create } from "zustand";

export type LabelTier = "now" | "A" | "B";
export type LabelLine = "strong" | "default";

export const LABEL_TIERS: readonly LabelTier[] = ["now", "A", "B"];
export const LABEL_LINES: readonly LabelLine[] = ["strong", "default"];

// ---- The switcher's state ------------------------------------------------

const TIER_KEY = "galley.tmp.workbenchLabelTrial.tier";
const LINE_KEY = "galley.tmp.workbenchLabelTrial.line";

/** A stored choice, a per-machine convenience (HMR and reloads keep it);
 * production never reads it, and unreadable storage is the default. */
function readStored(key: string): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not stored: the pill still switches for this page.
  }
}

function readTier(): LabelTier {
  const stored = readStored(TIER_KEY);
  return LABEL_TIERS.find((tier) => tier === stored) ?? "now";
}

function readLine(): LabelLine {
  const stored = readStored(LINE_KEY);
  return LABEL_LINES.find((line) => line === stored) ?? "strong";
}

interface LabelTrialState {
  tier: LabelTier;
  line: LabelLine;
  setTier: (tier: LabelTier) => void;
  setLine: (line: LabelLine) => void;
}

export const useWorkbenchLabelTrialStore = create<LabelTrialState>((set) => ({
  tier: readTier(),
  line: readLine(),
  setTier: (tier) => {
    writeStored(TIER_KEY, tier);
    set({ tier });
  },
  setLine: (line) => {
    writeStored(LINE_KEY, line);
    set({ line });
  },
}));

export interface WorkbenchLabelTrial {
  tier: LabelTier;
  line: LabelLine;
}

/** The trial in force: the pill's in a dev build; today's name on
 * today's strong line in production, whatever is stored. */
export function useWorkbenchLabelTrial(): WorkbenchLabelTrial {
  const tier = useWorkbenchLabelTrialStore((s) => s.tier);
  const line = useWorkbenchLabelTrialStore((s) => s.line);
  return import.meta.env.DEV ? { tier, line } : { tier: "now", line: "strong" };
}

/** The line's colour: 加重 is today's `line-strong`, 默认 is `line`. */
export function labelLineClass(line: LabelLine): string {
  return line === "strong" ? "bg-line-strong" : "bg-line";
}
