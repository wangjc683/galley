import type { FaceActivity, FaceReaction } from "@/lib/assistant-face";

/**
 * How the assistant's face moves (main chat PRD rulings 117, 119;
 * tickets 65–67): every number in one place, each motion with the one
 * thing it says (foundations.md §2.7: motion conveys state, not
 * decoration; ruling 117 point 5 asks for that sentence per motion).
 * The rules they keep are §2.7's exemption for the assistant's face;
 * the sizes are final at 1× (ruling 119 point 7: JC compared 1, 1.5 and
 * 2 times on the real machine, 「1x 比较合适」).
 *
 * Ticket 66 made it big enough to read without staring (ruling 119:
 * 「绝大部分都动效幅度太小，不盯着看看不太出来」): the body moves 6–8px
 * on the 72px avatar, tilts 12–20°, jumps 10–12px out of its circle and
 * squashes and stretches 15–20%; the eyes sweep the face, open to 1.7
 * times and change shape (^ ^, ‿ ‿, > <, × ×); the mouth opens from a
 * slit to 1.8 times; the tongue — the G — is a body of its own that
 * wags, curls, reaches out and goes limp; comic marks (？ ！ z z ✦ and
 * a drop of sweat) pop beside the head. And the old tricks of animation
 * carry it: a crouch before a jump (anticipation), squash on landing
 * and stretch in the air, overshooting and springing back, the tongue
 * catching up a moment after the head (follow-through) and moving
 * while something else is the point (secondary action).
 *
 * Nothing loops at an even beat. Each activity is a run of separate
 * beats with random pauses between them and two to four variants of
 * each beat, their sizes and timings drawn anew each time (`rand`), so
 * the face never ticks like a metronome.
 *
 * Busy or not must read at a glance (ruling 117 point 8): while it works
 * (`WORKING`) the head never rests — under the beats runs an
 * undercurrent, the whole head rising and falling breath after breath
 * with no pause (`bobBeat`); at rest its moves are short and rare (a
 * blink under 0.2s, a look or a flick under 0.6s, every 8–15 seconds;
 * dozing breathes as rarely), so moving still means working. Waiting
 * for your answer and an error are no work: it strikes its pose and
 * holds still. A long stretch of the same work quiets down to about
 * four tenths of its size and keeps moving, with a full-size move now
 * and then (`MOTION.quiet`, the director; ruling 119 point 6).
 *
 * A beat is a set of tracks, one per field of the pose that moves, each
 * keyed in time with its own curves (`compose` builds them from
 * parallel voices: the body, the eyes, the mouth, the tongue, a mark),
 * played by the avatar as SVG animations (SMIL) of its shapes'
 * transforms and opacity and of the tongue's two traced paths: the
 * browser runs them, no script per frame. (Not CSS or Web Animations:
 * in Chrome an SVG shape with one running is rasterized half a device
 * pixel off, so the whole face visibly shifts as a beat starts and
 * snaps back as it ends; a SMIL animation leaves the raster alone.)
 *
 * Distances are in the icon's own units (its 4096 viewBox): 57 units
 * are 1px on the 72px avatar. The eyes are about 270 units across, in a
 * face 1680 wide; the figure stands about 2860 tall.
 */

/** One position of the face. */
export interface FacePose {
  /** The whole figure (head and tongue): offset, in units. */
  x: number;
  y: number;
  /** Its tilt, in degrees, about a point a little under the avatar's
   * centre. */
  rot: number;
  /** Its scale from its foot: squash and stretch. */
  sx: number;
  sy: number;
  /** The tongue's three joints, degrees (positive curls it in, toward
   * the head; negative opens it out), and how much longer it is. */
  t1: number;
  t2: number;
  t3: number;
  stretch: number;
  /** Where both eyes look: offset, in units. */
  gx: number;
  gy: number;
  /** The face turned to a side, −1 left to 1 right: the far eye comes
   * further than the near one (a three-quarter look). */
  look: number;
  /** How open the eyes are: 1 as drawn, 0.1 shut. */
  lid: number;
  /** How wide the eyes are: 1 as drawn. */
  wide: number;
  /** The eyes' shapes in place of the round ones, 0 or 1: smiling ^ ^,
   * sleeping ‿ ‿, straining > <, knocked out × ×. */
  smile: number;
  sleep: number;
  strain: number;
  cross: number;
  /** How open the mouth is: 1 as drawn, 0 shut, up to 1.8. */
  mouth: number;
  /** The mouth as a small o, or a grin: 0 or 1 (the drawn one shut). */
  o: number;
  grin: number;
  /** The comic marks, each shown 0–1: ？, ！, z z, ✦, sweat. */
  q: number;
  bang: number;
  zz: number;
  spark: number;
  sweat: number;
  /** The mark's offset from its place (units) and its scale. */
  mx: number;
  my: number;
  ms: number;
}

export type FaceField = keyof FacePose;

/** The face as the app icon draws it. */
export const NEUTRAL_POSE: FacePose = {
  x: 0,
  y: 0,
  rot: 0,
  sx: 1,
  sy: 1,
  t1: 0,
  t2: 0,
  t3: 0,
  stretch: 0,
  gx: 0,
  gy: 0,
  look: 0,
  lid: 1,
  wide: 1,
  smile: 0,
  sleep: 0,
  strain: 0,
  cross: 0,
  mouth: 1,
  o: 0,
  grin: 0,
  q: 0,
  bang: 0,
  zz: 0,
  spark: 0,
  sweat: 0,
  mx: 0,
  my: 0,
  ms: 1,
};

export const FACE_FIELDS = Object.keys(NEUTRAL_POSE) as FaceField[];

const FACE_REST_FIELDS: FaceField[] = [
  "gx",
  "gy",
  "look",
  "lid",
  "wide",
  "smile",
  "sleep",
  "strain",
  "cross",
  "mouth",
  "o",
  "grin",
];

/** Whether the eyes and the mouth are as the icon draws them (the
 * avatar then hides its moving eyes and mouth: the drawing itself shows,
 * pixel for pixel). */
export function faceAtRest(pose: FacePose): boolean {
  return FACE_REST_FIELDS.every((k) => pose[k] === NEUTRAL_POSE[k]);
}

/** Whether the figure stands as drawn. */
export function figureAtRest(pose: FacePose): boolean {
  return (
    pose.x === 0 &&
    pose.y === 0 &&
    pose.rot === 0 &&
    pose.sx === 1 &&
    pose.sy === 1
  );
}

export function samePose(a: FacePose, b: FacePose): boolean {
  return FACE_FIELDS.every((k) => a[k] === b[k]);
}

/**
 * The fields that are a size in space — a distance, an angle, a scale's
 * departure from 1 — and so shrink with the quiet of a long stretch of
 * work (`scalePose`, `scaleBeat`, `MOTION.quiet`). Not time, not how shut the eyes are (a blink is a blink), not
 * which shape the eyes or the mouth take, not the marks.
 */
export const SPATIAL_FIELDS: readonly FaceField[] = [
  "x",
  "y",
  "rot",
  "sx",
  "sy",
  "t1",
  "t2",
  "t3",
  "stretch",
  "gx",
  "gy",
  "look",
  "wide",
  "mouth",
];

/** A pose with its spatial departure from the drawing times `k`. */
export function scalePose(pose: FacePose, k: number): FacePose {
  if (k === 1) return pose;
  const out = { ...pose };
  for (const f of SPATIAL_FIELDS) {
    out[f] = NEUTRAL_POSE[f] + (pose[f] - NEUTRAL_POSE[f]) * k;
  }
  return out;
}

/** A key of a track: at `t` ms the field is `v`, reached along `ease`
 * from the key before (or from the beat's start). */
export interface TrackKey {
  t: number;
  v: number;
  ease: string;
}

/** One motion: from where the face is to where it stays, each field
 * that moves on its own track. */
export interface FaceBeat {
  /** What it is, for the tests. */
  name: string;
  /** Total length, ms (0: set at once). */
  duration: number;
  from: FacePose;
  end: FacePose;
  /** Fields that move; any other is `from` (equal to `end`) throughout. */
  tracks: Partial<Record<FaceField, TrackKey[]>>;
}

// ---- Curves ----------------------------------------------------------------

/** The motion tokens' curves (globals.css `--ease-firm`, `--ease-pop`),
 * and some the tokens do not have: a sine in-out for slow drifts, an
 * ease-in for a fall, an even sweep for a gaze reading a line. Two
 * marks are not curves: `spring` overshoots its target a little and
 * comes back, `bounce` a lot (甩过头再回弹); `compose` plays each as two
 * segments, out past the target and back, since a SMIL curve cannot
 * leave 0–1. */
export const EASE = {
  firm: "cubic-bezier(0.2, 0, 0, 1)",
  pop: "cubic-bezier(0.16, 1, 0.3, 1)",
  drift: "cubic-bezier(0.37, 0, 0.63, 1)",
  fall: "cubic-bezier(0.5, 0, 0.75, 0)",
  sweep: "cubic-bezier(0.3, 0.1, 0.7, 0.9)",
  linear: "linear",
  spring: "spring",
  bounce: "bounce",
} as const;

