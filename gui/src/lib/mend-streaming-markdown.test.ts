import { describe, expect, it } from "vitest";

import {
  mendStreamingMarkdown,
  PENDING_LINK_HREF,
} from "@/lib/mend-streaming-markdown";

const TICK = "`";
const FENCE = TICK.repeat(3);

describe("code spans", () => {
  it("closes a hanging span", () => {
    expect(mendStreamingMarkdown(`路径在 ${TICK}core/src/sess`)).toBe(
      `路径在 ${TICK}core/src/sess${TICK}`,
    );
  });

  it("matches the opener's run length", () => {
    expect(mendStreamingMarkdown(`a ${TICK}${TICK}b${TICK}c`)).toBe(
      `a ${TICK}${TICK}b${TICK}c${TICK}${TICK}`,
    );
  });

  it("leaves an opener with no content alone", () => {
    // An empty span would render as literal backticks anyway, and the next
    // flush repairs it the moment a character arrives.
    expect(mendStreamingMarkdown(`路径在 ${TICK}`)).toBe(`路径在 ${TICK}`);
  });

  it("leaves a closed span alone", () => {
    expect(mendStreamingMarkdown(`路径在 ${TICK}a.rs${TICK} 里`)).toBe(
      `路径在 ${TICK}a.rs${TICK} 里`,
    );
  });

  it("ignores an escaped backtick", () => {
    expect(mendStreamingMarkdown("a \\` b")).toBe("a \\` b");
  });

  it("only looks at the last block", () => {
    // The first paragraph's span is closed; nothing is owed even though a
    // naive whole-document backtick count would be even either way.
    expect(mendStreamingMarkdown(`${TICK}a${TICK} 第一段\n\n第二段`)).toBe(
      `${TICK}a${TICK} 第一段\n\n第二段`,
    );
  });
});

describe("fences", () => {
  it("does not mend inside an open fence", () => {
    const source = `说明\n\n${FENCE}rust\nlet s = "it's ${TICK}odd";\n`;
    expect(mendStreamingMarkdown(source)).toBe(source);
  });

  it("resumes mending after the fence closes", () => {
    const source = `${FENCE}rust\nfn main() {}\n${FENCE}\n\n再看 ${TICK}Cargo.to`;
    expect(mendStreamingMarkdown(source)).toBe(source + TICK);
  });

  it("treats a blank line inside a fence as content, not a block break", () => {
    // If the blank line were taken as a boundary the tail would start inside
    // the code and the closing fence would read as an opener.
    const source = `${FENCE}\na\n\nb\n${FENCE}\n\n然后 ${TICK}x.rs`;
    expect(mendStreamingMarkdown(source)).toBe(source + TICK);
  });
});

describe("link destinations", () => {
  it("replaces a streaming destination with the pending sentinel", () => {
    expect(mendStreamingMarkdown("见 [文档](https://exa")).toBe(
      `见 [文档](${PENDING_LINK_HREF})`,
    );
  });

  it("leaves a completed link alone", () => {
    const source = "见 [文档](https://example.com) 里";
    expect(mendStreamingMarkdown(source)).toBe(source);
  });

  it("keeps an earlier completed link when a later one is pending", () => {
    expect(
      mendStreamingMarkdown("[a](https://a.com) 和 [b](https://b"),
    ).toBe(`[a](https://a.com) 和 [b](${PENDING_LINK_HREF})`);
  });

  it("does not touch a bracket that has no destination yet", () => {
    // `[text` alone is far more often prose than a link.
    expect(mendStreamingMarkdown("见 [文档")).toBe("见 [文档");
  });

  it("handles balanced parens inside a destination", () => {
    const source = "见 [x](https://en.wikipedia.org/wiki/Foo_(bar)) 后续";
    expect(mendStreamingMarkdown(source)).toBe(source);
  });

  it("mends a code span inside link text", () => {
    expect(mendStreamingMarkdown(`见 [${TICK}mod.rs`)).toBe(
      `见 [${TICK}mod.rs${TICK}`,
    );
  });
});

describe("no-ops", () => {
  it("passes plain prose through untouched", () => {
    const source = "这是一段没有任何悬挂标记的普通中文，末尾还有标点。";
    expect(mendStreamingMarkdown(source)).toBe(source);
  });

  it("passes the empty string through", () => {
    expect(mendStreamingMarkdown("")).toBe("");
  });

  it("leaves emphasis alone — deliberately out of scope", () => {
    expect(mendStreamingMarkdown("先看这个 **要点")).toBe("先看这个 **要点");
  });
});
