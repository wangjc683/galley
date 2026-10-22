import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readAutostartHintClosed,
  readTodoPanelIntroduced,
  TODO_AUTOSTART_HINT_CLOSED_KEY,
  TODO_PANEL_INTRODUCED_KEY,
  TODO_PANEL_OPEN_KEYS,
  writeAutostartHintClosed,
  writeTodoPanelIntroduced,
} from "@/lib/todo-panel-memory";

/**
 * The launch-at-login hint's × (main chat PRD ruling 96): closed for good
 * on this machine. Only `"1"` counts; no window, blocked storage or a
 * value that is not ours read as not closed.
 */

function stubStorage(initial: Record<string, string> = {}, throws = false) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (throws) throw new Error("blocked");
  };
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => {
        guard();
        return data.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        guard();
        data.set(key, value);
      },
    },
  });
  return data;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the launch-at-login hint's ×", () => {
  it("is not closed until closed, then stays closed", () => {
    const data = stubStorage();
    expect(readAutostartHintClosed()).toBe(false);
    writeAutostartHintClosed();
    expect(data.get(TODO_AUTOSTART_HINT_CLOSED_KEY)).toBe("1");
    expect(readAutostartHintClosed()).toBe(true);
  });

  it("reads anything else as not closed", () => {
    stubStorage({ [TODO_AUTOSTART_HINT_CLOSED_KEY]: "true" });
    expect(readAutostartHintClosed()).toBe(false);
    stubStorage({}, true);
    expect(readAutostartHintClosed()).toBe(false);
    expect(() => writeAutostartHintClosed()).not.toThrow();
  });

  it("reads as not closed without a window (a static render)", () => {
    expect(readAutostartHintClosed()).toBe(false);
  });
});

describe("the panel met (main chat ticket 87, PRD ruling 131 point 4)", () => {
  it("keeps a key of its own: a close deletes the open key", () => {
    expect(TODO_PANEL_INTRODUCED_KEY).toBe("galley.todoPanelIntroduced");
  });

  it("is not met until written, then stays met", () => {
    const data = stubStorage();
    expect(readTodoPanelIntroduced()).toBe(false);
    writeTodoPanelIntroduced();
    expect(data.get(TODO_PANEL_INTRODUCED_KEY)).toBe("1");
    expect(readTodoPanelIntroduced()).toBe(true);
  });

  it("counts a place left open as met", () => {
    stubStorage({ [TODO_PANEL_OPEN_KEYS.galley]: "1" });
    expect(readTodoPanelIntroduced()).toBe(true);
    stubStorage({ [TODO_PANEL_OPEN_KEYS.elsewhere]: "1" });
    expect(readTodoPanelIntroduced()).toBe(true);
  });

  it("reads anything else as not met", () => {
    stubStorage({
      [TODO_PANEL_INTRODUCED_KEY]: "true",
      [TODO_PANEL_OPEN_KEYS.galley]: "yes",
    });
    expect(readTodoPanelIntroduced()).toBe(false);
    stubStorage({}, true);
    expect(readTodoPanelIntroduced()).toBe(false);
    expect(() => writeTodoPanelIntroduced()).not.toThrow();
  });

  it("reads as not met without a window (a static render)", () => {
    expect(readTodoPanelIntroduced()).toBe(false);
  });
});