/** The overshoot marks: by how much of the way past, at what share of
 * the segment's time. */
export const OVERSHOOT = {
  spring: { by: 0.12, share: 0.6 },
  bounce: { by: 0.3, share: 0.55 },
} as const;

/** The control points of a `cubic-bezier(…)` curve ("linear": the
 * diagonal). */
export function bezierPoints(ease: string): [number, number, number, number] {
  const m = /cubic-bezier\(([^)]*)\)/.exec(ease);
  if (!m) return [0, 0, 1, 1];
  const [a, b, c, d] = m[1].split(",").map((n) => Number(n.trim()));
  return [a, b, c, d];
}

/** A cubic Bézier easing: progress `x` (0–1) to eased progress. */
export function easeAt(ease: string, x: number): number {
  const [x1, y1, x2, y2] = bezierPoints(ease);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bx = (t: number) =>
    3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t: number) =>
    3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < x) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) / 2);
}

/** A field `ms` into a beat. */
export function fieldAt(beat: FaceBeat, field: FaceField, ms: number): number {
  const keys = beat.tracks[field];
  if (!keys || keys.length === 0) {
    return ms <= 0 ? beat.from[field] : beat.end[field];
  }
  let t0 = 0;
  let v0 = beat.from[field];
  for (const key of keys) {
    if (ms <= key.t) {
      const span = key.t - t0;
      const x = span > 0 ? (ms - t0) / span : 1;
      return v0 + (key.v - v0) * easeAt(key.ease, Math.max(0, x));
    }
    t0 = key.t;
    v0 = key.v;
  }
  return v0;
}

/** Where a beat has the face `ms` into it. */
export function poseAt(beat: FaceBeat, ms: number): FacePose {
  if (beat.duration <= 0 || ms >= beat.duration) return beat.end;
  const out = { ...beat.end };
  for (const f of FACE_FIELDS) out[f] = fieldAt(beat, f, ms);
  return out;
}

/** The moments a beat's fields change course: its start, every key of
 * the given fields' tracks (all by default), its end. */
export function beatTimes(
  beat: FaceBeat,
  fields: readonly FaceField[] = FACE_FIELDS,
): number[] {
  const times = new Set<number>([0, beat.duration]);
  for (const f of fields) {
    for (const key of beat.tracks[f] ?? []) times.add(key.t);
  }
  return [...times].sort((a, b) => a - b);
}

// ---- The numbers -----------------------------------------------------------

/**
 * Every timing and size, with what it says. `[a, b]` is a range a beat
 * draws from each time it plays. Sizes are final (1×, ruling 119 point
 * 7), on the 72px avatar (57 units a pixel).
 */
export const MOTION = {
  /** Moving from one activity's pose to the next: it turns to what it
   * does now. */
  turnMs: 300,
  /** Falling asleep: the eyes close slowly, halfway first, the head
   * sinks. */
  dozeInMs: 2400,

  /** A blink: it is alive and here. Close fast, open a little slower;
   * under 0.2s in all. */
  blink: { closeMs: [55, 75], openMs: [85, 120], lid: [0.06, 0.12] },
  /** Two blinks in a row, this far apart: a double take. */
  doubleBlinkGapMs: [70, 120],

  /** The tongue catching up with the head (follow-through): it lags the
   * move by this much of the move's size, then swings past and settles
   * in two shrinking swings (晃两下停住). */
  follow: {
    lagMs: 140,
    swingMs: [150, 170, 190],
    /** Each swing's size against the first. */
    swings: [1, -0.5, 0.2],
  },

  /** Thinking: the eyes roll to the upper left, the head tilts about
   * 15°, the tongue's tip curls up slowly, as a finger goes to the chin;
   * now and then a ？. */
  think: {
    pose: { gx: -95, gy: -55, look: -0.4, rot: -12, t3: -14 },
    /** Pondering: the tilt deepens, the tip curls further. */
    tiltDeg: [-20, -16],
    curlT3: [-34, -26],
    ponderMs: [520, 700],
    holdMs: [700, 1300],
    /** Tapping the chin: the tip taps three or four times. */
    taps: [3, 4],
    tapT3: [-32, -26],
    tapMs: [140, 180],
    /** The ？: pops beside the head and floats up a little. */
    markPopMs: 220,
    markHoldMs: 900,
    markRiseY: -140,
    /** The head swaps its tilt to the other side as the ？ pops. */
    swapDeg: [10, 14],
    gapMs: [400, 1400],
  },
  /** Reading a web page: the eyes sweep a line across the whole face,
   * the head turning with them, and at the line's end snap back (啪)
   * to the next; the tongue swings after the snap. */
  browse: {
    pose: { gx: -100, gy: -40, look: -0.6, x: -340, rot: -7 },
    lines: [2, 4],
    fromX: -100,
    toX: 115,
    headX: 380,
    headDeg: 8,
    sweepMs: [650, 900],
    snapMs: [100, 130],
    lineStep: [14, 22],
    /** Skimming: three quick saccades across, the head jerking along. */
    skimMs: [170, 220],
    gapMs: [200, 800],
  },
  /** Reading a file: the head bows (about 10°: down and forward), the
   * eyes sit low and run down the text; every few seconds the tongue's
   * tip flips over, like turning a page. */
  read: {
    pose: { y: 260, rot: 10, sy: 0.94, gx: -20, gy: 52 },
    fromY: [10, 24],
    toY: [56, 62],
    driftX: [-60, 60],
    driftMs: [1200, 1800],
    flickMs: [110, 150],
    /** The page turning: the tip flips up and over. */
    pageT3: -52,
    pageUpMs: 180,
    pageDownMs: 220,
    gapMs: [300, 1200],
  },
  /** Writing something down: big nods, as if writing in a notebook; the
   * tongue's tip draws small circles. */
  note: {
    pose: { y: 120, rot: 6, gx: -40, gy: 52 },
    nodY: [400, 470],
    nodDeg: [13, 17],
    nodDownMs: [150, 190],
    nodUpMs: [220, 280],
    /** A small circle drawn by the tip: t2 and t3 a quarter turn apart. */
    circleT2: 7,
    circleT3: 14,
    circleMs: [360, 460],
    /** The eyes following the words written, step by step. */
    stepX: [36, 48],
    gapMs: [300, 1200],
  },
  /** Doing the work by hand: the eyes squeezed (> <), the whole body
   * squashing and springing up, bump after bump; the tongue hammers. */
  work: {
    pose: { strain: 1, sy: 0.94, sx: 1.04, y: 40, mouth: 0.5 },
    bumps: [2, 4],
    crouchSy: 0.82,
    crouchSx: 1.12,
    riseY: [-420, -340],
    riseSy: 1.12,
    crouchMs: [100, 120],
    riseMs: [140, 170],
    landMs: [130, 150],
    /** The hammer: raised slowly, brought down hard. */
    raise: { t1: -8, t2: -18, t3: -46 },
    raiseMs: [320, 400],
    slamMs: 90,
    leanDeg: 8,
    /** A shift of weight to one side. */
    shiftX: [340, 420],
    shiftDeg: [10, 13],
    gapMs: [150, 600],
  },
  /** Writing a reply: the mouth opens wide and shuts, syllable by
   * syllable, the head riding each one; the tongue moves along. */
  talk: {
    pose: {},
    syllables: [3, 7],
    /** How far a syllable closes the mouth, and opens it. */
    closeTo: [0.2, 0.45],
    openTo: [1.35, 1.8],
    closeMs: [80, 110],
    openMs: [90, 130],
    /** The head rising as the mouth opens. */
    headY: [-170, -110],
    tongueT3: [-12, -6],
    gapMs: [100, 450],
  },
  /** Waiting for a subtask: looking around, left and right, to see if it
   * is back; the tongue's tip taps, impatient. */
  awaitSubtask: {
    pose: { gx: 30 },
    lookX: [380, 460],
    lookDeg: [11, 14],
    lookHoldMs: [500, 900],
    turnMs: [220, 280],
    taps: [3, 5],
    tapT3: [-26, -20],
    tapMs: [120, 150],
    gapMs: [400, 1400],
  },
  /** At rest: a blink every 8–15 seconds (ruling 117 point 4), now and
   * then a look to one side or a flick of the tip — each under 0.6s, so
   * the face is still nearly all the time (rule 8: moving means
   * working). */
  idleAlive: {
    pose: {},
    lookX: [90, 110],
    lookBodyX: [200, 260],
    lookMs: [130, 160],
    lookHoldMs: [160, 220],
    lookBackMs: [150, 180],
    flickT3: [-30, -22],
    flickMs: [140, 170],
    gapMs: [8000, 15000],
  },
  /** Dozing: the head sinks, the eyes shut (‿ ‿), the mouth half
   * closes, the tongue hangs a little loose. Now and then — as rarely as
   * a blink — a breath lifts the body and a z z drifts up, or the head
   * dips and catches itself; each under 0.6s. */
  doze: {
    pose: {
      sleep: 1,
      lid: 0.15,
      mouth: 0.45,
      y: 320,
      rot: -14,
      t1: -8,
      t2: 3,
      t3: 12,
    },
    breathSy: 1.07,
    breathY: -110,
    breathInMs: 240,
    breathOutMs: 320,
    zzRiseY: -260,
    dropY: [110, 150],
    dropMs: [200, 240],
    catchMs: [220, 260],
    gapMs: [8000, 15000],
  },

  /** The undercurrent while it works (rule 8): the whole head rising and
   * falling about 2px, one breath after another with no pause, each its
   * own length and height, now and then leaning to one side. It is what
   * says 「busy」 when no beat plays. */
  bob: {
    upY: [-150, -110],
    swayX: [0, 40],
    ms: [1000, 1500],
    /** Settling back when the work ends. */
    settleMs: 260,
  },

  /** A long stretch of the same work quiets down (ruling 119 point 6):
   * after `afterMs` its moves shrink to `k` of their size — still
   * moving all the time — and every `bigMs` one plays at full size; any
   * change (a new tool, a reply, a reaction) brings it back at once. */
  quiet: { afterMs: 15_000, k: 0.4, bigMs: [20_000, 30_000] },

  /** You sent a message: it gathers itself, then nods hard and blinks —
   * got it — and the tip of its tongue wags once. */
  sent: {
    upY: -130,
    upMs: 110,
    nodY: 420,
    nodDeg: 8,
    nodMs: 150,
    backMs: 300,
    wagT3: -36,
  },
  /** You are typing: it leans toward the composer (down and right),
   * eyes wide, and listens — the tongue still — until you stop. */
  listen: {
    pose: { rot: 14, x: 320, y: 170, gx: 95, gy: 48, look: 0.6, wide: 1.3 },
    inMs: 220,
    holdMs: 1600,
    outMs: 300,
  },
  /** The pointer came onto it: a quick hop, eyes wide on you, the tip
   * wagging — oh, hi. */
  look: {
    crouchY: 70,
    crouchMs: 90,
    hopY: -430,
    hopMs: 150,
    landMs: 130,
    wide: 1.4,
    holdMs: 360,
    outMs: 280,
    wagT3: -32,
  },
  /** Something dragged in: ！, eyes as wide as they go, mouth a small o,
   * a jump — oh?! */
  drop: {
    crouchMs: 90,
    hopY: -540,
    hopMs: 180,
    landMs: 150,
    wide: 1.7,
    holdMs: 520,
    outMs: 280,
  },
  /** You pressed stop: everything stops at once, one squash and a
   * blink. */
  stop: { squashMs: 90, sy: 0.84, sx: 1.1, backMs: 240 },
  /** Done: down into a crouch, then a jump out of its circle, a squash
   * on landing; eyes smiling, a grin, the tongue wagging like a tail,
   * and a ✦. */
  done: {
    crouchMs: 160,
    crouchY: 90,
    jumpMs: 260,
    /** About 11px on the 72px avatar. */
    jumpY: -640,
    hangMs: 110,
    fallMs: 210,
    landMs: 90,
    settleMs: 260,
    smileHoldMs: 500,
    smileOutMs: 220,
    wags: 3,
    wagT3: [-42, -4],
    wagMs: 140,
  },
  /** A subtask sent off: the tongue reaches out, long, as if handing
   * something over, the body leaning back against it; then it comes
   * back. */
  dispatch: {
    pullMs: 140,
    reach: { t1: -16, t2: -22, t3: -28, stretch: 0.18 },
    reachMs: 320,
    holdMs: 420,
    backMs: 420,
    leanX: -220,
    leanDeg: -9,
    gaze: { gx: 60, gy: -58, look: 0.3 },
  },
  /** A subtask's report woke it: from looking aside it turns back to
   * you and nods; the tongue comes in as if catching what came back. */
  subtaskBack: {
    turnX: 400,
    turnDeg: 12,
    outMs: 180,
    backMs: 380,
    nodY: 340,
    nodMs: 140,
    catch: { t1: -8, t2: -12, t3: -16, stretch: 0.08 },
  },
  /** A reminder woke it: eyes shut, then ！ — eyes wide open, a spring
   * up. */
  wakeReminder: {
    shutMs: 40,
    shutHoldMs: 200,
    openMs: 140,
    wide: 1.6,
    hopY: -580,
    hopMs: 210,
    landMs: 190,
    holdMs: 400,
  },
  /** At rest, dozing, and you touched it: two blinks, head up, the
   * tongue drawn back in. */
  wake: { openMs: 220, wide: 1.3, settleMs: 200 },
  /** It asks you something: the head tilts about 20°, the tongue's tip
   * curls into a question mark, a ？ pops; then it holds still, looking
   * at you, the ？ standing. */
  askEnter: {
    counterDeg: 4,
    tiltDeg: -20,
    inMs: 300,
    holdMs: 300,
    settleMs: 300,
  },
  ask: {
    pose: { rot: -14, t2: 8, t3: -38, wide: 1.08, gy: -10, q: 1 },
  },
  /** An error: a shake from side to side, eyes knocked out (× ×), a drop
   * of sweat; then the head hangs and the tongue goes limp, and it holds
   * still. */
  errorEnter: {
    shakes: 4,
    shakeX: 300,
    shakeMs: 55,
    sweatSlideY: 140,
    droopMs: 520,
  },
  error: {
    pose: {
      cross: 1,
      sweat: 1,
      /** The drop, slid down its cheek. */
      my: 140,
      mouth: 0.35,
      y: 300,
      rot: 12,
      sy: 0.93,
      t1: -8,
      t2: 6,
      t3: 10,
    },
  },
} as const;

