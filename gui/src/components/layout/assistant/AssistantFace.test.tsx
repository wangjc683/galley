import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  basePose,
  type FacePose,
  loopBeat,
  loopVariants,
  MOTION,
  NEUTRAL_POSE,
  reactionBeat,
  scaleBeat,
  turnBeat,
} from "@/lib/assistant-face-motion";

import { AssistantAvatar } from "./AssistantAvatar";
import { AssistantFace } from "./AssistantFace";
import {
  clearTongue,
  EYE_RADIUS,
  EYES,
  FACE_ROOM,
  ICON,
  jawScale,
  JAW,
  JAW_FULL,
  lipScale,
  LIP,
  MAX_MOUTH,
  MAX_WIDE,
  OUTLINE_SKIN,
  parseIcon,
  TONGUE,
  tongueClearOfHead,
  WOOD_SKIN,
} from "./assistant-face-geometry";
import {
  displayPose,
  FACE_PARTS,
  partAnimation,
  partValue,
  REST_VALUE,
} from "./face-smil";

/**
 * The face that moves (tickets 65, 66) is the app icon taken apart, not
 * redrawn: at rest it draws the master's own pieces and nothing else;
 * moving, its tongue is the master's own two paths, bent. (Its pixels
 * against the still avatar's were compared in headless Chrome, 28 / 40 /
 * 48 / 64 / 72 × light / dark, after loading and after a beat played
 * out: no pixel differs.)
 */

const ROOT = path.resolve(__dirname, "../../../../..");
const MASTER = readFileSync(
  path.join(ROOT, "core/icons/master/galley-icon.svg"),
  "utf8",
);

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

describe("the master, taken apart", () => {
  it("reads the ground, the group's transform and the two paths as the file has them", () => {
    const icon = parseIcon(MASTER);
    expect(icon).toEqual(ICON);
    expect(icon.viewBox).toBe("0 0 4096 4096");
    expect(icon.ground).toBe("#fcdba9");
    expect(icon.transform).toBe("translate(-4 122)");
    expect(MASTER).toContain(`d="${icon.outline.d}"`);
    expect(MASTER).toContain(`d="${icon.wood.d}"`);
  });

  it("finds the two eyes, the wood's round holes, left first", () => {
    expect(EYES).toHaveLength(2);
    expect(EYES[0].cx).toBeLessThan(EYES[1].cx);
    for (const eye of EYES) {
      expect(ICON.wood.d).toContain(eye.d);
      expect(eye.cy).toBeGreaterThan(1850);
      expect(eye.cy).toBeLessThan(1950);
    }
  });

  it("throws on a master of another shape", () => {
    expect(() =>
      parseIcon(
        '<svg viewBox="0 0 1 1"><rect fill="#fff"/><g transform="x"><path d="M0 0" fill="#000"/></g></svg>',
      ),
    ).toThrow();
  });

  it("closes the mouth with a strip from its top, opens it with one from its foot", () => {
    expect(LIP.top + (LIP.shutBottom - LIP.top) * lipScale(0)).toBeCloseTo(
      LIP.restBottom,
      6,
    );
    expect(lipScale(1)).toBeCloseTo(1, 6);
    expect(JAW.top + JAW_FULL * jawScale(1)).toBeCloseTo(JAW.restBottom, 6);
    expect(jawScale(MAX_MOUTH)).toBeCloseTo(1, 6);
    // Opened all the way it stays on the wood under the mouth (to 3218).
    expect(JAW.top + JAW_FULL).toBeLessThan(3218 - 50);
  });
});

describe("the tongue, bent on its skeleton", () => {
  it("is the master's own text at rest", () => {
    const rest = { t1: 0, t2: 0, t3: 0, stretch: 0 };
    expect(OUTLINE_SKIN.at(rest)).toBe(ICON.outline.d);
    expect(WOOD_SKIN.at(rest)).toBe(ICON.wood.d);
  });

  it("bends only the tongue: the head, the eyes and the root keep their points", () => {
    const bent = WOOD_SKIN.at({ t1: -12, t2: -18, t3: -30, stretch: 0.15 });
    const nums = (d: string) => d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const a = nums(ICON.wood.d);
    const b = nums(bent);
    expect(b).toHaveLength(a.length);
    let moved = 0;
    for (let i = 0; i < a.length; i += 2) {
      const head = a[i] >= TONGUE.head.minX && a[i + 1] >= TONGUE.head.minY;
      if (head) {
        expect(Math.abs(b[i] - a[i])).toBeLessThan(0.06);
        expect(Math.abs(b[i + 1] - a[i + 1])).toBeLessThan(0.06);
      } else if (Math.hypot(b[i] - a[i], b[i + 1] - a[i + 1]) > 50) {
        moved++;
      }
    }
    expect(moved).toBeGreaterThan(50);
    for (const eye of EYES) expect(bent).toContain(eye.d);
  });

  it("keeps the same commands, so SMIL can play one into the other", () => {
    const shape = (d: string) => d.replace(/-?\d+(?:\.\d+)?/g, "#");
    const bent = OUTLINE_SKIN.at({ t1: -5, t2: 8, t3: -20, stretch: 0 });
    expect(shape(bent)).toBe(shape(ICON.outline.d));
  });

  it("knows when it would touch the head, and eases a curl back off it", () => {
    expect(tongueClearOfHead({ t1: 0, t2: 0, t3: 0, stretch: 0 })).toBe(true);
    const curled = { t1: 0, t2: 12, t3: 20, stretch: 0 };
    expect(tongueClearOfHead(curled)).toBe(false);
    const cleared = clearTongue(curled);
    expect(tongueClearOfHead(cleared)).toBe(true);
    expect(cleared.t2).toBeLessThan(12);
    // Opening out is kept whole.
    const out = { t1: -16, t2: -22, t3: -28, stretch: 0.18 };
    expect(clearTongue(out)).toEqual(out);
  });
});

