import { describe, expect, it } from "vitest";

import {
  cleanFinalAnswer,
  cleanPartialContent,
  extractLiveThinking,
  extractPreamble,
  finalAnswerFileRefs,
  isLeakedToolCallMarkup,
  isSilentReply,
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

// Goal was removed on 2026-10-13; replies persisted before that still
// end with a complete `<goal-status>` tag, and a reply in such a session
// can echo it from the replayed history. GA_TAG_PATTERNS keeps it out.
describe("legacy goal-status tag stripping", () => {
  it("strips a complete tag from final answers and partials", async () => {
    const { cleanFinalAnswer, cleanPartialContent, stripGATags } = await import(
      "@/lib/ipc/ga-output-cleaning"
    );
    const raw = "目标已达成。\n\n<goal-status>complete</goal-status>";
    for (const clean of [cleanFinalAnswer, cleanPartialContent, stripGATags]) {
      const out = clean(raw);
      expect(out).toContain("目标已达成。");
      expect(out).not.toContain("goal-status");
      expect(out).not.toContain("complete");
    }
  });
});

// Main chat ticket 06a: the instructions the main chat hands a subtask
// never show as answer prose — neither while the reply streams nor once
// it is persisted (the Rust port, `turn_persistence/derive.rs`, is held
// to `cleanFinalAnswer` by the shared golden fixtures).
describe("subtask tag stripping", () => {
  const reply =
    "好，交给子任务。\n<subtask>把下载文件夹里的 PDF 分类\n发票一类</subtask>\n" +
    "<subtask>查报价</subtask>";

  it("strips every tag from final answers and partials", async () => {
    const { cleanFinalAnswer, stripGATags } =
      await import("@/lib/ipc/ga-output-cleaning");
    for (const clean of [cleanFinalAnswer, cleanPartialContent, stripGATags]) {
      const out = clean(reply);
      expect(out).toContain("好，交给子任务。");
      expect(out).not.toContain("subtask");
      expect(out).not.toContain("PDF");
    }
  });

  it("drops an unclosed tag and what follows it", async () => {
    const { cleanFinalAnswer } = await import("@/lib/ipc/ga-output-cleaning");
    expect(
      cleanFinalAnswer("派出去了。\n<subtask>整理下载文件夹，没写完"),
    ).toBe("派出去了。");
    // Mid-stream: inside the instructions, and inside the tag name.
    expect(cleanPartialContent("派出去了。\n<subtask>整理下载")).toBe(
      "派出去了。\n",
    );
    expect(cleanPartialContent("派出去了。\n<subt")).toBe("派出去了。\n");
    expect(cleanPartialContent("派出去了。\n<subtask>整理</subt")).toBe(
      "派出去了。\n",
    );
  });

  it("keeps the tag out of the extracted preamble", () => {
    expect(extractPreamble("先看一下。<subtask>不该在这里</subtask>")).toBe(
      "先看一下。",
    );
    expect(extractPreamble("先看一下。<subtask>没写完")).toBe("先看一下。");
  });
});

// Main chat tickets 29 / 31: a report round's reply that says nothing
// to the user is exactly `<no-reply/>`. Core's turn derivation strips it
// (derive.rs, like <subtask>); this is the mirror, live and streaming.
describe("no-reply tag stripping", () => {
  it("strips the tag in every shape models write it, leaving nothing", async () => {
    const { stripGATags } = await import("@/lib/ipc/ga-output-cleaning");
    for (const reply of [
      "<no-reply/>",
      "  <no-reply/>\n",
      "<No-Reply />",
      "<NO-REPLY/>",
      "< no-reply / >",
      "<no-reply>",
      "<no-reply></no-reply>",
    ]) {
      expect(cleanFinalAnswer(reply)).toBe("");
      expect(cleanPartialContent(reply).trim()).toBe("");
      expect(stripGATags(reply)).toBe("");
      expect(isSilentReply(reply)).toBe(true);
    }
    // Prose around it stays; it is still the tag.
    expect(cleanFinalAnswer("已打回。<no-reply/>")).toBe("已打回。");
    expect(isSilentReply("已打回。<no-reply/>")).toBe(true);
  });

  it("is no silent reply without the tag, or with a dispatch", () => {
    expect(isSilentReply("")).toBe(false);
    expect(isSilentReply("好的，已经订好了。")).toBe(false);
    expect(isSilentReply("<no-replying>")).toBe(false);
    expect(isSilentReply("<subtask>再查一家</subtask><no-reply/>")).toBe(false);
  });

  it("holds every prefix of the tag back while it streams", () => {
    const tag = "<no-reply/>";
    for (let end = 1; end <= tag.length; end++) {
      expect(cleanPartialContent(`我打回了。${tag.slice(0, end)}`)).toBe(
        "我打回了。",
      );
    }
    for (const partial of ["<no-reply /", "< no-rep", "</no-re", "<NO-RE"]) {
      expect(cleanPartialContent(partial)).toBe("");
    }
    // Not a prefix of it: shown as written.
    expect(cleanPartialContent("a <nob")).toBe("a <nob");
    expect(cleanPartialContent("1 <2")).toBe("1 <2");
  });

  it("keeps the tag out of the extracted preamble", () => {
    expect(extractPreamble("我把它打回去了。<no-reply/>")).toBe(
      "我把它打回去了。",
    );
    expect(extractPreamble("<no-reply/>")).toBeUndefined();
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

describe("extractPreamble", () => {
  const VERBOSE_MARKER =
    "🛠️ Tool: `web_execute_js` 📥 args:\n````text\n{\n  \"tab_id\": 1\n}\n````\n";

  it("strips a complete verbose-mode dispatch marker", () => {
    expect(
      extractPreamble(`当前阶段：先联网搜索。\n${VERBOSE_MARKER}`),
    ).toBe("当前阶段：先联网搜索。");
  });

  it("truncates a partial verbose marker instead of leaking it", () => {
    expect(extractPreamble("先联网搜索。\n🛠️ Tool: `web_exe")).toBe(
      "先联网搜索。",
    );
    // Marker-only buffer → no preamble, so the status falls back to
    // the generic copy rather than "Tool: … args:".
    expect(extractPreamble(VERBOSE_MARKER)).toBeUndefined();
  });
});

describe("extractLiveThinking", () => {
  it("reports nothing for a buffer without reasoning", () => {
    expect(extractLiveThinking("")).toEqual({ text: "", open: false });
    expect(extractLiveThinking("Plain answer text.")).toEqual({
      text: "",
      open: false,
    });
  });

  it("does not treat a partial open tag at the tail as a block yet", () => {
    expect(extractLiveThinking("<thin")).toEqual({ text: "", open: false });
    expect(extractLiveThinking("Intro.\n<thinki")).toEqual({
      text: "",
      open: false,
    });
  });

  it("reports an open block, empty or with text so far", () => {
    expect(extractLiveThinking("<thinking>")).toEqual({
      text: "",
      open: true,
    });
    expect(extractLiveThinking("<thinking>\nLet me check the config")).toEqual({
      text: "Let me check the config",
      open: true,
    });
  });

  it("closes the block once the close tag lands, answer text after it", () => {
    expect(
      extractLiveThinking(
        "<thinking>Plan the fix.</thinking>\nHere is the fix",
      ),
    ).toEqual({ text: "Plan the fix.", open: false });
    // The answer partial never carries the reasoning (existing contract).
    expect(
      cleanPartialContent(
        "<thinking>Plan the fix.</thinking>\nHere is the fix",
      ),
    ).toBe("\nHere is the fix");
  });

  it("joins two blocks with a blank line, the second possibly still open", () => {
    expect(
      extractLiveThinking(
        "<thinking>first</thinking>mid<thinking>second</thinking>",
      ),
    ).toEqual({ text: "first\n\nsecond", open: false });
    expect(
      extractLiveThinking("<thinking>first</thinking><thinking>second"),
    ).toEqual({ text: "first\n\nsecond", open: true });
  });

  it("drops a close tag split across chunks instead of flashing it", () => {
    for (const fragment of ["<", "</", "</thin", "</thinking"]) {
      expect(extractLiveThinking(`<thinking>almost done${fragment}`)).toEqual({
        text: "almost done",
        open: true,
      });
    }
    // Not a close-tag prefix: content, kept.
    expect(extractLiveThinking("<thinking>if a <b").text).toBe("if a <b");
  });

  it("undoes the runner's escape of a literal close tag", () => {
    expect(
      extractLiveThinking("<thinking>the </ thinking> tag ends a block"),
    ).toEqual({ text: "the </thinking> tag ends a block", open: true });
  });

  it("ignores tags in GA's tool dispatch output after the reply", () => {
    const dispatch =
      "🛠️ Tool: `file_read` 📥 args:\n````text\n{}\n````\n`````\n";
    // A tool printing source code with its own <thinking> must not
    // reopen the preview or leak into the text.
    expect(
      extractLiveThinking(
        `<thinking>Read the parser.</thinking>\n${dispatch}<thinking>from a file`,
      ),
    ).toEqual({ text: "Read the parser.", open: false });
    // A block the model never closed is over once dispatch starts.
    expect(
      extractLiveThinking(`<thinking>unterminated\n${dispatch}output`),
    ).toEqual({ text: "unterminated", open: false });
  });
});

describe("finalAnswerFileRefs (the assistant card's [文件] names)", () => {
  it("lists the [FILE:] paths the cleaned answer drops, in order, once", () => {
    const raw =
      "<thinking>写到 [FILE:/tmp/draft.md]</thinking>图做好了：[FILE: /tmp/out/x.png ]\n报告在 [FILE:report.pdf]，图再看一次 [FILE:/tmp/out/x.png]";
    expect(cleanFinalAnswer(raw)).toBe("图做好了：\n报告在 ，图再看一次");
    expect(finalAnswerFileRefs(raw)).toEqual(["/tmp/out/x.png", "report.pdf"]);
  });

  it("skips the hint's placeholders and an unsent subtask's text", () => {
    expect(
      finalAnswerFileRefs("用 [FILE:filepath] 或 [FILE:<path>] 或 [FILE:...]"),
    ).toEqual([]);
    expect(
      finalAnswerFileRefs("好 [FILE:a.txt]<subtask>写 [FILE:b.txt]"),
    ).toEqual(["a.txt"]);
    expect(finalAnswerFileRefs("")).toEqual([]);
    expect(finalAnswerFileRefs("没有文件")).toEqual([]);
  });
});