// ---- Building beats --------------------------------------------------------

type Rand = () => number;
type Range = readonly [number, number];
type PosePatch = Partial<FacePose>;

/** A value in `[a, b]`. */
function draw(rand: Rand, [a, b]: Range): number {
  return a + (b - a) * rand();
}

function drawInt(rand: Rand, [a, b]: Range): number {
  return Math.floor(a + (b - a + 1) * rand());
}

function side(rand: Rand): 1 | -1 {
  return rand() < 0.5 ? -1 : 1;
}

interface VoiceKey {
  t: number;
  patch: PosePatch;
  ease: string;
}

/**
 * One part of a beat moving on its own time: a run of keys, each `ms`
 * after the one before, each a patch over the beat's end pose (`{}`: the
 * end itself). A voice owns the fields its patches name; the keys of a
 * voice that starts later (`start`) wait there at the beat's first pose.
 */
export class Voice {
  readonly keys: VoiceKey[] = [];
  private t: number;

  constructor(readonly start = 0) {
    this.t = start;
  }

  /** After `ms`, `patch`, along `ease`. */
  to(ms: number, patch: PosePatch = {}, ease: string = EASE.firm): this {
    this.t += Math.max(1, Math.round(ms));
    this.keys.push({ t: this.t, patch, ease });
    return this;
  }

  /** Stay where the last key put it, `ms`. */
  hold(ms: number): this {
    const last = this.keys[this.keys.length - 1];
    return this.to(ms, last ? last.patch : {}, EASE.linear);
  }

  get time(): number {
    return this.t;
  }
}

/** Expand overshoot marks (`spring`, `bounce`) into two segments: out
 * past the target, then back along a drift. */
function expandOvershoot(from: number, keys: TrackKey[]): TrackKey[] {
  const out: TrackKey[] = [];
  let t0 = 0;
  let v0 = from;
  for (const key of keys) {
    const mark =
      key.ease === EASE.spring
        ? OVERSHOOT.spring
        : key.ease === EASE.bounce
          ? OVERSHOOT.bounce
          : null;
    if (mark && key.v !== v0 && key.t - t0 >= 2) {
      out.push({
        t: Math.round(t0 + (key.t - t0) * mark.share),
        v: v0 + (key.v - v0) * (1 + mark.by),
        ease: EASE.firm,
      });
      out.push({ t: key.t, v: key.v, ease: EASE.drift });
    } else {
      out.push({ t: key.t, v: key.v, ease: mark ? EASE.firm : key.ease });
    }
    t0 = key.t;
    v0 = key.v;
  }
  return out;
}

/**
 * A beat from `from` (where the face is now) to `end` (where it stays),
 * out of voices that move at once. Each field takes its keys from the
 * one voice that names it (two voices naming the same field is a
 * mistake, and throws); a field no voice names but that differs between
 * the two poses turns to its end over `MOTION.turnMs`.
 */
