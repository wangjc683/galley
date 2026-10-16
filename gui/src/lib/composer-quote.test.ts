import { describe, expect, it } from "vitest";

import { markdownQuote, textWithQuote } from "./composer-quote";

describe("markdownQuote", () => {
  it("quotes one line", () => {
    expect(markdownQuote("这一句")).toBe("> 这一句");
  });

  it("quotes every line, blank lines as one bare >", () => {
    expect(markdownQuote("第一段\n第二行\n\n\n第二段")).toBe(
      "> 第一段\n> 第二行\n>\n> 第二段",
    );
  });

  it("drops blank lines at the ends and trailing spaces", () => {
    expect(markdownQuote("\n  \n开头前有空行  \n\n")).toBe("> 开头前有空行");
  });

  it("keeps a line's indentation and reads CRLF as one break", () => {
    expect(markdownQuote("列表：\r\n  - 子项")).toBe("> 列表：\n>   - 子项");
  });
});

describe("textWithQuote", () => {
  it("fills an empty composer: quote, blank line, caret line", () => {
    expect(textWithQuote("", "这一句")).toBe("> 这一句\n\n");
    expect(textWithQuote("  \n", "这一句")).toBe("> 这一句\n\n");
  });

  it("follows text already there after one blank line", () => {
    expect(textWithQuote("先说一句", "这一句")).toBe(
      "先说一句\n\n> 这一句\n\n",
    );
    expect(textWithQuote("先说一句\n\n\n", "这一句")).toBe(
      "先说一句\n\n> 这一句\n\n",
    );
  });

  it("stacks a second quote under the first", () => {
    const once = textWithQuote("", "第一处");
    expect(textWithQuote(once, "第二处\n第二行")).toBe(
      "> 第一处\n\n> 第二处\n> 第二行\n\n",
    );
  });

  it("leaves the composer as it was for a selection with no text", () => {
    expect(textWithQuote("草稿", " \n ")).toBe("草稿");
  });
});
