import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CodeBlockContext } from "@/lib/code-block-context";

import { CODE_COLLAPSE_LINES, CodeBlock } from "./CodeBlock";

function lines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");
}

function render(code: string, language: string | null, collapsible = true) {
  return renderToStaticMarkup(
    <CodeBlockContext.Provider value={{ collapsible }}>
      <CodeBlock code={code} language={language} />
    </CodeBlockContext.Provider>,
  );
}

describe("CodeBlock", () => {
  it("folds past CODE_COLLAPSE_LINES with a footer counting the hidden lines", () => {
    const html = render(lines(CODE_COLLAPSE_LINES + 3), "bash");
    expect(html).toContain("还有 3 行");
    expect(html).toContain('aria-expanded="false"');
  });

  it("does not fold at exactly CODE_COLLAPSE_LINES", () => {
    const html = render(lines(CODE_COLLAPSE_LINES), "bash");
    expect(html).not.toContain("还有");
    expect(html).not.toContain("aria-expanded");
  });

  it("never folds while streaming (CodeBlockContext.collapsible = false)", () => {
    const html = render(lines(CODE_COLLAPSE_LINES + 10), "bash", false);
    expect(html).not.toContain("还有");
  });

  it("labels aliases by their canonical language and suppresses text", () => {
    expect(render("# hi", "md")).toContain(">markdown<");
    expect(render("plain", "text")).not.toContain(">text<");
    expect(render("plain", "plaintext")).not.toContain(">plaintext<");
    expect(render("x", "swift")).toContain(">swift<");
  });

  it("always renders the copy control", () => {
    const html = render("ls", "bash");
    expect(html).toContain('aria-label="复制"');
  });

  it("keeps the wrap toggle off until a line overflows", () => {
    // SSR has no layout, so nothing overflows: the toggle must be absent.
    expect(render("a".repeat(400), "bash")).not.toContain("自动换行");
  });
});
