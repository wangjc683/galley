import { afterEach, describe, expect, it, vi } from "vitest";

import { saveReplyMarkdown } from "./reply-save";

const dialog = vi.hoisted(() => ({
  save: vi.fn<(options: { defaultPath?: string }) => Promise<string | null>>(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: dialog.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn() }));

describe("saveReplyMarkdown", () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("proposes a filename on the local clock, not UTC", async () => {
    process.env.TZ = "Asia/Shanghai";
    vi.useFakeTimers({ toFake: ["Date"] });
    // 00:30:05 on 11-10 in Shanghai is 16:30:05 on 11-09 in UTC.
    vi.setSystemTime(new Date(2026, 10, 10, 0, 30, 5));
    dialog.save.mockResolvedValue(null);

    await expect(saveReplyMarkdown("# 回复")).resolves.toBe(false);

    expect(dialog.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "galley-20261110-003005.md" }),
    );
  });
});
