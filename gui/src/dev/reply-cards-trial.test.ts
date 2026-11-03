import { describe, expect, it } from "vitest";

import type { SubtaskCardState, SubtaskDispatch } from "@/lib/subtasks";

import {
  DEFAULT_PICK,
  demoSubtaskState,
  mixedFiles,
  parsePick,
  replyCardsTrialCss,
} from "./reply-cards-trial";

/*
 * TEMP variant switcher (main chat 131): its pure parts. The widths and
 * heights themselves need a real layout (jsdom has none); they were
 * measured in headless Chrome against the built Tailwind and fonts.
 */

const done: SubtaskCardState = { kind: "done", line: null };

describe("the saved pick", () => {
  it("defaults to 一框列表 (乙 · 40 kept for 有框) · 真实 · 真实, folded", () => {
    expect(parsePick(null)).toEqual({
      style: "list",
      width: "yi",
      height: "40",
      demo: "real",
      data: "real",
      folded: true,
    });
  });

  // A pick saved by ticket 131's switcher has no style and no fold.
  it("reads a pick from before the style group", () => {
    expect(
      parsePick(
        JSON.stringify({
          width: "yi",
          height: "32",
          demo: "real",
          data: "mixed",
        }),
      ),
    ).toEqual({
      style: "list",
      width: "yi",
      height: "32",
      demo: "real",
      data: "mixed",
      folded: true,
    });
  });

  it("keeps what it knows and drops the rest", () => {
    expect(
      parsePick(
        JSON.stringify({
          style: "rows",
          width: "bing",
          height: "32",
          demo: "nope",
          data: "mixed",
          folded: "yes",
        }),
      ),
    ).toEqual({
      style: "rows",
      width: "bing",
      height: "32",
      demo: "real",
      data: "mixed",
      folded: true,
    });
    expect(parsePick(JSON.stringify({ style: "box", folded: false }))).toEqual({
      ...DEFAULT_PICK,
      style: "box",
      folded: false,
    });
    expect(parsePick("{not json")).toBe(DEFAULT_PICK);
    expect(parsePick("7")).toBe(DEFAULT_PICK);
  });
});

describe("状态", () => {
  it("真实 keeps the card's own state", () => {
    expect(demoSubtaskState("real", done, 0)).toBe(done);
  });

  it("在问你: the first waits for you, the rest run", () => {
    expect(demoSubtaskState("asking", done, 0)).toMatchObject({
      kind: "asking",
      inCard: false,
    });
    expect(demoSubtaskState("asking", done, 1).kind).toBe("running");
  });

  it("出错: the first failed with a reason, the second cut short, the rest run", () => {
    expect(demoSubtaskState("error", done, 0)).toEqual({
      kind: "failed",
      failure: { kind: "error", message: "网页打不开" },
    });
    expect(demoSubtaskState("error", done, 1)).toEqual({
      kind: "failed",
      failure: { kind: "didNotFinish" },
    });
    expect(demoSubtaskState("error", done, 2).kind).toBe("running");
  });
});

function dispatch(turnIndex: number, ordinal = 0): SubtaskDispatch {
  return {
    parentSessionId: "s-main",
    turnIndex,
    ordinal,
    messageId: `msg_s-main_${turnIndex}_assistant`,
    sessionId: `s-sub-${turnIndex}-${ordinal}`,
    title: "整理一页会议纪要",
    failure: null,
    failureDetail: null,
    createdAt: "2026-11-03T08:00:00.000Z",
  };
}

const byMessage = (...ds: SubtaskDispatch[]) => {
  const map = new Map<string, SubtaskDispatch[]>();
  for (const d of ds)
    map.set(d.messageId, [...(map.get(d.messageId) ?? []), d]);
  return map;
};

