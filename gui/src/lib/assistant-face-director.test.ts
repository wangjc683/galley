import { describe, expect, it } from "vitest";

import type { FaceActivity, FaceReaction } from "@/lib/assistant-face";
import { FaceDirector, type FaceClock } from "@/lib/assistant-face-director";
import {
  basePose,
  type FaceBeat,
  faceAtRest,
  listenPose,
  MOTION,
  NEUTRAL_POSE,
  samePose,
  WORKING,
} from "@/lib/assistant-face-motion";

/**
 * The face director on a clock the test moves by hand (no real waiting),
 * with a seeded chance.
 */

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

interface Played {
  t: number;
  beat: FaceBeat;
}

function rig(seed = 1) {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { t: number; fn: () => void }>();
  const clock: FaceClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.set(++id, { t: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => {
      timers.delete(h as number);
    },
  };
  const beats: Played[] = [];
  const bobs: Played[] = [];
  const director = new FaceDirector({
    clock,
    random: seeded(seed),
    onBeat: (beat) => beats.push({ t: now, beat }),
    onBob: (beat) => bobs.push({ t: now, beat }),
  });
  /** Run the clock to `t`, firing timers in order. */
  const advance = (to: number) => {
    for (;;) {
      let next: [number, { t: number; fn: () => void }] | null = null;
      for (const entry of timers) {
        if (!next || entry[1].t < next[1].t) next = entry;
      }
      if (!next || next[1].t > to) break;
      timers.delete(next[0]);
      now = next[1].t;
      next[1].fn();
    }
    now = to;
  };
  return {
    director,
    beats,
    bobs,
    advance,
    get now() {
      return now;
    },
    pending: () => timers.size,
  };
}

const last = (beat: FaceBeat) => beat.frames[beat.frames.length - 1].pose;

/** When the face moves, from what was played: the time inside segments
 * whose poses differ, cut where the next beat on the channel began. */
function movingIntervals(played: Played[], until: number): [number, number][] {
  const out: [number, number][] = [];
  played.forEach(({ t, beat }, i) => {
    const cut = Math.min(played[i + 1]?.t ?? until, until);
    for (let k = 0; k < beat.frames.length - 1; k++) {
      const a = beat.frames[k];
      const b = beat.frames[k + 1];
      if (samePose(a.pose, b.pose)) continue;
      const from = t + a.at * beat.duration;
      const to = Math.min(t + b.at * beat.duration, cut);
      if (to > from) out.push([from, to]);
    }
  });
  return out;
}

/** The share of [from, until] in which some part moves, and the longest
 * still stretch. */
function motion(intervals: [number, number][], from: number, until: number) {
  const sorted = intervals
    .map(
      ([a, b]) => [Math.max(a, from), Math.min(b, until)] as [number, number],
    )
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let moving = 0;
  let longestStill = 0;
  let cursor = from;
  for (const [a, b] of sorted) {
    if (a > cursor) longestStill = Math.max(longestStill, a - cursor);
    if (b > cursor) {
      moving += b - Math.max(a, cursor);
      cursor = b;
    }
  }
  longestStill = Math.max(longestStill, until - cursor);
  return { share: moving / (until - from), longestStill };
}

/** Ten simulated minutes of an activity, over several seeds. */
function measure(activity: FaceActivity, alive: boolean) {
  const results = [1, 2, 3, 4, 5].map((seed) => {
    const r = rig(seed);
    r.director.setAlive(alive);
    r.director.setActivity(activity);
    const until = 10 * 60_000;
    r.advance(until);
    // From after the face has turned to the activity (a doze closes its
    // eyes over 2.2s first).
    const from = 5_000;
    return motion(
      [...movingIntervals(r.beats, until), ...movingIntervals(r.bobs, until)],
      from,
      until,
    );
  });
  return {
    share: results.reduce((s, x) => s + x.share, 0) / results.length,
    longestStill: Math.max(...results.map((x) => x.longestStill)),
  };
}

describe("an activity: turn to its pose, then its beats with pauses", () => {
  it("turns to the activity's pose, then plays a loop beat after a pause", () => {
    const r = rig();
    r.director.setActivity("browse");
    expect(r.beats).toHaveLength(1);
    expect(r.beats[0].beat.name).toBe("enter:browse");
    expect(last(r.beats[0].beat)).toEqual(basePose("browse"));
    r.advance(MOTION.turnMs);
    // A pause, not a beat at once.
    expect(r.beats).toHaveLength(1);
    r.advance(MOTION.turnMs + MOTION.browse.gapMs[1]);
    expect(r.beats.length).toBeGreaterThanOrEqual(2);
    expect(r.beats[1].beat.name.startsWith("browse:")).toBe(true);
    // Every loop beat ends back on the activity's pose.
    expect(last(r.beats[1].beat)).toEqual(basePose("browse"));
  });

  it("never plays the same variant twice in a row, and varies its timing", () => {
    const r = rig(7);
    r.director.setActivity("work");
    r.advance(120_000);
    const loops = r.beats.filter((b) => b.beat.name.startsWith("work:"));
    expect(loops.length).toBeGreaterThan(20);
    for (let i = 1; i < loops.length; i++) {
      expect(loops[i].beat.name).not.toBe(loops[i - 1].beat.name);
    }
    const durations = new Set(loops.map((b) => Math.round(b.beat.duration)));
    expect(durations.size).toBeGreaterThan(loops.length / 2);
    const gaps = loops
      .slice(1)
      .map((b, i) => b.t - (loops[i].t + loops[i].beat.duration));
    expect(new Set(gaps.map(Math.round)).size).toBeGreaterThan(gaps.length / 2);
  });

  it("holds still at rest in 乙, while waiting for you and after an error", () => {
    for (const activity of ["idle", "ask", "error"] as const) {
      const r = rig();
      r.director.setActivity("think");
      r.advance(5_000);
      r.director.setActivity(activity);
      const settled = r.beats.length;
      r.advance(120_000);
      // The turn back to looking at you, then nothing.
      expect(r.beats.length - settled, activity).toBeLessThanOrEqual(1);
      expect(last(r.beats[r.beats.length - 1].beat)).toEqual(NEUTRAL_POSE);
    }
  });

  it("lives at rest in 丙: a blink or a look every 8–15 seconds", () => {
    const r = rig(3);
    r.director.setAlive(true);
    r.advance(300_000);
    const loops = r.beats.filter((b) => b.beat.name.startsWith("idle:"));
    expect(loops.length).toBeGreaterThan(15);
    for (let i = 1; i < loops.length; i++) {
      const gap = loops[i].t - (loops[i - 1].t + loops[i - 1].beat.duration);
      expect(gap).toBeGreaterThanOrEqual(MOTION.idleAlive.gapMs[0]);
      expect(gap).toBeLessThanOrEqual(MOTION.idleAlive.gapMs[1]);
    }
  });
});

describe("a reaction cuts in and hands back to the activity", () => {
  it("plays at once and ends on the activity's pose; its beats go on", () => {
    const r = rig();
    r.director.setActivity("read");
    r.advance(3_000);
    r.director.react("sent");
    const reaction = r.beats[r.beats.length - 1].beat;
    expect(reaction.name).toBe("sent");
    expect(last(reaction)).toEqual(basePose("read"));
    r.advance(3_000 + reaction.duration + MOTION.read.gapMs[1] + 10);
    expect(
      r.beats.slice(-1)[0].beat.name.startsWith("read:") ||
        r.beats.slice(-1)[0].beat.name === "sent",
    ).toBe(true);
    expect(
      r.beats.some(
        (b, i) => i > 0 && b.t > 3_000 && b.beat.name.startsWith("read:"),
      ),
    ).toBe(true);
  });

  it("starts from where the face really is, mid-beat", () => {
    const r = rig();
    r.director.setActivity("browse");
    r.advance(MOTION.turnMs / 2);
    r.director.react("look");
    const look = r.beats[r.beats.length - 1].beat;
    const first = look.frames[0].pose;
    // Half-way between at rest and browsing's pose, not either end.
    expect(first.gx).toBeLessThan(0);
    expect(first.gx).toBeGreaterThan(basePose("browse").gx);
  });

  it("plays the new activity after the reaction when it changed meanwhile", () => {
    const r = rig();
    r.director.react("done");
    const done = r.beats[0].beat;
    r.director.setActivity("think");
    // Not cut: the hop plays out.
    expect(r.beats).toHaveLength(1);
    r.advance(done.duration);
    expect(r.beats[1].beat.name).toBe("enter:think");
  });

  it("holds the listening pose while you type, then turns back", () => {
    const r = rig();
    r.director.setActivity("idle");
    r.director.react("listen");
    expect(last(r.beats[0].beat)).toEqual(listenPose());
    for (let t = 300; t <= 3_000; t += 300) {
      r.advance(t);
      r.director.react("listen");
    }
    // Still one beat: typing on keeps it listening.
    expect(r.beats).toHaveLength(1);
    r.advance(3_000 + MOTION.listen.holdMs + 10);
    expect(r.beats).toHaveLength(2);
    expect(last(r.beats[1].beat)).toEqual(NEUTRAL_POSE);
  });

  it("every reaction ends on the pose it was asked to", () => {
    const reactions: FaceReaction[] = [
      "sent",
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
    for (const reaction of reactions) {
      const r = rig();
      r.director.setActivity("note");
      r.advance(2_000);
      r.director.react(reaction);
      expect(last(r.beats[r.beats.length - 1].beat), reaction).toEqual(
        basePose("note"),
      );
    }
  });
});

describe("paused, and still", () => {
  it("starts nothing while paused; the beat under way finishes", () => {
    const r = rig();
    r.director.setActivity("talk");
    r.advance(10_000);
    r.director.setActive(false);
    const count = r.beats.length;
    const bobs = r.bobs.length;
    r.advance(60_000);
    expect(r.beats.length).toBe(count);
    expect(r.bobs.length).toBe(bobs);
    r.director.react("sent");
    expect(r.beats.length).toBe(count);
    r.director.setActive(true);
    r.advance(70_000);
    expect(r.beats.length).toBeGreaterThan(count);
    expect(r.bobs.length).toBeGreaterThan(bobs);
  });

  it("sets the drawn face at once under reduced motion and plays nothing", () => {
    const r = rig();
    r.director.setActivity("work");
    r.advance(5_000);
    r.director.setStill(true);
    const still = r.beats[r.beats.length - 1].beat;
    expect(still.name).toBe("still");
    expect(still.duration).toBe(0);
    expect(last(still)).toEqual(NEUTRAL_POSE);
    expect(r.bobs[r.bobs.length - 1].beat.name).toBe("still");
    const count = r.beats.length;
    r.director.react("done");
    r.director.setActivity("browse");
    r.advance(120_000);
    expect(r.beats.length).toBe(count);
    expect(faceAtRest(last(r.beats[count - 1].beat))).toBe(true);
  });
});

describe("busy or not reads at a glance (ruling 117 point 8)", () => {
  it("breathes without a pause while it works, and settles when the work ends", () => {
    const r = rig();
    r.director.setActivity("read");
    r.advance(20_000);
    expect(r.bobs.length).toBeGreaterThan(10);
    for (let i = 1; i < r.bobs.length; i++) {
      const before = r.bobs[i - 1];
      expect(r.bobs[i].t).toBe(before.t + before.beat.duration);
    }
    r.director.setActivity("ask");
    const settle = r.bobs[r.bobs.length - 1];
    expect(settle.beat.name).toBe("bob:settle");
    expect(last(settle.beat)).toEqual(NEUTRAL_POSE);
    const count = r.bobs.length;
    r.advance(60_000);
    expect(r.bobs.length).toBe(count);
  });

  // Measured on 10 simulated minutes × 5 seeds (2026-10-19): every
  // working state 100% (the undercurrent never pauses), 丙 at rest 2.0%,
  // dozing 4.0%, waiting for you and after an error 0%.
  const working = [...WORKING];
  it.each(working)(
    "%s moves at least 95% of the time, never still a second",
    (activity) => {
      const m = measure(activity, true);
      expect(m.share).toBeGreaterThanOrEqual(0.95);
      expect(m.longestStill).toBeLessThanOrEqual(1_000);
    },
  );

  it("at rest 乙 never moves; 丙 at rest and dozing move under 5% of the time, briefly", () => {
    expect(measure("idle", false).share).toBe(0);
    for (const activity of ["idle", "doze"] as const) {
      expect(measure(activity, true).share, activity).toBeLessThanOrEqual(0.05);
    }
    for (const activity of ["ask", "error"] as const) {
      expect(measure(activity, true).share, activity).toBe(0);
    }
  });

  it("keeps 丙's moves at rest short: a blink under 0.2s, a look under 0.6s", () => {
    const r = rig(9);
    r.director.setAlive(true);
    r.advance(600_000);
    const loops = r.beats.filter((b) => b.beat.name.startsWith("idle:"));
    for (const { beat } of loops) {
      if (beat.name === "idle:blink")
        expect(beat.duration).toBeLessThanOrEqual(200);
      else expect(beat.duration, beat.name).toBeLessThanOrEqual(600);
    }
    expect(new Set(loops.map((b) => b.beat.name))).toEqual(
      new Set(["idle:blink", "idle:look"]),
    );
  });
});
