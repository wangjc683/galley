import { describe, expect, it } from "vitest";

import {
  composeQuotedMessage,
  markdownQuote,
  quotedMessagePreview,
  snippetQuoteSegments,
  splitQuotedMessage,
} from "./composer-quote";

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

describe("composeQuotedMessage", () => {
  it("puts the quotes ahead of your words, a blank line apart", () => {
    expect(composeQuotedMessage(["这一句"], "什么意思")).toBe(
      "> 这一句\n\n什么意思",
    );
    expect(
      composeQuotedMessage(["第一处", "第二处\n第二行"], "这两处什么意思"),
    ).toBe("> 第一处\n\n> 第二处\n> 第二行\n\n这两处什么意思");
  });

  it("keeps each quote's formatting rules (blank lines, CRLF)", () => {
    expect(composeQuotedMessage(["一段\r\n\r\n\r\n二段"], "嗯")).toBe(
      "> 一段\n>\n> 二段\n\n嗯",
    );
  });

  it("is your words alone without quotes, the quotes alone without words", () => {
    expect(composeQuotedMessage([], "只有话")).toBe("只有话");
    expect(composeQuotedMessage([" \n "], "只有话")).toBe("只有话");
    expect(composeQuotedMessage(["配图说明"], "")).toBe("> 配图说明");
  });

  it("keeps /btw at the head of a side question", () => {
    const sent = composeQuotedMessage(["这一句"], "/btw 什么意思");
    expect(sent).toBe("/btw \n> 这一句\n\n什么意思");
    // Still a side question for the bridge's and GA's prefix check.
    expect(sent.startsWith("/btw ")).toBe(true);
    expect(composeQuotedMessage(["这一句"], "/btw")).toBe("/btw \n> 这一句");
  });
});

describe("splitQuotedMessage", () => {
  it("reads one quote off the head", () => {
    expect(splitQuotedMessage("> 这一句\n\n什么意思")).toEqual({
      quotes: ["这一句"],
      body: "什么意思",
    });
  });

  it("reads several, blank lines between them, blank lines inside one", () => {
    expect(
      splitQuotedMessage(
        "> 第一处\n\n> 第二处\n>\n> 第二段\n\n\n这两处什么意思\n第二行",
      ),
    ).toEqual({
      quotes: ["第一处", "第二处\n\n第二段"],
      body: "这两处什么意思\n第二行",
    });
  });

  it("round-trips what composeQuotedMessage sends", () => {
    const quotes = ["一句", "两行\n第二行"];
    expect(splitQuotedMessage(composeQuotedMessage(quotes, "问题"))).toEqual({
      quotes,
      body: "问题",
    });
  });

  it("only reads the head: a > further down is your text", () => {
    const text = "先说\n> 这不是引用\n后面";
    expect(splitQuotedMessage(text)).toEqual({ quotes: [], body: text });
    expect(splitQuotedMessage("> 引用\n\n正文\n> 中间的")).toEqual({
      quotes: ["引用"],
      body: "正文\n> 中间的",
    });
  });

  it("takes a message of quotes only, and a hand-typed >", () => {
    expect(splitQuotedMessage("> 只有引用")).toEqual({
      quotes: ["只有引用"],
      body: "",
    });
    expect(splitQuotedMessage(">没有空格\n话")).toEqual({
      quotes: ["没有空格"],
      body: "话",
    });
  });

  it("reads CRLF as one break and leaves a message without quotes as it came", () => {
    expect(splitQuotedMessage("> 一句\r\n\r\n话")).toEqual({
      quotes: ["一句"],
      body: "话",
    });
    expect(splitQuotedMessage("  普通的话\r\n")).toEqual({
      quotes: [],
      body: "  普通的话\r\n",
    });
    expect(splitQuotedMessage("")).toEqual({ quotes: [], body: "" });
  });

  it("drops empty quote blocks", () => {
    expect(splitQuotedMessage(">\n> \n\n话")).toEqual({
      quotes: [],
      body: ">\n> \n\n话",
    });
  });

  it("keeps /btw at the head of the body", () => {
    expect(splitQuotedMessage("/btw \n> 这一句\n\n什么意思")).toEqual({
      quotes: ["这一句"],
      body: "/btw 什么意思",
    });
    expect(splitQuotedMessage("/btw \n> 这一句")).toEqual({
      quotes: ["这一句"],
      body: "/btw",
    });
    // A /btw without quotes is left alone.
    expect(splitQuotedMessage("/btw 进展如何")).toEqual({
      quotes: [],
      body: "/btw 进展如何",
    });
  });
});

describe("quotedMessagePreview", () => {
  it("is your words, or the quotes when there are none", () => {
    expect(quotedMessagePreview("> 引用\n\n我的话")).toBe("我的话");
    expect(quotedMessagePreview("> 一\n\n> 二")).toBe("一 二");
    expect(quotedMessagePreview("普通")).toBe("普通");
  });
});

describe("snippetQuoteSegments", () => {
  it("cuts a snippet into quote and own-words runs", () => {
    expect(snippetQuoteSegments("> 引用里的«命中»\n\n后面的话")).toEqual([
      { quote: true, text: "引用里的«命中»" },
      { quote: false, text: "后面的话" },
    ]);
  });

  it("reads a quote line after the snippet's opening ellipsis", () => {
    expect(snippetQuoteSegments("…> 半句\n> 下一行\n话")).toEqual([
      { quote: true, text: "…半句 下一行" },
      { quote: false, text: "话" },
    ]);
  });

  it("leaves a snippet with no quote lines as one run", () => {
    expect(snippetQuoteSegments("…普通的«话»…")).toEqual([
      { quote: false, text: "…普通的«话»…" },
    ]);
  });
});