describe("混排", () => {
  const files = new Map<string, readonly string[]>([
    ["msg_s-main_2_assistant", ["/Users/demo/Downloads/短名.docx"]],
    [
      "msg_s-main_5_assistant",
      [
        "/Users/demo/Desktop/一份名字很长很长的周末出行计划_第二版.html",
        "/Users/demo/Pictures/一张名字更长更长更长更长更长更长更长的海边照片.png",
      ],
    ],
  ]);

  it("adds the longest delivered file, not an image, under the latest reply with subtasks", () => {
    const next = mixedFiles(
      files,
      byMessage(dispatch(3), dispatch(9, 0), dispatch(9, 1)),
    );
    expect(next.get("msg_s-main_9_assistant")).toEqual([
      "/Users/demo/Desktop/一份名字很长很长的周末出行计划_第二版.html",
    ]);
    expect(next.get("msg_s-main_3_assistant")).toBeUndefined();
    // The replies that delivered it keep their own.
    expect(next.get("msg_s-main_5_assistant")).toBe(
      files.get("msg_s-main_5_assistant"),
    );
  });

  it("after the reply's own files, and not twice", () => {
    const own = mixedFiles(files, byMessage(dispatch(2)));
    expect(own.get("msg_s-main_2_assistant")).toEqual([
      "/Users/demo/Downloads/短名.docx",
      "/Users/demo/Desktop/一份名字很长很长的周末出行计划_第二版.html",
    ]);
    expect(mixedFiles(files, byMessage(dispatch(5)))).toBe(files);
  });

  it("adds nothing without a delivered file or a reply with subtasks", () => {
    const none = new Map<string, readonly string[]>();
    expect(mixedFiles(none, byMessage(dispatch(4)))).toBe(none);
    expect(mixedFiles(files, new Map())).toBe(files);
  });
});

describe("the style", () => {
  const css = replyCardsTrialCss();
  const answering =
    '[data-role="subtask-card"]:has([data-role="ask-user-bubble"])';

  it("matches nothing under 现状 and 40", () => {
    expect(css).not.toContain('data-reply-cards-width="now"');
    expect(css).not.toContain('data-reply-cards-height="40"');
  });

  // A :has() inside a :has() is invalid: the browser drops the rule.
  it("never nests :has()", () => {
    expect(css).not.toMatch(/:has\([^)]*:has\(/);
  });

  // 有框 is ticket 131 as it was: nothing keyed on the style touches it,
  // and the width and height rules do not look at the style (the pill
  // writes them onto <html> under 有框 only).
  it("keys 一框列表 and 无框行 on the style, and nothing on 有框", () => {
    const lines = css.split("\n");
    expect(css).not.toContain('data-reply-cards-style="box"');
    for (const line of lines) {
      const style = line.includes("data-reply-cards-style");
      const size =
        line.includes("data-reply-cards-width") ||
        line.includes("data-reply-cards-height");
      expect(style && size).toBe(false);
      expect(style || size).toBe(true);
    }
    expect(css).toContain('html[data-reply-cards-style="list"]');
    expect(css).toContain('html[data-reply-cards-style="rows"]');
  });

  it("sends a list that is answered in place to the cap, and its card in 无框行", () => {
    expect(css).toContain(
      `html[data-reply-cards-style="list"] [data-role="reply-cards"]:has([data-role="subtask-card"] [data-role="ask-user-bubble"]){width:auto}`,
    );
    expect(css).toContain(
      `html[data-reply-cards-style="rows"] [data-role="reply-cards"] ${answering}{width:auto}`,
    );
  });

  // Ruling 101's fallback: a subtask answered in its card keeps the
  // bubble's cap, so the question and the reply field are not squeezed.
  it("lets a card answered in place go to the cap under 甲, 乙 and 丙", () => {
    const lines = css.split("\n");
    const rule = (needle: string) => lines.findIndex((l) => l.includes(needle));
    const jia = rule('html[data-reply-cards-width="jia"]');
    const bing = rule('html[data-reply-cards-width="bing"]');
    const card = lines.findIndex(
      (l) =>
        l.includes(
          '[data-reply-cards-width="jia"],[data-reply-cards-width="bing"]',
        ) && l.includes(`${answering}{width:auto}`),
    );
    // Same specificity as 甲's and 丙's rules: it wins by coming after.
    expect(card).toBeGreaterThan(Math.max(jia, bing));
    expect(css).toContain(
      `html[data-reply-cards-width="yi"] [data-role="reply-cards"]:has([data-role="subtask-card"] [data-role="ask-user-bubble"]){width:auto}`,
    );
  });
});
