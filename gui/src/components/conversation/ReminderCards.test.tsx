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
  opts: { language?: "zh-CN" | "en-US" } = {},
) {
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
      <Tooltip.Provider>
        <ReminderCards tasks={tasks} />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("ReminderCards", () => {
  it("draws one line: the words, then the time, the state and 取消", () => {
    const html = render([task()]);
    expect(html).toContain('data-reminder-state="scheduled"');
    expect(html).toContain("明天 09:00");
    expect(html).toContain("提醒用户明早 9 点开会，带上周报");
    expect(html).toContain(">待提醒<");
    expect(html).toContain(">取消<");
    expect(html).toContain(
      'aria-label="提醒 · 提醒用户明早 9 点开会，带上周报"',
    );
    // Ruling 182: the words first, the time and the state 8px after
    // them in ink-muted, 「取消」 at the line's end, 20px.
    const at = (s: string) => html.indexOf(s);
    expect(at("提醒用户明早")).toBeLessThan(at("明天 09:00"));
    expect(at("明天 09:00")).toBeLessThan(at(">待提醒<"));
    expect(at(">待提醒<")).toBeLessThan(at(">取消<"));
    expect(html).toContain("ml-auto h-5 shrink-0 px-1.5 py-0");
    // A 24px line in the reply's frame, no frame of its own, no bar.
    expect(html).toContain(
      "flex h-6 min-w-0 items-center rounded-sm px-2 [font-size:var(--conversation-step-size)] select-none",
    );
    expect(html).not.toContain("min-h-10");
    expect(html).not.toContain("border-line");
    expect(html).not.toContain("w-[3px]");
    // data-card-icon: what flies into the top bar's 待办 button.
    expect(count(html, "data-card-icon")).toBe(1);
  });

  // Main chat ticket 105, PRD ruling 151: the line for the user; the
  // notes to itself after the blank line are nowhere on the card.
  it("shows only the first line of its words, in the line and its accessible name", () => {
    const html = render([
      task({
        prompt:
          "开会带上周报\n\n明早 9 点的周会，用户要讲 Q3 数据；到时提醒带上周报。",
      }),
    ]);
    expect(html).toContain(">开会带上周报<");
    expect(html).toContain('aria-label="提醒 · 开会带上周报"');
    expect(html).not.toContain("Q3");
    expect(html).not.toContain("周会");
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
    expect(cancelled).toContain("min-w-0 truncate leading-5 text-ink-muted");
  });

  // Ticket 99, PRD ruling 144 point 2: cancelled is struck, as a deleted
  // to-do or memo is; reminded, paused and set are not.
  it("strikes a cancelled one's time and words, and no other's", () => {
    const cancelled = render([task({ cancelledAt: "2026-10-16T09:00:00Z" })]);
    expect(cancelled).toContain(
      'pointer-events-none ml-2 shrink-0 tabular-nums text-ink-muted line-through">明天 09:00<',
    );
    expect(cancelled).toContain(
      'min-w-0 truncate leading-5 text-ink-muted line-through"',
    );
    expect(count(cancelled, "line-through")).toBe(2);
    // 「已取消」 itself is not struck.
    expect(cancelled).toContain(
      '<span class="pointer-events-none ml-2 shrink-0 text-ink-muted">已取消</span>',
    );
    const fired = render([
      task({ fireAt: inDays(0, 0), lastFiredAt: inDays(0, 1) }),
    ]);
    const paused = render([
      task({ repeat: { kind: "daily" }, timeOfDay: "08:00", enabled: false }),
    ]);
    for (const html of [fired, paused, render([task()])]) {
      expect(html).not.toContain("line-through");
    }
    expect(fired).toContain("min-w-0 truncate leading-5 text-ink-muted");
  });

  it("writes a repeating task's rule and 已暂停 when switched off", () => {
    const html = render([
      task({ repeat: { kind: "daily" }, timeOfDay: "08:00", enabled: false }),
    ]);
    expect(html).toContain("每天 08:00");
    expect(html).toContain(">已暂停<");
    expect(html).toContain(">取消<");
  });

  it("stacks several, a line each, no gaps: the reply's frame holds them", () => {
    const two = render([task(), task({ id: "sched_2" })]);
    expect(count(two, 'data-role="reminder-card"')).toBe(2);
    expect(two).toContain('data-role="reminder-cards" class="flex flex-col"');
  });

  it("speaks English", () => {
    const html = render([task()], { language: "en-US" });
    expect(html).toContain(">Set<");
    expect(html).toContain(">Cancel<");
    expect(html.replace(/\s/g, " ")).toContain("Tomorrow 9:00 AM");
  });
});
