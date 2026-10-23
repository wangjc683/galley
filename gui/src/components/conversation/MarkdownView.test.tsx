import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView";
import { MessageAgent } from "./MessageAgent";
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

// Short table columns stay on one line (main chat PRD ruling 136, ticket
// 92); the rule itself is lib/table-short-columns.test.ts's.
describe("MarkdownView short table columns", () => {
  // The table from a main-chat reply of 2026-10-23, verbatim: its team
  // names stood two, then one, characters a line.
  const EAST = [
    "| 常规赛排名 | 球队 | 我的判断 |",
    "|---|---|---|",
    "| **1** | **尼克斯** | 卫冕核心仍在，布伦森的关键球、主力之间的默契最值得信任。隐患是失去米切尔·罗宾逊后，护筐和内线深度下降。 |",
    "| **2** | **凯尔特人** | 布朗离队损失很大，但塔图姆领衔，配上怀特、普里查德和成熟体系，常规赛下限仍高。乔治的健康和状态决定季后赛上限。 |",
    "| **4** | **76人** | 马克西、布朗、詹姆斯、恩比德加埃奇库姆，纸面天赋最吓人。但阵容磨合、恩比德出勤和老将体能，让我不敢押常规赛第一。 |",
    "| **7** | **步行者** | 我愿意押哈利伯顿回归带来的反弹。卡莱尔的调整能力、哈利伯顿与祖巴茨的挡拆值得期待，但不能默认跟腱伤后马上恢复巅峰。 |",
  ].join("\n");

  /** Each row's cells, true where the cell carries the short mark. */
  function marks(html: string): boolean[][] {
    return [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map((row) =>
      [...row[1].matchAll(/<t[hd]([^>]*)>/g)].map((cell) =>
        cell[1].includes('data-short-col=""'),
      ),
    );
  }

  it("marks the rank and team columns of the real table, not the judgement", () => {
    const html = render(EAST);
    expect(marks(html)).toEqual(Array(5).fill([true, true, false]));
    // …and the marked cells are the ones the prose keeps on one line.
    expect(html).toContain(
      "[&amp;_th[data-short-col]]:whitespace-nowrap [&amp;_td[data-short-col]]:whitespace-nowrap",
    );
  });

  it("marks nothing when the short columns come to more than 40", () => {
    // Six columns of 8 CJK characters: each is short, together 96.
    const row = (cell: string) => `| ${Array(6).fill(cell).join(" | ")} |`;
    const html = render(
      [
        row("一二三四五六七八"),
        `|${"---|".repeat(6)}`,
        row("八七六五四三二一"),
      ].join("\n"),
    );
    expect(marks(html)).toEqual(Array(2).fill(Array(6).fill(false)));
    expect(html).not.toContain('data-short-col=""');
  });

  it("reads a cell as it renders: bold, a link's text, inline code's text", () => {
    // Each written past 16 columns, each 16 or fewer as it reads; the
    // three come to exactly 40.
    const html = render(
      [
        "| 加粗 | 链接 | 代码 | 说明 |",
        "|---|---|---|---|",
        "| **一二三四五六七八** | [链接文字](https://example.com/a/very/long/path) | `abcdefghijklmnop` | 这一列写得很长，长过十六个显示单位。 |",
      ].join("\n"),
    );
    expect(marks(html)).toEqual(Array(2).fill([true, true, true, false]));
  });

  it("draws only the delimiter row's columns, and leaves a missing cell unmarked", () => {
    // The two drawn columns come to 32; counted, the third cell (never
    // drawn) would take them to 42 and nothing would be marked.
    const html = render(
      [
        "| 第一列写满八个字 | 第二列也写八个字 |",
        "|---|---|",
        "| 1 |",
        "| 2 | 短 | 不画的一格 |",
      ].join("\n"),
    );
    expect(marks(html)).toEqual([
      [true, true],
      [true, false],
      [true, true],
    ]);
  });

  it("marks the same cells in the workbench, the main chat bubble, thinking and a document", () => {
    const views = [
      <MessageAgent key="workbench">{EAST}</MessageAgent>,
      <MessageAgent key="bubble" bubble messageId="a1">
        {EAST}
      </MessageAgent>,
      <MarkdownView key="thinking" source={EAST} variant="thinking" />,
      <MarkdownView
        key="document"
        source={EAST}
        variant="agent"
        documentPath="/tmp/east.md"
      />,
    ].map((node) =>
      renderToStaticMarkup(
        <Tooltip.Provider>
          <LocalFilesContext.Provider value={() => undefined}>
            {node}
          </LocalFilesContext.Provider>
        </Tooltip.Provider>,
      ),
    );
    expect(views[1]).toContain('data-role="assistant-bubble"');
    for (const html of views) {
      expect(marks(html)).toEqual(Array(5).fill([true, true, false]));
    }
  });
});
