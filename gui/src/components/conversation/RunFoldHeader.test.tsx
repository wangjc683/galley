import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RunFoldHeader } from "./RunFoldHeader";
import type { RunStats } from "@/lib/run-groups";

// useCopy falls back to the zh copy without a CopyProvider, so the
// expected strings below are the zh labels.

function makeStats(overrides: Partial<RunStats> = {}): RunStats {
  return {
    stepCount: 3,
    elapsedMs: null,
    telemetry: null,
    toolCounts: [],
    deniedCount: 0,
    askUserCount: 0,
    ...overrides,
  };
}

function render(stats: RunStats, live = false): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <RunFoldHeader
        stats={stats}
        open={false}
        onToggle={() => {}}
        live={live}
      />
    </Tooltip.Provider>,
  );
}

/** The first <span> whose class attribute starts with `classPrefix`,
 * through its matching close tag (nested spans included). */
function spanAt(html: string, classPrefix: string): string {
  const start = html.indexOf(`<span class="${classPrefix}`);
  expect(start).toBeGreaterThan(-1);
  const tags = /<span\b|<\/span>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[0] === "</span>" ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`unclosed span: ${classPrefix}`);
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

const STRUCTURE = "shrink-0 tabular-nums";
const SCENT = "min-w-0 truncate";
const INKED_DIGITS = /<span class="([^"]*)">(\d+)<\/span>/g;

/** The structure segment's inked digit runs, in order, after checking
 * each carries ink-soft; plus the text left once they are removed. */
function inkedDigits(structure: string): { digits: string[]; rest: string } {
  const digits: string[] = [];
  for (const [, className, digit] of structure.matchAll(INKED_DIGITS)) {
    expect(className.split(" ")).toContain("text-ink-soft");
    digits.push(digit);
  }
  return { digits, rest: text(structure.replace(INKED_DIGITS, "")) };
}

describe("RunFoldHeader scent order", () => {
  it("leads with file tools, then the rest in count-desc", () => {
    const html = render(
      makeStats({
        toolCounts: [
          { name: "web_execute_js", count: 5 },
          { name: "web_scan", count: 3 },
          { name: "file_patch", count: 2 },
        ],
      }),
    );
    expect(text(spanAt(html, SCENT))).toBe(
      "修改文件 ×2 · 执行网页脚本 ×5 · 读取网页 ×3",
    );
  });

  it("keeps count-desc inside each partition, first appearance on ties", () => {
    const html = render(
      makeStats({
        toolCounts: [
          { name: "web_scan", count: 2 },
          { name: "file_write", count: 1 },
          { name: "code_run", count: 2 },
          { name: "file_patch", count: 3 },
        ],
      }),
    );
    expect(text(spanAt(html, SCENT))).toBe(
      "修改文件 ×3 · 写入文件 · 读取网页 ×2 · 运行代码 ×2",
    );
  });
});

describe("RunFoldHeader structure segment", () => {
  it("inks only the digit runs of the settled steps and duration", () => {
    const html = render(makeStats({ stepCount: 9, elapsedMs: 147_000 }));
    const structure = spanAt(html, STRUCTURE);
    expect(text(structure)).toBe("9 步 · 用时 2 分 27 秒");

    const { digits, rest } = inkedDigits(structure);
    expect(digits).toEqual(["9", "2", "27"]);
    // Every digit sits inside an inked span; the words stay outside.
    expect(rest).not.toMatch(/\d/);
    expect(rest).toBe(" 步 · 用时  分  秒");
    // The inked spans follow the row's hover / focus lift by name.
    expect(html).toMatch(/data-role="run-fold" class="group\/fold /);
  });

  it("live: inks the completed-step count and shows no duration", () => {
    const html = render(makeStats({ stepCount: 4, elapsedMs: 147_000 }), true);
    const structure = spanAt(html, STRUCTURE);
    expect(text(structure)).toBe("已完成 4 步");

    const { digits, rest } = inkedDigits(structure);
    expect(digits).toEqual(["4"]);
    expect(rest).toBe("已完成  步");
    expect(html).not.toContain("用时");
  });
});
