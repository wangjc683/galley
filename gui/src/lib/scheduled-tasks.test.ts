import { describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";

import {
  countFailedTasks,
  formatFireTime,
  formDaysValid,
  formFromTask,
  repeatFromForm,
  repeatSummary,
  EMPTY_SCHEDULED_TASK_FORM,
  SCHEDULED_REMINDER_UNDELIVERED_EVENT,
  SCHEDULED_TASK_FIRE_FAILED_EVENT,
  isDailyReviewTask,
  REVIEW_SUPERVISOR,
  SCHEDULER_SUPERVISOR,
  type ScheduledTask,
  type ScheduledTaskFormState,
} from "./scheduled-tasks";

function form(patch: Partial<ScheduledTaskFormState>): ScheduledTaskFormState {
  return { ...EMPTY_SCHEDULED_TASK_FORM, ...patch };
}

describe("repeatFromForm", () => {
  it("daily carries no day list", () => {
    expect(repeatFromForm(form({ repeatKind: "daily" }))).toEqual({
      kind: "daily",
    });
  });

  it("sorts weekdays so the wire shape matches Core's normalized()", () => {
    expect(
      repeatFromForm(form({ repeatKind: "weekly", weekdays: [5, 1, 3] })),
    ).toEqual({ kind: "weekly", weekdays: [1, 3, 5] });
  });

  it("sorts monthdays and leaves the form state untouched", () => {
    const f = form({ repeatKind: "monthly", monthdays: [31, 1, 15] });
    expect(repeatFromForm(f)).toEqual({
      kind: "monthly",
      monthdays: [1, 15, 31],
    });
    // The sort must copy — the form array is React state.
    expect(f.monthdays).toEqual([31, 1, 15]);
  });
});

describe("formDaysValid", () => {
  it("daily needs no days", () => {
    expect(formDaysValid(form({ repeatKind: "daily" }))).toBe(true);
  });

  it("weekly and monthly need at least one day", () => {
    expect(formDaysValid(form({ repeatKind: "weekly" }))).toBe(false);
    expect(formDaysValid(form({ repeatKind: "weekly", weekdays: [1] }))).toBe(
      true,
    );
    expect(formDaysValid(form({ repeatKind: "monthly" }))).toBe(false);
    expect(
      formDaysValid(form({ repeatKind: "monthly", monthdays: [31] })),
    ).toBe(true);
  });
});

describe("repeatSummary", () => {
  it("renders each repeat kind through the copy table", () => {
    expect(repeatSummary(zhCopy, { kind: "daily" }, "09:00")).toBe(
      "每天 09:00",
    );
    expect(
      repeatSummary(zhCopy, { kind: "weekly", weekdays: [1, 5] }, "17:00"),
    ).toBe("每周一·五 17:00");
    expect(
      repeatSummary(zhCopy, { kind: "monthly", monthdays: [1, 15] }, "09:30"),
    ).toBe("每月 1·15 日 09:30");
    expect(repeatSummary(zhCopy, { kind: "once" }, "20:00")).toBe("一次 20:00");
  });
});

describe("formatFireTime", () => {
  it("formats both UTC shapes Core writes (+00:00 and legacy Z)", () => {
    const plus = formatFireTime("2026-07-22T13:00:00+00:00", "zh-CN");
    const zed = formatFireTime("2026-07-22T13:00:00Z", "zh-CN");
    expect(plus).toBe(zed);
    expect(plus).not.toBe("2026-07-22T13:00:00+00:00");
    expect(plus).toContain(":");
  });

  it("degrades to the raw string when the timestamp is corrupt", () => {
    expect(formatFireTime("not-a-timestamp", "zh-CN")).toBe("not-a-timestamp");
  });
});

describe("SCHEDULER_SUPERVISOR", () => {
  it("pins the literal Core stamps in core/src/scheduler.rs", () => {
    // Cross-language seam: Rust writes this string on scheduler-created
    // sessions, the GUI filters on it (badge + sidebar marker). A rename
    // must land on both sides — this test is the tripwire.
    expect(SCHEDULER_SUPERVISOR).toBe("galley-scheduler");
  });

  it("pins the daily review's label Core seeds (main chat tickets 73, 74)", () => {
    // `scheduled_tasks.created_by_supervisor` of the one routine Core
    // seeds; the to-do panel names that row by it.
    expect(REVIEW_SUPERVISOR).toBe("galley-review");
  });

  it("pins the fire-failed event name Core emits in api/schedule.rs", () => {
    expect(SCHEDULED_TASK_FIRE_FAILED_EVENT).toBe(
      "scheduled-tasks:fire-failed",
    );
  });

  it("pins the reminder-undelivered event name Core emits", () => {
    expect(SCHEDULED_REMINDER_UNDELIVERED_EVENT).toBe(
      "scheduled-tasks:reminder-undelivered",
    );
  });
});

describe("isDailyReviewTask", () => {
  const task = (origin?: ScheduledTask["origin"]): ScheduledTask => ({
    id: "sched_x",
    prompt: "Daily review: go over what is in hand.",
    repeat: { kind: "daily" },
    timeOfDay: "09:00",
    enabled: true,
    target: "assistant",
    origin,
    createdAt: "2026-10-21T00:00:00+00:00",
    updatedAt: "2026-10-21T00:00:00+00:00",
  });

  it("is the task Core seeded for the daily review (ticket 73's origin)", () => {
    expect(
      isDailyReviewTask(task({ via: "system", supervisor: "galley-review" })),
    ).toBe(true);
    expect(
      isDailyReviewTask(
        task({ via: "supervisor", supervisor: "galley-assistant" }),
      ),
    ).toBe(false);
    expect(isDailyReviewTask(task({ via: "gui" }))).toBe(false);
    expect(isDailyReviewTask(task())).toBe(false);
  });
});

describe("countFailedTasks", () => {
  function task(patch: Partial<ScheduledTask>): ScheduledTask {
    return {
      id: "sched_x",
      prompt: "p",
      repeat: { kind: "daily" },
      timeOfDay: "09:00",
      enabled: true,
      createdAt: "2026-07-01T00:00:00+00:00",
      updatedAt: "2026-07-01T00:00:00+00:00",
      ...patch,
    };
  }

  it("counts enabled tasks that fired without producing a session", () => {
    expect(
      countFailedTasks([
        // Fired, no session → the failure the badge must surface.
        task({ lastFiredAt: "2026-07-30T01:00:00+00:00" }),
        // Fired with a session → healthy.
        task({
          lastFiredAt: "2026-07-30T01:00:00+00:00",
          lastRunSessionId: "sess_ok",
        }),
        // Never fired → nothing to report.
        task({}),
      ]),
    ).toBe(1);
  });

  it("excludes disabled tasks — pausing is the user's handling", () => {
    expect(
      countFailedTasks([
        task({ lastFiredAt: "2026-07-30T01:00:00+00:00", enabled: false }),
      ]),
    ).toBe(0);
  });

  it("excludes tasks that wake the assistant — they start no session", () => {
    expect(
      countFailedTasks([
        task({
          lastFiredAt: "2026-07-30T01:00:00+00:00",
          target: "assistant",
        }),
      ]),
    ).toBe(0);
  });
});

describe("formFromTask", () => {
  const base: ScheduledTask = {
    id: "sched_x",
    prompt: "p",
    repeat: { kind: "weekly", weekdays: [1, 5] },
    timeOfDay: "09:00",
    enabled: true,
    createdAt: "2026-07-01T00:00:00+00:00",
    updatedAt: "2026-07-01T00:00:00+00:00",
  };

  it("fills the form for a repeating task", () => {
    expect(formFromTask(base)).toEqual({
      id: "sched_x",
      prompt: "p",
      projectId: "",
      repeatKind: "weekly",
      weekdays: [1, 5],
      monthdays: [],
      timeOfDay: "09:00",
      llmName: "",
    });
  });

  it("has no form for a one-off", () => {
    expect(
      formFromTask({
        ...base,
        repeat: { kind: "once" },
        fireAt: "2026-10-20T12:00:00+00:00",
      }),
    ).toBeNull();
  });
});
