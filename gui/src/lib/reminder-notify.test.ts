import { describe, expect, it, vi } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import {
  remindUndelivered,
  type ReminderFallbackDeps,
} from "@/lib/reminder-notify";

/**
 * A reminder that could not reach the assistant (main chat ticket 37):
 * its words reach the user where they are — a system notification that
 * lands the window on the assistant when it is in the background, a
 * toast when it is in front.
 */

const PAYLOAD = {
  taskId: "sched_water",
  prompt: "提醒用户喝水",
  reason: "asking" as const,
};

function deps(focused: boolean) {
  return {
    windowFocused: vi.fn(async () => focused),
    pushToast: vi.fn(),
    notify: vi.fn(async () => {}),
  } satisfies ReminderFallbackDeps;
}

describe("remindUndelivered", () => {
  it("in the background: notifies with its words and leaves the view alone", async () => {
    const d = deps(false);
    await expect(remindUndelivered(PAYLOAD, zhCopy, d)).resolves.toBe(
      "notification",
    );
    expect(d.notify).toHaveBeenCalledWith("scheduleFailed", {
      title: "提醒",
      body: "提醒用户喝水",
      throttleKey: "schedule-reminder:sched_water",
      tone: "needsYou",
    });
    expect(d.pushToast).not.toHaveBeenCalled();
  });

  it("in front: a toast that stays, no notification, the view left alone", async () => {
    const d = deps(true);
    await expect(remindUndelivered(PAYLOAD, zhCopy, d)).resolves.toBe("toast");
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.pushToast).toHaveBeenCalledTimes(1);
    const toast = d.pushToast.mock.calls[0][0];
    expect(toast).toMatchObject({
      id: "reminder-undelivered:sched_water",
      severity: "info",
      title: "提醒",
      message: "提醒用户喝水",
      autoDismissMs: 0,
    });
  });
});
