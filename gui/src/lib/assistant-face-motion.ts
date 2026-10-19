import type { FaceActivity, FaceReaction } from "@/lib/assistant-face";

/**
 * How the assistant's face moves (main chat PRD ruling 117, ticket 65):
 * every number in one place, each motion with the one thing it says
 * (foundations.md §2.7: motion conveys state, not decoration; ruling 117
 * point 5 asks for that sentence per motion). When a tier wins, these
 * go into §2.7 as the avatar's exemption.
 *
 * Nothing loops at an even beat. Each activity is a run of separate
 * beats with random pauses between them and two to four variants of
 * each beat, their sizes and timings drawn anew each time (`rand`), so
 * the face never ticks like a metronome.
 *
 * Busy or not must read at a glance (ruling 117 point 8): while it works
 * (`WORKING`) the head never rests — under the beats runs an
 * undercurrent, a gentle rise and fall of the whole head, breath after
 * breath with no pause, each a little different (`bobBeat`), so a
 * glance never lands on a still face; at rest 乙 is still and 丙's moves
 * are short and rare (a blink under 0.2s, a look under 0.6s, every 8–15
 * seconds; dozing holds still), so moving still means working. Waiting
 * for your answer is no work: it looks straight at you and holds still.
 * A beat is a list of poses over time, played by the avatar as SVG
 * animations (SMIL) of its shapes' transforms and opacity only: the
 * browser runs them, no script per frame. (Not CSS or Web Animations:
 * in Chrome an SVG shape with one running is rasterized half a device
 * pixel off, so the whole face visibly shifts as a beat starts and
 * snaps back as it ends; a SMIL animation leaves the raster alone.)
 *
 * Distances are in the icon's own units (its 4096 viewBox): 57 units
 * are 1px on the 72px avatar, 64 on the 64px one, 146 on the header's
 * 28px. The eyes are about 270 units across and have about 130 units of
 * face to either side, 79 above and 78 below. A move of the whole
 * figure under about 50 units does not read on the 72px avatar, so the
 * body's moves are 1px and up.
 */

/** One position of the face. */
export interface FacePose {
  /** The whole figure (head and tongue): offset, in units. */
  x: number;
  y: number;
  /** Its tilt, in degrees, about the avatar's centre (it never leaves
   * the circle it is cropped to). */
  rot: number;
  /** Its scale (squash and stretch, shrinking). */
  sx: number;
  sy: number;
  /** Where both eyes look: offset, in units. */
  gx: number;
  gy: number;
  /** How open the eyes are: 1 as drawn, 0.1 shut. */
  lid: number;
  /** How wide the eyes are: 1 as drawn. */
  wide: number;
  /** The smiling eyes (^ ^) in place of the round ones: 0 or 1. */
  smile: number;
  /** The sleeping eyes (‿ ‿) in place of the round ones: 0 or 1. */
  sleep: number;
  /** How far the mouth closes from the top: 0 as drawn (open), 1 shut
   * down to its lower lip. */
  jaw: number;
}

/** The face as the app icon draws it. */
export const NEUTRAL_POSE: FacePose = {
  x: 0,
  y: 0,
  rot: 0,
  sx: 1,
  sy: 1,
  gx: 0,
  gy: 0,
  lid: 1,
  wide: 1,
  smile: 0,
  sleep: 0,
  jaw: 0,
};

/** Whether the eyes and the mouth are as the icon draws them (the
 * avatar then hides its moving eyes and mouth: the drawing itself shows,
 * pixel for pixel). */
export function faceAtRest(pose: FacePose): boolean {
  return (
    pose.gx === 0 &&
    pose.gy === 0 &&
    pose.lid === 1 &&
    pose.wide === 1 &&
    pose.smile === 0 &&
    pose.sleep === 0 &&
    pose.jaw === 0
  );
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
  return (Object.keys(a) as (keyof FacePose)[]).every((k) => a[k] === b[k]);
}

/** A pose on the way: when (0–1 of the beat), and the curve to the
 * next one. */
export interface FaceFrame {
  at: number;
  pose: FacePose;
  ease: string;
}

/** One motion: its frames from where the face is to where it stays. */
export interface FaceBeat {
  /** What it is, for the demo's label and the tests. */
  name: string;
  /** Total length, ms (0: set at once). */
  duration: number;
  /** At least two; the first at 0, the last at 1. */
  frames: FaceFrame[];
}

// ---- Curves ----------------------------------------------------------------

/** The motion tokens' curves (globals.css `--ease-firm`, `--ease-pop`,
 * `--ease-spring`), and two the tokens do not have: a sine in-out for
 * slow drifts (breathing, a gaze reading down a page) and an ease-in for
 * a fall. A SMIL curve cannot leave 0–1, so the spring's overshoot is
 * played as its own short segment (`SPRING_OVERSHOOT`). */
