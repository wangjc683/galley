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
