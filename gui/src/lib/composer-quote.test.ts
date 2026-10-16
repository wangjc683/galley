import { describe, expect, it } from "vitest";

import {
  composeQuotedMessage,
  markdownQuote,
  quotedMessagePreview,
  snippetQuoteSegments,
  splitQuotedMessage,
  wholeMessageQuote,
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

describe("wholeMessageQuote", () => {
  it("quotes a short message whole", () => {
    expect(wholeMessageQuote("明天几点出发？", false)).toBe("明天几点出发？");
    expect(wholeMessageQuote("第一行\n\n第二行", false)).toBe("第一行\n第二行");
  });

  it("takes three lines at most, then 「…」", () => {
    expect(wholeMessageQuote("一\n二\n三\n四", false)).toBe("一\n二\n三…");
  });

  it("takes about 120 CJK characters (240 columns), then 「…」", () => {
    const quote = wholeMessageQuote("字".repeat(200), false);
    expect(quote).toBe(`${"字".repeat(120)}…`);
    // Latin counts one column a character.
    expect(wholeMessageQuote("a".repeat(300), false)).toBe(
      `${"a".repeat(240)}…`,
    );
    // The budget runs across lines: 100 + 20 characters.
    expect(
      wholeMessageQuote(`${"甲".repeat(100)}\n${"乙".repeat(50)}`, false),
    ).toBe(`${"甲".repeat(100)}\n${"乙".repeat(20)}…`);
  });

  it("leaves no separator dangling before 「…」", () => {
    expect(wholeMessageQuote(`${"字".repeat(119)}，后面`, false)).toBe(
      `${"字".repeat(119)}…`,
    );
  });

  it("your message: your words, not the quotes at their head", () => {
    expect(wholeMessageQuote("> 它说的\n\n我的问题", false)).toBe("我的问题");
    expect(wholeMessageQuote("> 只有引用", false)).toBe("只有引用");
  });

  it("a reply reads as it shows: Markdown markers off", () => {
    expect(
      wholeMessageQuote(
        "## 结论\n\n**周五**去，见[行程](https://example.com)。",
        true,
      ),
    ).toBe("结论\n周五去，见行程。");
    expect(
      wholeMessageQuote("- 第一项 `code`\n- [x] 第二项\n1. 第三项", true),
    ).toBe("• 第一项 code\n• 第二项\n1. 第三项");
    expect(wholeMessageQuote("![图](a.png)\n\n> 引一句", true)).toBe("引一句");
  });

  it("stops at a code block or a table: the prose before it", () => {
    expect(
      wholeMessageQuote("运行这个：\n\n```bash\nls -la\n```\n\n就好。", true),
    ).toBe("运行这个…");
    expect(
      wholeMessageQuote(
        "对比如下\n\n| 日期 | 天气 |\n|---|---|\n| 周五 | 晴 |",
        true,
      ),
    ).toBe("对比如下…");
  });

  it("a reply opening with one: its first line", () => {
    expect(wholeMessageQuote("```bash\n\nls -la\ncd ~\n```", true)).toBe(
      "ls -la…",
    );
    expect(wholeMessageQuote("```\nls -la\n```", true)).toBe("ls -la");
    expect(
      wholeMessageQuote("| 日期 | 天气 |\n| --- | --- |\n| 周五 | 晴 |", true),
    ).toBe("日期 | 天气…");
  });

  it("nothing to quote: empty", () => {
    expect(wholeMessageQuote("   \n ", false)).toBe("");
    expect(wholeMessageQuote("![图](a.png)", true)).toBe("");
  });
});
