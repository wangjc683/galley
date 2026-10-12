import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getPref: vi.fn<(key: string) => Promise<unknown>>(),
  setPref: vi.fn<(key: string, value: unknown) => Promise<void>>(),
}));
vi.mock("@/lib/db", () => db);

import {
  SIDEBAR_COLLAPSED_PREF,
  useSidebarCollapseStore,
} from "./sidebar-collapse";

const store = () => useSidebarCollapseStore.getState();

beforeEach(() => {
  db.getPref.mockReset();
  db.setPref.mockReset();
  db.setPref.mockResolvedValue(undefined);
  useSidebarCollapseStore.setState({
    collapsed: false,
    loaded: false,
    changedBeforeLoad: false,
  });
});

describe("the collapsed sidebar in Core prefs", () => {
  it("is expanded by default and reads the stored value once", async () => {
    expect(store().collapsed).toBe(false);
    db.getPref.mockResolvedValue(true);
    await store().hydrate();
    expect(db.getPref).toHaveBeenCalledWith("sidebar_collapsed");
    expect(SIDEBAR_COLLAPSED_PREF).toBe("sidebar_collapsed");
    expect(store().collapsed).toBe(true);
    // Reading back writes nothing.
    expect(db.setPref).not.toHaveBeenCalled();
    await store().hydrate();
    expect(db.getPref).toHaveBeenCalledTimes(1);
  });

  it("writes every toggle back once the stored value is in", async () => {
    db.getPref.mockResolvedValue(undefined);
    await store().hydrate();
    store().toggle();
    expect(store().collapsed).toBe(true);
    expect(db.setPref).toHaveBeenLastCalledWith("sidebar_collapsed", true);
    store().toggle();
    expect(store().collapsed).toBe(false);
    expect(db.setPref).toHaveBeenLastCalledWith("sidebar_collapsed", false);
  });

  it("keeps a toggle made before the read returns, and saves it then", async () => {
    let answer: (stored: unknown) => void = () => {};
    db.getPref.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const reading = store().hydrate();
    store().toggle();
    expect(db.setPref).not.toHaveBeenCalled();
    answer(false);
    await reading;
    expect(store()).toMatchObject({ collapsed: true, loaded: true });
    expect(db.setPref).toHaveBeenCalledWith("sidebar_collapsed", true);
  });

  it("stays expanded when the read fails, and still saves later toggles", async () => {
    db.getPref.mockRejectedValue(new Error("no host"));
    await store().hydrate();
    expect(store()).toMatchObject({ collapsed: false, loaded: true });
    store().toggle();
    expect(db.setPref).toHaveBeenCalledWith("sidebar_collapsed", true);
  });
});
