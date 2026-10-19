import type { FaceActivity, FaceReaction } from "@/lib/assistant-face";
import {
  basePose,
  bobBeat,
  bobSettleBeat,
  type FaceBeat,
  type FacePose,
  hasLoop,
  listenPose,
  loopBeat,
  loopGap,
  MOTION,
  NEUTRAL_POSE,
  poseAt,
  reactionBeat,
  samePose,
  stillBeat,
  turnBeat,
  WORKING,
} from "@/lib/assistant-face-motion";

/**
 * When the assistant's face plays what (ticket 65): one director for
 * both avatars — the sidebar card's and the header's 28px — so they play
 * the same beat at the same time (`onBeat` goes to one store both read).
 *
 *   - An activity (lib/assistant-face.ts) turns the face to its pose,
 *     then plays its beats with random pauses between them
 *     (lib/assistant-face-motion.ts `loopBeat`, `loopGap`).
 *   - A reaction cuts in at once, plays, and hands back to the activity
 *     — its pose, then its beats (ruling 117: a one-off plays out and
 *     the face returns to what lasts). Typing (`listen`) holds the
 *     listening pose until you have stopped for a moment.
 *   - Paused (`setActive(false)`: the window is not in front, or no
 *     avatar is on screen) it starts nothing new; the beat under way
 *     finishes and the face holds its pose.
 *   - Still (`setStill(true)`: the system's reduced motion) it sets the
 *     face as drawn and plays nothing.
 *   - 乙 (`alive` false) holds still at rest; 丙 blinks and looks around.
 *   - While it works, a second channel (`onBob`) plays the undercurrent:
 *     one breath of the head after another with no pause, under whatever
 *     the beats do (ruling 117 point 8: busy must read at a glance). It
 *     stops with the work (settling back), pauses with the director and
 *     is off when still.
 *
 * Time and chance come in from outside (`clock`, `random`), so a test
 * drives it without waiting.
 */

export interface FaceClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const REAL_CLOCK: FaceClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

export interface FaceDirectorOptions {
  clock: FaceClock;
  random: () => number;
  /** A beat to play now, ending on its last frame's pose. */
  onBeat: (beat: FaceBeat) => void;
  /** A breath of the undercurrent to play now (its `x`, `y`). */
  onBob?: (beat: FaceBeat) => void;
}

type Phase =
  /** Nothing is playing; the face holds its pose. */
  | "rest"
  /** A beat plays until the timer. */
  | "beat"
  /** Waiting to play the activity's next beat. */
  | "gap"
  /** Holding the listening pose. */
  | "listen";

export class FaceDirector {
  private readonly clock: FaceClock;
  private readonly random: () => number;
  private readonly onBeat: (beat: FaceBeat) => void;
  private readonly onBob: (beat: FaceBeat) => void;

  private activity: FaceActivity = "idle";
  private alive = false;
  private active = true;
  private still = false;
  /** Where the last beat ends. */
  private pose: FacePose = NEUTRAL_POSE;
  /** The beat under way and when it began, to cut in from where the
   * face really is. */
  private playing: { beat: FaceBeat; at: number } | null = null;
  private phase: Phase = "rest";
  /** The beat playing is a reaction (it hands back when it ends). */
  private reacting = false;
  private timer: unknown = null;
  private lastVariant: string | null = null;
  private listenUntil = 0;
  /** The undercurrent: on, the breath under way, the next one's timer. */
  private bobbing = false;
  private bob: { beat: FaceBeat; at: number } | null = null;
  private bobTimer: unknown = null;

  constructor(options: FaceDirectorOptions) {
    this.clock = options.clock;
    this.random = options.random;
    this.onBeat = options.onBeat;
    this.onBob = options.onBob ?? (() => {});
  }

  /** The activity it plays (for the demo label and tests). */
  get currentActivity(): FaceActivity {
    return this.activity;
  }

  /** 丙: the face lives at rest. */
  setAlive(alive: boolean): void {
    if (alive === this.alive) return;
    this.alive = alive;
    if (this.activity === "idle" && this.phase === "rest") this.scheduleLoop();
    if (this.activity === "idle" && !alive && this.phase === "gap") {
      this.clear();
      this.phase = "rest";
    }
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.updateBob();
    if (!active) {
      // The beat under way finishes; nothing new starts.
      if (this.phase === "gap") {
        this.clear();
        this.phase = "rest";
      }
      return;
    }
    if (this.phase === "rest") this.settle();
  }

  setStill(still: boolean): void {
    if (still === this.still) return;
    this.still = still;
    this.clear();
    this.reacting = false;
    this.updateBob();
    if (still) {
      this.pose = NEUTRAL_POSE;
      this.playing = null;
      this.phase = "rest";
      this.onBeat(stillBeat(NEUTRAL_POSE));
      return;
    }
    this.phase = "rest";
    this.settle();
  }

  setActivity(activity: FaceActivity): void {
    if (activity === this.activity) return;
    this.activity = activity;
    this.updateBob();
    if (this.still) return;
    // A reaction or the listening pose plays out first; it hands back to
    // the new activity when it ends.
    if ((this.phase === "beat" && this.reacting) || this.phase === "listen") {
      return;
    }
    const from = this.where();
    this.clear();
    this.phase = "rest";
    this.pose = from;
    this.settle();
  }

