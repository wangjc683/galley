import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Conversation } from "./Conversation";
import { toolEventsFromRaw } from "@/lib/agent-turn";
import { LocalFilesContext } from "@/lib/local-files";
import type { AgentTurn, Turn } from "@/types/conversation";

// One user request and one settled tool step, no closing turn: an
// incomplete run that is not running renders flat in full, so the
// step's marker and body are both in the markup.
function renderStep(step: Omit<AgentTurn, "role" | "tools">): string {
  const turns: Turn[] = [
    { role: "user", content: "帮我查一下营业时间" },
    {
      role: "agent",
      turnIndex: 1,
      tools: [{ id: "t1", name: "web_scan", status: "success-historical" }],
      ...step,
    },
  ];
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <Conversation turns={turns} />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

/** The step's marker row, up to the end of its own <div>. */
function markerRow(html: string): string {
  const start = html.indexOf('data-role="step-marker"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</div>", start));
}

/** The marker row's whole opening tag. React renders the row's role /
 * tabindex / aria-expanded ahead of its data-role, where markerRow's
 * slice would miss them. */
function markerTag(html: string): string {
  const attr = html.indexOf('data-role="step-marker"');
  expect(attr).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<", attr), html.indexOf(">", attr) + 1);
}

function narrationRows(html: string): number {
  return html.split('data-role="agent-narration"').length - 1;
}

describe("Conversation echo-narration step", () => {
  it("puts the narration on the marker line and drops its own row", () => {
    const narration = "营业时间只在搜索摘要里，我去 `厦门网` 原文核对。";
    // GA's fallback: no `<summary>`, so the summary echoes the reply.
    const html = renderStep({ finalAnswer: narration, summary: narration });
    // Cleaned the way the sidebar cleans GA's recap: backticks out.
    expect(markerRow(html)).toContain(
      "营业时间只在搜索摘要里，我去 厦门网 原文核对。",
    );
    expect(narrationRows(html)).toBe(0);
    expect(html).not.toContain("调用了 web_scan");
  });

  it("keeps the summary and the narration row on a step with its own summary", () => {
    const html = renderStep({
      finalAnswer: "我去厦门网原文核对。",
      summary: "核对营业时间",
    });
    expect(markerRow(html)).toContain("核对营业时间");
    expect(markerRow(html)).not.toContain("我去厦门网原文核对。");
    expect(narrationRows(html)).toBe(1);
    expect(html).toContain("我去厦门网原文核对。");
  });
});

describe("Conversation step marker disclosure", () => {
  // `thinking` and `preamble` are what feed the marker's DetailPanel;
  // either one makes the row a disclosure.
  it.each([
    ["thinking", { thinking: "先看搜索摘要，再去原文核对。" }],
    ["preamble", { preamble: "当前阶段：核对营业时间" }],
  ])("makes a settled step with %s a keyboard disclosure", (_, detail) => {
    const html = renderStep({
      finalAnswer: null,
      summary: "核对营业时间",
      ...detail,
    });
    const tag = markerTag(html);
    expect(tag).toContain('role="button"');
    expect(tag).toContain('tabindex="0"');
    expect(tag).toContain('aria-expanded="false"');
    // Named by its content (sr-only step label + summary), not a label.
    expect(tag).not.toContain("aria-label");
  });

  it("leaves a settled step without detail a plain row", () => {
    const html = renderStep({ finalAnswer: null, summary: "核对营业时间" });
    const tag = markerTag(html);
    expect(tag).not.toContain('role="button"');
    expect(tag).not.toContain("tabindex");
    expect(tag).not.toContain("aria-expanded");
  });
});

describe("Conversation browser step site", () => {
  // Sanitized GA results (lib/browser-site.test.ts holds the full set).
  const scan = (tabsOnly: boolean) =>
    `{"status": "success", "metadata": {"tabs_count": 2, "tabs": [{"id": "11", "url": "https://movie.douban.com/top250", "title": "豆瓣电影 Top 250"}, {"id": "12", "url": "https://www.google.com/", "title": "Google"}], "active_tab": "11"}}` +
    (tabsOnly ? "" : "\n```html\n豆瓣电影 Top 250\n```");

  function render(
    steps: { name: string; args: Record<string, unknown>; content: string }[],
  ): string {
    const turns: Turn[] = [
      { role: "user", content: "看看豆瓣电影榜单" },
      ...steps.map(
        (step, i): Turn => ({
          role: "agent",
          turnIndex: i + 1,
          finalAnswer: null,
          summary: `第 ${i + 1} 步`,
          tools: toolEventsFromRaw(
            [{ toolName: step.name, args: step.args }],
            [{ content: step.content }],
            "t-",
          ),
        }),
      ),
    ];
    return renderToStaticMarkup(
      <Tooltip.Provider>
        <LocalFilesContext.Provider value={() => undefined}>
          <Conversation turns={turns} />
        </LocalFilesContext.Provider>
      </Tooltip.Provider>,
    );
  }

  it("puts the page title and host on a scan, the host on a script", () => {
    const html = render([
      { name: "web_scan", args: { switch_tab_id: "11" }, content: scan(false) },
      {
        name: "web_execute_js",
        args: { script: "document.title" },
        content: `{"status": "success", "js_return": "豆瓣电影 Top 250", "tab_id": "11"}`,
      },
    ]);
    expect(html).toContain("· 豆瓣电影 Top 250");
    expect(html.split("· movie.douban.com").length - 1).toBe(2);
  });

  it("counts tabs on a tab-list scan and shows nothing for an unknown tab", () => {
    const html = render([
      { name: "web_scan", args: { tabs_only: true }, content: scan(true) },
      {
        name: "web_execute_js",
        args: { script: "document.title" },
        content: `{"status": "success", "js_return": 1, "tab_id": "99"}`,
      },
    ]);
    expect(html).toContain("· 2 个标签页");
    expect(html).not.toContain("douban.com");
  });
});
