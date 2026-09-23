import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView";
import { LocalFilesContext } from "@/lib/local-files";

function render(source: string, softBreaks = false) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <MarkdownView source={source} variant="agent" softBreaks={softBreaks} />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

describe("MarkdownView softBreaks", () => {
  it("keeps a single newline as a line break only when softBreaks is on", () => {
    const source = "第一个问题？\n第二个问题？";
    expect(render(source, true)).toContain("<br");
    expect(render(source, false)).not.toContain("<br");
  });
  it("leaves lists and code blocks alone under softBreaks", () => {
    expect(render("1. 方案 A\n2. 方案 B", true)).toContain("<ol");
    expect(render("1. 方案 A\n2. 方案 B", true)).not.toContain("<br");
    expect(render("```\na\nb\n```", true)).not.toContain("<br");
  });
  it("always opts the prose back into text selection", () => {
    expect(render("hi")).toContain("select-text");
  });
});

// CommonMark keeps these `**` literal (commonmark-spec#650); the
// remark-cjk-friendly plugin is what turns them into strong.
describe("MarkdownView CJK-adjacent emphasis", () => {
  it("renders a bold label closed by a full-width colon in a list item", () => {
    const html = render("- **早餐：**肠粉、粿条汤。");
    expect(html).toContain("<strong>早餐：</strong>肠粉、粿条汤。");
    expect(html).not.toContain("**");
  });
  it("renders a bold label closed by a full-width colon in a paragraph", () => {
    const html = render("**注意地理范围：**揭西、普宁都属于揭阳。");
    expect(html).toContain(
      "<strong>注意地理范围：</strong>揭西、普宁都属于揭阳。",
    );
    expect(html).not.toContain("**");
  });
  it("renders a quoted strong run glued to CJK letters", () => {
    for (const source of ['名叫**"下一个字"**的字', "名叫**“下一个字”**的字"]) {
      const html = render(source);
      expect(html).toMatch(/名叫<strong>[^<]*下一个字[^<]*<\/strong>的字/);
      expect(html).not.toContain("**");
    }
  });
  it("leaves genuine literal asterisks alone", () => {
    const table = render("| 车型 | 高度 |\n| --- | --- |\n| G6* | 510cm* |");
    expect(table).toContain("G6*");
    expect(table).toContain("510cm*");
    const prose = render("支持 gpt-* 系列模型。");
    expect(prose).toContain("gpt-*");
    for (const html of [table, prose]) {
      expect(html).not.toContain("<em>");
      expect(html).not.toContain("<strong>");
    }
  });
});
