import {
  beatTimes,
  bezierPoints,
  type FaceBeat,
  type FaceField,
  type FacePose,
  faceAtRest,
  fieldAt,
  NEUTRAL_POSE,
  poseAt,
  scalePose,
} from "@/lib/assistant-face-motion";

import {
  clearTongue,
  EYE_RADIUS,
  EYES,
  FACE_ROOM,
  FIGURE_ORIGIN,
  jawScale,
  lipScale,
  MAX_MOUTH,
  MAX_WIDE,
  OUTLINE_SKIN,
  type TonguePose,
  WOOD_SKIN,
} from "./assistant-face-geometry";

/**
 * A beat (lib/assistant-face-motion.ts) as SVG animations (SMIL) for each
 * moving part of AssistantFace: one `<animateTransform>`, `<animate
 * attributeName="opacity">` or — for the tongue, bent along its skeleton
 * (assistant-face-geometry.ts) — `<animate attributeName="d">` per part,
 * keyed where the part's fields change course, with their curves as key
 * splines. Transforms, opacity and the traced paths' own points only
 * (ruling 117 point 5). Pure, so the tests read what the avatar will play.
 *
 * Every pose is drawn at an amplitude (the trial's 1, 1.5 or 2 times;
 * `displayPose`), and kept drawable: the eyes inside the face, the mouth
 * inside its wood, the tongue off the head.
 *
 * Each part is its own group with one kind of transform, nested so that
 * together they move the figure as one (AssistantFace):
 */
export type FacePart =
  /** The whole figure: where it is (hop, nod, a shift of weight). */
  | "move"
  /** Its tilt, about a point a little under the avatar's centre. */
  | "turn"
  /** Its scale from its foot (squash and stretch). */
  | "squash"
  /** The tongue bent: the two traced paths' own points. */
  | "outline"
  | "wood"
  /** Where both eyes look. */
  | "gaze"
  /** Each round eye's own shift (the far eye's in a three-quarter look). */
  | "shiftL"
  | "shiftR"
  /** Each round eye, about its own centre: open, shut, wide. */
  | "eyeL"
  | "eyeR"
  /** The round eyes (hidden while they take another shape). */
  | "discs"
  /** The eyes' other shapes. */
  | "smile"
  | "sleepy"
  | "strain"
  | "cross"
  /** The wood coming down over the mouth, from its top. */
  | "lip"
  /** The dark opening the mouth further down. */
  | "jaw"
  /** The mouth as a small o, and as a grin. */
  | "mouthO"
  | "grin"
  /** Everything laid over the drawing's face: shown only while the eyes
   * or the mouth are not as drawn. */
  | "overlay"
  /** The comic marks: where they are, their size, each one. */
  | "markMove"
  | "markScale"
  | "markQ"
  | "markBang"
  | "markZz"
  | "markSpark"
  | "markSweat";

export const FACE_PARTS: readonly FacePart[] = [
  "move",
  "turn",
  "squash",
  "outline",
  "wood",
  "gaze",
  "shiftL",
  "shiftR",
  "eyeL",
  "eyeR",
  "discs",
  "smile",
  "sleepy",
  "strain",
  "cross",
  "lip",
  "jaw",
  "mouthO",
  "grin",
  "overlay",
  "markMove",
  "markScale",
  "markQ",
  "markBang",
  "markZz",
  "markSpark",
  "markSweat",
];

type Kind = "translate" | "rotate" | "scale" | "opacity" | "d";

const KIND: Record<FacePart, Kind> = {
  move: "translate",
  turn: "rotate",
  squash: "scale",
  outline: "d",
  wood: "d",
  gaze: "translate",
  shiftL: "translate",
  shiftR: "translate",
  eyeL: "scale",
  eyeR: "scale",
  discs: "opacity",
  smile: "opacity",
  sleepy: "opacity",
  strain: "opacity",
  cross: "opacity",
  lip: "scale",
  jaw: "scale",
  mouthO: "opacity",
  grin: "opacity",
  overlay: "opacity",
  markMove: "translate",
  markScale: "scale",
  markQ: "opacity",
  markBang: "opacity",
  markZz: "opacity",
  markSpark: "opacity",
  markSweat: "opacity",
};

/** The pose fields each part reads (its keys are where they change). */
const FIELDS: Record<FacePart, readonly FaceField[]> = {
  move: ["x", "y"],
  turn: ["rot"],
  squash: ["sx", "sy"],
  outline: ["t1", "t2", "t3", "stretch"],
  wood: ["t1", "t2", "t3", "stretch"],
  gaze: ["gx", "gy", "wide"],
  shiftL: ["gx", "look", "wide"],
  shiftR: ["gx", "look", "wide"],
  eyeL: ["wide", "lid"],
  eyeR: ["wide", "lid"],
  discs: ["smile", "sleep", "strain", "cross"],
  smile: ["smile"],
  sleepy: ["sleep"],
  strain: ["strain"],
  cross: ["cross"],
  lip: ["mouth", "o", "grin"],
  jaw: ["mouth", "o", "grin"],
  mouthO: ["o"],
  grin: ["grin"],
  overlay: [],
  markMove: ["mx", "my"],
  markScale: ["ms"],
  markQ: ["q"],
  markBang: ["bang"],
  markZz: ["zz"],
  markSpark: ["spark"],
  markSweat: ["sweat"],
};