  react(reaction: FaceReaction): void {
    if (this.still) return;
    // Nobody sees a reaction in a window behind others or off screen,
    // and a late one would play for something long past. Waking is
    // the exception: the face must open its eyes either way.
    if (!this.active && reaction !== "wake") return;
    if (reaction === "listen") {
      this.listen();
      return;
    }
    const from = this.where();
    this.clear();
    const end = basePose(this.activity);
    this.play(reactionBeat(reaction, from, end, this.random), true);
  }

  dispose(): void {
    this.clear();
    this.clearBob();
  }

  // ---- the undercurrent --------------------------------------------------

  private updateBob(): void {
    const should = WORKING.has(this.activity) && this.active && !this.still;
    if (should === this.bobbing) return;
    this.bobbing = should;
    this.clearBob();
    if (should) {
      this.breathe();
      return;
    }
    if (this.still) {
      this.bob = null;
      this.onBob(stillBeat(NEUTRAL_POSE));
      return;
    }
    // Paused: the breath under way ends at rest by itself. The work
    // ended: settle from wherever the head is in its breath.
    if (!this.active || !this.bob) return;
    const { beat, at } = this.bob;
    if (this.clock.now() - at >= beat.duration) return;
    const settle = bobSettleBeat(poseAt(beat, this.clock.now() - at));
    this.bob = { beat: settle, at: this.clock.now() };
    this.onBob(settle);
  }

  private breathe(): void {
    const from =
      this.bob && this.clock.now() - this.bob.at < this.bob.beat.duration
        ? poseAt(this.bob.beat, this.clock.now() - this.bob.at)
        : NEUTRAL_POSE;
    const beat = bobBeat(from, this.random);
    this.bob = { beat, at: this.clock.now() };
    this.onBob(beat);
    this.bobTimer = this.clock.setTimeout(() => {
      this.bobTimer = null;
      if (this.bobbing) this.breathe();
    }, beat.duration);
  }

  private clearBob(): void {
    if (this.bobTimer !== null) {
      this.clock.clearTimeout(this.bobTimer);
      this.bobTimer = null;
    }
  }

  // ---- inside ----------------------------------------------------------

  private listen(): void {
    this.listenUntil = this.clock.now() + MOTION.listen.holdMs;
    if (this.phase === "listen") return;
    const from = this.where();
    this.clear();
    const beat = reactionBeat("listen", from, listenPose(), this.random);
    this.reacting = true;
    this.phase = "listen";
    this.pose = beat.frames[beat.frames.length - 1].pose;
    this.playing = { beat, at: this.clock.now() };
    this.onBeat(beat);
    this.waitListen();
  }

  private waitListen(): void {
    const left = this.listenUntil - this.clock.now();
    this.timer = this.clock.setTimeout(
      () => {
        this.timer = null;
        if (this.clock.now() < this.listenUntil) {
          this.waitListen();
          return;
        }
        this.reacting = false;
        this.phase = "rest";
        this.settle(MOTION.listen.outMs);
      },
      Math.max(left, MOTION.listen.inMs),
    );
  }

  private play(beat: FaceBeat, reaction: boolean): void {
    this.reacting = reaction;
    this.phase = "beat";
    this.pose = beat.frames[beat.frames.length - 1].pose;
    this.playing = { beat, at: this.clock.now() };
    this.onBeat(beat);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.reacting = false;
      this.phase = "rest";
      this.settle();
    }, beat.duration);
  }

  /** At rest between beats: turn to the activity's pose if the face is
   * elsewhere, else wait for the activity's next beat. */
  private settle(turnMs?: number): void {
    if (this.still) return;
    const base = basePose(this.activity);
    if (!samePose(this.pose, base)) {
      const beat = turnBeat(this.pose, base, this.activity);
      if (turnMs !== undefined && this.activity !== "doze") {
        beat.duration = turnMs;
      }
      this.play(beat, false);
      return;
    }
    this.scheduleLoop();
  }

  private scheduleLoop(): void {
    if (this.still || !this.active) return;
    if (!hasLoop(this.activity, this.alive)) return;
    this.clear();
    this.phase = "gap";
    const activity = this.activity;
    this.timer = this.clock.setTimeout(
      () => {
        this.timer = null;
        if (activity !== this.activity || !this.active) {
          this.phase = "rest";
          return;
        }
        const pick = loopBeat(
          activity,
          this.pose,
          this.random,
          this.lastVariant,
        );
        if (!pick) {
          this.phase = "rest";
          return;
        }
        this.lastVariant = pick.variant;
        this.play(pick.beat, false);
      },
      loopGap(activity, this.random),
    );
  }

  /** Where the face is now: inside the beat under way, or where the
   * last one ended. */
  private where(): FacePose {
    if (!this.playing) return this.pose;
    const { beat, at } = this.playing;
    return poseAt(beat, this.clock.now() - at);
  }

  private clear(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
