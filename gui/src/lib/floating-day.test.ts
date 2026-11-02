// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import {
  FLOATING_DAY_PROBE_PX,
  ROW_AT_ATTRIBUTE,
  floatingDayLabel,
  rowAt,
  timedRowAt,
  topRowAt,
} from "@/lib/floating-day";

/*
 * The main chat's floating day (ruling 171, ticket 124): which day the
 * row at the top of the viewport was said on, and its words. Local
 * dates throughout, so the cases hold in every time zone.
 */

const TODAY = new Date(2026, 10, 2).getTime();
const ZH = { today: zhCopy.todo.dayToday, yesterday: zhCopy.todo.dayYesterday };
const EN = { today: enCopy.todo.dayToday, yesterday: enCopy.todo.dayYesterday };

function at(...parts: [number, number, number, number?, number?]): number {
  const [y, m, d, h = 12, min = 0] = parts;
  return new Date(y, m, d, h, min).getTime();
}

describe("floatingDayLabel", () => {
  it("says nothing for today, from its first minute to its last", () => {
    expect(floatingDayLabel(at(2026, 10, 2, 0, 0), TODAY, "zh-CN", ZH)).toBe(
      null,
    );
    expect(floatingDayLabel(at(2026, 10, 2, 9, 10), TODAY, "zh-CN", ZH)).toBe(
      null,
    );
    expect(floatingDayLabel(at(2026, 10, 2, 23, 59), TODAY, "en-US", EN)).toBe(
      null,
    );
  });

  it("says nothing for a moment later than today (a skewed clock reads as today)", () => {
    expect(floatingDayLabel(at(2026, 10, 3, 8, 0), TODAY, "zh-CN", ZH)).toBe(
      null,
    );
    expect(floatingDayLabel(at(2027, 0, 1), TODAY, "en-US", EN)).toBe(null);
  });

  it("says nothing without a moment", () => {
    expect(floatingDayLabel(null, TODAY, "zh-CN", ZH)).toBe(null);
  });

  it("says 昨天 / Yesterday for yesterday, at either end of it", () => {
    expect(floatingDayLabel(at(2026, 10, 1, 23, 59), TODAY, "zh-CN", ZH)).toBe(
      "昨天",
    );
    expect(floatingDayLabel(at(2026, 10, 1, 0, 0), TODAY, "zh-CN", ZH)).toBe(
      "昨天",
    );
    expect(floatingDayLabel(at(2026, 10, 1, 8, 0), TODAY, "en-US", EN)).toBe(
      "Yesterday",
    );
  });

  it("writes the date for earlier this year: no weekday, no clock", () => {
    expect(floatingDayLabel(at(2026, 9, 28, 14, 32), TODAY, "zh-CN", ZH)).toBe(
      "10月28日",
    );
    // Two days back is a date too, not 「周六」.
    expect(floatingDayLabel(at(2026, 9, 31), TODAY, "zh-CN", ZH)).toBe(
      "10月31日",
    );
    expect(floatingDayLabel(at(2026, 9, 28, 14, 32), TODAY, "en-US", EN)).toBe(
      "Oct 28",
    );
    expect(floatingDayLabel(at(2026, 0, 1, 0, 0), TODAY, "zh-CN", ZH)).toBe(
      "1月1日",
    );
  });

  it("adds the year for another year", () => {
    expect(floatingDayLabel(at(2025, 11, 31, 23, 0), TODAY, "zh-CN", ZH)).toBe(
      "2025年12月31日",
    );
    expect(floatingDayLabel(at(2025, 11, 31, 23, 0), TODAY, "en-US", EN)).toBe(
      "Dec 31, 2025",
    );
  });

  it("re-reads 「today」 from the stamp it is given: past midnight, today becomes 昨天", () => {
    const tomorrow = new Date(2026, 10, 3).getTime();
    expect(floatingDayLabel(at(2026, 10, 2, 9, 0), tomorrow, "zh-CN", ZH)).toBe(
      "昨天",
    );
  });
});

describe("rowAt", () => {
  it("is the ISO moment in ms, nothing without one or when it does not parse", () => {
    expect(rowAt("2026-11-01T08:30:00.000Z")).toBe(
      Date.UTC(2026, 10, 1, 8, 30),
    );
    expect(rowAt(undefined)).toBe(undefined);
    expect(rowAt("")).toBe(undefined);
    expect(rowAt("not a time")).toBe(undefined);
  });
});