/** Every pose a beat keys, and the same quieted down (a long stretch of
 * work, `MOTION.quiet`). */
function keyedPoses(): { name: string; pose: FacePose }[] {
  const rand = seeded(4);
  const beats = [];
  for (let i = 0; i < 4; i++) {
    for (const activity of [
      "idle",
      "think",
      "browse",
      "read",
      "note",
      "work",
      "talk",
      "awaitSubtask",
      "doze",
    ] as const) {
      for (const variant of loopVariants(activity)) {
        beats.push(
          loopBeat(activity, basePose(activity), rand, null, variant)!.beat,
        );
      }
    }
    for (const reaction of [
      "sent",
      "look",
      "drop",
      "stop",
      "done",
      "dispatch",
      "subtaskBack",
      "wakeReminder",
      "wake",
    ] as const) {
      beats.push(reactionBeat(reaction, basePose("doze"), NEUTRAL_POSE, rand));
    }
    beats.push(reactionBeat("askEnter", NEUTRAL_POSE, basePose("ask"), rand));
    beats.push(
      reactionBeat("errorEnter", NEUTRAL_POSE, basePose("error"), rand),
    );
  }
  const out = [];
  for (const beat of beats) {
    const times = new Set<number>([0, beat.duration]);
    for (const keys of Object.values(beat.tracks)) {
      for (const k of keys) times.add(k.t);
    }
    for (const b of [beat, scaleBeat(beat, MOTION.quiet.k)]) {
      for (const t of times) {
        const pose = { ...b.end };
        for (const [f, keys] of Object.entries(b.tracks)) {
          const key = keys.find((k) => k.t === t);
          if (key) pose[f as keyof FacePose] = key.v;
        }
        out.push({ name: b === beat ? beat.name : `${beat.name} quiet`, pose });
      }
    }
  }
  return out;
}
const KEYED = keyedPoses();

describe("at every key of every beat, the face stays drawable", () => {
  it("keeps the eyes inside the face (only the widest touch its walls)", () => {
    const bad: string[] = [];
    for (const { name, pose } of KEYED) {
      const p = displayPose(pose);
      const r = EYE_RADIUS * p.wide;
      const [gx, gy] = partValue("gaze", p).split(" ").map(Number);
      const left = EYES[0].cx + gx - r;
      const right = EYES[1].cx + gx + r;
      const top = EYES[0].cy + gy - r;
      const bottom = EYES[0].cy + gy + r;
      const spill = r > 175 ? 40 : 0;
      if (
        left < FACE_ROOM.left - spill ||
        right > FACE_ROOM.right + spill ||
        top < FACE_ROOM.top - spill ||
        bottom > FACE_ROOM.bottom + spill
      ) {
        bad.push(name);
      }
      if (p.wide > MAX_WIDE) bad.push(`${name} wide ${p.wide}`);
    }
    expect(bad).toEqual([]);
  });

  it("keeps the tongue off the head", () => {
    const bad: string[] = [];
    for (const { name, pose } of KEYED) {
      const p = displayPose(pose);
      const t = clearTongue({
        t1: p.t1,
        t2: p.t2,
        t3: p.t3,
        stretch: p.stretch,
      });
      if (!tongueClearOfHead(t)) bad.push(name);
    }
    expect(bad).toEqual([]);
  });
});