export function compose(
  name: string,
  from: FacePose,
  end: FacePose,
  voices: Voice[],
): FaceBeat {
  const tracks: Partial<Record<FaceField, TrackKey[]>> = {};
  for (const voice of voices) {
    const fields = new Set<FaceField>();
    for (const key of voice.keys) {
      for (const f of Object.keys(key.patch) as FaceField[]) fields.add(f);
    }
    for (const f of fields) {
      if (tracks[f]) throw new Error(`${name}: two voices move ${f}`);
      const keys: TrackKey[] = [];
      if (voice.start > 0) {
        keys.push({ t: voice.start, v: from[f], ease: EASE.linear });
      }
      for (const key of voice.keys) {
        keys.push({ t: key.t, v: key.patch[f] ?? end[f], ease: key.ease });
      }
      const last = keys[keys.length - 1];
      if (last.v !== end[f]) {
        keys.push({ t: last.t + MOTION.turnMs, v: end[f], ease: EASE.firm });
      }
      tracks[f] = expandOvershoot(from[f], keys);
    }
  }
  let duration = 0;
  for (const keys of Object.values(tracks)) {
    duration = Math.max(duration, keys[keys.length - 1].t);
  }
  for (const f of FACE_FIELDS) {
    if (tracks[f] || from[f] === end[f]) continue;
    duration = Math.max(duration, MOTION.turnMs);
    tracks[f] = [
      { t: Math.min(duration, MOTION.turnMs), v: end[f], ease: EASE.firm },
    ];
  }
  return { name, duration, from, end, tracks };
}

/** The activities that are work (rule 8): the head never rests in
 * them. Not waiting for your answer, not an error, not rest or doze. */
export const WORKING: ReadonlySet<FaceActivity> = new Set<FaceActivity>([
  "think",
  "browse",
  "read",
  "note",
  "work",
  "talk",
  "awaitSubtask",
]);

/**
 * One breath of the undercurrent: from `from` (where the head is in its
 * rise and fall; at rest 0) up and back to 0. Only `x` and `y` matter
 * (the avatar plays it on a group of its own, under the beats).
 */
export function bobBeat(from: FacePose, rand: Rand, k = 1): FaceBeat {
  const m = MOTION.bob;
  const ms = draw(rand, m.ms);
  const up = draw(rand, m.upY) * k;
  const sway = side(rand) * draw(rand, m.swayX) * k;
  const peak = 0.42 + 0.16 * rand();
  const v = new Voice()
    .to(ms * peak, { y: up, x: sway }, EASE.drift)
    .to(ms * (1 - peak), {}, EASE.drift);
  return compose("bob", from, NEUTRAL_POSE, [v]);
}

/** The undercurrent coming to rest at 0 from `from`. */
export function bobSettleBeat(from: FacePose): FaceBeat {
  const v = new Voice().to(MOTION.bob.settleMs, { x: 0, y: 0 }, EASE.firm);
  return compose("bob:settle", from, NEUTRAL_POSE, [v]);
}

/** The pose an activity holds between its beats. */
export function basePose(activity: FaceActivity): FacePose {
  const patch: PosePatch =
    activity === "think"
      ? MOTION.think.pose
      : activity === "browse"
        ? MOTION.browse.pose
        : activity === "read"
          ? MOTION.read.pose
          : activity === "note"
            ? MOTION.note.pose
            : activity === "work"
              ? MOTION.work.pose
              : activity === "awaitSubtask"
                ? MOTION.awaitSubtask.pose
                : activity === "doze"
                  ? MOTION.doze.pose
                  : activity === "ask"
                    ? MOTION.ask.pose
                    : activity === "error"
                      ? MOTION.error.pose
                      : {};
  return { ...NEUTRAL_POSE, ...patch };
}

/** The listening pose (you are typing). */
export function listenPose(): FacePose {
  return { ...NEUTRAL_POSE, ...MOTION.listen.pose };
}

/** Turning from `from` to an activity's pose: firm, the tongue catching
 * up a moment later. Into a doze the eyes close halfway first, then the
 * rest of the way, as the head sinks. */
export function turnBeat(
  from: FacePose,
  to: FacePose,
  activity: FaceActivity,
): FaceBeat {
  if (activity === "doze") {
    const half = MOTION.dozeInMs / 2;
    const eyes = new Voice()
      .to(half, { lid: 0.45, sleep: 0 }, EASE.drift)
      .to(half, { lid: to.lid, sleep: to.sleep }, EASE.drift);
    const rest = new Voice().to(
      MOTION.dozeInMs,
      pick(to, BODY_REST),
      EASE.drift,
    );
    return compose(`enter:${activity}`, from, to, [eyes, rest]);
  }
  const body = new Voice().to(MOTION.turnMs, pick(to, BODY), EASE.firm);
  const face = new Voice().to(MOTION.turnMs, pick(to, FACE), EASE.firm);
  const tongue = new Voice(Math.round(MOTION.turnMs / 3)).to(
    MOTION.turnMs,
    pick(to, TONGUE_FIELDS),
    EASE.spring,
  );
  const marks = new Voice().to(MOTION.turnMs, pick(to, MARKS), EASE.firm);
  return compose(`enter:${activity}`, from, to, [body, face, tongue, marks]);
}

const BODY: FaceField[] = ["x", "y", "rot", "sx", "sy"];
const TONGUE_FIELDS: FaceField[] = ["t1", "t2", "t3", "stretch"];
const MARKS: FaceField[] = [
  "q",
  "bang",
  "zz",
  "spark",
  "sweat",
  "mx",
  "my",
  "ms",
];
const FACE: FaceField[] = FACE_REST_FIELDS;
const BODY_REST: FaceField[] = [...BODY, ...TONGUE_FIELDS, "mouth", "gx", "gy"];

function pick(pose: FacePose, fields: readonly FaceField[]): PosePatch {
  const out: PosePatch = {};
  for (const f of fields) out[f] = pose[f];
  return out;
}

/** Holding a pose set at once (reduced motion: the still face). */
export function stillBeat(pose: FacePose): FaceBeat {
  return { name: "still", duration: 0, from: pose, end: pose, tracks: {} };
}

/** A blink over `base` (its lid back to the base's). */
function blinkKeys(v: Voice, rand: Rand, base: FacePose): Voice {
  return v
    .to(
      draw(rand, MOTION.blink.closeMs),
      { lid: draw(rand, MOTION.blink.lid) * base.lid },
      EASE.fall,
    )
    .to(draw(rand, MOTION.blink.openMs), { lid: base.lid }, EASE.firm);
}

/** The tongue catching up with a move of the body (follow-through):
 * after `MOTION.follow.lagMs` it swings `size` degrees (signed; mostly
 * the tip, less near the root), then back past its pose, then home. */
function followKeys(v: Voice, size: number): Voice {
  const m = MOTION.follow;
  v.to(m.lagMs, {}, EASE.linear);
  m.swings.forEach((k, i) => {
    v.to(
      m.swingMs[i],
      { t1: size * k * 0.25, t2: size * k * 0.5, t3: size * k },
      EASE.drift,
    );
  });
  return v.to(200, {}, EASE.drift);
}

/** One of an activity's loop beats, or null when it has none (waiting
 * for you, after an error). `variant` keeps a beat from coming twice in
 * a row when there is another. */
export interface LoopPick {
  beat: FaceBeat;
  variant: string;
}

interface Variant {
  name: string;
  weight: number;
  make: (rand: Rand, from: FacePose, base: FacePose) => Voice[];
}

const blinkVariant = (weight: number): Variant => ({
  name: "blink",
  weight,
  make: (rand, _from, base) => [blinkKeys(new Voice(), rand, base)],
});

/** The marks' voice for a ？ / ！ / ✦ popping and fading: grows in
 * past its size, stands, rises a little and goes. */
function markKeys(
  v: Voice,
  mark: "q" | "bang" | "spark",
  holdMs: number,
  riseY: number,
): Voice {
  return v
    .to(1, { [mark]: 0, ms: 0.4, my: 0 }, EASE.linear)
    .to(MOTION.think.markPopMs, { [mark]: 1, ms: 1, my: 0 }, EASE.bounce)
    .to(holdMs, { [mark]: 1, ms: 1, my: riseY }, EASE.drift)
    .to(220, { [mark]: 0, ms: 1, my: riseY * 1.4 }, EASE.firm)
    .to(1, { [mark]: 0, ms: 1, my: 0 }, EASE.linear);
}