export const EASE = {
  firm: "cubic-bezier(0.2, 0, 0, 1)",
  pop: "cubic-bezier(0.16, 1, 0.3, 1)",
  spring: "cubic-bezier(0.34, 1.2, 0.64, 1)",
  drift: "cubic-bezier(0.37, 0, 0.63, 1)",
  fall: "cubic-bezier(0.5, 0, 0.75, 0)",
  /** A gaze sweeping a line of text: even, a touch slower at the ends. */
  sweep: "cubic-bezier(0.3, 0.1, 0.7, 0.9)",
} as const;

/** The spring as two segments: out past the target by this much of the
 * way, over this share of the time, then back. */
export const SPRING_OVERSHOOT = { by: 0.08, share: 0.6 } as const;

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

function mix(a: FacePose, b: FacePose, k: number): FacePose {
  const out = { ...a };
  for (const key of Object.keys(a) as (keyof FacePose)[]) {
    out[key] = a[key] + (b[key] - a[key]) * k;
  }
  return out;
}

/** Where a beat has the face `ms` into it. */
export function poseAt(beat: FaceBeat, ms: number): FacePose {
  const frames = beat.frames;
  if (beat.duration <= 0 || ms >= beat.duration) {
    return frames[frames.length - 1].pose;
  }
  const at = Math.max(0, ms) / beat.duration;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (at <= b.at) {
      const span = b.at - a.at;
      const x = span > 0 ? (at - a.at) / span : 1;
      return mix(a.pose, b.pose, easeAt(a.ease, x));
    }
  }
  return frames[frames.length - 1].pose;
}

// ---- The numbers -----------------------------------------------------------

/**
 * Every timing and size, with what it says. `[a, b]` is a range a beat
 * draws from each time it plays.
 */