/** The undercurrent's group (under `move`): a translate, played from
 * its own channel's breaths with `move`'s values (`x`, `y`). */
export const BOB_PART = "bob";

/** How much further the far eye comes in a three-quarter look, units. */
export const LOOK_SHIFT = 160;

function n(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * The pose as drawn at amplitude `amp`: its spatial sizes times `amp`,
 * then kept drawable — the eyes no wider than `MAX_WIDE`, the mouth
 * between shut and `MAX_MOUTH`, squash and stretch short of folding, the
 * tongue no shorter than drawn and no longer than a third more.
 */
export function displayPose(pose: FacePose, amp = 1): FacePose {
  const p = scalePose(pose, amp);
  p.wide = clamp(p.wide, 0.3, MAX_WIDE);
  p.lid = clamp(p.lid, 0.04, 1.3);
  p.mouth = clamp(p.mouth, 0, MAX_MOUTH);
  p.sx = clamp(p.sx, 0.5, 1.6);
  p.sy = clamp(p.sy, 0.5, 1.6);
  // A shorter tongue curls tighter onto the head: it only grows.
  p.stretch = clamp(p.stretch, 0, 0.35);
  p.look = clamp(p.look, -1, 1);
  return p;
}

/** Where both eyes look, kept inside the face for their size: each
 * eye's edge `margin` short of the walls, the head's top and the mouth;
 * when an eye is too big to fit it sits in the middle of its room. */
function gazeOffset(p: FacePose): [number, number] {
  const r = EYE_RADIUS * p.wide;
  const [left, right] = EYES;
  const room = FACE_ROOM;
  const fit = (v: number, lo: number, hi: number) =>
    lo <= hi ? clamp(v, lo, hi) : (lo + hi) / 2;
  const gx = fit(
    p.gx,
    room.left + room.margin + r - left.cx,
    room.right - room.margin - r - right.cx,
  );
  const gy = fit(
    p.gy,
    room.top + room.margin + r - left.cy,
    room.bottom - room.margin - r - left.cy,
  );
  return [gx, gy];
}

/** Each round eye's own shift in a three-quarter look: the far eye (the
 * left one when it looks right) comes further, never closer to the other
 * than `FACE_ROOM.between`. */
function eyeShift(p: FacePose, eye: 0 | 1): number {
  const r = EYE_RADIUS * p.wide;
  const span = EYES[1].cx - EYES[0].cx - 2 * r - FACE_ROOM.between;
  const shift =
    eye === 0
      ? Math.max(0, p.look) * LOOK_SHIFT
      : Math.min(0, p.look) * LOOK_SHIFT;
  return eye === 0
    ? Math.min(shift, Math.max(0, span))
    : Math.max(shift, -Math.max(0, span));
}

function tongueOf(p: FacePose): TonguePose {
  return { t1: p.t1, t2: p.t2, t3: p.t3, stretch: p.stretch };
}

/** How far the strip over the mouth has come down: 0 as drawn, 1 shut
 * (a small o and a grin close the drawn mouth). */
function jawShut(p: FacePose): number {
  return clamp(Math.max(1 - Math.min(1, p.mouth), p.o, p.grin), 0, 1);
}

/** A part's value in a pose (already at its amplitude): a transform's
 * arguments, an opacity, or a path. */
export function partValue(part: FacePart, p: FacePose): string {
  switch (part) {
    case "move":
      return `${n(p.x)} ${n(p.y)}`;
    case "turn":
      return `${n(p.rot)} ${FIGURE_ORIGIN.x} ${FIGURE_ORIGIN.y}`;
    case "squash":
      return `${n(p.sx)} ${n(p.sy)}`;
    case "outline":
      return OUTLINE_SKIN.at(clearTongue(tongueOf(p)));
    case "wood":
      return WOOD_SKIN.at(clearTongue(tongueOf(p)));
    case "gaze": {
      const [gx, gy] = gazeOffset(p);
      return `${n(gx)} ${n(gy)}`;
    }
    case "shiftL":
      return `${n(eyeShift(p, 0))} 0`;
    case "shiftR":
      return `${n(eyeShift(p, 1))} 0`;
    case "eyeL":
    case "eyeR":
      return `${n(p.wide)} ${n(p.lid * p.wide)}`;
    case "discs":
      return n(clamp(1 - Math.max(p.smile, p.sleep, p.strain, p.cross), 0, 1));
    case "smile":
      return n(clamp(p.smile, 0, 1));
    case "sleepy":
      return n(clamp(p.sleep, 0, 1));
    case "strain":
      return n(clamp(p.strain, 0, 1));
    case "cross":
      return n(clamp(p.cross, 0, 1));
    case "lip":
      return `1 ${n(lipScale(jawShut(p)))}`;
    case "jaw":
      return `1 ${n(p.o > 0 || p.grin > 0 ? jawScale(1) : jawScale(p.mouth))}`;
    case "mouthO":
      return n(clamp(p.o, 0, 1));
    case "grin":
      return n(clamp(p.grin, 0, 1));
    case "overlay":
      return faceAtRest(p) ? "0" : "1";
    case "markMove":
      return `${n(p.mx)} ${n(p.my)}`;
    case "markScale":
      return `${n(p.ms)} ${n(p.ms)}`;
    case "markQ":
      return n(clamp(p.q, 0, 1));
    case "markBang":
      return n(clamp(p.bang, 0, 1));
    case "markZz":
      return n(clamp(p.zz, 0, 1));
    case "markSpark":
      return n(clamp(p.spark, 0, 1));
    case "markSweat":
      return n(clamp(p.sweat, 0, 1));
  }
}

/** A part's value as the markup has it: the drawing at rest. */
export const REST_VALUE = Object.fromEntries(
  FACE_PARTS.map((part) => [part, partValue(part, NEUTRAL_POSE)]),
) as Record<FacePart, string>;

/** The attribute a part's value goes into at rest between beats: its
 * `transform` (`translate(…)`, `rotate(…)`, `scale(…)`), `opacity` or
 * `d`. */
export function partAttribute(
  part: FacePart,
  value: string,
): { name: "transform" | "opacity" | "d"; value: string } {
  const kind = KIND[part];
  if (kind === "opacity") return { name: "opacity", value };
  if (kind === "d") return { name: "d", value };
  return { name: "transform", value: `${kind}(${value})` };
}

/** One SMIL animation of a part. */
export interface PartAnimation {
  element: "animateTransform" | "animate";
  attributes: Record<string, string>;
}

/**
 * A part's animation for a beat at amplitude `amp`, or null when the
 * part stays put through it (nothing to animate: the drawing is left as
 * it is). The overlay shows for the whole beat and hides at its end only
 * when the beat ends with the eyes and the mouth as drawn.
 */
export function partAnimation(
  part: FacePart,
  beat: FaceBeat,
  amp = 1,
): PartAnimation | null {
  const dur = `${Math.max(1, Math.round(beat.duration))}ms`;
  const common = { dur, begin: "indefinite", fill: "freeze" };
  if (part === "overlay") {
    // Shown over each stretch in which the eyes or the mouth leave the
    // drawing (from its start), hidden again where they are back: the
    // drawing itself shows whenever it can, so a beat that starts or ends
    // with the face as drawn starts and ends on the icon's own pixels.
    const times = beatTimes(beat);
    const rest = times.map((t) =>
      faceAtRest(displayPose(poseAt(beat, t), amp)),
    );
    if (rest.every(Boolean)) return null;
    const values = times.map((_, i) =>
      i < times.length - 1 && (!rest[i] || !rest[i + 1])
        ? "1"
        : rest[i]
          ? "0"
          : "1",
    );
    const duration = Math.max(1, beat.duration);
    return {
      element: "animate",
      attributes: {
        ...common,
        attributeName: "opacity",
        calcMode: "discrete",
        values: values.join(";"),
        keyTimes: times.map((t) => n(t / duration)).join(";"),
      },
    };
  }
  const fields = FIELDS[part];
  const times = beatTimes(beat, fields);
  const values = times.map((t) =>
    partValue(part, displayPose(poseAt(beat, t), amp)),
  );
  if (values.every((v) => v === values[0])) return null;
  const duration = Math.max(1, beat.duration);
  const keyTimes = times.map((t) => n(t / duration)).join(";");
  const keySplines = times
    .slice(1)
    .map((t, i) => bezierPoints(segmentEase(beat, fields, times[i], t)))
    .map((points) => points.map(n).join(" "))
    .join(";");
  const kind = KIND[part];
  const attributes = {
    ...common,
    calcMode: "spline",
    values: values.join(";"),
    keyTimes,
    keySplines,
  };
  if (kind === "translate" || kind === "rotate" || kind === "scale") {
    return {
      element: "animateTransform",
      attributes: { ...attributes, attributeName: "transform", type: kind },
    };
  }
  return {
    element: "animate",
    attributes: {
      ...attributes,
      attributeName: kind === "d" ? "d" : "opacity",
    },
  };
}

/** The curve of a part between two of its moments: the curve of a
 * field's key that ends there and starts at the moment before (the
 * fields of a part move together, so they agree); straight when none
 * does (a field mid-way through a longer move). */
function segmentEase(
  beat: FaceBeat,
  fields: readonly FaceField[],
  t0: number,
  t1: number,
): string {
  for (const f of fields) {
    const keys = beat.tracks[f];
    if (!keys) continue;
    const i = keys.findIndex((k) => k.t === t1);
    if (i < 0) continue;
    const before = i === 0 ? 0 : keys[i - 1].t;
    if (before === t0) return keys[i].ease;
  }
  return "linear";
}

/** For tests and the harness: a field of a beat at a moment, at an
 * amplitude. */
export function displayedField(
  beat: FaceBeat,
  field: FaceField,
  ms: number,
  amp = 1,
): number {
  return displayPose({ ...beat.end, [field]: fieldAt(beat, field, ms) }, amp)[
    field
  ];
}
