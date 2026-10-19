import { create } from "zustand";

import type { FaceReaction } from "@/lib/assistant-face";
import {
  type FaceBeat,
  type FacePose,
  NEUTRAL_POSE,
} from "@/lib/assistant-face-motion";

/**
 * The assistant's face, shared by every avatar that draws it (ticket 65):
 * the beat to play now (`seq` counts beats, so the same beat twice still
 * plays twice) and the pose it ends on, which an avatar mounted later
 * takes at once; and the undercurrent's breath while it works (`bob`).
 * The director (lib/assistant-face-director.ts, driven by
 * hooks/useAssistantFaceDriver.ts) writes it; AssistantFace reads it.
 *
 * Two small channels the other way: each avatar says whether it is on
 * screen (the director pauses with none), and the card and the header
 * say when the pointer comes onto the assistant (`signal("look")`).
 */
interface AssistantFaceState {
  beat: FaceBeat | null;
  seq: number;
  /** The undercurrent's breath to play now, and its count. */
  bob: FaceBeat | null;
  bobSeq: number;
  /** Where the last beat ends. */
  pose: FacePose;
  /** What the demo plays now, for the pill (ticket 65's trial). */
  demoLabel: string | null;
  /** Avatars on screen, by their own id. */
  onScreen: Record<string, true>;
  /** The latest signal to the driver, and its count. */
  signal: { kind: FaceReaction; seq: number } | null;
  play: (beat: FaceBeat) => void;
  playBob: (beat: FaceBeat) => void;
  setDemoLabel: (label: string | null) => void;
  setOnScreen: (id: string, on: boolean) => void;
  sendSignal: (kind: FaceReaction) => void;
}

export const useAssistantFaceStore = create<AssistantFaceState>()(
  (set, get) => ({
    beat: null,
    seq: 0,
    bob: null,
    bobSeq: 0,
    pose: NEUTRAL_POSE,
    demoLabel: null,
    onScreen: {},
    signal: null,
    play: (beat) =>
      set((s) => ({
        beat,
        seq: s.seq + 1,
        pose: beat.frames[beat.frames.length - 1].pose,
      })),
    playBob: (bob) => set((s) => ({ bob, bobSeq: s.bobSeq + 1 })),
    setDemoLabel: (demoLabel) => {
      if (get().demoLabel !== demoLabel) set({ demoLabel });
    },
    setOnScreen: (id, on) => {
      const current = get().onScreen;
      if ((current[id] === true) === on) return;
      const onScreen = { ...current };
      if (on) onScreen[id] = true;
      else delete onScreen[id];
      set({ onScreen });
    },
    sendSignal: (kind) =>
      set((s) => ({ signal: { kind, seq: (s.signal?.seq ?? 0) + 1 } })),
  }),
);

/** The pointer came onto the assistant (its card, its header row). */
export function signalAssistantLook(): void {
  useAssistantFaceStore.getState().sendSignal("look");
}
