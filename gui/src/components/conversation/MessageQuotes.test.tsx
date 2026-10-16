import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MessageQuotes } from "./MessageQuotes";
import { MessageUser } from "./MessageUser";

// Telegram-details tickets 07 and 08: the quotes a message opens with,
// drawn at the top of the bubble, apart from your words.

function bubble(content: string): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <MessageUser content={content} />
    </Tooltip.Provider>,
  );
}

/** The bubble's own markup: from its anchor to the end. */
function inBubble(html: string): string {
  const at = html.indexOf('data-role="user-msg"');
  expect(at).toBeGreaterThanOrEqual(0);
  return html.slice(at);
}

describe("a message that opens with quotes", () => {
  it("draws the quotes inside the bubble, above your words, without >", () => {
    const html = bubble("> 第一处\n\n> 第二处\n> 第二行\n\n这两处什么意思");
    const bubbleHtml = inBubble(html);
    // Nothing of the quotes sits before the bubble in its row.
    expect(html.slice(0, html.indexOf('data-role="user-msg"'))).not.toContain(
      "第一处",
    );
    const first = bubbleHtml.indexOf("第一处");
    const second = bubbleHtml.indexOf("第二处\n第二行");
    const words = bubbleHtml.indexOf("这两处什么意思");
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(words).toBeGreaterThan(second);
    expect(bubbleHtml).not.toContain("&gt;");
  });

  it("counts only your words toward the long-message fold", () => {
    const longQuote = "引用".repeat(400);
    const html = bubble(`> ${longQuote}\n\n短问题`);
    expect(html).not.toContain("line-clamp-6");
    expect(html).not.toContain(">展开");
  });

  it("draws a quotes-only message as quotes, with no empty words line", () => {
    const html = bubble("> 只有引用");
    expect(inBubble(html)).toContain("只有引用");
    expect(html).not.toContain("whitespace-pre-wrap");
  });

  it("leaves a message without quotes, and a > further down, as before", () => {
    const html = bubble("先说\n> 不是引用");
    expect(html).not.toContain(`role="group"`);
    expect(html).toContain("先说\n&gt; 不是引用");
  });
});

describe("MessageQuotes", () => {
  it("draws a block per quote: deeper ground, a bar, three lines at most", () => {
    const html = renderToStaticMarkup(<MessageQuotes quotes={["一", "二"]} />);
    expect(html.match(/line-clamp-3/g)).toHaveLength(2);
    expect(html.match(/bg-brand-strong\/10/g)).toHaveLength(2);
    expect(html.match(/border-l-2 border-brand-strong\/45/g)).toHaveLength(2);
    expect(html).toContain("select-none");
    // A static render measures nothing: no quote is a button until it is
    // found cut short.
    expect(html).not.toContain('role="button"');
  });
});
