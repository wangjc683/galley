import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MainHeader } from "./MainHeader";

/**
 * 「Galley ›」 before the title while an unpromoted subtask is open
 * (main chat tickets 06a / 18: the main chat is the assistant, Galley).
 * Which session gets it, and what a click opens, is `subtaskBreadcrumb`
 * (lib/subtasks.test.ts); this pins where it sits.
 */

function render(breadcrumb?: Parameters<typeof MainHeader>[0]["breadcrumb"]) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <MainHeader sessionTitle="把 PDF 分类" breadcrumb={breadcrumb} />
    </Tooltip.Provider>,
  );
}

describe("the main header's crumb", () => {
  it("stands before the title: the assistant's name, then a chevron", () => {
    const html = render({
      label: "Galley",
      ariaLabel: "回到 Galley",
      onClick: () => {},
    });
    const crumb = html.indexOf('aria-label="回到 Galley"');
    expect(crumb).toBeGreaterThan(-1);
    expect(html.indexOf(">Galley<")).toBeGreaterThan(crumb);
    expect(html.indexOf(">Galley<")).toBeLessThan(
      html.indexOf(">把 PDF 分类<"),
    );
    // One step quieter than the title.
    expect(html.slice(crumb, html.indexOf(">Galley<"))).toContain(
      "text-ink-muted",
    );
  });

  it("is absent otherwise", () => {
    const html = render();
    expect(html).not.toContain("回到 Galley");
    expect(html).not.toContain(">Galley<");
  });
});
