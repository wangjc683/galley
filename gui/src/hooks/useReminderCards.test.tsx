// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ScheduledTask } from "@/lib/scheduled-tasks";

/**
 * The reads the main chat's reminder cards come from, as the to-do
 * panel's one opening by itself hears them (main chat ticket 101, PRD
 * ruling 147 point 4): a mount's first read stands for what is already
 * there (null before it), each later one says what came before it; an
 * unmounted chat's reads are heard by no one.
 */

const tauri = vi.hoisted(() => ({
  reads: [] as ScheduledTask[][],
  changed: null as null | (() => void),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, handler: () => void) => {
    tauri.changed = handler;
    return () => {
      tauri.changed = null;
    };
  },
}));
vi.mock("@/lib/scheduled-tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scheduled-tasks")>()),
  listScheduledTasks: async () => tauri.reads.shift() ?? [],
}));

import {
  subscribeReminderReads,
  useRemindersByMessage,
} from "./useReminderCards";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function task(id: string, turnIndex?: number): ScheduledTask {
  return {
    id,
    prompt: id,
    repeat: { kind: "once" },
    timeOfDay: "15:00",
    enabled: true,
    target: "assistant",
    createdIn: { sessionId: "s-main", turnIndex },
    createdAt: "2026-10-28T06:50:00Z",
    updatedAt: "2026-10-28T06:50:00Z",
  };
}

let root: Root | null = null;

function Probe() {
  useRemindersByMessage("s-main");
  return null;
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Probe />));
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("the reminder reads, heard (ticket 101)", () => {
  it("a mount's first read is a starting point, each later one says what came before", async () => {
    const heard: [string[] | null, string[]][] = [];
    const ids = (tasks: readonly ScheduledTask[]) => tasks.map((t) => t.id);
    const unsubscribe = subscribeReminderReads((previous, next) =>
      heard.push([previous && ids(previous), ids(next)]),
    );
    tauri.reads.push([task("sched_old", 3)]);
    await mount();
    await settle();
    expect(heard).toEqual([[null, ["sched_old"]]]);

    tauri.reads.push([task("sched_old", 3), task("sched_new", 7)]);
    tauri.changed?.();
    await settle();
    expect(heard[1]).toEqual([["sched_old"], ["sched_old", "sched_new"]]);

    // Back on the main chat after elsewhere: what was made meanwhile is
    // the new mount's starting point.
    act(() => root?.unmount());
    root = null;
    tauri.reads.push([
      task("sched_old", 3),
      task("sched_new", 7),
      task("sched_away", 9),
    ]);
    await mount();
    await settle();
    expect(heard[2]).toEqual([null, ["sched_old", "sched_new", "sched_away"]]);

    unsubscribe();
    tauri.reads.push([task("sched_old", 3)]);
    tauri.changed?.();
    await settle();
    expect(heard).toHaveLength(3);
  });
});
