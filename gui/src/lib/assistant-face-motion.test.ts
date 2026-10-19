import { describe, expect, it } from "vitest";

import type { FaceActivity, FaceReaction } from "@/lib/assistant-face";
import {
  basePose,
  bezierPoints,
  bobBeat,
  easeAt,
  EASE,
  type FaceBeat,
  faceAtRest,
  loopBeat,
  loopVariants,
  MOTION,
  NEUTRAL_POSE,
  poseAt,
  reactionBeat,
  turnBeat,
} from "@/lib/assistant-face-motion";

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACTIVITIES: FaceActivity[] = [
  "idle",
  "think",
  "browse",
  "read",
  "note",
  "work",
  "talk",
  "awaitSubtask",
  "doze",
];
const REACTIONS: FaceReaction[] = [
  "sent",
  "listen",
  "look",
  "drop",
  "stop",
  "done",
  "dispatch",
  "subtaskBack",
  "wakeReminder",
  "wake",
  "askEnter",
  "errorEnter",
];

/** Many beats of every kind, sizes and timings drawn. */
function everyBeat(): FaceBeat[] {
  const beats: FaceBeat[] = [];
  const rand = seeded(5);
  for (let i = 0; i < 40; i++) {
    for (const activity of ACTIVITIES) {
      const pick = loopBeat(activity, basePose(activity), rand, null);
      if (pick) beats.push(pick.beat);
      beats.push(turnBeat(NEUTRAL_POSE, basePose(activity), activity));
    }
    for (const reaction of REACTIONS) {
      beats.push(reactionBeat(reaction, basePose("think"), NEUTRAL_POSE, rand));
    }
    beats.push(bobBeat(NEUTRAL_POSE, rand));
  }
  return beats;
}

