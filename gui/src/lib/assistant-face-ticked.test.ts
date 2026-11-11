import { describe, expect, it } from "vitest";

import { tickedOffHere } from "@/lib/assistant-face";
import { FaceDirector, type FaceClock } from "@/lib/assistant-face-director";
import {
  basePose,
  type FaceBeat,
  fieldAt,
  MOTION,
  NEUTRAL_POSE,
  poseAt,
  reactionBeat,
} from "@/lib/assistant-face-motion";
import type { TodoFlip } from "@/lib/todo-panel";

/**
 * The face nodding when you tick off one of your to-dos (main chat
 * ticket 163, PRD ruling 208 point 5): which clicks count, the nod
 * itself (`MOTION.ticked`), and the director playing it — once, not
 * while it waits for your answer or holds after an error, not when it
 * is still or paused. The driver's half (reading the to-do store, a
 * doze woken instead) is in hooks/useAssistantFaceDriver.ticked.dom.test.tsx.
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

/** 57 units are 1px on the 72px avatar. */
const PX = 57;

describe("which clicks are a tick off (`tickedOffHere`)", () => {
  const tick: TodoFlip = { done: true, phase: "settling" };
  const untick: TodoFlip = { done: false, phase: "settling" };

  it("is a tick whose hold just started, at the click", () => {
    expect(tickedOffHere({ a: tick }, {})).toBe(true);
    // One more beside a hold already running.
    expect(tickedOffHere({ a: tick, b: tick }, { a: tick })).toBe(true);
  });

  it("is not an untick, a tick taken back in its hold, or the hold turning into Core's write", () => {
    expect(tickedOffHere({ a: untick }, {})).toBe(false);
    expect(tickedOffHere({}, { a: tick })).toBe(false);
    expect(
      tickedOffHere({ a: { done: true, phase: "saving" } }, { a: tick }),
    ).toBe(false);
    // Taking an untick back leaves the to-do done: no flip, no nod.
    expect(tickedOffHere({}, { a: untick })).toBe(false);
    const same = { a: tick };
    expect(tickedOffHere(same, same)).toBe(false);
  });
});

describe("the nod (`MOTION.ticked`)", () => {
  const beats = (from = NEUTRAL_POSE, end = NEUTRAL_POSE) =>
    Array.from({ length: 60 }, (_, i) =>
      reactionBeat("ticked", from, end, seeded(i + 1)),
    );
  /** The lowest the head goes, past the pose it goes back to, units. */
  const depth = (beat: FaceBeat) =>
    Math.max(...(beat.tracks.y ?? []).map((k) => k.v)) - beat.end.y;

  it("is the head about 2px down and back, under half a second, ending where it began", () => {
    for (const beat of beats()) {
      expect(beat.name).toBe("ticked");
      expect(beat.duration).toBeLessThanOrEqual(500);
      expect(depth(beat) / PX).toBeGreaterThanOrEqual(1.5);
      expect(depth(beat) / PX).toBeLessThanOrEqual(2.3);
      // Tipping forward a little with it, never a big bow.
      const rot = Math.max(...(beat.tracks.rot ?? []).map((k) => k.v));
      expect(rot).toBeGreaterThan(0);
      expect(rot).toBeLessThanOrEqual(4);
      expect(beat.end).toEqual(NEUTRAL_POSE);
      expect(poseAt(beat, beat.duration)).toEqual(NEUTRAL_POSE);
    }
  });

  it("has three variants — a blink at the bottom, a glance first, the eyes easing half shut — sizes and timings drawn anew", () => {
    const all = beats();
    const lowestLid = (beat: FaceBeat) =>
      Math.min(...(beat.tracks.lid ?? [{ v: 1 }]).map((k) => k.v));
    const blink = all.filter((b) => lowestLid(b) <= 0.12);
    const glance = all.filter((b) => b.tracks.gx);
    const soft = all.filter((b) => lowestLid(b) === MOTION.ticked.soft.lid);
    expect(blink.length).toBeGreaterThan(5);
    expect(glance.length).toBeGreaterThan(5);
    expect(soft.length).toBeGreaterThan(5);
    expect(blink.length + glance.length + soft.length).toBe(all.length);
    // Not a metronome: hardly two alike.
    expect(new Set(all.map((b) => b.duration)).size).toBeGreaterThan(30);
    expect(new Set(all.map((b) => Math.round(depth(b)))).size).toBeGreaterThan(
      10,
    );
  });

  it("nods down from the pose it goes back to, whatever the activity holds the head at", () => {
    for (const activity of ["read", "note", "work", "think"] as const) {
      const end = basePose(activity);
      for (const beat of beats(end, end)) {
        expect(depth(beat), activity).toBeGreaterThan(1.5 * PX);
        expect(beat.end, activity).toEqual(end);
        // The head goes down (y grows) before it comes back.
        const bottom = Math.max(
          ...[0, 100, 150, 200, 250].map((t) => fieldAt(beat, "y", t)),
        );
        expect(bottom, activity).toBeGreaterThan(end.y);
      }
    }
  });
});

