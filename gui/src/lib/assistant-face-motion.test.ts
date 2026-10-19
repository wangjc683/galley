import { describe, expect, it } from "vitest";

import type { FaceActivity, FaceReaction } from "@/lib/assistant-face";
import {
  basePose,
  bezierPoints,
  bobBeat,
  compose,
  EASE,
  easeAt,
  FACE_FIELDS,
  type FaceBeat,
  type FaceField,
  faceAtRest,
  fieldAt,
  loopBeat,
  loopVariants,
  MOTION,
  NEUTRAL_POSE,
  poseAt,
  reactionBeat,
  scaleBeat,
  scalePose,
  SPATIAL_FIELDS,
  turnBeat,
  Voice,
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
  for (let i = 0; i < 8; i++) {
    for (const activity of ACTIVITIES) {
      for (const variant of loopVariants(activity)) {
        const pick = loopBeat(
          activity,
          basePose(activity),
          rand,
          null,
          variant,
        );
        if (pick) beats.push(pick.beat);
      }
      beats.push(turnBeat(NEUTRAL_POSE, basePose(activity), activity));
    }
    for (const reaction of REACTIONS) {
      beats.push(reactionBeat(reaction, basePose("think"), NEUTRAL_POSE, rand));
    }
    beats.push(reactionBeat("askEnter", NEUTRAL_POSE, basePose("ask"), rand));
    beats.push(
      reactionBeat("errorEnter", NEUTRAL_POSE, basePose("error"), rand),
    );
    beats.push(bobBeat(NEUTRAL_POSE, rand));
  }
  return beats;
}
const BEATS = everyBeat();

/** The largest a field gets in a beat (by its keys and its ends). */
function extreme(beat: FaceBeat, field: FaceField, pick: "min" | "max") {
  const values = [
    beat.from[field],
    beat.end[field],
    ...(beat.tracks[field] ?? []).map((k) => k.v),
  ];
  return pick === "min" ? Math.min(...values) : Math.max(...values);
}
const reach = (beat: FaceBeat, field: FaceField) =>
  Math.max(
    Math.abs(extreme(beat, field, "min") - NEUTRAL_POSE[field]),
    Math.abs(extreme(beat, field, "max") - NEUTRAL_POSE[field]),
  );

