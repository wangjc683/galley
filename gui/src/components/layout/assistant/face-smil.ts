import {
  bezierPoints,
  type FaceBeat,
  type FacePose,
  faceAtRest,
} from "@/lib/assistant-face-motion";

import { lipScale } from "./assistant-face-geometry";

/**
 * A beat (lib/assistant-face-motion.ts) as SVG animations (SMIL) for each
 * moving part of AssistantFace: one `<animateTransform>` or `<animate
 * attributeName="opacity">` per part, keyed at the beat's frames, its
 * curves as key splines. Transforms and opacity only (ruling 117 point
 * 5). Pure, so the tests read what the avatar will play.
 *
 * Each part is its own group with one kind of transform, nested so that
 * together they move the figure as one (AssistantFace):
 */
export type FacePart =
  /** The whole figure: where it is (hop, nod, a shift of weight). */
  | "move"
  /** Its tilt, about the avatar's centre (it never leaves its circle). */
  | "turn"
  /** Its scale about the centre (squash, a flinch). */
  | "squash"
  /** Where both eyes look. */
  | "gaze"
  /** Each eye, about its own centre: open, shut, wide. */
  | "eyeL"
  | "eyeR"
  /** The round eyes (hidden while they smile). */
  | "discs"
  /** The smiling eyes. */
  | "smile"
  /** The sleeping eyes. */
  | "sleepy"
  /** The wood coming down over the mouth, from its top. */
  | "lip"
  /** Everything laid over the drawing: shown only while the eyes or the
   * mouth are not as drawn. */
  | "overlay";

export const FACE_PARTS: readonly FacePart[] = [
  "move",
  "turn",
  "squash",
  "gaze",
  "eyeL",
  "eyeR",
  "discs",
  "smile",
  "sleepy",
  "lip",
  "overlay",
];

type Kind = "translate" | "rotate" | "scale" | "opacity";

const KIND: Record<FacePart, Kind> = {
  move: "translate",
  turn: "rotate",
  squash: "scale",
  gaze: "translate",
  eyeL: "scale",
  eyeR: "scale",
  discs: "opacity",
  smile: "opacity",
  sleepy: "opacity",
  lip: "scale",
  overlay: "opacity",
};

/** The avatar's centre, in the view box: the figure turns about it. */
export const FIGURE_CENTRE = 2048;

function n(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** The undercurrent's group (under `move`): a translate, played from
 * its own channel's breaths with `move`'s values (`x`, `y`). */
export const BOB_PART = "bob";

/** A part's value in a pose: a transform's arguments, or an opacity. */
export function partValue(part: FacePart, pose: FacePose): string {
  switch (part) {
    case "move":
      return `${n(pose.x)} ${n(pose.y)}`;
    case "turn":
      return `${n(pose.rot)} ${FIGURE_CENTRE} ${FIGURE_CENTRE}`;
    case "squash":
      return `${n(pose.sx)} ${n(pose.sy)}`;
    case "gaze":
      return `${n(pose.gx)} ${n(pose.gy)}`;
    case "eyeL":
    case "eyeR":
      return `${n(pose.wide)} ${n(pose.lid * pose.wide)}`;
    case "discs":
      return n(Math.min(1, Math.max(0, 1 - Math.max(pose.smile, pose.sleep))));
    case "smile":
      return n(Math.min(1, Math.max(0, pose.smile)));
    case "sleepy":
      return n(Math.min(1, Math.max(0, pose.sleep)));
    case "lip":
      return `1 ${n(lipScale(pose.jaw))}`;
    case "overlay":
      return faceAtRest(pose) ? "0" : "1";
  }
}

/** A part's value as the markup has it: the drawing at rest. */
export const REST_VALUE: Record<FacePart, string> = {
  move: "0 0",
  turn: `0 ${FIGURE_CENTRE} ${FIGURE_CENTRE}`,
  squash: "1 1",
  gaze: "0 0",
  eyeL: "1 1",
  eyeR: "1 1",
  discs: "1",
  smile: "0",
  sleepy: "0",
  lip: `1 ${n(lipScale(0))}`,
  overlay: "0",
};

/** The attribute a part's value goes into at rest between beats: its
 * `transform` (`translate(…)`, `rotate(…)`, `scale(…)`) or `opacity`. */
export function partAttribute(
  part: FacePart,
  value: string,
): { name: "transform" | "opacity"; value: string } {
  const kind = KIND[part];
  return kind === "opacity"
    ? { name: "opacity", value }
    : { name: "transform", value: `${kind}(${value})` };
}

/** One SMIL animation of a part. */
export interface PartAnimation {
  element: "animateTransform" | "animate";
  attributes: Record<string, string>;
}

/**
 * A part's animation for a beat, or null when the part stays put
 * through it (nothing to animate: the drawing is left as it is). The
 * overlay shows for the whole beat and hides at its end only when the
 * beat ends with the eyes and the mouth as drawn.
 */
export function partAnimation(
  part: FacePart,
  beat: FaceBeat,
): PartAnimation | null {
  const values = beat.frames.map((frame) => partValue(part, frame.pose));
  const dur = `${Math.max(1, Math.round(beat.duration))}ms`;
  const common = {
    dur,
    begin: "indefinite",
    fill: "freeze",
  };
  if (part === "overlay") {
    if (values.every((v) => v === "0")) {
      // Eyes and mouth as drawn all through: no overlay at all.
      return null;
    }
    return {
      element: "animate",
      attributes: {
        ...common,
        attributeName: "opacity",
        calcMode: "discrete",
        values: `1;${values[values.length - 1]}`,
        keyTimes: "0;1",
      },
    };
  }
  if (values.every((v) => v === values[0])) return null;
  const keyTimes = beat.frames.map((frame) => n(frame.at)).join(";");
  const keySplines = beat.frames
    .slice(0, -1)
    .map((frame) => bezierPoints(frame.ease).map(n).join(" "))
    .join(";");
  const kind = KIND[part];
  return kind === "opacity"
    ? {
        element: "animate",
        attributes: {
          ...common,
          attributeName: "opacity",
          calcMode: "spline",
          values: values.join(";"),
          keyTimes,
          keySplines,
        },
      }
    : {
        element: "animateTransform",
        attributes: {
          ...common,
          attributeName: "transform",
          type: kind,
          calcMode: "spline",
          values: values.join(";"),
          keyTimes,
          keySplines,
        },
      };
}
