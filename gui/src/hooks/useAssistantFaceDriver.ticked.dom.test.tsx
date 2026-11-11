// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { basePose } from "@/lib/assistant-face-motion";
import { EMPTY_TODO, type TodoItem } from "@/lib/assistant-todo";
import type { FaceClock } from "@/lib/assistant-face-director";
import { useAssistantFaceStore } from "@/stores/assistant-face";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import type { Session } from "@/types/session";

import { useAssistantFaceDriver } from "./useAssistantFaceDriver";

/**
 * The face's driver nodding at your tick (main chat ticket 163, PRD
 * ruling 208 point 5): it reads the to-do store's hold starting — the
 * click on one of your to-dos' boxes in this window — and nothing else
 * there; dozing, the tick wakes it instead (as any touch does); after an
 * error it nods and goes back to that pose, as `look` does; behind
 * other windows, off screen, under reduced motion it does nothing.
 * The main chat's status is stood in for; the clock is moved by hand.
 */

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
  isTauri: () => false,
}));
const view = vi.hoisted(() => ({ status: "idle" as string }));
vi.mock("@/hooks/useSessionStatusView", () => ({
  useSessionStatusView: () => ({ status: view.status }),
}));
vi.mock("@/hooks/useSessionsAttention", () => ({
  useSessionsAttention: () => ({ runningCount: 0 }),
}));

const MAIN = { id: "main" } as Session;

const TODO: TodoItem = {
  kind: "todo",
  id: "t1",
  text: "交周报",
  state: "open",
  createdBy: "user",
};

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let host: HTMLDivElement;
let root: Root;
let now: number;
let timers: Map<number, { t: number; fn: () => void }>;
let clock: FaceClock;
/** Every beat the face played, by name, in order. */
let played: string[];
let unsubscribe: () => void;

/** The same chance every run. */
function steady(): () => number {
  let i = 0;
  return () => ((i += 1) * 0.37) % 1;
}
const random = steady();

function advance(to: number) {
  act(() => {
    for (;;) {
      let next: [number, { t: number; fn: () => void }] | null = null;
      for (const entry of timers) {
        if (!next || entry[1].t < next[1].t) next = entry;
      }
      if (!next || next[1].t > to) break;
      timers.delete(next[0]);
      now = next[1].t;
      next[1].fn();
    }
    now = to;
  });
}

function Harness({ open }: { open: boolean }) {
  useAssistantFaceDriver({ mainChat: MAIN, subtasks: [], open, clock, random });
  return null;
}

function mount(open = false) {
  act(() => root.render(<Harness open={open} />));
}

beforeEach(() => {
  now = 0;
  let id = 0;
  timers = new Map();
  clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.set(++id, { t: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => {
      timers.delete(h as number);
    },
  };
  view.status = "idle";
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  useAssistantFaceStore.setState({ beat: null, seq: 0, onScreen: {} });
  useAssistantFaceStore.getState().setOnScreen("card", true);
  played = [];
  unsubscribe = useAssistantFaceStore.subscribe((state, prev) => {
    if (state.seq !== prev.seq && state.beat) played.push(state.beat.name);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  unsubscribe();
  act(() =>
    useAssistantTodoStore.setState({
      todo: EMPTY_TODO,
      flips: {},
      deleting: {},
      subitemTicks: {},
    }),
  );
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** What a click on a box starts: the row's hold (stores/assistant-todo.ts
 * `toggle`), set here directly so no write goes to Core. */
function flip(done: boolean, phase: "settling" | "saving" = "settling") {
  act(() =>
    useAssistantTodoStore.setState((s) => ({
      flips: { ...s.flips, [TODO.id]: { done, phase } },
    })),
  );
}
function unflip() {
  act(() => useAssistantTodoStore.setState({ flips: {} }));
}
const nods = () => played.filter((name) => name === "ticked").length;

describe("you tick off one of your to-dos", () => {
  it("nods at the click, with the panel beside any conversation", () => {
    mount(false);
    flip(true);
    expect(played[played.length - 1]).toBe("ticked");
    expect(nods()).toBe(1);
  });

  it("does not nod at an untick, a tick taken back, the write that follows, an item, a list from elsewhere, a delete", () => {
    mount(true);
    flip(false);
    unflip();
    expect(nods()).toBe(0);
    flip(true);
    expect(nods()).toBe(1);
    // Taken back in the hold, then the hold of another one turning into
    // Core's write: neither adds a nod or takes one back.
    unflip();
    flip(true);
    flip(true, "saving");
    expect(nods()).toBe(2);
    unflip();
    // An item under a to-do ticked.
    act(() =>
      useAssistantTodoStore.setState({
        subitemTicks: { s1: { done: true } as never },
      }),
    );
    // Galley's tick, another window's or the CLI's: a fresh list.
    act(() =>
      useAssistantTodoStore.setState({
        todo: { ...EMPTY_TODO, done: [{ ...TODO, state: "done" }] },
      }),
    );
    // Deleted, skipped.
    act(() =>
      useAssistantTodoStore.setState({
        deleting: { [TODO.id]: { item: TODO } as never },
      }),
    );
    expect(nods()).toBe(2);
  });

  it("wakes it instead while it dozes, and does not nod as well", () => {
    mount(false);
    // Long without you: it dozes (at night after a minute, else after
    // half an hour — past both).
    advance(31 * 60_000);
    expect(played).toContain("enter:doze");
    flip(true);
    expect(played[played.length - 1]).toBe("wake");
    expect(nods()).toBe(0);
  });

  it("nods after an error too, as `look` and `sent` do", () => {
    view.status = "error";
    mount(false);
    expect(played).toContain("errorEnter");
    flip(true);
    expect(played[played.length - 1]).toBe("ticked");
    expect(useAssistantFaceStore.getState().beat?.end).toEqual(
      basePose("error"),
    );
  });

  it("does nothing behind other windows, off screen, or under reduced motion", () => {
    mount(false);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("blur")));
    flip(true);
    expect(nods()).toBe(0);
    unflip();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("focus")));
    // In front again: it nods.
    flip(true);
    expect(nods()).toBe(1);
    unflip();
    act(() => useAssistantFaceStore.getState().setOnScreen("card", false));
    flip(true);
    expect(nods()).toBe(1);
    unflip();
    act(() => root.unmount());

    // Reduced motion: the face is still.
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    act(() => useAssistantFaceStore.getState().setOnScreen("card", true));
    root = createRoot(host);
    mount(false);
    flip(true);
    expect(nods()).toBe(1);
  });
});