const LOOPS: Partial<Record<FaceActivity, Variant[]>> = {
  think: [
    {
      name: "ponder",
      weight: 3,
      make: (rand) => {
        const m = MOTION.think;
        const hold = draw(rand, m.holdMs);
        const ms = draw(rand, m.ponderMs);
        const body = new Voice()
          .to(ms, { rot: draw(rand, m.tiltDeg), y: -120, x: -120 }, EASE.drift)
          .hold(hold)
          .to(ms, {}, EASE.drift);
        const eyes = new Voice()
          .to(260, { gx: -105, gy: -62, look: -0.7 })
          .hold(hold + ms - 300)
          .to(300, {});
        const tongue = new Voice(120)
          .to(ms + 200, { t3: draw(rand, m.curlT3), t2: 5 }, EASE.drift)
          .hold(hold - 200)
          .to(ms, {}, EASE.drift);
        return [body, eyes, tongue];
      },
    },
    {
      name: "tap",
      weight: 2,
      make: (rand) => {
        const m = MOTION.think;
        const tongue = new Voice();
        const n = drawInt(rand, m.taps);
        for (let i = 0; i < n; i++) {
          const ms = draw(rand, m.tapMs);
          tongue
            .to(ms * 0.45, { t3: draw(rand, m.tapT3) }, EASE.firm)
            .to(ms * 0.55, { t3: -12 }, EASE.fall);
        }
        tongue.to(200, {}, EASE.drift);
        const eyes = new Voice()
          .to(220, { gx: 70, gy: -58, look: 0.4 })
          .hold(tongue.time - 420)
          .to(220, {});
        return [tongue, eyes];
      },
    },
    {
      name: "wonder",
      weight: 1.5,
      make: (rand) => {
        const m = MOTION.think;
        const swap = draw(rand, m.swapDeg);
        const body = new Voice()
          .to(140, { rot: -16 }, EASE.firm)
          .to(260, { rot: swap }, EASE.spring)
          .hold(m.markHoldMs - 200)
          .to(380, {}, EASE.drift);
        const eyes = new Voice()
          .to(260, { gx: 100, gy: -60, look: 0.6 }, EASE.firm)
          .hold(m.markHoldMs - 100)
          .to(300, {});
        const tongue = followKeys(new Voice(260), -14);
        const mark = markKeys(new Voice(180), "q", m.markHoldMs, m.markRiseY);
        return [body, eyes, tongue, mark];
      },
    },
    blinkVariant(1),
  ],
  browse: [
    {
      name: "lines",
      weight: 3,
      make: (rand, _from, base) => {
        const m = MOTION.browse;
        const lines = drawInt(rand, m.lines);
        const sweeps = Array.from({ length: lines }, () =>
          Math.round(draw(rand, m.sweepMs)),
        );
        const snaps = Array.from({ length: lines - 1 }, () =>
          Math.round(draw(rand, m.snapMs)),
        );
        const eyes = new Voice();
        const body = new Voice();
        let y = base.gy;
        sweeps.forEach((sweep, i) => {
          eyes.to(sweep, { gx: m.toX, gy: y + 4, look: 0.6 }, EASE.sweep);
          body.to(sweep, { x: m.headX, rot: m.headDeg }, EASE.sweep);
          if (i < snaps.length) {
            y += draw(rand, m.lineStep);
            eyes.to(snaps[i], { gx: m.fromX, gy: y, look: -0.6 }, EASE.bounce);
            body.to(snaps[i], { x: -m.headX, rot: -m.headDeg }, EASE.bounce);
          }
        });
        eyes.to(260, {}, EASE.bounce);
        body.to(300, {}, EASE.bounce);
        // The tongue swings after each snap back, into the next line.
        const tongue = new Voice().to(sweeps[0], {}, EASE.linear);
        snaps.forEach((snap, i) => {
          tongue
            .to(snap + 60, { t3: -18, t2: -6, t1: -2 }, EASE.firm)
            .to(150, { t3: 8, t2: 3, t1: 0 }, EASE.drift)
            .to(130, {}, EASE.drift)
            .to(Math.max(1, sweeps[i + 1] - 280), {}, EASE.linear);
        });
        followKeys(tongue, -16);
        return [eyes, body, tongue];
      },
    },
    {
      name: "skim",
      weight: 1,
      make: (rand, _from, base) => {
        const m = MOTION.browse;
        const eyes = new Voice();
        const body = new Voice();
        for (let i = 0; i < 3; i++) {
          const ms = draw(rand, m.skimMs);
          const right = i % 2 === 0;
          eyes.to(
            ms,
            {
              gx: right ? m.toX : m.fromX,
              gy: base.gy + 16 * (i + 1),
              look: right ? 0.6 : -0.6,
            },
            EASE.firm,
          );
          body.to(
            ms,
            { x: right ? 300 : -300, rot: right ? 7 : -7 },
            EASE.firm,
          );
        }
        eyes.to(220, {}, EASE.firm);
        body.to(260, {}, EASE.spring);
        const tongue = followKeys(new Voice(180), 18);
        return [eyes, body, tongue];
      },
    },
    {
      name: "scroll",
      weight: 1,
      make: (rand, _from, base) => {
        const eyes = new Voice().to(140, { gy: base.gy - 30 }, EASE.firm);
        blinkKeys(eyes, rand, base).to(160, {}, EASE.firm);
        const body = new Voice()
          .to(120, { y: -180 }, EASE.firm)
          .to(280, {}, EASE.spring);
        const tongue = new Voice(60)
          .to(150, { t3: -30, t2: -8 }, EASE.firm)
          .to(260, {}, EASE.spring);
        return [eyes, body, tongue];
      },
    },
  ],
  read: [
    {
      name: "down",
      weight: 3,
      make: (rand) => {
        const m = MOTION.read;
        const drift = draw(rand, m.driftMs);
        const eyes = new Voice()
          .to(draw(rand, m.flickMs), {
            gy: draw(rand, m.fromY),
            gx: draw(rand, m.driftX),
          })
          .to(
            drift,
            { gy: draw(rand, m.toY), gx: draw(rand, m.driftX) },
            EASE.drift,
          )
          .to(draw(rand, m.flickMs) + 30, {}, EASE.firm);
        const body = new Voice()
          .to(draw(rand, m.flickMs), { y: 180, rot: 8 }, EASE.firm)
          .to(drift, { y: 360, rot: 12 }, EASE.drift)
          .to(200, {}, EASE.spring);
        return [eyes, body];
      },
    },
    {
      name: "page",
      weight: 1.5,
      make: () => {
        const m = MOTION.read;
        const tongue = new Voice()
          .to(m.pageUpMs, { t3: m.pageT3, t2: -8 }, EASE.pop)
          .to(m.pageDownMs, { t3: 6, t2: 2 }, EASE.fall)
          .to(260, {}, EASE.spring);
        const eyes = new Voice()
          .to(160, { gx: 60, gy: -20, look: 0.4 }, EASE.firm)
          .hold(220)
          .to(260, { gx: -40, gy: 20 }, EASE.firm)
          .to(160, {}, EASE.firm);
        const body = new Voice()
          .to(160, { y: 120, rot: 4, x: 120 }, EASE.firm)
          .to(360, {}, EASE.spring);
        return [tongue, eyes, body];
      },
    },
    blinkVariant(1),
  ],
  note: [
    {
      name: "nod",
      weight: 2,
      make: (rand) => {
        const m = MOTION.note;
        const down = draw(rand, m.nodDownMs);
        const body = new Voice()
          .to(down, {
            y: draw(rand, m.nodY),
            rot: draw(rand, m.nodDeg),
            sy: 0.92,
          })
          .to(draw(rand, m.nodUpMs), {}, EASE.spring);
        const tongue = followKeys(new Voice(Math.round(down / 2)), 16);
        return [body, tongue];
      },
    },
    {
      name: "write",
      weight: 2,
      make: (rand, _from, base) => {
        const m = MOTION.note;
        const eyes = new Voice();
        const tongue = new Voice();
        const body = new Voice();
        for (let i = 1; i <= 3; i++) {
          const ms = draw(rand, m.circleMs);
          eyes.to(ms, { gx: base.gx + i * draw(rand, m.stepX) }, EASE.firm);
          tongue
            .to(ms / 4, { t2: m.circleT2, t3: 0 }, EASE.drift)
            .to(ms / 4, { t2: 0, t3: -m.circleT3 }, EASE.drift)
            .to(ms / 4, { t2: -m.circleT2, t3: -m.circleT3 * 2 }, EASE.drift)
            .to(ms / 4, { t2: 0, t3: -m.circleT3 }, EASE.drift);
          body
            .to(ms / 2, { y: 300, rot: 9, x: (i - 2) * 80 }, EASE.firm)
            .to(ms / 2, { y: 150, rot: 7, x: (i - 2) * 80 }, EASE.drift);
        }
        eyes.to(240, {}, EASE.firm);
        tongue.to(240, {}, EASE.drift);
        body.to(260, {}, EASE.spring);
        return [eyes, tongue, body];
      },
    },
    {
      name: "double-nod",
      weight: 1.5,
      make: (rand) => {
        const m = MOTION.note;
        const body = new Voice()
          .to(draw(rand, m.nodDownMs), {
            y: draw(rand, m.nodY),
            rot: draw(rand, m.nodDeg),
            sy: 0.92,
          })
          .to(draw(rand, m.nodUpMs) * 0.7, { y: 60 }, EASE.firm)
          .to(draw(rand, m.nodDownMs), {
            y: draw(rand, m.nodY) * 0.85,
            rot: draw(rand, m.nodDeg),
            sy: 0.93,
          })
          .to(draw(rand, m.nodUpMs), {}, EASE.spring);
        const tongue = followKeys(new Voice(240), 14);
        return [body, tongue];
      },
    },
    blinkVariant(0.7),
  ],
  work: [
    {
      name: "bumps",
      weight: 3,
      make: (rand) => {
        const m = MOTION.work;
        const body = new Voice();
        const tongue = new Voice();
        const n = drawInt(rand, m.bumps);
        for (let i = 0; i < n; i++) {
          const crouch = draw(rand, m.crouchMs);
          const rise = draw(rand, m.riseMs);
          const land = draw(rand, m.landMs);
          body
            .to(crouch, { sy: m.crouchSy, sx: m.crouchSx, y: 70 }, EASE.firm)
            .to(
              rise,
              { sy: m.riseSy, sx: 0.92, y: draw(rand, m.riseY) },
              EASE.pop,
            )
            .to(land, { sy: 0.88, sx: 1.08, y: 40 }, EASE.fall);
          tongue
            .to(crouch, {}, EASE.firm)
            .to(rise, { t2: -10, t3: -34 }, EASE.pop)
            .to(land, { t2: 3, t3: 6 }, EASE.fall);
        }
        body.to(220, {}, EASE.spring);
        tongue.to(260, {}, EASE.spring);
        return [body, tongue];
      },
    },
    {
      name: "hammer",
      weight: 2,
      make: (rand) => {
        const m = MOTION.work;
        const raise = draw(rand, m.raiseMs);
        const tongue = new Voice()
          .to(raise, m.raise, EASE.drift)
          .to(m.slamMs, { t1: 0, t2: 3, t3: 8 }, EASE.fall)
          .to(300, {}, EASE.bounce);
        const body = new Voice()
          .to(raise, { rot: -m.leanDeg, x: -200, y: -120 }, EASE.drift)
          .to(
            m.slamMs,
            { rot: 4, x: 80, y: 120, sy: 0.82, sx: 1.12 },
            EASE.fall,
          )
          .to(320, {}, EASE.bounce);
        const eyes = new Voice()
          .to(raise, { gy: -30 }, EASE.drift)
          .to(m.slamMs, { gy: 30 }, EASE.fall)
          .to(300, {}, EASE.firm);
        return [tongue, body, eyes];
      },
    },
    {
      name: "shift",
      weight: 1,
      make: (rand) => {
        const m = MOTION.work;
        const s = side(rand);
        const body = new Voice()
          .to(
            200,
            { x: s * draw(rand, m.shiftX), rot: s * draw(rand, m.shiftDeg) },
            EASE.firm,
          )
          .hold(draw(rand, [250, 450]))
          .to(300, {}, EASE.bounce);
        const tongue = followKeys(new Voice(), -s * 18);
        const eyes = new Voice()
          .to(200, { gx: s * 100, look: s * 0.5 }, EASE.firm)
          .hold(300)
          .to(260, {}, EASE.firm);
        return [body, tongue, eyes];
      },
    },
    blinkVariant(0.6),
  ],
  talk: [
    {
      name: "burst",
      weight: 4,
      make: (rand) => talkVoices(rand),
    },
    {
      name: "burst-nod",
      weight: 1,
      make: (rand) => {
        const [mouth, body, tongue] = talkVoices(rand);
        body.to(140, { y: 340, rot: 7 }, EASE.firm).to(240, {}, EASE.spring);
        return [mouth, body, tongue];
      },
    },
    {
      name: "burst-blink",
      weight: 1,
      make: (rand, _from, base) => [
        ...talkVoices(rand),
        blinkKeys(new Voice(300), rand, base),
      ],
    },
  ],
  awaitSubtask: [
    {
      name: "look-around",
      weight: 3,
      make: (rand) => {
        const m = MOTION.awaitSubtask;
        const s = rand() < 0.6 ? 1 : -1;
        const turn = () => draw(rand, m.turnMs);
        const hold = () => draw(rand, m.lookHoldMs);
        const t1 = turn();
        const h1 = hold();
        const t2 = turn() + 60;
        const h2 = hold();
        const t3 = turn();
        const body = new Voice()
          .to(
            t1,
            { x: s * draw(rand, m.lookX), rot: s * draw(rand, m.lookDeg) },
            EASE.firm,
          )
          .hold(h1)
          .to(
            t2,
            { x: -s * draw(rand, m.lookX), rot: -s * draw(rand, m.lookDeg) },
            EASE.firm,
          )
          .hold(h2)
          .to(t3, {}, EASE.spring);
        const eyes = new Voice()
          .to(t1 - 60, { gx: s * 105, gy: -20, look: s * 0.8 }, EASE.firm)
          .hold(h1 + 60)
          .to(t2 - 40, { gx: -s * 100, gy: -20, look: -s * 0.8 }, EASE.firm)
          .hold(h2 + 40)
          .to(t3, {}, EASE.firm);
        const tongue = new Voice(Math.round(t1 * 0.6))
          .to(220, { t3: s * 14, t2: s * 5 }, EASE.drift)
          .to(h1 + t2 - 100, { t3: -s * 16, t2: -s * 6 }, EASE.drift)
          .to(h2 + 120, {}, EASE.drift)
          .to(t3 + 120, {}, EASE.spring);
        return [body, eyes, tongue];
      },
    },
    {
      name: "tap",
      weight: 2,
      make: (rand) => {
        const m = MOTION.awaitSubtask;
        const tongue = new Voice();
        const n = drawInt(rand, m.taps);
        for (let i = 0; i < n; i++) {
          const ms = draw(rand, m.tapMs);
          tongue
            .to(ms * 0.45, { t3: draw(rand, m.tapT3) }, EASE.firm)
            .to(ms * 0.55, { t3: 2 }, EASE.fall);
        }
        tongue.to(180, {}, EASE.drift);
        const eyes = new Voice()
          .to(200, { gx: 90, gy: -50, look: 0.5 }, EASE.firm)
          .hold(Math.max(1, tongue.time - 400))
          .to(200, {}, EASE.firm);
        const body = new Voice()
          .to(200, { rot: 9, y: -120 }, EASE.firm)
          .hold(Math.max(1, tongue.time - 400))
          .to(220, {}, EASE.spring);
        return [tongue, eyes, body];
      },
    },
    blinkVariant(1),
  ],
  doze: [
    {
      name: "breath",
      weight: 2,
      make: (_rand, _from, base) => {
        const m = MOTION.doze;
        const body = new Voice()
          .to(
            m.breathInMs,
            { sy: m.breathSy, y: base.y + m.breathY },
            EASE.drift,
          )
          .to(m.breathOutMs, {}, EASE.drift);
        const mark = new Voice()
          .to(1, { zz: 0, my: 0, ms: 0.6 }, EASE.linear)
          .to(m.breathInMs, { zz: 1, my: m.zzRiseY / 2, ms: 1 }, EASE.firm)
          .to(m.breathOutMs - 2, { zz: 0, my: m.zzRiseY, ms: 1.1 }, EASE.drift)
          .to(1, { zz: 0, my: 0, ms: 1 }, EASE.linear);
        return [body, mark];
      },
    },
    {
      name: "nod-off",
      weight: 1,
      make: (rand, _from, base) => {
        const m = MOTION.doze;
        const body = new Voice()
          .to(
            draw(rand, m.dropMs),
            { y: base.y + draw(rand, m.dropY), rot: base.rot - 3 },
            EASE.fall,
          )
          .to(draw(rand, m.catchMs), {}, EASE.firm);
        return [body];
      },
    },
  ],
};

