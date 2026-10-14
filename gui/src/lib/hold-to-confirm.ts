/**
 * Hold to confirm: the confirmation for an action that cannot be taken
 * back (resetting the main chat, main chat ticket 15, PRD ruling 59).
 * The button has to be held down for {@link HOLD_TO_CONFIRM_MS}; letting
 * go, leaving the button, the window losing focus or Esc stop it.
 *
 * Mouse only, on purpose: Galley is mouse first
 * (docs/design/layout-and-chrome.md 「交互输入模型：鼠标优先」), so typing a
 * word to confirm would send the hand to the keyboard, and no key —
 * Enter, Space — confirms (a reflexive Enter must never fire it). A
 * slip lasts a second or two; the rest of the hold is time to change
 * one's mind just by letting go.
 *
 * This is the clock and the rules, without the DOM: an external store
 * (`useSyncExternalStore`) that the button feeds pointer events into.
 * Completion is judged by timestamps, not by the fill animation.
 */

/** How long the button must be held. */
export const HOLD_TO_CONFIRM_MS = 5_000;

export interface HoldSnapshot {
  /** Held down, filling. */
  holding: boolean;
  /** Let go before the end: say 「要按住不放」 until the next press. */
  tooShort: boolean;
}

const IDLE: HoldSnapshot = { holding: false, tooShort: false };
const HOLDING: HoldSnapshot = { holding: true, tooShort: false };
const TOO_SHORT: HoldSnapshot = { holding: false, tooShort: true };

export class HoldToConfirm {
  private startedAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private enabled = true;
  private snapshot: HoldSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private onConfirm: (() => void) | null = null;
  private readonly durationMs: number;
  private readonly now: () => number;

  constructor(
    durationMs: number = HOLD_TO_CONFIRM_MS,
    now: () => number = () => Date.now(),
  ) {
    this.durationMs = durationMs;
    this.now = now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): HoldSnapshot => this.snapshot;

  /** What a completed hold calls, once per hold. */
  setOnConfirm(onConfirm: (() => void) | null): void {
    this.onConfirm = onConfirm;
  }

  /** Disabled (busy, a conversation running): a hold in progress
   * stops, and no new one starts until enabled again. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  /** The button went down (primary button only — the caller checks). */
  press(): void {
    if (!this.enabled || this.startedAt !== null) return;
    this.startedAt = this.now();
    this.arm(this.durationMs);
    this.publish(HOLDING);
  }

  /** The button came up: confirmed if it was held long enough, else
   * stopped with the hint. */
  release(): void {
    if (this.startedAt === null) return;
    if (this.now() - this.startedAt >= this.durationMs) {
      this.complete();
    } else {
      this.stop(TOO_SHORT);
    }
  }

  /** Stopped without letting go (left the button, the window lost
   * focus, Esc, disabled): no hint. */
  cancel(): void {
    if (this.startedAt === null) return;
    this.stop(IDLE);
  }

  /** The owner is going away: stop any hold, confirm nothing. */
  dispose(): void {
    this.cancel();
  }

  private arm(ms: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.onTimer(), ms);
  }

  private onTimer(): void {
    this.timer = null;
    if (this.startedAt === null) return;
    const left = this.durationMs - (this.now() - this.startedAt);
    if (left > 0) {
      // A timer can fire early by a clock's rounding; the timestamps
      // decide.
      this.arm(left);
      return;
    }
    this.complete();
  }

  private complete(): void {
    // Confirm first, so the caller's busy state lands in the same
    // render as the end of the hold (the fill stays full, no flicker).
    try {
      this.onConfirm?.();
    } finally {
      this.stop(IDLE);
    }
  }

  private stop(next: HoldSnapshot): void {
    this.clearTimer();
    this.startedAt = null;
    this.publish(next);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private publish(next: HoldSnapshot): void {
    if (next === this.snapshot) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

/**
 * The hold button's event handlers: pointer events only. No click
 * handler and no key handler, so Enter and Space — which only click a
 * button — do nothing; no pointer capture, so leaving the button lets
 * go. Only the primary button presses.
 */
export function holdPointerHandlers(hold: HoldToConfirm) {
  return {
    onPointerDown: (event: { button: number }) => {
      if (event.button === 0) hold.press();
    },
    onPointerUp: () => hold.release(),
    onPointerLeave: () => hold.cancel(),
    onPointerCancel: () => hold.cancel(),
  };
}

/** What a key does to a hold: Esc stops it; nothing confirms. */
export function holdKeyAction(key: string): "cancel" | null {
  return key === "Escape" ? "cancel" : null;
}
