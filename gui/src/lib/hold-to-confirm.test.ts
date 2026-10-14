import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOLD_TO_CONFIRM_MS,
  HoldToConfirm,
  holdKeyAction,
  holdPointerHandlers,
} from "./hold-to-confirm";

/**
 * Hold to confirm (main chat ticket 15): five seconds held down
 * confirms, once; letting go early, leaving, Esc or a disable stop it;
 * no key confirms. Fake timers drive both the timer and `Date.now`.
 */

let confirmed: number;
let hold: HoldToConfirm;

beforeEach(() => {
  vi.useFakeTimers();
  confirmed = 0;
  hold = new HoldToConfirm();
  hold.setOnConfirm(() => {
    confirmed += 1;
  });
});

afterEach(() => {
  hold.dispose();
  vi.useRealTimers();
});

describe("HoldToConfirm", () => {
  it("is five seconds", () => {
    expect(HOLD_TO_CONFIRM_MS).toBe(5_000);
  });

  it("confirms once, five seconds after the press, while still held", () => {
    hold.press();
    expect(hold.getSnapshot()).toEqual({ holding: true, tooShort: false });

    vi.advanceTimersByTime(HOLD_TO_CONFIRM_MS - 1);
    expect(confirmed).toBe(0);
    vi.advanceTimersByTime(1);
    expect(confirmed).toBe(1);
    expect(hold.getSnapshot()).toEqual({ holding: false, tooShort: false });

    // Letting go afterwards, or waiting longer, confirms nothing more.
    hold.release();
    vi.advanceTimersByTime(HOLD_TO_CONFIRM_MS * 2);
    expect(confirmed).toBe(1);
  });

  it("letting go before five seconds confirms nothing and says to hold", () => {
    hold.press();
    vi.advanceTimersByTime(2_000);
    hold.release();

    expect(confirmed).toBe(0);
    expect(hold.getSnapshot()).toEqual({ holding: false, tooShort: true });
    vi.advanceTimersByTime(HOLD_TO_CONFIRM_MS * 2);
    expect(confirmed).toBe(0);

    // The next press takes the hint away and starts over from zero.
    hold.press();
    expect(hold.getSnapshot()).toEqual({ holding: true, tooShort: false });
    vi.advanceTimersByTime(HOLD_TO_CONFIRM_MS - 1);
    expect(confirmed).toBe(0);
    vi.advanceTimersByTime(1);
    expect(confirmed).toBe(1);
  });

  it("a click (press and release at once) only says to hold", () => {
    hold.press();
    hold.release();
    expect(confirmed).toBe(0);
    expect(hold.getSnapshot().tooShort).toBe(true);
  });

  it("leaving the button, the window losing focus or Esc stop it, without the hint", () => {
    hold.press();
    vi.advanceTimersByTime(4_900);
    hold.cancel();

    expect(hold.getSnapshot()).toEqual({ holding: false, tooShort: false });
    vi.advanceTimersByTime(HOLD_TO_CONFIRM_MS * 2);
    expect(confirmed).toBe(0);
    // A release after leaving changes nothing.
    hold.release();
    expect(hold.getSnapshot().tooShort).toBe(false);
  });

  it("a cancel keeps an earlier hint", () => {
    hold.press();
    hold.release();
    hold.cancel();
    expect(hold.getSnapshot().tooShort).toBe(true);
  });

  it("disabled mid-hold, it stops and cannot start again until enabled", () => {
    hold.press();
    vi.advanceTimersByTime(3_000);
    hold.setEnabled(false);
    expect(hold.getSnapshot().holding).toBe(false);
    vi.advanceTimersByTime(HOLD_TO_CONFIRM_MS * 2);
    expect(confirmed).toBe(0);

    hold.press();
    expect(hold.getSnapshot().holding).toBe(false);
    vi.advanceTimersByTime(HOLD_TO_CONFIRM_MS * 2);
    expect(confirmed).toBe(0);

    hold.setEnabled(true);
    hold.press();
    vi.advanceTimersByTime(HOLD_TO_CONFIRM_MS);
    expect(confirmed).toBe(1);
  });

  it("the timestamps decide: a late timer still confirms on release past five seconds", () => {
    // Hold the clock still for the timer, but not for Date.now: a
    // release past the mark (the timer callback not run yet) confirms.
    hold.press();
    vi.setSystemTime(Date.now() + HOLD_TO_CONFIRM_MS);
    hold.release();
    expect(confirmed).toBe(1);
    vi.advanceTimersByTime(HOLD_TO_CONFIRM_MS);
    expect(confirmed).toBe(1);
  });

  it("a timer that fires early waits out the rest", () => {
    let now = 1_000;
    const early = new HoldToConfirm(HOLD_TO_CONFIRM_MS, () => now);
    let count = 0;
    early.setOnConfirm(() => {
      count += 1;
    });
    early.press();
    // The timer fires on schedule, but the clock says 100ms are left.
    now += HOLD_TO_CONFIRM_MS - 100;
    vi.advanceTimersByTime(HOLD_TO_CONFIRM_MS);
    expect(count).toBe(0);
    expect(early.getSnapshot().holding).toBe(true);
    now += 100;
    vi.advanceTimersByTime(100);
    expect(count).toBe(1);
    early.dispose();
  });

  it("a second press while held does not restart the clock", () => {
    hold.press();
    vi.advanceTimersByTime(4_000);
    hold.press();
    vi.advanceTimersByTime(1_000);
    expect(confirmed).toBe(1);
  });

  it("tells its subscribers when the hold changes", () => {
    const seen: boolean[] = [];
    const unsubscribe = hold.subscribe(() =>
      seen.push(hold.getSnapshot().holding),
    );
    hold.press();
    hold.cancel();
    hold.cancel();
    unsubscribe();
    hold.press();
    expect(seen).toEqual([true, false]);
  });
});

describe("holdKeyAction", () => {
  it("no key confirms: Enter and Space do nothing, Esc lets go", () => {
    expect(holdKeyAction("Enter")).toBeNull();
    expect(holdKeyAction(" ")).toBeNull();
    expect(holdKeyAction("Spacebar")).toBeNull();
    expect(holdKeyAction("Escape")).toBe("cancel");
  });
});

describe("holdPointerHandlers", () => {
  it("pointer events only: no click or key handler, so Enter and Space confirm nothing", () => {
    const handlers = holdPointerHandlers(hold);
    expect(Object.keys(handlers).sort()).toEqual([
      "onPointerCancel",
      "onPointerDown",
      "onPointerLeave",
      "onPointerUp",
    ]);
  });

  it("the primary button presses, up releases, leaving or a cancel lets go", () => {
    const handlers = holdPointerHandlers(hold);
    handlers.onPointerDown({ button: 2 });
    expect(hold.getSnapshot().holding).toBe(false);

    handlers.onPointerDown({ button: 0 });
    expect(hold.getSnapshot().holding).toBe(true);
    handlers.onPointerLeave();
    expect(hold.getSnapshot()).toEqual({ holding: false, tooShort: false });

    handlers.onPointerDown({ button: 0 });
    handlers.onPointerCancel();
    expect(hold.getSnapshot().holding).toBe(false);

    handlers.onPointerDown({ button: 0 });
    handlers.onPointerUp();
    expect(hold.getSnapshot()).toEqual({ holding: false, tooShort: true });

    handlers.onPointerDown({ button: 0 });
    vi.advanceTimersByTime(HOLD_TO_CONFIRM_MS);
    expect(confirmed).toBe(1);
  });
});