/** At rest: a blink, now and then a look to one side or a flick of the
 * tongue's tip. */
const IDLE_ALIVE: Variant[] = [
  blinkVariant(5),
  {
    name: "look",
    weight: 1.2,
    make: (rand) => {
      const m = MOTION.idleAlive;
      const s = side(rand);
      const lookMs = draw(rand, m.lookMs);
      const hold = draw(rand, m.lookHoldMs);
      const back = draw(rand, m.lookBackMs);
      const eyes = new Voice()
        .to(lookMs, { gx: s * draw(rand, m.lookX), gy: -6, look: s * 0.6 })
        .hold(hold)
        .to(back, {});
      const body = new Voice()
        .to(lookMs, { x: s * draw(rand, m.lookBodyX), rot: s * 3 })
        .hold(hold)
        .to(back, {});
      return [eyes, body];
    },
  },
  {
    name: "flick",
    weight: 0.8,
    make: (rand) => {
      const m = MOTION.idleAlive;
      const ms = draw(rand, m.flickMs);
      const tongue = new Voice()
        .to(ms, { t3: draw(rand, m.flickT3), t2: -4 }, EASE.firm)
        .to(ms + 60, { t3: 5 }, EASE.drift)
        .to(ms, {}, EASE.drift);
      return [tongue];
    },
  },
];

/** A burst of talk: the mouth opening wide and shutting, the head riding
 * each syllable, the tongue moving along (a body, a mouth, a tongue). */
