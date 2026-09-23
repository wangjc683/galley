import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Conversation } from "./Conversation";
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