describe("the face at rest", () => {
  const html = renderToStaticMarkup(<AssistantFace />);

  it("draws the master's pieces in its own order", () => {
    expect(html).toContain(`fill="${ICON.ground}"`);
    expect(html.indexOf(`d="${ICON.outline.d}"`)).toBeGreaterThan(0);
    expect(html.indexOf(ICON.outline.d)).toBeLessThan(
      html.indexOf(ICON.wood.d),
    );
    expect(html).toContain(`transform="${ICON.transform}"`);
  });

  it("crops the ground to the circle, not the figure", () => {
    const figure = html.indexOf('data-role="assistant-face"');
    const before = html.slice(0, figure);
    expect(before).toContain("overflow-hidden rounded-full");
    expect(html.slice(figure)).toContain('overflow="visible"');
  });

  it("hides what it lays over the drawing and the marks, and plays nothing", () => {
    for (const part of [
      "overlay",
      "smile",
      "sleepy",
      "strain",
      "cross",
      "mouthO",
      "grin",
      "markQ",
      "markBang",
      "markZz",
      "markSpark",
      "markSweat",
    ]) {
      expect(html, part).toMatch(
        new RegExp(`data-face="${part}"[^>]*opacity="0"`),
      );
    }
    expect(html).not.toMatch(/<animate/);
    for (const part of [
      "bob",
      "move",
      "turn",
      "squash",
      "gaze",
      "eyeL",
      "eyeR",
    ]) {
      const tag = html
        .slice(html.indexOf(`data-face="${part}"`) - 4)
        .split(">")[0];
      expect(tag, part).not.toContain("transform=");
    }
  });

  it("is decoration, and the avatar shows it only when asked", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pointer-events-none");
    expect(
      renderToStaticMarkup(<AssistantAvatar size={72} animated />),
    ).toContain('data-role="assistant-face"');
    const still = renderToStaticMarkup(<AssistantAvatar size={72} />);
    expect(still).not.toContain('data-role="assistant-face"');
    expect(still).toMatch(/src="[^"]*\/galley-icon\.svg"/);
  });
});

describe("a beat as SMIL", () => {
  const rand = () => 0.5;
  const turn = turnBeat(NEUTRAL_POSE, basePose("read"), "read");

  it("animates only the parts that move: transforms, opacity and the tongue's paths", () => {
    const moving = FACE_PARTS.filter((part) => partAnimation(part, turn));
    expect(moving).toEqual(["move", "turn", "squash", "gaze", "overlay"]);
    const done = reactionBeat("done", NEUTRAL_POSE, NEUTRAL_POSE, rand);
    const parts = FACE_PARTS.filter((part) => partAnimation(part, done));
    expect(parts).toEqual(
      expect.arrayContaining(["outline", "wood", "smile", "grin", "markSpark"]),
    );
    for (const part of FACE_PARTS) {
      const spec = partAnimation(part, done);
      if (!spec) continue;
      expect(["transform", "opacity", "d"]).toContain(
        spec.attributes.attributeName,
      );
      expect(spec.attributes.begin).toBe("indefinite");
      expect(spec.attributes.fill).toBe("freeze");
      const n = spec.attributes.values.split(";").length;
      expect(spec.attributes.keyTimes.split(";")).toHaveLength(n);
      if (spec.attributes.keySplines !== undefined) {
        expect(spec.attributes.keySplines.split(";")).toHaveLength(n - 1);
      }
    }
  });

  it("keys a part where its fields change, with their curves", () => {
    const spec = partAnimation("gaze", turn)!;
    expect(spec.element).toBe("animateTransform");
    expect(spec.attributes.type).toBe("translate");
    expect(spec.attributes.keyTimes.split(";")[0]).toBe("0");
    expect(spec.attributes.values.split(";").pop()).toBe(
      partValue("gaze", displayPose(basePose("read"))),
    );
    expect(spec.attributes.dur).toBe(`${turn.duration}ms`);
  });

  it("shows the overlay only while the eyes or the mouth are off the drawing", () => {
    const blinkBack = reactionBeat("stop", NEUTRAL_POSE, NEUTRAL_POSE, rand);
    const values = partAnimation("overlay", blinkBack)!.attributes.values;
    expect(values.split(";").pop()).toBe("0");
    expect(values).toContain("1");
    expect(
      partAnimation("overlay", turn)!.attributes.values.split(";").pop(),
    ).toBe("1");
    // The stop's squash starts before its blink: the drawing shows until
    // the lids move.
    const squashOnly = partAnimation("overlay", {
      ...blinkBack,
      tracks: { ...blinkBack.tracks, lid: undefined },
    });
    expect(squashOnly).toBeNull();
  });

  it("starts and ends every part where it is held: no jump at a beat's edges", () => {
    const rand2 = seeded(8);
    const beats = [
      reactionBeat("done", basePose("think"), NEUTRAL_POSE, rand2),
      reactionBeat("dispatch", NEUTRAL_POSE, basePose("awaitSubtask"), rand2),
      loopBeat("work", basePose("work"), rand2, null, "hammer")!.beat,
      loopBeat("talk", basePose("talk"), rand2, null, "burst")!.beat,
    ];
    for (const beat of beats) {
      for (const part of FACE_PARTS) {
        const spec = partAnimation(part, beat);
        if (!spec || part === "overlay") continue;
        const values = spec.attributes.values.split(";");
        expect(values[0], `${beat.name} ${part}`).toBe(
          partValue(part, displayPose(beat.from)),
        );
        expect(values[values.length - 1], `${beat.name} ${part}`).toBe(
          partValue(part, displayPose(beat.end)),
        );
      }
    }
  });

  it("knows the markup's rest values", () => {
    for (const part of FACE_PARTS) {
      expect(partValue(part, NEUTRAL_POSE), part).toBe(REST_VALUE[part]);
    }
    expect(REST_VALUE.outline).toBe(ICON.outline.d);
  });
});