describe("timedRowAt", () => {
  const rows = (ats: (number | null)[]) => (i: number) => ats[i];

  it("is the row's own moment when it has one", () => {
    expect(timedRowAt(3, rows([1, 2, 3]), 1)).toBe(2);
  });

  it("takes the nearest row below with one for a row without (a time line, a process card)", () => {
    expect(timedRowAt(4, rows([1, null, null, 4]), 1)).toBe(4);
    expect(timedRowAt(3, rows([null, 2, 3]), 0)).toBe(2);
  });

  it("never looks above: none below is none", () => {
    expect(timedRowAt(3, rows([1, null, null]), 1)).toBe(null);
  });

  it("is none for no row", () => {
    expect(timedRowAt(3, rows([1, 2, 3]), -1)).toBe(null);
    expect(timedRowAt(0, rows([]), 0)).toBe(null);
  });
});

describe("topRowAt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  /** A scroll container whose rows stack from its top: `[height, at]`,
   * at null for a row without a moment. Rows report their box from the
   * container's `scrollTop`, as a laid-out page would. */
  function page(rows: [number, number | null][]) {
    const container = document.createElement("div");
    const column = document.createElement("div");
    const conversation = document.createElement("div");
    conversation.setAttribute("data-role", "conversation");
    let y = 24; // the scroll container's py-6
    const boxes = new Map<Element, { top: number; height: number }>();
    for (const [height, rowMs] of rows) {
      const row = document.createElement("div");
      if (rowMs !== null) row.setAttribute(ROW_AT_ATTRIBUTE, String(rowMs));
      boxes.set(row, { top: y, height });
      y += height;
      conversation.append(row);
    }
    column.append(conversation);
    container.append(column);
    document.body.append(container);
    const reads = { container: 0, rows: 0 };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === container) {
          reads.container += 1;
          return new DOMRect(0, 100, 600, 400);
        }
        const box = boxes.get(this);
        if (!box) return new DOMRect();
        reads.rows += 1;
        return new DOMRect(
          0,
          100 + box.top - container.scrollTop,
          600,
          box.height,
        );
      },
    );
    return { container, reads };
  }

  it("reads the row a line under the viewport's top edge crosses", () => {
    const { container } = page([
      [100, 1],
      [100, 2],
      [100, 3],
    ]);
    container.scrollTop = 0;
    expect(topRowAt(container, 0)).toBe(1);
    container.scrollTop = 150; // the top edge crosses the second row
    expect(topRowAt(container, 0)).toBe(2);
    container.scrollTop = 124; // the first row's bottom on the edge: the next
    expect(topRowAt(container, 0)).toBe(2);
  });

  it("takes a time line's moment from the message under it", () => {
    const { container } = page([
      [100, 1],
      [30, null],
      [100, 3],
    ]);
    container.scrollTop = 130; // inside the time line
    expect(topRowAt(container, 0)).toBe(3);
  });

  it("reads at the capsule's bottom edge: a time line behind the capsule gives the day under it, not the reply above it", () => {
    expect(FLOATING_DAY_PROBE_PX).toBe(12 + 24);
    // A reply whose empty action row is the last 30px of its row, the
    // time line right under it (rows from y 24 on).
    const { container } = page([
      [130, 1],
      [11, null],
      [60, 3],
    ]);
    // The time line's top 20px under the viewport's top edge: behind
    // the capsule, the reply's bubble out of sight above.
    container.scrollTop = 24 + 130 - 20;
    expect(topRowAt(container, 0)).toBe(1);
    expect(topRowAt(container)).toBe(3);
    // The time line under the capsule, the reply's last lines above it.
    container.scrollTop = 24 + 130 - 50;
    expect(topRowAt(container)).toBe(1);
  });

  it("is none without a conversation, or with no timed row from the top down", () => {
    const empty = document.createElement("div");
    expect(topRowAt(empty)).toBe(null);
    const { container } = page([
      [100, 1],
      [100, null],
    ]);
    container.scrollTop = 150;
    expect(topRowAt(container, 0)).toBe(null);
  });

  it("measures a handful of rows, not all of them, and writes nothing", () => {
    const { container, reads } = page(
      Array.from({ length: 400 }, (_, i) => [100, i] as [number, number]),
    );
    container.scrollTop = 20_050; // row 200 runs from 20 024 to 20 124
    expect(topRowAt(container, 0)).toBe(200);
    expect(reads.container).toBe(1);
    expect(reads.rows).toBeLessThanOrEqual(10);
    expect(container.scrollTop).toBe(20_050);
  });
});
