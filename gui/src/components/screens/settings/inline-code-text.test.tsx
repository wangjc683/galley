import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";

import { InlineCodeText } from "./inline-code-text";

function render(text: string): string {
  return renderToStaticMarkup(<InlineCodeText text={text} />);
}

/** Markup with the chip's class list stripped, so assertions read as structure. */
function shape(text: string): string {
  return render(text).replace(/<code class="[^"]*">/g, "<code>");
}

describe("InlineCodeText", () => {
  it("turns a backtick pair into a code chip and keeps the rest as text", () => {
    expect(shape("用 `galley` 定位。")).toBe("用 <code>galley</code> 定位。");
  });

  it("styles the chip like the other inline code in Settings prose", () => {
    expect(render("`galley`")).toContain("font-mono");
    expect(render("`galley`")).toContain("bg-app");
  });

  it("handles several pairs and code at either end", () => {
    expect(shape("`a` and `b`")).toBe("<code>a</code> and <code>b</code>");
  });

  it("passes plain text through untouched", () => {
    expect(render("没有命令名的句子。")).toBe("没有命令名的句子。");
  });

  it("leaves an unpaired backtick literal instead of swallowing the tail", () => {
    expect(shape("run `galley and more")).toBe("run `galley and more");
    expect(shape("`a` then `b")).toBe("<code>a</code> then `b");
    expect(shape("ends with `")).toBe("ends with `");
  });

  it("leaves an empty pair literal", () => {
    expect(shape("empty `` pair")).toBe("empty `` pair");
  });

  it("escapes markup inside text and code", () => {
    expect(shape("<b> `<i>`")).toBe("&lt;b&gt; <code>&lt;i&gt;</code>");
  });

  it.each([
    ["zh", zhCopy.settings.agent],
    ["en", enCopy.settings.agent],
  ])("renders `galley` as code in the %s Agent copy", (_language, copy) => {
    for (const text of [
      copy.discoveryDescription,
      copy.cliDescription,
      copy.pathUnsupportedWindows,
    ]) {
      const html = shape(text);
      expect(html).toContain("<code>galley</code>");
      expect(html).not.toContain("`");
    }
  });
});
