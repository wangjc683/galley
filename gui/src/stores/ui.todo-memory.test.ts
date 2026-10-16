import { afterEach, describe, expect, it, vi } from "vitest";

import { TODO_PANEL_OPEN_KEY } from "@/lib/todo-panel-memory";

/**
 * The to-do panel remembers whether it was open (main chat ticket 45,
 * PRD ruling 93 point 2): every set writes it to this machine's
 * localStorage, and a fresh start — a restart, the window reloading —
 * begins from what was written. Default closed; anything unreadable is
 * closed. Each case loads the ui store afresh over a stubbed window, as
 * a new run of the app would.
 */

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
  it("starts closed, and open after a restart once it was left open", async () => {
    const local = storage();
    vi.stubGlobal("window", { localStorage: local });
    const first = await freshStore();
    expect(first.getState().todoPanelOpen).toBe(false);
    first.getState().setTodoPanelOpen(true);
    expect(local.data.get(TODO_PANEL_OPEN_KEY)).toBe("1");

    const second = await freshStore();
    expect(second.getState().todoPanelOpen).toBe(true);
    // Closed — by its X, the button, or a preview taking its place —
    // and the next run starts closed.
    second.getState().setTodoPanelOpen(false);
    expect(local.data.has(TODO_PANEL_OPEN_KEY)).toBe(false);
    expect((await freshStore()).getState().todoPanelOpen).toBe(false);
  });

  it("counts anything unreadable as closed", async () => {
    vi.stubGlobal("window", {
      localStorage: storage({ [TODO_PANEL_OPEN_KEY]: "true" }),
    });
    expect((await freshStore()).getState().todoPanelOpen).toBe(false);

    vi.stubGlobal("window", { localStorage: storage({}, true) });
    const blocked = await freshStore();
    expect(blocked.getState().todoPanelOpen).toBe(false);
    // A failed write leaves the choice to this run alone.
    expect(() => blocked.getState().setTodoPanelOpen(true)).not.toThrow();
    expect(blocked.getState().todoPanelOpen).toBe(true);
  });

  it("is closed with no window at all (a static render)", async () => {
    expect((await freshStore()).getState().todoPanelOpen).toBe(false);
  });
});
