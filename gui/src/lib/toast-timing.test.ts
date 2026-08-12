import { describe, expect, it } from "vitest";

import { resumeDelay, TOAST_RESUME_FLOOR_MS } from "@/lib/toast-timing";

describe("resumeDelay", () => {
  it("uses the full budget on the first start", () => {
    expect(resumeDelay(null, 6000)).toBe(6000);
  });

  it("resumes with what was left", () => {
    expect(resumeDelay(4200, 6000)).toBe(4200);
  });

  it("floors a nearly-expired resume so the toast does not vanish on mouse-out", () => {
    expect(resumeDelay(40, 6000)).toBe(TOAST_RESUME_FLOOR_MS);
    expect(resumeDelay(0, 6000)).toBe(TOAST_RESUME_FLOOR_MS);
  });

  it("never floors past the toast's own budget", () => {
    // A caller asking for a 300ms toast means it; grazing the pointer over
    // it must not turn it into an 800ms one.
    expect(resumeDelay(10, 300)).toBe(300);
  });
});
