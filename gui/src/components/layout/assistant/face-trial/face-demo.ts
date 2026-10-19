/*
 * TEMPORARY — 票 65 临时切换器，定档后由拆除票删掉 (see face-trial.ts).
 *
 * The trial's demo (ticket 65 §4): every state of 乙's table in turn,
 * about three seconds each — the ones that last and the ones that play
 * once — and 丙's dozing; or one of them pinned, played again and again.
 * It only changes what the face shows: it feeds the director made-up
 * activities and reactions and touches no data.
 */
import type { FaceActivity, FaceReaction } from "@/lib/assistant-face";
import type { FaceClock, FaceDirector } from "@/lib/assistant-face-director";
import { MOTION } from "@/lib/assistant-face-motion";

export interface FaceDemoItem {
  id: string;
  /** The pill's words for it. */
  label: string;
  /** What lasts while it plays. */
  activity: FaceActivity;
  /** What plays once at its start (after `before`, if any). */
  reaction?: FaceReaction;
  /** The activity it starts from, for a reaction that needs one (a
   * reminder wakes it from dozing, stop cuts into work). */
  before?: FaceActivity;
  /** Typing: the reaction again every this many ms through the step. */
  repeatMs?: number;
  /** Only 丙's: in the rotation when 丙 is picked (pinned, it plays
   * either way). */
  aliveOnly?: boolean;
  /** Longer than the usual step: falling asleep comes first. */
  stepMs?: number;
  /** Activities in turn through the step, each this long (ms). */
  sequence?: readonly { activity: FaceActivity; ms: number }[];
}

/** A step that first falls asleep (`before: "doze"`). */
const AFTER_DOZE_STEP_MS = 5000;

export const FACE_DEMO_ITEMS: readonly FaceDemoItem[] = [
  { id: "think", label: "在想", activity: "think" },
  { id: "browse", label: "看网页", activity: "browse" },
  { id: "read", label: "读文件", activity: "read" },
  { id: "note", label: "记（写文件、记待办、设提醒）", activity: "note" },
  { id: "work", label: "动手（跑代码）", activity: "work" },
  {
    id: "dispatch",
    label: "派出子任务",
    activity: "awaitSubtask",
    reaction: "dispatch",
  },
  { id: "await", label: "等子任务回来", activity: "awaitSubtask" },
  { id: "talk", label: "写回复", activity: "talk" },
  { id: "sent", label: "你发出消息", activity: "idle", reaction: "sent" },
  {
    id: "listen",
    label: "你在输入框打字",
    activity: "idle",
    reaction: "listen",
    repeatMs: 300,
  },
  { id: "look", label: "鼠标移到它身上", activity: "idle", reaction: "look" },
  { id: "drop", label: "拖进文件或图片", activity: "idle", reaction: "drop" },
  {
    id: "stop",
    label: "你按停止",
    activity: "idle",
    reaction: "stop",
    before: "work",
  },
  { id: "done", label: "做完", activity: "idle", reaction: "done" },
  { id: "ask", label: "等你回复", activity: "ask", reaction: "askEnter" },
  { id: "error", label: "出错", activity: "error", reaction: "errorEnter" },
  {
    id: "reminder",
    label: "提醒到点叫醒它",
    activity: "think",
    reaction: "wakeReminder",
    before: "doze",
    stepMs: AFTER_DOZE_STEP_MS,
  },
  {
    id: "back",
    label: "子任务交回来",
    activity: "think",
    reaction: "subtaskBack",
  },
  {
    // Ruling 117 point 8: a round Core woke it for says the last message
    // on the card's second line while it looks things up; only the face
    // says it is busy. The demo leaves the line alone, so this is how it
    // looks at a glance.
    id: "woken-busy",
    label: "叫醒后在做事（第二行照旧是最后一句）",
    activity: "think",
    stepMs: 6000,
    sequence: [
      { activity: "think", ms: 1200 },
      { activity: "browse", ms: 2600 },
      { activity: "read", ms: 2200 },
    ],
  },
  {
    id: "alive",
    label: "丙 · 没事时（眨眼、左右看）",
    activity: "idle",
    aliveOnly: true,
  },
  { id: "doze", label: "丙 · 打盹", activity: "doze", aliveOnly: true },
  {
    id: "wake",
    label: "丙 · 一碰就醒",
    activity: "idle",
    reaction: "wake",
    before: "doze",
    aliveOnly: true,
    stepMs: AFTER_DOZE_STEP_MS,
  },
];

/**
 * Plays the demo on a director: `start(pinned)` steps through the items
 * (or repeats one), `stop()` ends it. `onItem` reports what plays, for
 * the pill.
 */
export class FaceDemo {
  private timer: unknown = null;
  private repeat: unknown = null;
  private index = 0;

  constructor(
    private readonly director: FaceDirector,
    private readonly clock: FaceClock,
    private readonly onItem: (item: FaceDemoItem | null) => void,
  ) {}

  start(pinned: string | null, alive: boolean): void {
    this.stop();
    const items = pinned
      ? FACE_DEMO_ITEMS.filter((item) => item.id === pinned)
      : FACE_DEMO_ITEMS.filter((item) => alive || !item.aliveOnly);
    if (items.length === 0) return;
    this.index = 0;
    this.step(items);
  }

  stop(): void {
    for (const handle of [this.timer, this.repeat]) {
      if (handle !== null) this.clock.clearTimeout(handle);
    }
    this.timer = null;
    this.repeat = null;
    this.onItem(null);
  }

  private step(items: readonly FaceDemoItem[]): void {
    const item = items[this.index % items.length];
    this.index += 1;
    this.onItem(item);
    this.play(item);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      if (this.repeat !== null) this.clock.clearTimeout(this.repeat);
      this.repeat = null;
      this.step(items);
    }, item.stepMs ?? MOTION.demoStepMs);
  }

  private play(item: FaceDemoItem): void {
    const d = this.director;
    if (item.before) {
      // Start from where the reaction needs the face: set the activity
      // and let it settle a moment, then react.
      d.setActivity(item.before);
      this.repeat = this.clock.setTimeout(
        () => {
          this.repeat = null;
          d.setActivity(item.activity);
          if (item.reaction) d.react(item.reaction);
        },
        item.before === "doze" ? MOTION.dozeInMs + 300 : 700,
      );
      return;
    }
    if (item.sequence) {
      const steps = item.sequence;
      d.setActivity(steps[0].activity);
      const next = (i: number) => {
        if (i >= steps.length) return;
        this.repeat = this.clock.setTimeout(
          () => {
            d.setActivity(steps[i].activity);
            next(i + 1);
          },
          steps[i - 1].ms,
        );
      };
      next(1);
      return;
    }
    d.setActivity(item.activity);
    if (!item.reaction) return;
    d.react(item.reaction);
    if (item.repeatMs) {
      const again = () => {
        d.react(item.reaction!);
        this.repeat = this.clock.setTimeout(again, item.repeatMs!);
      };
      this.repeat = this.clock.setTimeout(again, item.repeatMs);
    }
  }
}