describe("the curves", () => {
  it("eases from 0 to 1 along a cubic Bézier", () => {
    expect(easeAt(EASE.firm, 0)).toBe(0);
    expect(easeAt(EASE.firm, 1)).toBe(1);
    expect(easeAt("linear", 0.3)).toBeCloseTo(0.3, 3);
    expect(easeAt(EASE.firm, 0.5)).toBeGreaterThan(0.8);
    expect(bezierPoints("linear")).toEqual([0, 0, 1, 1]);
  });

  it("plays only curves SMIL takes: overshoot played as two segments, control points inside 0–1", () => {
    const bad: string[] = [];
    for (const beat of BEATS) {
      for (const keys of Object.values(beat.tracks)) {
        for (const key of keys) {
          const points = bezierPoints(key.ease);
          if (
            key.ease === EASE.spring ||
            key.ease === EASE.bounce ||
            points.some((v) => v < 0 || v > 1)
          ) {
            bad.push(`${beat.name} ${key.ease}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("swings past the target and back on a bounce (甩过头再回弹)", () => {
    const beat = compose("t", NEUTRAL_POSE, NEUTRAL_POSE, [
      new Voice().to(200, { x: 100 }, EASE.firm).to(300, {}, EASE.bounce),
    ]);
    expect(extreme(beat, "x", "min")).toBeLessThan(0);
    expect(beat.tracks.x![beat.tracks.x!.length - 1].v).toBe(0);
  });
});

describe("a beat", () => {
  it("keys each field in time order, from where the face is to where it stays", () => {
    for (const beat of BEATS) {
      expect(poseAt(beat, 0), beat.name).toEqual({
        ...beat.end,
        ...Object.fromEntries(FACE_FIELDS.map((f) => [f, fieldAt(beat, f, 0)])),
      });
      for (const f of FACE_FIELDS) {
        expect(fieldAt(beat, f, 0), `${beat.name} ${f}`).toBeCloseTo(
          beat.from[f],
          6,
        );
      }
      expect(poseAt(beat, beat.duration), beat.name).toEqual(beat.end);
      for (const [f, keys] of Object.entries(beat.tracks)) {
        for (let i = 1; i < keys.length; i++) {
          expect(keys[i].t, `${beat.name} ${f}`).toBeGreaterThanOrEqual(
            keys[i - 1].t,
          );
        }
        expect(keys[keys.length - 1].t).toBeLessThanOrEqual(beat.duration);
        expect(keys[keys.length - 1].v, `${beat.name} ${f}`).toBe(
          beat.end[f as FaceField],
        );
      }
    }
  });

  it("will not let two voices move the same field", () => {
    expect(() =>
      compose("t", NEUTRAL_POSE, NEUTRAL_POSE, [
        new Voice().to(100, { x: 1 }).to(100, {}),
        new Voice().to(100, { x: 2 }).to(100, {}),
      ]),
    ).toThrow(/two voices/);
  });

  it("varies: two to four variants for every activity that has beats", () => {
    for (const activity of ACTIVITIES) {
      const n = loopVariants(activity).length;
      expect(n, activity).toBeGreaterThanOrEqual(2);
      expect(n, activity).toBeLessThanOrEqual(4);
    }
  });

  it("keeps a move at rest under 0.6s (a blink under 0.2s), dozing too", () => {
    const rand = seeded(9);
    for (let i = 0; i < 50; i++) {
      for (const activity of ["idle", "doze"] as const) {
        for (const variant of loopVariants(activity)) {
          const beat = loopBeat(
            activity,
            basePose(activity),
            rand,
            null,
            variant,
          )!.beat;
          expect(beat.duration, beat.name).toBeLessThanOrEqual(
            variant === "blink" ? 200 : 600,
          );
        }
      }
    }
  });
});

describe("the sizes (ticket 66, 1× on the 72px avatar: 57 units a pixel)", () => {
  const PX = 57;
  const loops = (activity: FaceActivity) =>
    BEATS.filter((b) => b.name.startsWith(`${activity}:`));
  const max = (beats: FaceBeat[], field: FaceField) =>
    Math.max(...beats.map((b) => reach(b, field)));

  it("moves the head 6–8px in the work that turns it", () => {
    for (const activity of [
      "browse",
      "note",
      "awaitSubtask",
      "work",
    ] as const) {
      const m = Math.max(max(loops(activity), "x"), max(loops(activity), "y"));
      expect(m / PX, activity).toBeGreaterThanOrEqual(6);
    }
  });

  it("tilts it 12–20°", () => {
    expect(max(loops("think"), "rot")).toBeGreaterThanOrEqual(12);
    expect(max(loops("think"), "rot")).toBeLessThanOrEqual(20);
    const ask = reactionBeat(
      "askEnter",
      NEUTRAL_POSE,
      basePose("ask"),
      seeded(1),
    );
    expect(reach(ask, "rot")).toBeGreaterThanOrEqual(20);
  });

  it("jumps 10–12px out of the circle when done, from a crouch, landing squashed", () => {
    const done = reactionBeat("done", NEUTRAL_POSE, NEUTRAL_POSE, seeded(1));
    const top = -extreme(done, "y", "min") / PX;
    expect(top).toBeGreaterThanOrEqual(10);
    expect(top).toBeLessThanOrEqual(12.2);
    const y = done.tracks.y!;
    // Anticipation: down before up.
    expect(y[0].v).toBeGreaterThan(0);
    expect(extreme(done, "sy", "min")).toBeLessThanOrEqual(0.82);
    expect(extreme(done, "sy", "max")).toBeGreaterThanOrEqual(1.15);
  });

  it("squashes and stretches 15–20% in work", () => {
    const work = loops("work");
    expect(
      Math.min(...work.map((b) => extreme(b, "sy", "min"))),
    ).toBeLessThanOrEqual(0.85);
    expect(
      Math.max(...work.map((b) => extreme(b, "sy", "max"))),
    ).toBeGreaterThanOrEqual(1.1);
  });

  it("opens the eyes to 1.7 and the mouth from a slit to 1.8", () => {
    const drop = reactionBeat("drop", NEUTRAL_POSE, NEUTRAL_POSE, seeded(1));
    expect(extreme(drop, "wide", "max")).toBe(1.7);
    const talk = loops("talk");
    expect(
      Math.max(...talk.map((b) => extreme(b, "mouth", "max"))),
    ).toBeGreaterThanOrEqual(1.7);
    expect(
      Math.min(...talk.map((b) => extreme(b, "mouth", "min"))),
    ).toBeLessThanOrEqual(0.25);
  });

  it("moves the tongue in every kind of work", () => {
    for (const activity of [
      "think",
      "browse",
      "read",
      "note",
      "work",
      "talk",
      "awaitSubtask",
    ] as const) {
      const moved = loops(activity).some(
        (b) => reach(b, "t3") >= 10 || reach(b, "t2") >= 10,
      );
      expect(moved, activity).toBe(true);
    }
  });
});

describe("what each motion says", () => {
  const rand = seeded(2);
  const end = NEUTRAL_POSE;

  it("done: smiling eyes, a grin, a ✦, the tongue wagging", () => {
    const beat = reactionBeat("done", end, end, rand);
    expect(extreme(beat, "smile", "max")).toBe(1);
    expect(extreme(beat, "grin", "max")).toBe(1);
    expect(extreme(beat, "spark", "max")).toBeGreaterThanOrEqual(1);
    const wags = beat.tracks.t3!.filter((k) => k.v <= -40).length;
    expect(wags).toBeGreaterThanOrEqual(3);
    expect(faceAtRest(beat.end)).toBe(true);
  });

  it("asking: the head tilted, the tongue curled like a question mark, a ？ that stays", () => {
    const ask = basePose("ask");
    expect(Math.abs(ask.rot)).toBeGreaterThanOrEqual(12);
    expect(ask.t3).toBeLessThan(-30);
    expect(ask.q).toBe(1);
  });

  it("an error: a shake, × eyes, sweat, then hanging and limp", () => {
    const beat = reactionBeat("errorEnter", end, basePose("error"), rand);
    const xs = beat.tracks.x!.map((k) => Math.sign(k.v)).filter(Boolean);
    expect(new Set(xs)).toEqual(new Set([1, -1]));
    const error = basePose("error");
    expect(error.cross).toBe(1);
    expect(error.sweat).toBe(1);
    expect(error.y).toBeGreaterThan(200);
  });

  it("the tongue catches up after the head (follow-through)", () => {
    const pick = loopBeat("note", basePose("note"), rand, null, "nod")!;
    const body = pick.beat.tracks.y![0].t;
    const tongue = pick.beat.tracks.t3!.find(
      (k) => k.v !== basePose("note").t3,
    )!.t;
    expect(tongue).toBeGreaterThan(body);
  });

  it("working by hand: eyes > <; dozing: ‿ ‿ and z z", () => {
    expect(basePose("work").strain).toBe(1);
    expect(basePose("doze").sleep).toBe(1);
    const breath = loopBeat("doze", basePose("doze"), rand, null, "breath")!;
    expect(extreme(breath.beat, "zz", "max")).toBe(1);
  });

  it("dispatching: the tongue reaches out, longer, and comes back", () => {
    const beat = reactionBeat("dispatch", end, end, rand);
    expect(extreme(beat, "stretch", "max")).toBeGreaterThan(0.1);
    expect(extreme(beat, "t3", "min")).toBeLessThan(-20);
    expect(beat.end.stretch).toBe(0);
  });

  it("the undercurrent: a breath up and back, about 2px, its length drawn", () => {
    const a = bobBeat(NEUTRAL_POSE, seeded(1));
    const b = bobBeat(NEUTRAL_POSE, seeded(2));
    expect(a.duration).not.toBe(b.duration);
    expect(extreme(a, "y", "min")).toBeLessThan(-100);
    expect(a.end).toEqual(NEUTRAL_POSE);
  });
});

describe("the amplitude", () => {
  it("scales sizes in space only: not how shut the eyes are, which shape they take, the marks", () => {
    const pose = {
      ...basePose("error"),
      x: 100,
      gx: 50,
      lid: 0.5,
      wide: 1.2,
      mouth: 0.4,
    };
    const two = scalePose(pose, 2);
    for (const f of FACE_FIELDS) {
      if (SPATIAL_FIELDS.includes(f)) {
        expect(two[f] - NEUTRAL_POSE[f], f).toBeCloseTo(
          2 * (pose[f] - NEUTRAL_POSE[f]),
          9,
        );
      } else {
        expect(two[f], f).toBe(pose[f]);
      }
    }
    expect(SPATIAL_FIELDS).not.toContain("lid");
    expect(SPATIAL_FIELDS).not.toContain("sweat");
  });

  it("scales a beat's sizes, never its timing", () => {
    const pick = loopBeat("work", basePose("work"), seeded(3), null, "bumps")!;
    const quiet = scaleBeat(pick.beat, 0.4);
    expect(quiet.duration).toBe(pick.beat.duration);
    expect(quiet.tracks.y!.map((k) => k.t)).toEqual(
      pick.beat.tracks.y!.map((k) => k.t),
    );
    expect(reach(quiet, "y")).toBeCloseTo(0.4 * reach(pick.beat, "y"), 6);
    expect(quiet.from).toEqual(pick.beat.from);
  });

  it("quiets a long stretch to four tenths, a full-size beat every 20–30 seconds", () => {
    expect(MOTION.quiet.afterMs).toBe(15_000);
    expect(MOTION.quiet.k).toBe(0.4);
    expect(MOTION.quiet.bigMs).toEqual([20_000, 30_000]);
  });
});
