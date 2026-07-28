import { describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";

import {
  formatFireTime,
  formDaysValid,
  repeatFromForm,
  repeatSummary,
  EMPTY_SCHEDULED_TASK_FORM,
  SCHEDULER_SUPERVISOR,
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
});
