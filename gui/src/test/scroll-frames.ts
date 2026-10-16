import { vi } from "vitest";

/**
 * A scroll container as the browser keeps it, for lib/animate-scroll.ts
 * and lib/chase-bottom.ts: `scrollTop` clamped to the scrollable range,
 * key presses heard on its own document.
 */
export class FakeScrollBox extends EventTarget {
  readonly ownerDocument = new EventTarget();
  /** Every value `scrollTop` took, in order. */
  readonly writes: number[] = [];
  private top = 0;
  constructor(
    public scrollHeight: number,
    public clientHeight: number,
  ) {
    super();
  }
  get scrollTop(): number {
    return this.top;
  }
  set scrollTop(value: number) {
    this.top = Math.min(
      Math.max(0, value),
      Math.max(0, this.scrollHeight - this.clientHeight),
    );
    this.writes.push(this.top);
  }
}

/**
 * Frames by hand: stubs `requestAnimationFrame`, `performance.now` and
 * `matchMedia` (reduced motion off until `reducedMotion` is set). Call
 * from `beforeEach`; `vi.restoreAllMocks()` and `vi.unstubAllGlobals()`
 * undo it.
 */
export function stubFrames(startAt = 1_000) {
  const state = {
    clock: startAt,
    reducedMotion: false,
    frames: new Map<number, FrameRequestCallback>(),
  };
  let nextFrame = 0;
  vi.spyOn(performance, "now").mockImplementation(() => state.clock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    state.frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    state.frames.delete(id);
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches:
      query === "(prefers-reduced-motion: reduce)" && state.reducedMotion,
  }));
  return {
    state,
    /** Milliseconds since `startAt`. */
    elapsed: () => state.clock - startAt,
    /** Frames requested and not yet run. */
    pending: () => state.frames.size,
    /** Runs one frame `ms` after the last. */
    tick(ms = 16) {
      state.clock += ms;
      const due = [...state.frames.values()];
      state.frames = new Map();
      for (const callback of due) callback(state.clock);
    },
    /** Runs frames until none is pending (or `limit` frames). */
    runOut(limit = 200) {
      for (let i = 0; i < limit && state.frames.size > 0; i++) this.tick();
    },
  };
}