function talkVoices(rand: Rand): [Voice, Voice, Voice] {
  const m = MOTION.talk;
  const mouth = new Voice();
  const body = new Voice();
  const tongue = new Voice();
  const n = drawInt(rand, m.syllables);
  for (let i = 0; i < n; i++) {
    const open = draw(rand, m.openMs);
    const close = draw(rand, m.closeMs);
    mouth
      .to(open, { mouth: draw(rand, m.openTo) }, EASE.pop)
      .to(close, { mouth: i === n - 1 ? 1 : draw(rand, m.closeTo) }, EASE.firm);
    body
      .to(open, { y: draw(rand, m.headY), sy: 1.04 }, EASE.pop)
      .to(close, { y: 20, sy: 0.98 }, EASE.firm);
    tongue
      .to(open, { t3: draw(rand, m.tongueT3) }, EASE.drift)
      .to(close, { t3: 2 }, EASE.drift);
  }
  body.to(160, {}, EASE.spring);
  tongue.to(160, {}, EASE.drift);
  return [mouth, body, tongue];
}

/** Whether an activity has beats between its pauses: waiting for you
 * and after an error it holds still; at rest it lives only in 丙. */
export function hasLoop(activity: FaceActivity, alive: boolean): boolean {
  if (activity === "idle") return alive;
  return LOOPS[activity] !== undefined;
}

/** The pause before an activity's next beat, ms. */
export function loopGap(activity: FaceActivity, rand: Rand): number {
  const gap: Range =
    activity === "idle"
      ? MOTION.idleAlive.gapMs
      : activity === "think"
        ? MOTION.think.gapMs
        : activity === "browse"
          ? MOTION.browse.gapMs
          : activity === "read"
            ? MOTION.read.gapMs
            : activity === "note"
              ? MOTION.note.gapMs
              : activity === "work"
                ? MOTION.work.gapMs
                : activity === "talk"
                  ? MOTION.talk.gapMs
                  : activity === "awaitSubtask"
                    ? MOTION.awaitSubtask.gapMs
                    : MOTION.doze.gapMs;
  return Math.round(draw(rand, gap));
}

/** The variants an activity draws from (at rest included). */
export function loopVariants(activity: FaceActivity): string[] {
  const list = activity === "idle" ? IDLE_ALIVE : (LOOPS[activity] ?? []);
  return list.map((v) => v.name);
}

/**
 * The next beat of an activity, from `from` back to its pose: a
 * weighted draw among its variants, never the variant it played last
 * (`previous`) when there is another; the variant's sizes and timings
 * are drawn too. `only` plays that variant (a quiet stretch's full-size
 * move plays the activity's first, its biggest).
 */
export function loopBeat(
  activity: FaceActivity,
  from: FacePose,
  rand: Rand,
  previous: string | null,
  only?: string,
): LoopPick | null {
  const list = activity === "idle" ? IDLE_ALIVE : LOOPS[activity];
  if (!list || list.length === 0) return null;
  let chosen: Variant | undefined = only
    ? list.find((v) => v.name === only)
    : undefined;
  if (!chosen) {
    const pool =
      list.length > 1 ? list.filter((v) => v.name !== previous) : list;
    const total = pool.reduce((sum, v) => sum + v.weight, 0);
    let r = rand() * total;
    chosen = pool[pool.length - 1];
    for (const v of pool) {
      if (r < v.weight) {
        chosen = v;
        break;
      }
      r -= v.weight;
    }
  }
  const base = basePose(activity);
  const voices = chosen.make(rand, from, base);
  return {
    beat: compose(`${activity}:${chosen.name}`, from, base, voices),
    variant: chosen.name,
  };
}

/** A beat with every spatial size times `k` (the quiet of a long
 * stretch of work): it starts where the face is and its keys and end
 * are scaled about the drawing. */
export function scaleBeat(beat: FaceBeat, k: number): FaceBeat {
  if (k === 1) return beat;
  const spatial = new Set<FaceField>(SPATIAL_FIELDS);
  const tracks: Partial<Record<FaceField, TrackKey[]>> = {};
  for (const [f, keys] of Object.entries(beat.tracks) as [
    FaceField,
    TrackKey[],
  ][]) {
    tracks[f] = spatial.has(f)
      ? keys.map((key) => ({
          ...key,
          v: NEUTRAL_POSE[f] + (key.v - NEUTRAL_POSE[f]) * k,
        }))
      : keys;
  }
  const end = scalePose(beat.end, k);
  let duration = beat.duration;
  // A field that only differed by its size now moves to the scaled end.
  for (const f of SPATIAL_FIELDS) {
    if (!tracks[f] && beat.from[f] !== end[f]) {
      const t = Math.min(beat.duration || MOTION.turnMs, MOTION.turnMs);
      tracks[f] = [{ t, v: end[f], ease: EASE.firm }];
      duration = Math.max(duration, t);
    }
  }
  return { ...beat, duration, end, tracks };
}

/**
 * A reaction from `from`, ending on `end` (the activity's pose it goes
 * back to; for `listen`, the listening pose it holds).
 */
export function reactionBeat(
  reaction: FaceReaction,
  from: FacePose,
  end: FacePose,
  rand: Rand,
): FaceBeat {
  return compose(
    reaction,
    from,
    end,
    reactionVoices(reaction, from, end, rand),
  );
}

