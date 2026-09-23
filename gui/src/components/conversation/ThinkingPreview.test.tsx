import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThinkingPreview } from "./ThinkingPreview";
import { LocalFilesContext } from "@/lib/local-files";

function render(text: string, { visible = true }: { visible?: boolean } = {}) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <ThinkingPreview text={text} visible={visible} />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

describe("ThinkingPreview", () => {
  it("renders reasoning in the thinking register, not answer prose", () => {
    const html = render("Check the parser first.");
    expect(html).toContain("Check the parser first.");
    expect(html).toContain("italic");
    expect(html).toContain("--conversation-thinking-size");
    expect(html).not.toContain("--conversation-body-size");
    // Rolling process material: out of the accessibility tree and
    // not a pointer target.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pointer-events-none");
  });

  it("clips to a fixed three-line box with a top fade", () => {
    const html = render("Check the parser first.");
    // Counted in the paragraph line box (thinking size × body leading —
    // see LINE_BOX in the component).
    expect(html).toContain(
      "height:calc(calc(var(--conversation-thinking-size) * var(--conversation-body-leading)) * 3)",
    );
    expect(html).toContain("mask-image");
  });

  it("hands only the tail of long reasoning to the markdown renderer", () => {
    const text = Array.from(
      { length: 120 },
      (_, i) => `Paragraph ${i} ${"x".repeat(100)}`,
    ).join("\n\n");
    const html = render(text);
    expect(html).toContain("Paragraph 119 ");
    expect(html).not.toContain("Paragraph 0 ");
  });

  it("renders nothing while hidden", () => {
    expect(render("Check the parser first.", { visible: false })).toBe("");
    expect(render("")).toBe("");
  });
});
