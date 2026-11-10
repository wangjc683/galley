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
  it("draws one line per file, in marker order, in the reply's frame", () => {
    const html = render([
      "/Users/me/Documents/计划/五一出行计划.html",
      "/Users/me/Documents/报告/q3.pdf",
      "/Users/me/notes.md",
    ]);
    // No margin, no gap: lines one after another in ReplyCards' frame.
    expect(html).toContain('data-role="file-cards" class="flex flex-col"');
    expect(count(html, 'data-role="file-card"')).toBe(3);
    const order = ["五一出行计划", "q3", "notes"].map((n) => html.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // A 24px line at the step size (ruling 182), no frame of its own, no
    // state bar.
    expect(html).toContain(
      "flex h-6 min-w-0 items-center rounded-sm px-2 [font-size:var(--conversation-step-size)]",
    );
    expect(html).not.toContain("min-h-10");
    expect(html).not.toContain("border-line bg-app");
    expect(html).not.toContain("w-[3px]");
  });

  it("shows the name with its extension kept apart and the folder, never the whole path", () => {
    const path = "/Users/me/Documents/报告/2026年第三季度经营分析报告.pdf";
    const html = render([path]);
    expect(html).toContain(">2026年第三季度经营</span>");
    expect(html).toContain(">分析报告.pdf</span>");
    // The folder (its tooltip is the folder's own path), not the file's.
    expect(html).toContain('title="/Users/me/Documents/报告"');
    expect(html).not.toContain(path);
    expect(html).toContain('aria-label="2026年第三季度经营分析报告.pdf"');
    // A glyph for the kind, and 在文件夹中显示 beside the right end on
    // hover: outside the frame (9px past the line), the line not making
    // room for it.
    expect(html).toContain('aria-label="在文件夹中显示"');
    expect(html).toContain("group-hover/file-card:opacity-100");
    expect(html).toContain("absolute inset-y-0 left-full");
    expect(html).toContain("pl-[9px]");
    // The line no longer makes room for it on hover.
    expect(html).not.toMatch(/group-hover\/file-card:pr-/);
  });

  // The folder 8px after the name, ink-muted, capped by a length: the
  // frame sizes itself to its widest line, and a percentage is not known
  // then, so a long folder set the frame's width (ticket 132b).
  it("caps the folder at 16em, never a share of the line", () => {
    const html = render([
      "/Users/me/Library/Application Support/app.galley/managed/state/temp/模板.md",
    ]);
    expect(html).toContain("ml-2 max-w-[16em] shrink-0 text-ink-muted");
    expect(html).not.toMatch(/max-w-\[\d+%\]/);
    // The name ink-soft, to ink on hover or focus; the line lights.
    expect(html).toContain(
      "text-ink-soft group-hover/file-card:text-ink group-focus-visible/file-line:text-ink",
    );
    expect(html).toContain(
      "group-hover/file-card:bg-hover focus-visible:bg-hover",
    );
  });

  it("draws an image as the attachment thumbnail, side by side with the next", () => {
    const html = render([
      "/Users/me/Pictures/banner.png",
      "/Users/me/Pictures/cover.JPG",
      "/Users/me/plan.html",
    ]);
    expect(count(html, 'data-file-kind="image"')).toBe(2);
    expect(html).toContain(
      "h-24 w-24 overflow-hidden rounded-md border border-line",
    );
    expect(html).toContain(
      `src="asset://localhost/${encodeURIComponent("/Users/me/Pictures/banner.png")}"`,
    );
    expect(html).toContain('aria-label="预览图片 · banner.png"');
    // The two thumbnails share a wrapping row, a band of its own in the
    // frame (4px above and below, its left on the icon column); the page
    // is a line.
    expect(html).toContain('<div class="flex flex-wrap gap-2 px-2 py-1">');
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