export const MOTION = {
  /** Moving from one activity's pose to the next: the face turns to
   * what it does now. */
  turnMs: 260,
  /** Falling asleep (丙): the eyes close slowly, halfway first. */
  dozeInMs: 2200,

  /** A blink: it is alive and here. Close fast, open a little slower;
   * under 0.2s in all. */
  blink: { closeMs: [55, 75], openMs: [85, 120], lid: [0.06, 0.12] },
  /** Two blinks in a row, this far apart: a double take. */
  doubleBlinkGapMs: [70, 120],

  /** Thinking: the eyes go up and aside, as one does when thinking. */
  think: {
    pose: { gx: 0, gy: -38 },
    /** Where a wandering glance goes: up and well to either side. */
    glanceX: [60, 100],
    glanceY: [-52, -24],
    /** A small second look inside a held glance. */
    driftX: [12, 24],
    moveMs: [200, 320],
    holdMs: [700, 1600],
    /** Now and then the head tilts: turning a thought over. */
    tiltDeg: [3, 5],
    /** Pauses between these beats. */
    gapMs: [900, 2600],
  },
  /** Reading a web page: the eyes sweep a line left to right, jump back
   * and down, and read the next. */
  browse: {
    pose: { gx: -80, gy: -32 },
    lines: [2, 4],
    lineFromX: [-95, -75],
    lineToX: [75, 95],
    /** One line read across. */
    sweepMs: [520, 820],
    /** The jump back to the next line's start. */
    returnMs: [90, 130],
    /** Down a line. */
    lineStep: [20, 30],
    /** Skimming: three quick saccades across. */
    skimMs: [200, 280],
    gapMs: [300, 1100],
  },
  /** Reading a file: the eyes look down and run down the text. */
  read: {
    pose: { gx: 0, gy: 36 },
    fromY: [10, 20],
    /** Short of the mouth's top (the eyes have 78 units below them). */
    toY: [50, 60],
    driftX: [-18, 18],
    driftMs: [1100, 1700],
    flickMs: [110, 150],
    gapMs: [400, 1500],
  },
  /** Writing something down: eyes down, the head nods along, as if
   * noting each item. */
  note: {
    pose: { gx: -15, gy: 52 },
    nodY: [55, 75],
    nodDeg: [1.5, 2.5],
    nodDownMs: [120, 160],
    nodUpMs: [180, 240],
    /** The eyes following a line being written, step by step. */
    scribbleSteps: 3,
    scribbleStepMs: [140, 190],
    gapMs: [500, 1600],
  },
  /** Doing the work by hand: eyes narrowed in focus, the body bobbing
   * as it works. */
  work: {
    pose: { lid: 0.5, gy: 18 },
    bounces: [2, 4],
    bounceY: [-58, -38],
    bounceUpMs: [100, 130],
    bounceDownMs: [110, 140],
    bounceDeg: [1, 2],
    /** A shift of weight to one side. */
    shiftX: [40, 60],
    shiftHoldMs: [250, 500],
    /** Leaning into it. */
    leanDeg: [2, 3],
    gapMs: [250, 1100],
  },
  /** Writing a reply: the mouth opens and closes, syllable by syllable,
   * in bursts. */
  talk: {
    pose: {},
    syllables: [3, 7],
    /** How far a syllable closes the mouth. */
    closeTo: [0.3, 0.85],
    /** How far it opens again (0: as drawn). */
    openTo: [0, 0.18],
    closeMs: [70, 110],
    openMs: [70, 120],
    gapMs: [120, 520],
  },
  /** Waiting for a subtask: now and then a glance aside, to see if it
   * is back. */
  awaitSubtask: {
    pose: {},
    glanceX: [85, 105],
    glanceY: [-5, 10],
    moveMs: [160, 220],
    holdMs: [500, 1100],
    backMs: [240, 320],
    tiltDeg: [2, 3.5],
    gapMs: [2200, 6000],
  },
  /** 丙, at rest: a blink every 8–15 seconds (ruling 117 point 4), now
   * and then a quick look to one side — under 0.6s, so the face is still
   * nearly all the time (rule 8: moving means working). */
  idleAlive: {
    pose: {},
    lookX: [75, 100],
    lookMs: [130, 160],
    lookHoldMs: [180, 240],
    lookBackMs: [150, 180],
    gapMs: [8000, 15000],
  },
  /** 丙, dozing: eyes shut (‿ ‿), mouth half closed, head down, still;
   * now and then (as rarely as a blink) the head dips and catches
   * itself, under 0.6s. */
  doze: {
    pose: { sleep: 1, lid: 0.15, jaw: 0.5, gy: 24, y: 28, rot: -2.5 },
    dropY: [30, 45],
    dropMs: [200, 260],
    catchMs: [220, 280],
    gapMs: [8000, 15000],
  },

  /** The undercurrent while it works (rule 8): the whole head rising and
   * falling about 1px on the 72px avatar, one breath after another with
   * no pause, each its own length and height, now and then leaning a
   * hair to one side. It is what says 「busy」 when no beat plays. */
  bob: {
    upY: [-62, -44],
    swayX: [0, 12],
    ms: [1150, 1700],
    /** Settling back when the work ends. */
    settleMs: 260,
  },

  /** You sent a message: a blink and a nod — got it. */
  sent: { nodY: 60, downMs: 140, upMs: 200 },
  /** You are typing: the eyes go down to your words and stay, listening,
   * until you have stopped typing this long. */
  listen: { pose: { gx: 0, gy: 56 }, inMs: 180, holdMs: 1600, outMs: 280 },
  /** The pointer came onto it: it looks straight at you, eyes a little
   * wider, head up. */
  look: { wide: 1.12, liftY: -45, inMs: 150, holdMs: 420, outMs: 300 },
  /** Something dragged in: the eyes go wide — oh? */
  drop: { wide: 1.28, liftY: -40, inMs: 120, holdMs: 380, outMs: 300 },
  /** You pressed stop: one blink, and it stops. */
  stop: {},
  /** Done: a small hop, the eyes smiling. */
  done: {
    crouchMs: 120,
    crouchY: 22,
    jumpMs: 210,
    /** About 3px on the 72px avatar. */
    jumpY: -170,
    fallMs: 200,
    settleMs: 160,
    smileHoldMs: 450,
    smileOutMs: 200,
  },
  /** A subtask sent off: it turns its head aside to see it go, then back. */
  dispatch: {
    gazeX: 105,
    turnX: 50,
    turnDeg: 4,
    inMs: 260,
    holdMs: 420,
    outMs: 320,
  },
  /** A subtask's report woke it: from looking aside it turns back to you. */
  subtaskBack: {
    gazeX: 105,
    turnX: 50,
    turnDeg: 4,
    outMs: 120,
    backMs: 380,
    nodY: 50,
  },
  /** A reminder woke it: eyes shut, then open wide, and a hop — up! */
  wakeReminder: {
    shutMs: 40,
    shutHoldMs: 220,
    openMs: 220,
    wide: 1.18,
    hopY: -130,
    hopMs: 170,
    landMs: 190,
  },
  /** 丙: you touched it while it dozed — eyes open, head up. */
  wake: { openMs: 260, wide: 1.12, settleMs: 160 },
  /** It asks you something: the head tilts — a question — then it looks
   * straight at you and holds still. */
  askEnter: { tiltDeg: 7, inMs: 260, holdMs: 380, outMs: 320 },
  /** An error: a startled double blink and a flinch, then still. */
  errorEnter: {
    shrink: 0.92,
    flinchY: 30,
    flinchMs: 110,
    holdMs: 220,
    backMs: 260,
  },

  /** The demo: each state plays this long before the next. */
  demoStepMs: 3000,
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

/** A key of a beat under construction: at `t` ms the pose is `base`
 * with `patch` over it. */
interface Key {
  t: number;
  patch: PosePatch;
  ease?: string;
}

/**
 * Build a beat that starts from `from` (where the face is now) and ends
 * on `end` (where it stays); keys are patches over `end`, the last key
 * being the end itself. Times are cumulative ms; the curve of a key is
 * the curve into it.
 */
function build(
  name: string,
  from: FacePose,
  end: FacePose,
  keys: Key[],
): FaceBeat {
  const duration = keys.length > 0 ? keys[keys.length - 1].t : 0;
  const frames: FaceFrame[] = [{ at: 0, pose: from, ease: EASE.firm }];
  for (const key of keys) {
    frames.push({
      at: duration > 0 ? key.t / duration : 1,
      pose: { ...end, ...key.patch },
      ease: key.ease ?? EASE.firm,
    });
  }
  // A curve belongs to the segment it leads into: shift each one back a
  // frame (a frame's curve runs from it to the next).
  for (let i = 0; i < frames.length - 1; i++) {
    frames[i] = { ...frames[i], ease: frames[i + 1].ease };
  }
  frames[frames.length - 1] = { ...frames[frames.length - 1], ease: "linear" };
  return { name, duration, frames: expandSprings(frames) };
}

/** Each spring segment as out-past-and-back (SMIL curves stay in 0–1). */
function expandSprings(frames: FaceFrame[]): FaceFrame[] {
  const out: FaceFrame[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const next = frames[i + 1];
    if (!next || frame.ease !== EASE.spring) {
      out.push(frame);
      continue;
    }
    const { by, share } = SPRING_OVERSHOOT;
    out.push({ ...frame, ease: EASE.firm });
    out.push({
      at: frame.at + (next.at - frame.at) * share,
      pose: mix(frame.pose, next.pose, 1 + by),
      ease: EASE.drift,
    });
  }
  return out;
}

/** A sequence of keys built from relative steps. */
class Keys {
  readonly list: Key[] = [];
  private t = 0;
  /** After `ms`, `patch` (over the end pose). */
  to(ms: number, patch: PosePatch, ease?: string): this {
    this.t += Math.max(1, Math.round(ms));
    this.list.push({ t: this.t, patch, ease });
    return this;
  }
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
export function bobBeat(from: FacePose, rand: Rand): FaceBeat {
  const m = MOTION.bob;
  const ms = draw(rand, m.ms);
  const up = draw(rand, m.upY);
  const sway = side(rand) * draw(rand, m.swayX);
  const peak = 0.42 + 0.16 * rand();
  return build("bob", from, NEUTRAL_POSE, [
    { t: ms * peak, patch: { y: up, x: sway }, ease: EASE.drift },
    { t: ms, patch: {}, ease: EASE.drift },
  ]);
}

/** The undercurrent coming to rest at 0 from `from`. */
export function bobSettleBeat(from: FacePose): FaceBeat {
  return build("bob:settle", from, NEUTRAL_POSE, [
    { t: MOTION.bob.settleMs, patch: {}, ease: EASE.firm },
  ]);
}

/** The pose an activity holds between its beats. */
export function basePose(activity: FaceActivity): FacePose {
  switch (activity) {
    case "think":
      return { ...NEUTRAL_POSE, ...MOTION.think.pose };
    case "browse":
      return { ...NEUTRAL_POSE, ...MOTION.browse.pose };
    case "read":
      return { ...NEUTRAL_POSE, ...MOTION.read.pose };
    case "note":
      return { ...NEUTRAL_POSE, ...MOTION.note.pose };
    case "work":
      return { ...NEUTRAL_POSE, ...MOTION.work.pose };
    case "doze":
      return { ...NEUTRAL_POSE, ...MOTION.doze.pose };
    default:
      // idle, talk, awaitSubtask, ask, error: looking straight at you.
      return NEUTRAL_POSE;
  }
}

/** The listening pose (you are typing). */
export function listenPose(): FacePose {
  return { ...NEUTRAL_POSE, ...MOTION.listen.pose };
}

/** Turning from `from` to an activity's pose: `ms`, firm. Into a doze
 * the eyes close halfway first, then the rest of the way. */
export function turnBeat(
  from: FacePose,
  to: FacePose,
  activity: FaceActivity,
): FaceBeat {
  if (activity === "doze") {
    const half = MOTION.dozeInMs / 2;
    return build(`enter:${activity}`, from, to, [
      {
        t: half,
        patch: {
          lid: 0.45,
          sleep: 0,
          jaw: to.jaw / 2,
          y: to.y / 2,
          rot: to.rot / 2,
        },
        ease: EASE.drift,
      },
      { t: MOTION.dozeInMs, patch: {}, ease: EASE.drift },
    ]);
  }
  return build(`enter:${activity}`, from, to, [
    { t: MOTION.turnMs, patch: {}, ease: EASE.firm },
  ]);
}

/** Holding a pose set at once (reduced motion: the still face). */
export function stillBeat(pose: FacePose): FaceBeat {
  return {
    name: "still",
    duration: 0,
    frames: [
      { at: 0, pose, ease: "linear" },
      { at: 1, pose, ease: "linear" },
    ],
  };
}

/** A blink over `base` (its lid back to the base's). */
function blinkKeys(k: Keys, rand: Rand, base: FacePose): Keys {
  return k
    .to(
      draw(rand, MOTION.blink.closeMs),
      { lid: draw(rand, MOTION.blink.lid) * base.lid },
      EASE.fall,
    )
    .to(draw(rand, MOTION.blink.openMs), { lid: base.lid }, EASE.firm);
}

/** One of an activity's loop beats, or null when it has none (乙 at
 * rest, waiting for you, after an error). `variant` keeps a beat from
 * coming twice in a row when there is another. */
export interface LoopPick {
  beat: FaceBeat;
  variant: string;
}

interface Variant {
  name: string;
  weight: number;
  make: (rand: Rand, from: FacePose, base: FacePose) => Keys;
}

const blinkVariant = (weight: number): Variant => ({
  name: "blink",
  weight,
  make: (rand, _from, base) => blinkKeys(new Keys(), rand, base),
});

const LOOPS: Partial<Record<FaceActivity, Variant[]>> = {
  think: [
    {
      name: "glance",
      weight: 3,
      make: (rand) => {
        const m = MOTION.think;
        const s = side(rand);
        const at = { gx: s * draw(rand, m.glanceX), gy: draw(rand, m.glanceY) };
        // Held, with one small second look further along.
        const next = { gx: at.gx - s * draw(rand, m.driftX), gy: at.gy + 6 };
        return new Keys()
          .to(draw(rand, m.moveMs), at)
          .to(draw(rand, m.holdMs) / 2, at, "linear")
          .to(120, next, EASE.firm)
          .to(draw(rand, m.holdMs) / 2, next, "linear")
          .to(draw(rand, m.moveMs) + 60, {});
      },
    },
    {
      name: "tilt",
      weight: 1.5,
      make: (rand) => {
        const m = MOTION.think;
        const s = side(rand);
        return new Keys()
          .to(
            300,
            { rot: s * draw(rand, m.tiltDeg), gx: -s * 70, gy: -50 },
            EASE.spring,
          )
          .to(
            draw(rand, m.holdMs) * 0.8,
            { rot: s * draw(rand, m.tiltDeg), gx: -s * 75, gy: -52 },
            EASE.drift,
          )
          .to(350, {});
      },
    },
    {
      name: "aside",
      weight: 1,
      make: (rand) => {
        const s = side(rand);
        return new Keys()
          .to(180, { gx: s * 95, gy: -10 })
          .to(draw(rand, [400, 800]), { gx: s * 92, gy: -12 }, EASE.drift)
          .to(260, {});
      },
    },
    blinkVariant(1),
  ],
  browse: [
    {
      name: "scan",
      weight: 3,
      make: (rand, _from, base) => {
        const m = MOTION.browse;
        const k = new Keys();
        let y = base.gy;
        const lines = drawInt(rand, m.lines);
        for (let i = 0; i < lines; i++) {
          k.to(
            draw(rand, m.sweepMs),
            { gx: draw(rand, m.lineToX), gy: y + 3 },
            EASE.sweep,
          );
          y += draw(rand, m.lineStep);
          if (i < lines - 1) {
            k.to(
              draw(rand, m.returnMs),
              { gx: draw(rand, m.lineFromX), gy: y },
              EASE.firm,
            );
          }
        }
        return k.to(200, {}, EASE.firm);
      },
    },
    {
      name: "scan-blink",
      weight: 1,
      make: (rand, _from, base) => {
        const m = MOTION.browse;
        const k = new Keys()
          .to(
            draw(rand, m.sweepMs),
            { gx: draw(rand, m.lineToX), gy: base.gy + 3 },
            EASE.sweep,
          )
          .to(draw(rand, m.returnMs), {}, EASE.firm);
        return blinkKeys(k, rand, base);
      },
    },
    {
      name: "skim",
      weight: 1,
      make: (rand, _from, base) => {
        const m = MOTION.browse;
        const k = new Keys();
        for (let i = 0; i < 3; i++) {
          k.to(
            draw(rand, m.skimMs),
            { gx: i % 2 === 0 ? 85 : -60, gy: base.gy + 14 * (i + 1) },
            EASE.firm,
          );
        }
        return k.to(180, {}, EASE.firm);
      },
    },
  ],
  read: [
    {
      name: "down",
      weight: 3,
      make: (rand) => {
        const m = MOTION.read;
        return new Keys()
          .to(draw(rand, m.flickMs), {
            gy: draw(rand, m.fromY),
            gx: draw(rand, m.driftX),
          })
          .to(
            draw(rand, m.driftMs),
            { gy: draw(rand, m.toY), gx: draw(rand, m.driftX) },
            EASE.drift,
          )
          .to(draw(rand, m.flickMs) + 30, {}, EASE.firm);
      },
    },
    {
      name: "turn",
      weight: 1,
      make: (rand) =>
        new Keys()
          .to(120, { gy: -8, gx: draw(rand, MOTION.read.driftX) })
          .to(200, { y: 40 }, EASE.firm)
          .to(260, {}, EASE.firm),
    },
    blinkVariant(1),
  ],
  note: [
    {
      name: "nod",
      weight: 2,
      make: (rand) => {
        const m = MOTION.note;
        return new Keys()
          .to(
            draw(rand, m.nodDownMs),
            { y: draw(rand, m.nodY), rot: draw(rand, m.nodDeg) },
            EASE.firm,
          )
          .to(draw(rand, m.nodUpMs), {}, EASE.spring);
      },
    },
    {
      name: "double-nod",
      weight: 2,
      make: (rand) => {
        const m = MOTION.note;
        return new Keys()
          .to(
            draw(rand, m.nodDownMs),
            { y: draw(rand, m.nodY), rot: draw(rand, m.nodDeg) },
            EASE.firm,
          )
          .to(draw(rand, m.nodUpMs) * 0.7, { y: 4 }, EASE.firm)
          .to(
            draw(rand, m.nodDownMs),
            { y: draw(rand, m.nodY) * 0.8, rot: draw(rand, m.nodDeg) },
            EASE.firm,
          )
          .to(draw(rand, m.nodUpMs), {}, EASE.spring);
      },
    },
    {
      name: "scribble",
      weight: 1.5,
      make: (rand, _from, base) => {
        const m = MOTION.note;
        const k = new Keys();
        for (let i = 1; i <= m.scribbleSteps; i++) {
          k.to(
            draw(rand, m.scribbleStepMs),
            { gx: base.gx + i * 22, gy: base.gy + (i % 2) * 4 },
            EASE.firm,
          );
        }
        return k
          .to(150, { y: draw(rand, m.nodY) * 0.7 }, EASE.firm)
          .to(220, {}, EASE.spring);
      },
    },
    blinkVariant(0.7),
  ],
  work: [
    {
      name: "bob",
      weight: 3,
      make: (rand) => {
        const m = MOTION.work;
        const k = new Keys();
        const n = drawInt(rand, m.bounces);
        const s = side(rand);
        for (let i = 0; i < n; i++) {
          k.to(
            draw(rand, m.bounceUpMs),
            {
              y: draw(rand, m.bounceY),
              rot: (i % 2 === 0 ? s : -s) * draw(rand, m.bounceDeg),
            },
            EASE.firm,
          );
          k.to(draw(rand, m.bounceDownMs), {}, EASE.fall);
        }
        return k;
      },
    },
    {
      name: "shift",
      weight: 1,
      make: (rand) => {
        const m = MOTION.work;
        const s = side(rand);
        return new Keys()
          .to(160, { x: s * draw(rand, m.shiftX), gx: s * 40 })
          .to(
            draw(rand, m.shiftHoldMs),
            { x: s * draw(rand, m.shiftX), gx: s * 45 },
            EASE.drift,
          )
          .to(200, {});
      },
    },
    {
      name: "lean",
      weight: 0.8,
      make: (rand) => {
        const m = MOTION.work;
        const s = side(rand);
        return new Keys()
          .to(
            220,
            { rot: s * draw(rand, m.leanDeg), gx: s * 30, y: 20 },
            EASE.firm,
          )
          .to(
            draw(rand, [300, 600]),
            { rot: s * draw(rand, m.leanDeg) },
            EASE.drift,
          )
          .to(240, {}, EASE.spring);
      },
    },
    blinkVariant(1),
  ],
  talk: [
    {
      name: "burst",
      weight: 4,
      make: (rand) => talkKeys(new Keys(), rand),
    },
    {
      name: "burst-nod",
      weight: 1,
      make: (rand) =>
        talkKeys(new Keys(), rand)
          .to(120, { y: 45 }, EASE.firm)
          .to(180, {}, EASE.spring),
    },
    {
      name: "burst-blink",
      weight: 1,
      make: (rand, _from, base) =>
        blinkKeys(talkKeys(new Keys(), rand), rand, base),
    },
  ],
  awaitSubtask: [
    {
      name: "glance",
      weight: 3,
      make: (rand) => {
        const m = MOTION.awaitSubtask;
        // Mostly the way the dispatch looked (right).
        const s = rand() < 0.7 ? 1 : -1;
        return new Keys()
          .to(draw(rand, m.moveMs), {
            gx: s * draw(rand, m.glanceX),
            gy: draw(rand, m.glanceY),
          })
          .to(
            draw(rand, m.holdMs),
            { gx: s * draw(rand, m.glanceX) },
            EASE.drift,
          )
          .to(draw(rand, m.backMs), {});
      },
    },
    {
      name: "glance-tilt",
      weight: 1,
      make: (rand) => {
        const m = MOTION.awaitSubtask;
        const s = rand() < 0.7 ? 1 : -1;
        return new Keys()
          .to(draw(rand, m.moveMs) + 40, {
            gx: s * draw(rand, m.glanceX),
            rot: s * draw(rand, m.tiltDeg),
          })
          .to(
            draw(rand, m.holdMs),
            { gx: s * draw(rand, m.glanceX), rot: s * draw(rand, m.tiltDeg) },
            EASE.drift,
          )
          .to(draw(rand, m.backMs) + 40, {}, EASE.spring);
      },
    },
    blinkVariant(1),
  ],
  doze: [
    {
      name: "nod-off",
      weight: 1,
      make: (rand, _from, base) => {
        const m = MOTION.doze;
        return new Keys()
          .to(
            draw(rand, m.dropMs),
            { y: base.y + draw(rand, m.dropY), rot: base.rot - 1.5 },
            EASE.fall,
          )
          .to(draw(rand, m.catchMs), {}, EASE.firm);
      },
    },
  ],
};

/** 丙's life at rest: a blink, now and then a quick look to one side. */
const IDLE_ALIVE: Variant[] = [
  blinkVariant(5),
  {
    name: "look",
    weight: 1.2,
    make: (rand) => {
      const m = MOTION.idleAlive;
      const at = { gx: side(rand) * draw(rand, m.lookX), gy: -6 };
      return new Keys()
        .to(draw(rand, m.lookMs), at)
        .to(draw(rand, m.lookHoldMs), at, "linear")
        .to(draw(rand, m.lookBackMs), {});
    },
  },
];

function talkKeys(k: Keys, rand: Rand): Keys {
  const m = MOTION.talk;
  const n = drawInt(rand, m.syllables);
  for (let i = 0; i < n; i++) {
    k.to(draw(rand, m.closeMs), { jaw: draw(rand, m.closeTo) }, EASE.firm);
    k.to(
      draw(rand, m.openMs),
      { jaw: i === n - 1 ? 0 : draw(rand, m.openTo) },
      EASE.firm,
    );
  }
  return k;
}

/** Whether an activity has beats between its pauses: 乙 holds still at
 * rest, and while it waits for you or after an error; 丙 lives at rest. */
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

/** The variants an activity draws from (丙's at rest included). */
export function loopVariants(activity: FaceActivity): string[] {
  const list = activity === "idle" ? IDLE_ALIVE : (LOOPS[activity] ?? []);
  return list.map((v) => v.name);
}

/**
 * The next beat of an activity, from `from` back to its pose: a
 * weighted draw among its variants, never the variant it played last
 * (`previous`) when there is another; the variant's sizes and timings
 * are drawn too.
 */
export function loopBeat(
  activity: FaceActivity,
  from: FacePose,
  rand: Rand,
  previous: string | null,
): LoopPick | null {
  const list = activity === "idle" ? IDLE_ALIVE : LOOPS[activity];
  if (!list || list.length === 0) return null;
  const pool = list.length > 1 ? list.filter((v) => v.name !== previous) : list;
  const total = pool.reduce((sum, v) => sum + v.weight, 0);
  let r = rand() * total;
  let chosen = pool[pool.length - 1];
  for (const v of pool) {
    if (r < v.weight) {
      chosen = v;
      break;
    }
    r -= v.weight;
  }
  const base = basePose(activity);
  const keys = chosen.make(rand, from, base).list;
  return {
    beat: build(`${activity}:${chosen.name}`, from, base, keys),
    variant: chosen.name,
  };
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
  const k = new Keys();
  switch (reaction) {
    case "sent": {
      const m = MOTION.sent;
      blinkKeys(k, rand, end);
      k.to(m.downMs, { y: end.y + m.nodY }, EASE.firm).to(
        m.upMs,
        {},
        EASE.spring,
      );
      break;
    }
    case "listen":
      k.to(MOTION.listen.inMs, {}, EASE.firm);
      break;
    case "look": {
      const m = MOTION.look;
      const at: PosePatch = {
        gx: 0,
        gy: 0,
        lid: 1,
        wide: m.wide,
        smile: 0,
        y: m.liftY,
        rot: 0,
      };
      k.to(m.inMs, at, EASE.pop)
        .to(m.holdMs, at, "linear")
        .to(m.outMs, {}, EASE.firm);
      break;
    }
    case "drop": {
      const m = MOTION.drop;
      const at: PosePatch = { gx: 0, gy: -8, lid: 1, wide: m.wide, y: m.liftY };
      k.to(m.inMs, at, EASE.spring)
        .to(m.holdMs, at, "linear")
        .to(m.outMs, {}, EASE.firm);
      break;
    }
    case "stop":
      blinkKeys(k, rand, end);
      break;
    case "done": {
      const m = MOTION.done;
      k.to(
        m.crouchMs,
        { y: m.crouchY, sy: 0.94, sx: 1.03, smile: 1 },
        EASE.firm,
      )
        .to(m.jumpMs, { y: m.jumpY, sy: 1.04, sx: 0.97, smile: 1 }, EASE.pop)
        .to(m.fallMs, { y: 0, sy: 0.95, sx: 1.03, smile: 1 }, EASE.fall)
        .to(m.settleMs, { smile: 1 }, EASE.spring)
        .to(m.smileHoldMs, { smile: 1 }, "linear")
        .to(m.smileOutMs, {}, EASE.firm);
      break;
    }
    case "dispatch": {
      const m = MOTION.dispatch;
      const turned: PosePatch = {
        gx: m.gazeX,
        gy: 0,
        x: m.turnX,
        rot: m.turnDeg,
      };
      k.to(m.inMs, turned, EASE.firm)
        .to(m.holdMs, { ...turned, gx: m.gazeX + 4 }, EASE.drift)
        .to(m.outMs, {}, EASE.spring);
      break;
    }
    case "subtaskBack": {
      const m = MOTION.subtaskBack;
      k.to(
        m.outMs,
        { gx: m.gazeX, gy: 0, x: m.turnX, rot: m.turnDeg },
        EASE.firm,
      )
        .to(m.backMs, { gx: 0, gy: 0, x: 0, rot: 0 }, EASE.spring)
        .to(130, { y: m.nodY }, EASE.firm)
        .to(170, {}, EASE.spring);
      break;
    }
    case "wakeReminder": {
      const m = MOTION.wakeReminder;
      k.to(m.shutMs, { lid: 0.1, gx: 0, gy: 10 }, "linear")
        .to(m.shutHoldMs, { lid: 0.1, gx: 0, gy: 10 }, "linear")
        .to(m.openMs, { lid: m.wide, wide: m.wide, gx: 0, gy: 0 }, EASE.pop)
        .to(m.hopMs, { y: m.hopY, wide: 1.05 }, EASE.pop)
        .to(m.landMs, {}, EASE.fall);
      break;
    }
    case "wake": {
      const m = MOTION.wake;
      // The sleeping eyes give way to shut round ones, which open wide.
      k.to(
        120,
        {
          sleep: 0,
          lid: 0.15,
          gx: from.gx,
          gy: from.gy,
          y: from.y,
          rot: from.rot,
          jaw: from.jaw,
        },
        EASE.firm,
      )
        .to(
          m.openMs,
          { lid: m.wide, wide: m.wide, gx: 0, gy: 0, y: 0, rot: 0 },
          EASE.pop,
        )
        .to(m.settleMs, {}, EASE.firm);
      blinkKeys(k, rand, end);
      break;
    }
    case "askEnter": {
      const m = MOTION.askEnter;
      const s = side(rand);
      k.to(m.inMs, { rot: s * m.tiltDeg, gx: 0, gy: 0 }, EASE.spring)
        .to(m.holdMs, { rot: s * m.tiltDeg }, "linear")
        .to(m.outMs, {}, EASE.firm);
      break;
    }
    case "errorEnter": {
      const m = MOTION.errorEnter;
      blinkKeys(k, rand, end);
      k.to(draw(rand, MOTION.doubleBlinkGapMs), {}, EASE.firm);
      blinkKeys(k, rand, end);
      k.to(m.flinchMs, { sx: m.shrink, sy: m.shrink, y: m.flinchY }, EASE.firm)
        .to(m.holdMs, { sx: m.shrink, sy: m.shrink, y: m.flinchY }, "linear")
        .to(m.backMs, {}, EASE.firm);
      break;
    }
  }
  return build(reaction, from, end, k.list);
}
