/**
 * TEMPORARY — 票 66 临时切换器，定档后由拆除票删掉 (main chat PRD
 * rulings 117–119). Ticket 65 compared 乙 / 丙 and two card layouts; JC
 * settled on 丙 and the centred 72px stage (ruling 119 point 1), so in a
 * dev build that is simply the assistant's card now: the face that moves
 * (AssistantFace, alive at rest: blinks, looks around, dozes), on the
 * stage. One pill (AssistantFaceTrialSwitcher) is left, in the managed
 * runtime with a main chat, for two things:
 *
 *   幅度  1× / 1.5× / 2×  how big every move is (spatial sizes only —
 *                          distances, angles, scales' departure, the
 *                          jump's height; never timings or rates), for
 *                          JC to pull back on the real machine (1× is
 *                          ticket 66's targets);
 *   演示                   every state in turn, about three seconds each,
 *                          or one pinned (face-demo.ts); it changes only
 *                          what the face shows.
 *
 * Today's card — the 40px avatar, still, with the running spinner on its
 * corner — is what a production build draws (`useAssistantFaceTrial`
 * says `on: false` there) until the removal ticket moves the face and
 * the stage into production.
 *
 * Every branch point in the old files carries 「票 66 临时切换器，定档后
 * 由拆除票删掉」 (`grep -rn "票 66" gui/src`). Removal: delete this folder
 * and the mounts in App.tsx (keeping the driver's), make the stage and
 * the moving face the card in SidebarAssistant.tsx / Sidebar.tsx /
 * AssistantAvatar.tsx, fix the amplitude JC chose, and drop today's
 * 40px branch.
 */
import { create } from "zustand";

export type FaceAmplitude = 1 | 1.5 | 2;

export const FACE_AMPLITUDES: readonly FaceAmplitude[] = [1, 1.5, 2];

const AMPLITUDE_KEY = "galley.tmp.faceTrial.amplitude";
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

function storedAmplitude(): FaceAmplitude {
  const value = Number(readStored(AMPLITUDE_KEY));
  return FACE_AMPLITUDES.find((a) => a === value) ?? 1;
}

interface FaceTrialState {
  amplitude: FaceAmplitude;
  /** The demo plays (only what the face shows). */
  demo: boolean;
  /** One demo state pinned, or null for all in turn. */
  pinned: string | null;
  setAmplitude: (amplitude: FaceAmplitude) => void;
  setDemo: (demo: boolean) => void;
  setPinned: (pinned: string | null) => void;
}

export const useFaceTrialStore = create<FaceTrialState>((set) => ({
  amplitude: storedAmplitude(),
  demo: readStored(DEMO_KEY) === "1",
  pinned: readStored(PINNED_KEY) || null,
  setAmplitude: (amplitude) => {
    writeStored(AMPLITUDE_KEY, String(amplitude));
    set({ amplitude });
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
  /** The moving face on the stage card (a dev build); false: today's
   * still 40px card (production). */
  on: boolean;
  amplitude: FaceAmplitude;
  demo: boolean;
  pinned: string | null;
}

/** The trial in force: the pill's in a dev build; today's avatar and
 * card in production. */
export function useAssistantFaceTrial(): AssistantFaceTrial {
  const amplitude = useFaceTrialStore((s) => s.amplitude);
  const demo = useFaceTrialStore((s) => s.demo);
  const pinned = useFaceTrialStore((s) => s.pinned);
  return import.meta.env.DEV
    ? { on: true, amplitude, demo, pinned }
    : { on: false, amplitude: 1, demo: false, pinned: null };
}
