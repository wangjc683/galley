import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { rememberFilePresence } from "@/lib/file-cards";
import { CopyProvider } from "@/lib/i18n";

import { FileCards } from "./FileCards";

/**
 * The file cards under a main chat reply (main chat ticket 74), drawn.
 * The rules (which reply, the name's cut, the folder, what Core's answer
 * means) are pinned in lib/file-cards.test.ts; here what a card shows in
 * each case. A static render runs no effect, so Core is never asked
 * here: a card starts from what the page remembers (seeded below) or
 * draws as there.
 */

// Thumbnails load through the asset protocol, as the user's own image
// attachments do; outside Tauri convertFileSrc has no bridge.
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: (path: string) =>
    `asset://localhost/${encodeURIComponent(path)}`,
}));

function render(paths: string[], language: "zh-CN" | "en-US" = "zh-CN") {
  return renderToStaticMarkup(
    <CopyProvider language={language}>
      <Tooltip.Provider>
        <FileCards paths={paths} />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("FileCards", () => {
  it("draws one card per file, in marker order, 12px under the bubble", () => {
    const html = render([
      "/Users/jc/Documents/计划/五一出行计划.html",
      "/Users/jc/Documents/报告/q3.pdf",
      "/Users/jc/notes.md",
    ]);
    expect(html).toContain(
      'data-role="file-cards" class="mt-3 flex flex-col gap-2"',
    );
    expect(count(html, 'data-role="file-card"')).toBe(3);
    const order = ["五一出行计划", "q3", "notes"].map((n) => html.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The reminder card's frame, one 40px line, no state bar.
    expect(html).toContain("min-h-10");
    expect(html).toContain("rounded-md border border-line bg-app");
    expect(html).not.toContain("w-[3px]");
  });

  it("shows the name with its extension kept apart and the folder, never the whole path", () => {
    const path = "/Users/jc/Documents/报告/2026年第三季度经营分析报告.pdf";
    const html = render([path]);
    expect(html).toContain(">2026年第三季度经营</span>");
    expect(html).toContain(">分析报告.pdf</span>");
    // The folder (its tooltip is the folder's own path), not the file's.
    expect(html).toContain('title="/Users/jc/Documents/报告"');
    expect(html).not.toContain(path);
    expect(html).toContain('aria-label="2026年第三季度经营分析报告.pdf"');
    // A glyph for the kind, and 在文件夹中显示 over the right end on hover.
    expect(html).toContain('aria-label="在文件夹中显示"');
    expect(html).toContain("group-hover/file-card:opacity-100");
  });

  it("draws an image as the attachment thumbnail, side by side with the next", () => {
    const html = render([
      "/Users/jc/Pictures/banner.png",
      "/Users/jc/Pictures/cover.JPG",
      "/Users/jc/plan.html",
    ]);
    expect(count(html, 'data-file-kind="image"')).toBe(2);
    expect(html).toContain(
      "h-24 w-24 overflow-hidden rounded-md border border-line",
    );
    expect(html).toContain(
      `src="asset://localhost/${encodeURIComponent("/Users/jc/Pictures/banner.png")}"`,
    );
    expect(html).toContain('aria-label="预览图片 · banner.png"');
    // The two thumbnails share a wrapping row; the page is a line.
    expect(html).toContain('<div class="flex flex-wrap gap-2">');
    expect(count(html, 'data-file-state="present"')).toBe(3);
  });

  it("keeps a gone file's card, faded, 「已移走或删除」 after the name, nothing to show in a folder", () => {
    rememberFilePresence("/tmp/out/gone.pdf", { state: "missing" });
    rememberFilePresence("/tmp/out/gone.png", { state: "missing" });
    const html = render(["/tmp/out/gone.pdf", "/tmp/out/gone.png"]);
    expect(count(html, 'data-file-state="missing"')).toBe(2);
    // A gone image is a file card, not a broken thumbnail.
    expect(html).not.toContain('data-file-kind="image"');
    expect(count(html, ">已移走或删除<")).toBe(2);
    expect(html).toContain("text-ink-muted");
    expect(html).not.toContain('aria-label="在文件夹中显示"');
    expect(html).not.toContain("group-hover/file-card:bg-hover");
    expect(html).toContain('aria-label="gone.pdf · 已移走或删除"');
  });

  it("says it in English", () => {
    rememberFilePresence("/tmp/out/gone-en.pdf", { state: "missing" });
    const html = render(["/tmp/out/gone-en.pdf", "/tmp/out/fine.txt"], "en-US");
    expect(html).toContain(">Moved or deleted<");
    expect(html).toContain('aria-label="Show in folder"');
  });

  it("draws a folder Core named with the folder glyph and no thumbnail", () => {
    rememberFilePresence("/tmp/out/site.png", {
      state: "present",
      kind: "directory",
      path: "/tmp/out/site.png",
    });
    const html = render(["/tmp/out/site.png"]);
    expect(html).not.toContain('data-file-kind="image"');
    expect(count(html, 'data-file-state="present"')).toBe(1);
  });
});
