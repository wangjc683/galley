/**
 * TEMPORARY — 票 62 临时切换器，定档后由拆除票删掉 (main chat PRD ruling
 * 114). Four ways to draw the sidebar's two zones with a main chat — the
 * assistant above, the workbench below — compared live in tauri dev with
 * a pill (SidebarZonesTrialSwitcher), from the most restrained:
 *
 *   now  today's sidebar, pixel for pixel; the only tier a production
 *        build has.
 *   A    only the workbench is named: 「工作台」 sits on the strong line
 *        under the card block, the line drawn on from after the word
 *        (SidebarWorkbenchLabel); the workbench's app ground runs from
 *        that line to the window's foot, and 「已归档」 stays pinned at
 *        the foot, on that ground.
 *   B    A, and the assistant's zone named too: 「助理」 on the masthead's
 *        line, the same type in the same place relative to its line
 *        (SidebarAssistantLabel).
 *   C    A, with more air around the card: 12px above it and 10px under
 *        it to the name's row (A: 6px and 4px; today 6px and 6px to the
 *        line).
 *
 * 「新用户」 (any tier) changes only what the list shows: no conversation
 * a person started, no project, nothing archived — the empty line under
 * the new-chat row — while the assistant's card keeps its real data.
 *
 * Every branch point in the old files carries 「票 62 临时切换器，定档后
 * 由拆除票删掉」 (`grep -rn "票 62" gui/src`). Removal: delete this folder
 * and the pill's mount in App.tsx; in Sidebar.tsx keep the winning tier's
 * classes and labels and drop 「新用户」; drop the zone names' copy the
 * winner does not use (`sidebar.zoneWorkbench`, `sidebar.zoneAssistant`).
 */
import { create } from "zustand";

export type ZonesTier = "now" | "A" | "B" | "C";

export const ZONES_TIERS: readonly ZonesTier[] = ["now", "A", "B", "C"];

// ---- The switcher's state ------------------------------------------------

const TIER_KEY = "galley.tmp.sidebarZonesTrial.tier";
const NEW_USER_KEY = "galley.tmp.sidebarZonesTrial.newUser";

/** A stored choice, a per-machine convenience (HMR and reloads keep it);
 * production never reads it. */
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

function readTier(): ZonesTier {
  const stored = readStored(TIER_KEY);
  return ZONES_TIERS.find((tier) => tier === stored) ?? "now";
}

interface ZonesTrialState {
  tier: ZonesTier;
  /** 「新用户」: the list shows what a new install's would. */
  newUser: boolean;
  setTier: (tier: ZonesTier) => void;
  setNewUser: (newUser: boolean) => void;
}

export const useSidebarZonesTrialStore = create<ZonesTrialState>((set) => ({
  tier: readTier(),
  newUser: readStored(NEW_USER_KEY) === "1",
  setTier: (tier) => {
    writeStored(TIER_KEY, tier);
    set({ tier });
  },
  setNewUser: (newUser) => {
    writeStored(NEW_USER_KEY, newUser ? "1" : "0");
    set({ newUser });
  },
}));

export interface SidebarZonesTrial {
  tier: ZonesTier;
  newUser: boolean;
}

/** The trial in force: the pill's in a dev build; today's sidebar, with
 * the real list, in production. */
export function useSidebarZonesTrial(): SidebarZonesTrial {
  const tier = useSidebarZonesTrialStore((s) => s.tier);
  const newUser = useSidebarZonesTrialStore((s) => s.newUser);
  return import.meta.env.DEV
    ? { tier, newUser }
    : { tier: "now", newUser: false };
}

// ---- The tiers' layout ---------------------------------------------------

export interface SidebarZonesLayout {
  /** The card block's classes, in place of today's
   * `border-b border-line-strong py-1.5`: the strong line moves into the
   * workbench's name row, which every tier but `now` has. */
  cardBlock: string;
  /** 「助理」 on the masthead's line (B). */
  assistantLabel: boolean;
}

/**
 * The card block of each tier, `null` for today's sidebar. Measured from
 * the masthead's foot (44px), with the card 58px and the name's row 13px
 * (its line, and the turn of the ground, 6px into it):
 *
 *   now  card 50–108, line 114, new-chat button from 121
 *   A    card 50–108, line 118, button from 131   (+10)
 *   B    card 54–112, line 122, button from 135   (+14: 「助理」's
 *        row reaches 6px under the masthead's line, then 4px to the card)
 *   C    card 56–114, line 130, button from 143   (+22)
 */
export function sidebarZonesLayout(tier: ZonesTier): SidebarZonesLayout | null {
  switch (tier) {
    case "now":
      return null;
    case "A":
      return { cardBlock: "pb-1 pt-1.5", assistantLabel: false };
    case "B":
      return { cardBlock: "pb-1", assistantLabel: true };
    case "C":
      return { cardBlock: "pb-2.5 pt-3", assistantLabel: false };
  }
}
