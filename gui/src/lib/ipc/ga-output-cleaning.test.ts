import { describe, expect, it } from "vitest";

import {
  cleanPartialContent,
  isLeakedToolCallMarkup,
  summaryEchoesAnswer,
} from "@/lib/ipc/ga-output-cleaning";

/**
 * Reproduces GA's fallback (ga.py:594-601) so the tests exercise the
 * shape the bug actually produces rather than a hand-written guess:
 * strip fences + thinking, drop newlines, then smart_format at 80.
 */
function gaFallbackSummary(responseContent: string): string {
  const cleaned = responseContent
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
    .trim();
  return smartFormat(cleaned.replace(/\n/g, ""), 80);
}

/** ga.py:291 — unchanged below max + 2*omit, else head/tail elision. */
function smartFormat(data: string, maxStrLen: number): string {
  const omit = " ... ";
  if (data.length < maxStrLen + omit.length * 2) return data;
  return (
    data.slice(0, Math.floor(maxStrLen / 2)) +
    omit +
    data.slice(-Math.floor(maxStrLen / 2))
  );
}

describe("summaryEchoesAnswer", () => {
  it("catches the short-answer case from the 2026-08-03 dogfood report", () => {
    const answer = "你好！ 👋\n\n有什么可以帮你的吗？无论是文件处理、脚本执行、浏览器操作，还是其他任务，尽管吩咐～";
    expect(summaryEchoesAnswer(gaFallbackSummary(answer), answer)).toBe(true);
  });

  it("catches the elided form when the answer exceeds smart_format's cap", () => {
    const answer = `开头的一段说明文字。\n\n${"中间的正文内容。".repeat(30)}\n\n结尾的一句总结。`;
    const summary = gaFallbackSummary(answer);
    expect(summary).toContain("...");
    expect(summaryEchoesAnswer(summary, answer)).toBe(true);
  });

  it("catches an answer whose code fences GA stripped before summarizing", () => {
    const answer = "先看一下配置：\n\n```bash\nls -la /etc\n```\n\n然后再决定下一步。";
    const summary = gaFallbackSummary(answer);
    expect(summary).not.toContain("ls -la");
    expect(summaryEchoesAnswer(summary, answer)).toBe(true);
  });

  it("keeps a genuine one-line <summary> that merely describes the answer", () => {
    expect(
      summaryEchoesAnswer(
        "读取了配置文件，确认端口为 8080",
        "我查看了 config.toml，其中 `port` 字段的值是 8080，因此服务会监听 8080 端口。如需修改，改这一行即可。",
      ),
    ).toBe(false);
  });

  it("does not fire on a summary that is only a prefix of the answer", () => {
    // Guards against a looser prefix rule: a compliant summary can open
    // with the same words the answer opens with without being an echo.
    expect(summaryEchoesAnswer("开始执行任务", "开始执行任务前需要先确认三件事……")).toBe(
      false,
    );
  });

  it("ignores whitespace and trimming differences on both sides", () => {
    expect(summaryEchoesAnswer("你好世界", "  你好\n\n世界  ")).toBe(true);
  });

  it("returns false for empty, missing, or whitespace-only input", () => {
    expect(summaryEchoesAnswer(undefined, "答案")).toBe(false);
    expect(summaryEchoesAnswer("摘要", undefined)).toBe(false);
    expect(summaryEchoesAnswer(null, null)).toBe(false);
    expect(summaryEchoesAnswer("   ", "答案")).toBe(false);
    expect(summaryEchoesAnswer("摘要", "   ")).toBe(false);
  });

  it("does not treat a literal '...' in a short summary as an elision", () => {
    expect(summaryEchoesAnswer("嗯...好的", "完全无关的另一段回答内容")).toBe(false);
  });
});

describe("next-suggestion tag stripping", () => {
  it("strips the tag from final answers and partials", async () => {
    const { cleanFinalAnswer, cleanPartialContent, stripGATags } = await import(
      "@/lib/ipc/ga-output-cleaning"
    );
    const raw =
      "修好了。\n\n<next-suggestion>帮我把剩下两处调用也改掉</next-suggestion>";
    for (const clean of [cleanFinalAnswer, cleanPartialContent, stripGATags]) {
      const out = clean(raw);
      expect(out).toContain("修好了。");
      expect(out).not.toContain("next-suggestion");
      expect(out).not.toContain("帮我把剩下两处调用也改掉");
    }
  });

  it("truncates an unclosed next-suggestion tag mid-stream", async () => {
    const { cleanPartialContent } = await import(
      "@/lib/ipc/ga-output-cleaning"
    );
    // Chunk boundary fell inside the tag body — nothing after the
    // opener may leak as prose.
    expect(
      cleanPartialContent("正文结束。\n<next-suggestion>帮我把剩"),
    ).toBe("正文结束。\n");
    // Chunk ended inside the tag NAME ("<next-sug") — the partial
    // opener itself must not flash as text.
    expect(cleanPartialContent("正文结束。\n<next-sug")).toBe("正文结束。\n");
  });
});

// #22 sample 2 (redacted): a proxied model emitted its tool call as
// plain text — the whole reply body is `<invoke …>` markup and must
// never render as prose.
const LEAKED_MARKUP =
  '<invoke name="code_run">\n<parameter name="script">import json\n' +
  "info=json.load(open('prov.json'))\nprint(len(js))\n" +
  "</parameter>\n</invoke>";

describe("leaked tool-call markup (#22)", () => {
  it("detects a markup-led body, including truncated variants", () => {
    expect(isLeakedToolCallMarkup(LEAKED_MARKUP)).toBe(true);
    expect(isLeakedToolCallMarkup('  <parameter name="script">x')).toBe(true);
  });

  it("leaves prose that merely mentions the markup alone", () => {
    expect(isLeakedToolCallMarkup("解释一下 <invoke> 的语法")).toBe(false);
    expect(isLeakedToolCallMarkup("正常回答正文。")).toBe(false);
  });

  it("suppresses the streaming flash: markup-led partials render empty", () => {
    expect(cleanPartialContent(LEAKED_MARKUP)).toBe("");
    // Markup after a stripped thinking block still leads the cleaned
    // buffer — suppressed too.
    expect(
      cleanPartialContent(
        '<thinking>先跑脚本</thinking>\n<invoke name="code_run">',
      ),
    ).toBe("");
  });

  it("truncates a chunk boundary inside '<invoke' instead of flashing it", () => {
    expect(cleanPartialContent("正文结束。\n<invo")).toBe("正文结束。\n");
  });
});
