import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MainHeader } from "./MainHeader";

/**
 * 「主对话 ›」 before the title while an unpromoted subtask is open
 * (main chat ticket 06a). Which session gets it, and what a click
 * opens, is `subtaskBreadcrumb` (lib/subtasks.test.ts); this pins where
 * it sits.
 */

function render(breadcrumb?: Parameters<typeof MainHeader>[0]["breadcrumb"]) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <MainHeader sessionTitle="把 PDF 分类" breadcrumb={breadcrumb} />
    </Tooltip.Provider>,
  );
}

describe("the main header's crumb", () => {
  it("stands before the title: the main chat's name, then a chevron", () => {
    const html = render({
      label: "主对话",
      ariaLabel: "回到主对话",
      onClick: () => {},
    });
    const crumb = html.indexOf('aria-label="回到主对话"');
    expect(crumb).toBeGreaterThan(-1);
    expect(html.indexOf(">主对话<")).toBeGreaterThan(crumb);
    expect(html.indexOf(">主对话<")).toBeLessThan(
      html.indexOf(">把 PDF 分类<"),
    );
    // One step quieter than the title.
    expect(html.slice(crumb, html.indexOf(">主对话<"))).toContain(
      "text-ink-muted",
    );
  });

  it("is absent otherwise", () => {
    const html = render();
    expect(html).not.toContain("回到主对话");
    expect(html).not.toContain(">主对话<");
  });
});
