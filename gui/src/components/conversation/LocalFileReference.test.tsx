import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView";
import { LocalFilesContext } from "@/lib/local-files";

function render(source: string, documentPath?: string) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <MarkdownView
          source={source}
          variant="agent"
          documentPath={documentPath}
        />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

describe("Markdown file references", () => {
  it("makes full paths and file links actionable but not code fences or relative chat paths", () => {
    expect(render("`/tmp/report.md`")).toContain("在文件夹中显示");
    expect(render("[报告](file:///tmp/report.md)")).toContain("在文件夹中显示");
    expect(render("`output/report.md`")).not.toContain("<button");
    expect(render("[报告](output/report.md)")).not.toContain("href=");
    expect(render("```\n/tmp/report.md\n```")).not.toContain("在文件夹中显示");
  });
  it("does not nest path buttons inside links with code labels", () => {
    const html = render("[`/tmp/report.md`](/tmp/report.md)");
    expect(html.match(/<button /g)).toHaveLength(2); // primary + folder
    expect(html).not.toMatch(
      /<button[^>]*>[^]*?<button[^>]*>[^]*?<\/button>[^]*?<\/button>/,
    );
  });
  it("resolves relative document links and preserves external link behavior", () => {
    expect(render("[Next](./next.md)", "/tmp/report.md")).toContain(
      "在文件夹中显示",
    );
    expect(render("[Web](https://example.com)")).toContain(
      'href="https://example.com"',
    );
    expect(render("[Run](javascript:alert(1))")).not.toContain("href=");
  });

  it("renders document heading anchors without adding IDs to ordinary chat headings", () => {
    const source = "[Summary](#summary)\n\n# Summary\n\n# Summary";
    const html = render(source, "/tmp/report.md");
    expect(html).toContain('href="#summary"');
    expect(html).toContain('id="summary"');
    expect(html).toContain('id="summary-1"');
    expect(render(source)).not.toContain('id="summary"');
  });
});
