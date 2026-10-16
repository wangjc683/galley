import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MessageQuotes } from "./MessageQuotes";
import { MessageUser } from "./MessageUser";

// Telegram-details ticket 07: the quotes a message opens with, drawn
// apart from your words.

function bubble(content: string): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <MessageUser content={content} />
    </Tooltip.Provider>,
  );
}

describe("a message that opens with quotes", () => {
  it("draws the quotes above the bubble (D1) and only your words in it", () => {
    const html = bubble("> 第一处\n\n> 第二处\n> 第二行\n\n这两处什么意思");
    const quotes = html.indexOf('data-role="message-quotes"');
    const message = html.indexOf('data-role="user-msg"');
    expect(quotes).toBeGreaterThanOrEqual(0);
    expect(message).toBeGreaterThan(quotes);
    const inBubble = html.slice(message);
    expect(inBubble).toContain("这两处什么意思");
    expect(inBubble).not.toContain("第一处");
    expect(inBubble).not.toContain("&gt;");
    expect(html.slice(quotes, message)).toContain("第二处\n第二行");
  });

  it("counts only your words toward the long-message fold", () => {
    const longQuote = "引用".repeat(400);
    const html = bubble(`> ${longQuote}\n\n短问题`);
    expect(html).not.toContain("line-clamp-6");
    expect(html).not.toContain('aria-expanded="false"');
  });

  it("draws a quotes-only message as quotes, with no empty words line", () => {
    const html = bubble("> 只有引用");
    expect(html).toContain('data-role="message-quotes"');
    expect(html).not.toContain("whitespace-pre-wrap");
  });

  it("leaves a message without quotes, and a > further down, as before", () => {
    const html = bubble("先说\n> 不是引用");
    expect(html).not.toContain('data-role="message-quotes"');
    expect(html).toContain("先说\n&gt; 不是引用");
  });
});

describe("MessageQuotes inside the bubble (D2)", () => {
  it("draws a block per quote with no parking marker", () => {
    const html = renderToStaticMarkup(
      <MessageQuotes quotes={["一", "二"]} placement="inside" />,
    );
    expect(html).not.toContain("message-quotes");
    expect(html.match(/line-clamp-3/g)).toHaveLength(2);
  });
});
