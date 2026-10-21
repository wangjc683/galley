// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import type { ScheduledTask } from "@/lib/scheduled-tasks";

import { ScheduledTasksDialog } from "./ScheduledTasksDialog";

/**
 * The 定时 dialog (the external runtime's: it only opens without a main
 * chat) leaves out the daily review a managed run left in the database
 * (main chat ticket 74): it never runs there, and its prompt is English
 * for the model.
 */

const listed = vi.hoisted(() => ({ tasks: [] as unknown[] }));
vi.mock("@/lib/scheduled-tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scheduled-tasks")>()),
  listScheduledTasks: async () => listed.tasks,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  listed.tasks = [];
});

function task(
  id: string,
  prompt: string,
  origin?: ScheduledTask["origin"],
): ScheduledTask {
  return {
    id,
    prompt,
    repeat: { kind: "daily" },
    timeOfDay: "09:00",
    enabled: true,
    origin,
    createdAt: "2026-10-21T00:00:00+00:00",
    updatedAt: "2026-10-21T00:00:00+00:00",
  };
}

describe("the 定时 dialog", () => {
  it("does not list the daily review a managed run left behind", async () => {
    listed.tasks = [
      task("sched_review", "Daily review: go over what is in hand.", {
        via: "system",
        supervisor: "galley-review",
      }),
      task("sched_digest", "整理下载文件夹", { via: "gui" }),
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <CopyProvider language="zh-CN">
          <Tooltip.Provider>
            <ScheduledTasksDialog
              open
              onOpenChange={() => {}}
              projects={[]}
              sessions={[]}
              llms={[]}
              onSelectSession={() => {}}
            />
          </Tooltip.Provider>
        </CopyProvider>,
      );
      // The dialog reads the list on the tick after it opens.
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("整理下载文件夹");
    expect(text).not.toContain("Daily review");
    expect(text).toContain("共 1 个");
  });
});
