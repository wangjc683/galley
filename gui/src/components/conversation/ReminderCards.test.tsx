import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import type { ScheduledTask } from "@/lib/scheduled-tasks";

import { ReminderCards } from "./ReminderCards";

/**
 * The reminder cards under a reply (main chat ticket 37). The state
 * rules and words are pinned in lib/assistant-todo.test.ts; here what a
 * card draws in each state, and where the cards sit.
 */

function inDays(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function task(extra: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "sched_1",
    prompt: "提醒用户明早 9 点开会，带上周报",
    repeat: { kind: "once" },
    timeOfDay: "09:00",
    enabled: true,
    fireAt: inDays(1, 9),
    target: "assistant",
    origin: { via: "supervisor", supervisor: "galley-assistant" },
    createdIn: { sessionId: "s-main", turnIndex: 7 },
    createdAt: "2026-10-16T08:00:00Z",
    updatedAt: "2026-10-16T08:00:00Z",
    ...extra,
  };
}

function render(
  tasks: ScheduledTask[],
  opts: { afterSubtasks?: boolean; language?: "zh-CN" | "en-US" } = {},
) {
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
      <Tooltip.Provider>
        <ReminderCards tasks={tasks} afterSubtasks={opts.afterSubtasks} />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("ReminderCards", () => {
  it("draws one line: time, the words, the state and 取消", () => {
    const html = render([task()]);
    expect(html).toContain('data-reminder-state="scheduled"');
    expect(html).toContain("明天 09:00");
    expect(html).toContain("提醒用户明早 9 点开会，带上周报");
    expect(html).toContain(">待提醒<");
    expect(html).toContain(">取消<");
    expect(html).toContain(
      'aria-label="提醒 · 提醒用户明早 9 点开会，带上周报"',
    );
    // The subtask card's frame, without a state bar.
    expect(html).toContain("rounded-md border border-line bg-app");
    expect(html).not.toContain("w-[3px]");
  });

  it("keeps a fired or cancelled card, without 取消", () => {
    const fired = render([
      task({ fireAt: inDays(0, 0), lastFiredAt: inDays(0, 1) }),
    ]);
    expect(fired).toContain('data-reminder-state="fired"');
    expect(fired).toContain(">已提醒<");
    expect(fired).not.toContain(">取消<");
    const cancelled = render([task({ cancelledAt: "2026-10-16T09:00:00Z" })]);
    expect(cancelled).toContain('data-reminder-state="cancelled"');
    expect(cancelled).toContain(">已取消<");
    expect(cancelled).not.toContain(">取消<");
    // The words step back once it is settled.
    expect(cancelled).toContain(
      "truncate text-[13px] leading-5 text-ink-muted",
    );
  });

  it("writes a repeating task's rule and 已暂停 when switched off", () => {
    const html = render([
      task({ repeat: { kind: "daily" }, timeOfDay: "08:00", enabled: false }),
    ]);
    expect(html).toContain("每天 08:00");
    expect(html).toContain(">已暂停<");
    expect(html).toContain(">取消<");
  });

  it("stacks several, 12px off the bubble or 8px under the subtask cards", () => {
    const two = render([task(), task({ id: "sched_2" })]);
    expect(count(two, 'data-role="reminder-card"')).toBe(2);
    expect(two).toContain('class="flex flex-col gap-2 mt-3"');
    expect(render([task()], { afterSubtasks: true })).toContain(
      'class="flex flex-col gap-2 mt-2"',
    );
  });

  it("speaks English", () => {
    const html = render([task()], { language: "en-US" });
    expect(html).toContain(">Set<");
    expect(html).toContain(">Cancel<");
    expect(html.replace(/\s/g, " ")).toContain("Tomorrow 9:00 AM");
  });
});