/** The director on a clock moved by hand. */
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
  const beats: { t: number; beat: FaceBeat }[] = [];
  const bobs: { t: number; beat: FaceBeat }[] = [];
  const director = new FaceDirector({
    clock,
    random: seeded(seed),
    onBeat: (beat) => beats.push({ t: now, beat }),
    onBob: (beat) => bobs.push({ t: now, beat }),
  });
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
  const names = () => beats.map((b) => b.beat.name);
  return { director, beats, bobs, advance, names };
}

describe("the director plays it", () => {
  it("once, cutting in, then hands back to the activity", () => {
    const r = rig();
    r.director.setAlive(true);
    r.director.setActivity("idle");
    r.director.react("ticked");
    const nod = r.beats[r.beats.length - 1].beat;
    expect(nod.name).toBe("ticked");
    expect(nod.end).toEqual(basePose("idle"));
    r.advance(60_000);
    expect(r.names().filter((n) => n === "ticked")).toHaveLength(1);
    expect(r.names().some((n) => n.startsWith("idle:"))).toBe(true);
  });

  it("over the undercurrent while it works, which goes on under it", () => {
    const r = rig(3);
    r.director.setActivity("read");
    r.advance(4_000);
    const bobs = r.bobs.length;
    r.director.react("ticked");
    const nod = r.beats[r.beats.length - 1].beat;
    expect(nod.name).toBe("ticked");
    expect(nod.end).toEqual(basePose("read"));
    r.advance(4_000 + nod.duration + 3_000);
    expect(r.bobs.length).toBeGreaterThan(bobs);
    // The breaths run back to back through the nod.
    for (let i = 1; i < r.bobs.length; i++) {
      const before = r.bobs[i - 1];
      expect(r.bobs[i].t).toBe(before.t + before.beat.duration);
    }
  });

  it("not while it waits for your answer or holds after an error: the pose stands", () => {
    for (const activity of ["ask", "error"] as const) {
      const r = rig();
      r.director.setActivity(activity);
      r.advance(5_000);
      const count = r.beats.length;
      r.director.react("ticked");
      r.advance(10_000);
      expect(r.beats.length, activity).toBe(count);
      expect(r.names(), activity).not.toContain("ticked");
    }
  });

  it("not when the face is still (reduced motion) or paused (window behind, face off screen)", () => {
    const still = rig();
    still.director.setStill(true);
    const count = still.beats.length;
    still.director.react("ticked");
    expect(still.beats.length).toBe(count);

    const paused = rig();
    paused.director.setActive(false);
    paused.director.react("ticked");
    expect(paused.names()).not.toContain("ticked");
  });

  it("a second tick mid-nod neither queues nor stacks: it starts over from where the head is", () => {
    const r = rig(5);
    r.director.setActivity("idle");
    r.director.react("ticked");
    const first = r.beats[r.beats.length - 1].beat;
    r.advance(120);
    r.director.react("ticked");
    const second = r.beats[r.beats.length - 1].beat;
    expect(second.name).toBe("ticked");
    // From the head's place 120ms into the first, not from rest.
    expect(second.from).toEqual(poseAt(first, 120));
    r.advance(120 + second.duration + 1);
    // Two nods played, and only two: the first was cut, nothing waited.
    expect(r.names().filter((n) => n === "ticked")).toHaveLength(2);
  });
});