function reactionVoices(
  reaction: FaceReaction,
  from: FacePose,
  end: FacePose,
  rand: Rand,
): Voice[] {
  switch (reaction) {
    case "sent": {
      const m = MOTION.sent;
      const body = new Voice()
        .to(m.upMs, { y: m.upY, sy: 1.05, sx: 0.97 }, EASE.firm)
        .to(
          m.nodMs,
          { y: m.nodY, rot: m.nodDeg, sy: 0.88, sx: 1.06 },
          EASE.firm,
        )
        .to(m.backMs, {}, EASE.bounce);
      const eyes = blinkKeys(new Voice(m.upMs), rand, end);
      const tongue = new Voice(m.upMs + 60)
        .to(140, { t3: m.wagT3, t2: -8 }, EASE.firm)
        .to(140, { t3: 6, t2: 2 }, EASE.drift)
        .to(180, {}, EASE.spring);
      return [body, eyes, tongue];
    }
    case "listen": {
      const m = MOTION.listen;
      return [new Voice().to(m.inMs, pick(end, [...BODY, ...FACE]), EASE.pop)];
    }
    case "look": {
      const m = MOTION.look;
      const body = new Voice()
        .to(m.crouchMs, { y: m.crouchY, sy: 0.9, sx: 1.06 }, EASE.firm)
        .to(m.hopMs, { y: m.hopY, sy: 1.08, sx: 0.95, rot: 0 }, EASE.pop)
        .to(m.landMs, { y: 0, sy: 0.92, sx: 1.04, rot: 0 }, EASE.fall)
        .to(m.holdMs, { rot: 0, y: 0 }, EASE.spring)
        .to(m.outMs, {}, EASE.firm);
      const at: PosePatch = {
        gx: 0,
        gy: 0,
        look: 0,
        lid: 1,
        wide: m.wide,
        smile: 0,
        strain: 0,
      };
      const eyes = new Voice()
        .to(m.crouchMs + 60, at, EASE.pop)
        .hold(m.hopMs + m.landMs + m.holdMs - 160)
        .to(m.outMs, {}, EASE.firm);
      const tongue = new Voice(m.crouchMs + 40)
        .to(130, { t3: m.wagT3, t2: -8 }, EASE.firm)
        .to(130, { t3: 4 }, EASE.drift)
        .to(130, { t3: m.wagT3 * 0.5 }, EASE.drift)
        .to(180, {}, EASE.spring);
      return [body, eyes, tongue];
    }
    case "drop": {
      const m = MOTION.drop;
      const body = new Voice()
        .to(m.crouchMs, { y: 60, sy: 0.88, sx: 1.08 }, EASE.firm)
        .to(m.hopMs, { y: m.hopY, sy: 1.12, sx: 0.92 }, EASE.pop)
        .to(m.landMs, { y: 0, sy: 0.9, sx: 1.06 }, EASE.fall)
        .to(m.holdMs - 200, { y: 0 }, EASE.spring)
        .to(m.outMs, {}, EASE.firm);
      const at: PosePatch = {
        gx: 0,
        gy: -10,
        look: 0,
        lid: 1,
        wide: m.wide,
        o: 1,
      };
      const face = new Voice()
        .to(m.crouchMs, at, EASE.pop)
        .hold(m.hopMs + m.landMs + m.holdMs - 200)
        .to(m.outMs, {}, EASE.firm);
      const mark = markKeys(new Voice(m.crouchMs), "bang", 600, -120);
      const tongue = followKeys(new Voice(m.crouchMs + m.hopMs), 20);
      return [body, face, mark, tongue];
    }
    case "stop": {
      const m = MOTION.stop;
      const body = new Voice()
        .to(m.squashMs, { sy: m.sy, sx: m.sx, y: 60 }, EASE.firm)
        .to(m.backMs, {}, EASE.bounce);
      return [body, blinkKeys(new Voice(), rand, end)];
    }
    case "done": {
      const m = MOTION.done;
      const air = m.jumpMs + m.hangMs + m.fallMs;
      const body = new Voice()
        .to(m.crouchMs, { y: m.crouchY, sy: 0.8, sx: 1.14 }, EASE.firm)
        .to(m.jumpMs, { y: m.jumpY, sy: 1.16, sx: 0.9 }, EASE.pop)
        .to(m.hangMs, { y: m.jumpY - 40, sy: 1.04, sx: 0.98 }, EASE.drift)
        .to(m.fallMs, { y: 0, sy: 1.08, sx: 0.94 }, EASE.fall)
        .to(m.landMs, { y: 0, sy: 0.8, sx: 1.15 }, EASE.firm)
        .to(m.settleMs, {}, EASE.bounce);
      const happy: PosePatch = { smile: 1, grin: 1, gx: 0, gy: 0, look: 0 };
      const face = new Voice()
        .to(m.crouchMs + 40, happy, EASE.firm)
        .hold(air + m.landMs + m.settleMs + m.smileHoldMs - 40)
        .to(m.smileOutMs, {}, EASE.firm);
      const tongue = new Voice(m.crouchMs);
      for (let i = 0; i < m.wags * 2; i++) {
        tongue.to(
          m.wagMs,
          { t3: m.wagT3[i % 2], t2: i % 2 === 0 ? -10 : 0 },
          EASE.drift,
        );
      }
      tongue.to(240, {}, EASE.spring);
      const mark = markKeys(
        new Voice(m.crouchMs + m.jumpMs - 60),
        "spark",
        700,
        -160,
      );
      return [body, face, tongue, mark];
    }
    case "dispatch": {
      const m = MOTION.dispatch;
      // Gathering itself (the body pulls back), then the tongue shoots
      // out and comes home with a swing.
      const tongue = new Voice(m.pullMs)
        .to(m.reachMs, m.reach, EASE.pop)
        .hold(m.holdMs)
        .to(m.backMs, {}, EASE.spring);
      const body = new Voice()
        .to(m.pullMs, { x: 100, rot: 4, y: 60 }, EASE.firm)
        .to(m.reachMs, { x: m.leanX, rot: m.leanDeg, y: -80 }, EASE.pop)
        .hold(m.holdMs)
        .to(m.backMs, {}, EASE.spring);
      const eyes = new Voice(m.pullMs)
        .to(m.reachMs, m.gaze, EASE.firm)
        .hold(m.holdMs)
        .to(m.backMs - 80, {}, EASE.firm);
      return [tongue, body, eyes];
    }
    case "subtaskBack": {
      const m = MOTION.subtaskBack;
      const body = new Voice()
        .to(m.outMs, { x: m.turnX, rot: m.turnDeg }, EASE.firm)
        .to(m.backMs, { x: 0, rot: 0 }, EASE.bounce)
        .to(m.nodMs, { y: m.nodY, sy: 0.92 }, EASE.firm)
        .to(240, {}, EASE.spring);
      const eyes = new Voice()
        .to(m.outMs, { gx: 110, gy: 0, look: 0.8 }, EASE.firm)
        .to(m.backMs, { gx: 0, gy: 0, look: 0 }, EASE.firm)
        .hold(m.nodMs)
        .to(200, {}, EASE.firm);
      const tongue = new Voice()
        .to(m.outMs, m.catch, EASE.firm)
        .to(m.backMs + 80, { t1: 0, t2: 4, t3: 8, stretch: 0 }, EASE.firm)
        .to(260, {}, EASE.bounce);
      return [body, eyes, tongue];
    }
    case "wakeReminder": {
      const m = MOTION.wakeReminder;
      const eyes = new Voice()
        .to(
          m.shutMs,
          { lid: 0.1, gx: 0, gy: 10, look: 0, sleep: 0 },
          EASE.linear,
        )
        .hold(m.shutHoldMs)
        .to(
          m.openMs,
          { lid: 1, wide: m.wide, gx: 0, gy: -10, look: 0, o: 1, mouth: 1 },
          EASE.pop,
        )
        .hold(m.hopMs + m.landMs + m.holdMs - 200)
        .to(260, {}, EASE.firm);
      const body = new Voice(m.shutMs + m.shutHoldMs)
        .to(m.openMs, { y: 80, sy: 0.86, sx: 1.1, rot: 0 }, EASE.firm)
        .to(m.hopMs, { y: m.hopY, sy: 1.12, sx: 0.92, rot: 0 }, EASE.pop)
        .to(m.landMs, { y: 0, sy: 0.9, sx: 1.06, rot: 0 }, EASE.fall)
        .to(260, {}, EASE.bounce);
      const mark = markKeys(
        new Voice(m.shutMs + m.shutHoldMs),
        "bang",
        m.holdMs + 300,
        -120,
      );
      const tongue = new Voice(m.shutMs + m.shutHoldMs + m.openMs)
        .to(160, { t1: 0, t2: -8, t3: -30, stretch: 0 }, EASE.pop)
        .to(200, { t3: 4, t2: 0 }, EASE.drift)
        .to(260, {}, EASE.spring);
      return [eyes, body, mark, tongue];
    }
    case "wake": {
      const m = MOTION.wake;
      const eyes = new Voice()
        .to(120, { sleep: 0, lid: 0.15, gx: from.gx, gy: from.gy }, EASE.firm)
        .to(m.openMs, { lid: 1, wide: m.wide, gx: 0, gy: 0 }, EASE.pop);
      blinkKeys(eyes, rand, { ...end, lid: 1 });
      eyes.to(draw(rand, MOTION.doubleBlinkGapMs), {}, EASE.firm);
      blinkKeys(eyes, rand, end).to(m.settleMs, {}, EASE.firm);
      const body = new Voice(120)
        .to(m.openMs + 80, { y: -200, rot: 0, sy: 1.08 }, EASE.pop)
        .to(320, {}, EASE.spring);
      const tongue = new Voice(200)
        .to(260, { t1: 0, t2: -4, t3: -10, stretch: 0 }, EASE.firm)
        .to(260, {}, EASE.spring);
      return [eyes, body, tongue];
    }
    case "askEnter": {
      const m = MOTION.askEnter;
      const body = new Voice()
        .to(120, { rot: m.counterDeg }, EASE.firm)
        .to(m.inMs, { rot: m.tiltDeg, y: -120 }, EASE.bounce)
        .hold(m.holdMs)
        .to(m.settleMs, {}, EASE.drift);
      const tongue = new Voice(160)
        .to(m.inMs + 100, { t2: end.t2, t3: end.t3 - 10 }, EASE.firm)
        .to(m.holdMs, {}, EASE.spring);
      const eyes = new Voice()
        .to(200, { gx: 0, gy: -10, look: 0, wide: 1.2, lid: 1 }, EASE.pop)
        .hold(m.inMs + m.holdMs)
        .to(m.settleMs, {}, EASE.drift);
      const mark = new Voice(200)
        .to(1, { q: 0, ms: 0.4, my: 0 }, EASE.linear)
        .to(MOTION.think.markPopMs, { q: 1, ms: 1, my: 0 }, EASE.bounce);
      return [body, tongue, eyes, mark];
    }
    case "errorEnter": {
      const m = MOTION.errorEnter;
      const body = new Voice();
      for (let i = 0; i < m.shakes; i++) {
        const k = 1 - i * 0.18;
        body.to(
          m.shakeMs,
          { x: (i % 2 === 0 ? 1 : -1) * m.shakeX * k },
          EASE.firm,
        );
      }
      body.to(m.shakeMs, { x: 0 }, EASE.firm).to(m.droopMs, {}, EASE.drift);
      const shake = m.shakes * m.shakeMs + m.shakeMs;
      const eyes = new Voice()
        .to(
          m.shakeMs,
          { cross: 1, gx: 0, gy: 0, look: 0, lid: 1, wide: 1.1 },
          EASE.firm,
        )
        .hold(shake)
        .to(m.droopMs, {}, EASE.drift);
      const mark = new Voice(shake - 100)
        .to(1, { sweat: 0, ms: 0.5, my: -60 }, EASE.linear)
        .to(180, { sweat: 1, ms: 1, my: 0 }, EASE.pop)
        .to(m.droopMs, { sweat: 1, ms: 1, my: m.sweatSlideY }, EASE.drift);
      const tongue = new Voice(shake).to(
        m.droopMs + 100,
        pick(end, TONGUE_FIELDS),
        EASE.bounce,
      );
      const mouth = new Voice()
        .to(m.shakeMs * 2, { mouth: 0.25, o: 0 }, EASE.firm)
        .hold(shake)
        .to(m.droopMs, {}, EASE.drift);
      return [body, eyes, mark, tongue, mouth];
    }
  }
}
