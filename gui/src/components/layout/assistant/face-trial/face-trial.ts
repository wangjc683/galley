/**
 * TEMPORARY — 票 65 临时切换器，定档后由拆除票删掉 (main chat PRD
 * rulings 117, 118). Two things compared live in tauri dev with one pill
 * (AssistantFaceTrialSwitcher), in the managed runtime with a main chat:
 *
 *   动效  乙  the face follows what the assistant does (ruling 117's
 *             table) and holds still when nothing happens;
 *         丙  乙, and alive at rest: a blink every 8–15 seconds, a look
 *             around now and then, dozing when long alone or late at
 *             night, woken by a touch.
 *   版式  行 64    the card as an IM list row with a 64px avatar;
 *         舞台 72  the avatar 72px and centred, its name and last line
 *                  under it (the default).
 *
 * The pill has no 「现状」 (JC: 「只要乙和丙」); today's card — the 40px
 * avatar, still, with the running spinner on its corner — is what a
 * production build draws (`useAssistantFaceTrial` returns nulls there)
 * and stays in the code until the removal ticket.
 *
 * The demo plays every state in turn, about three seconds each, or one
 * of them pinned (face-demo.ts); it changes only what the face shows.
 *
 * Every branch point in the old files carries 「票 65 临时切换器，定档后
 * 由拆除票删掉」 (`grep -rn "票 65" gui/src`). Removal: delete this folder
 * and the mounts in App.tsx; keep the winning motion (the driver, or
 * none) and layout in SidebarAssistant.tsx / Sidebar.tsx /
 * AssistantAvatar.tsx / AssistantIdentity.tsx, and drop the other's.
 */
import { create } from "zustand";

export type FaceMotionTier = "B" | "C";
export type CardLayoutTier = "row64" | "stage72";

export const FACE_MOTION_TIERS: readonly FaceMotionTier[] = ["B", "C"];
export const CARD_LAYOUT_TIERS: readonly CardLayoutTier[] = [
  "row64",
  "stage72",
];

const MOTION_KEY = "galley.tmp.faceTrial.motion";
const LAYOUT_KEY = "galley.tmp.faceTrial.layout";
const DEMO_KEY = "galley.tmp.faceTrial.demo";
const PINNED_KEY = "galley.tmp.faceTrial.pinned";

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

interface FaceTrialState {
  motion: FaceMotionTier;
  layout: CardLayoutTier;
  /** The demo plays (only what the face shows). */
  demo: boolean;
  /** One demo state pinned, or null for all in turn. */
  pinned: string | null;
  setMotion: (motion: FaceMotionTier) => void;
  setLayout: (layout: CardLayoutTier) => void;
  setDemo: (demo: boolean) => void;
  setPinned: (pinned: string | null) => void;
}

export const useFaceTrialStore = create<FaceTrialState>((set) => ({
  motion: readStored(MOTION_KEY) === "C" ? "C" : "B",
  layout: readStored(LAYOUT_KEY) === "row64" ? "row64" : "stage72",
  demo: readStored(DEMO_KEY) === "1",
  pinned: readStored(PINNED_KEY) || null,
  setMotion: (motion) => {
    writeStored(MOTION_KEY, motion);
    set({ motion });
  },
  setLayout: (layout) => {
    writeStored(LAYOUT_KEY, layout);
    set({ layout });
  },
  setDemo: (demo) => {
    writeStored(DEMO_KEY, demo ? "1" : "0");
    set({ demo });
  },
  setPinned: (pinned) => {
    writeStored(PINNED_KEY, pinned ?? "");
    set({ pinned });
  },
}));

export interface AssistantFaceTrial {
  /** null: today's still avatar (production). */
  motion: FaceMotionTier | null;
  /** null: today's 40px card (production). */
  layout: CardLayoutTier | null;
  demo: boolean;
  pinned: string | null;
}

/** The trial in force: the pill's in a dev build; today's avatar and
 * card in production. */
export function useAssistantFaceTrial(): AssistantFaceTrial {
  const motion = useFaceTrialStore((s) => s.motion);
  const layout = useFaceTrialStore((s) => s.layout);
  const demo = useFaceTrialStore((s) => s.demo);
  const pinned = useFaceTrialStore((s) => s.pinned);
  return import.meta.env.DEV
    ? { motion, layout, demo, pinned }
    : { motion: null, layout: null, demo: false, pinned: null };
}