describe("the curves", () => {
  it("eases from 0 to 1 along a cubic Bézier", () => {
    expect(easeAt(EASE.firm, 0)).toBe(0);
    expect(easeAt(EASE.firm, 1)).toBe(1);
    expect(easeAt("linear", 0.3)).toBeCloseTo(0.3, 3);
    // Firm is an ease-out: well past half way at the half.
    expect(easeAt(EASE.firm, 0.5)).toBeGreaterThan(0.8);
    expect(bezierPoints("linear")).toEqual([0, 0, 1, 1]);
  });

  it("plays only curves SMIL takes: control points inside 0–1 (the spring as two segments)", () => {
    for (const beat of everyBeat()) {
      for (const frame of beat.frames) {
        expect(frame.ease, beat.name).not.toBe(EASE.spring);
        for (const v of bezierPoints(frame.ease)) {
          expect(v, `${beat.name} ${frame.ease}`).toBeGreaterThanOrEqual(0);
          expect(v, `${beat.name} ${frame.ease}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("a beat", () => {
  it("runs from its first frame at 0 to its last at 1, in order", () => {
    for (const beat of everyBeat()) {
      expect(beat.frames.length, beat.name).toBeGreaterThanOrEqual(2);
      expect(beat.frames[0].at).toBe(0);
      expect(beat.frames[beat.frames.length - 1].at).toBe(1);
      for (let i = 1; i < beat.frames.length; i++) {
        expect(beat.frames[i].at, beat.name).toBeGreaterThanOrEqual(
          beat.frames[i - 1].at,
        );
      }
    }
  });

  it("knows where the face is at any moment", () => {
    const beat = turnBeat(NEUTRAL_POSE, basePose("read"), "read");
    expect(poseAt(beat, 0)).toEqual(NEUTRAL_POSE);
    expect(poseAt(beat, beat.duration)).toEqual(basePose("read"));
    const mid = poseAt(beat, beat.duration / 2);
    expect(mid.gy).toBeGreaterThan(0);
    expect(mid.gy).toBeLessThan(basePose("read").gy);
  });

  it("keeps the eyes inside the face and off the mouth, the mouth inside its lips", () => {
    // Room around the eyes (assistant-face-geometry.ts): about 130
    // units to either side, 79 above, 78 below to the mouth's top.
    for (const beat of everyBeat()) {
      for (const { pose } of beat.frames) {
        expect(Math.abs(pose.gx), beat.name).toBeLessThanOrEqual(110);
        expect(pose.gy, beat.name).toBeGreaterThanOrEqual(-62);
        expect(pose.gy, beat.name).toBeLessThanOrEqual(62);
        expect(pose.jaw, beat.name).toBeGreaterThanOrEqual(0);
        expect(pose.jaw, beat.name).toBeLessThanOrEqual(1);
        expect(Math.abs(pose.rot), beat.name).toBeLessThanOrEqual(8);
      }
    }
  });

  it("varies: two to four variants for every activity that has beats", () => {
    for (const activity of ACTIVITIES) {
      const n = loopVariants(activity).length;
      if (activity === "doze") expect(n).toBe(1);
      else expect(n, activity).toBeGreaterThanOrEqual(2);
      expect(n, activity).toBeLessThanOrEqual(4);
    }
  });
});

describe("what each motion says", () => {
  const rand = seeded(2);
  const end = NEUTRAL_POSE;
  const peak = (beat: FaceBeat, key: keyof typeof NEUTRAL_POSE) =>
    beat.frames.map((f) => f.pose[key]);

  it("done: a hop with smiling eyes", () => {
    const beat = reactionBeat("done", end, end, rand);
    expect(Math.min(...peak(beat, "y"))).toBe(MOTION.done.jumpY);
    expect(Math.max(...peak(beat, "smile"))).toBeGreaterThanOrEqual(1);
    expect(faceAtRest(beat.frames[beat.frames.length - 1].pose)).toBe(true);
  });

  it("ask: the head tilts, then straight", () => {
    const beat = reactionBeat("askEnter", end, end, rand);
    expect(Math.max(...peak(beat, "rot").map(Math.abs))).toBeGreaterThanOrEqual(
      MOTION.askEnter.tiltDeg,
    );
  });

  it("an error: two blinks and a flinch", () => {
    const beat = reactionBeat("errorEnter", end, end, rand);
    const shut = beat.frames.filter((f) => f.pose.lid < 0.2).length;
    expect(shut).toBeGreaterThanOrEqual(2);
    expect(Math.min(...peak(beat, "sx"))).toBe(MOTION.errorEnter.shrink);
  });

  it("talking: the mouth closes and opens, back open at the end", () => {
    const pick = loopBeat("talk", end, rand, null)!;
    expect(Math.max(...peak(pick.beat, "jaw"))).toBeGreaterThan(0.25);
    expect(pick.beat.frames[pick.beat.frames.length - 1].pose.jaw).toBe(0);
  });

  it("a reminder: from shut eyes to wide open, and a hop", () => {
    const beat = reactionBeat("wakeReminder", basePose("doze"), end, rand);
    expect(beat.frames[1].pose.lid).toBeLessThanOrEqual(0.12);
    expect(Math.max(...peak(beat, "lid"))).toBeGreaterThan(1);
    expect(Math.min(...peak(beat, "y"))).toBe(MOTION.wakeReminder.hopY);
  });

  it("dozing: sleeping eyes, the mouth half shut", () => {
    expect(basePose("doze").sleep).toBe(1);
    expect(basePose("doze").jaw).toBeGreaterThan(0);
  });

  it("the undercurrent: a breath up and back, its length drawn", () => {
    const a = bobBeat(NEUTRAL_POSE, seeded(1));
    const b = bobBeat(NEUTRAL_POSE, seeded(2));
    expect(a.duration).not.toBe(b.duration);
    expect(Math.min(...peak(a, "y"))).toBeLessThan(-40);
    expect(a.frames[a.frames.length - 1].pose).toEqual(NEUTRAL_POSE);
  });
});
