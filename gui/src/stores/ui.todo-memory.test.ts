import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TODO_PANEL_INTRODUCED_KEY,
  TODO_PANEL_OPEN_KEYS,
} from "@/lib/todo-panel-memory";

/**
 * The to-do panel remembers whether it was open (main chat ticket 45,
 * PRD ruling 93 point 2), in two places apart (ticket 46, ruling 95
 * point 3): beside Galley, under ticket 45's key, and beside everything
 * else, under its own. Every set writes its place to this machine's
 * localStorage, and a fresh start — a restart, the window reloading —
 * begins from what was written. Default closed; anything unreadable is
 * closed. Each case loads the ui store afresh over a stubbed window, as
 * a new run of the app would.
 */

const GALLEY = TODO_PANEL_OPEN_KEYS.galley;
const ELSEWHERE = TODO_PANEL_OPEN_KEYS.elsewhere;

function storage(initial: Record<string, string> = {}, throws = false) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (throws) throw new Error("blocked");
  };
  return {
    data,
    getItem: (key: string) => {
      guard();
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      guard();
      data.set(key, value);
    },
    removeItem: (key: string) => {
      guard();
      data.delete(key);
    },
  };
}

async function freshStore() {
  vi.resetModules();
  return (await import("@/stores/ui")).useUiStore;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("remembering the to-do panel", () => {
  it("keeps Galley's under ticket 45's key, unmigrated, and the rest under their own", () => {
    expect(GALLEY).toBe("galley.todoPanelOpen");
    expect(ELSEWHERE).toBe("galley.todoPanelOpenElsewhere");
  });

  it("starts closed in both places, and open after a restart where it was left open", async () => {
    const local = storage();
    vi.stubGlobal("window", { localStorage: local });
    const first = await freshStore();
    expect(first.getState().todoPanelOpen).toEqual({
      galley: false,
      elsewhere: false,
    });
    first.getState().setTodoPanelOpen("galley", true);
    expect(local.data.get(GALLEY)).toBe("1");
    expect(local.data.has(ELSEWHERE)).toBe(false);

    const second = await freshStore();
    expect(second.getState().todoPanelOpen).toEqual({
      galley: true,
      elsewhere: false,
    });
    // Closed — by its X, the button, or a preview taking its place —
    // and the next run starts closed there.
    second.getState().setTodoPanelOpen("galley", false);
    expect(local.data.has(GALLEY)).toBe(false);
    expect((await freshStore()).getState().todoPanelOpen.galley).toBe(false);
  });

  it("remembers each place apart", async () => {
    const local = storage();
    vi.stubGlobal("window", { localStorage: local });
    const first = await freshStore();
    first.getState().setTodoPanelOpen("elsewhere", true);
    expect(local.data.get(ELSEWHERE)).toBe("1");
    expect(local.data.has(GALLEY)).toBe(false);
    expect((await freshStore()).getState().todoPanelOpen).toEqual({
      galley: false,
      elsewhere: true,
    });

    // A machine that had Galley's open before ticket 46 keeps it, and
    // the workbench starts closed.
    vi.stubGlobal("window", { localStorage: storage({ [GALLEY]: "1" }) });
    expect((await freshStore()).getState().todoPanelOpen).toEqual({
      galley: true,
      elsewhere: false,
    });
  });

  it("counts anything unreadable as closed", async () => {
    vi.stubGlobal("window", {
      localStorage: storage({ [GALLEY]: "true", [ELSEWHERE]: "yes" }),
    });
    expect((await freshStore()).getState().todoPanelOpen).toEqual({
      galley: false,
      elsewhere: false,
    });

    vi.stubGlobal("window", { localStorage: storage({}, true) });
    const blocked = await freshStore();
    expect(blocked.getState().todoPanelOpen).toEqual({
      galley: false,
      elsewhere: false,
    });
    // A failed write leaves the choice to this run alone.
    expect(() =>
      blocked.getState().setTodoPanelOpen("elsewhere", true),
    ).not.toThrow();
    expect(blocked.getState().todoPanelOpen.elsewhere).toBe(true);
  });

  it("is closed with no window at all (a static render)", async () => {
    expect((await freshStore()).getState().todoPanelOpen).toEqual({
      galley: false,
      elsewhere: false,
    });
  });
});

describe("the panel met (main chat ticket 87, PRD ruling 131 point 4)", () => {
  it("starts from what was written, a place left open counting", async () => {
    vi.stubGlobal("window", { localStorage: storage() });
    expect((await freshStore()).getState().todoPanelIntroduced).toBe(false);
    vi.stubGlobal("window", {
      localStorage: storage({ [TODO_PANEL_INTRODUCED_KEY]: "1" }),
    });
    expect((await freshStore()).getState().todoPanelIntroduced).toBe(true);
    vi.stubGlobal("window", { localStorage: storage({ [GALLEY]: "1" }) });
    expect((await freshStore()).getState().todoPanelIntroduced).toBe(true);
  });

  it("is written by every remembered open or close, so a close keeps it met", async () => {
    // Met at start because Galley's was left open…
    const local = storage({ [GALLEY]: "1" });
    vi.stubGlobal("window", { localStorage: local });
    const first = await freshStore();
    expect(first.getState().todoPanelIntroduced).toBe(true);
    // …closed (a preview taking its place counts), the open key goes
    // and the flag stays.
    first.getState().setTodoPanelOpen("galley", false);
    expect(local.data.has(GALLEY)).toBe(false);
    expect(local.data.get(TODO_PANEL_INTRODUCED_KEY)).toBe("1");
    expect((await freshStore()).getState().todoPanelIntroduced).toBe(true);
  });

  it("is written when marked, whether or not this run had it met", async () => {
    const local = storage();
    vi.stubGlobal("window", { localStorage: local });
    const store = await freshStore();
    store.getState().markTodoPanelIntroduced();
    expect(store.getState().todoPanelIntroduced).toBe(true);
    expect(local.data.get(TODO_PANEL_INTRODUCED_KEY)).toBe("1");
    local.data.delete(TODO_PANEL_INTRODUCED_KEY);
    store.getState().markTodoPanelIntroduced();
    expect(local.data.get(TODO_PANEL_INTRODUCED_KEY)).toBe("1");
  });

  it("keeps a failed write met for this run alone", async () => {
    vi.stubGlobal("window", { localStorage: storage({}, true) });
    const blocked = await freshStore();
    expect(() => blocked.getState().markTodoPanelIntroduced()).not.toThrow();
    expect(blocked.getState().todoPanelIntroduced).toBe(true);
    expect((await freshStore()).getState().todoPanelIntroduced).toBe(false);
  });

  it("a look, the width and a row request stay out of storage", async () => {
    const local = storage();
    vi.stubGlobal("window", { localStorage: local });
    const store = await freshStore();
    // Narrow until measured.
    expect(store.getState().todoNarrow).toBe(true);
    store.getState().setTodoNarrow(false);
    store.getState().setTodoGlance({ at: "main:s-main", arrived: true });
    store.getState().requestTodoRows(["todo_1"]);
    expect([...local.data.keys()]).toEqual([]);
    const fresh = (await freshStore()).getState();
    expect(fresh.todoGlance).toBeNull();
    expect(fresh.todoRowRequest).toBeNull();
    expect(fresh.todoNarrow).toBe(true);
  });

  it("clears a row request only once the panel took that one", async () => {
    const store = await freshStore();
    store.getState().requestTodoRows(["todo_1"]);
    const first = store.getState().todoRowRequest!;
    store.getState().requestTodoRows(["todo_2"]);
    store.getState().clearTodoRowRequest(first.nonce);
    expect(store.getState().todoRowRequest?.ids).toEqual(["todo_2"]);
    store
      .getState()
      .clearTodoRowRequest(store.getState().todoRowRequest!.nonce);
    expect(store.getState().todoRowRequest).toBeNull();
  });
});
