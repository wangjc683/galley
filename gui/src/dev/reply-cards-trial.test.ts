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
  const both132b =
    'html:is([data-reply-cards-style="list"],[data-reply-cards-style="rows"]) [data-role="reply-cards"]';
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

  // A line that opens something opens from anywhere on it: the title's
  // button reaches over the line; what acts on its own keeps its click.
  describe("the whole line opens", () => {
    const both =
      'html:is([data-reply-cards-style="list"],[data-reply-cards-style="rows"]) [data-role="reply-cards"]';
    const line =
      ':is([data-role="subtask-card"],[data-role="todo-card"],[data-role="reminder-card"],[data-role="memo-card"])>div:first-child';
    const lines = css.split("\n");

    // Ticket 132b: not a stretched ::after. WebKit leaves the CJK / Latin
    // autospace out of the max-content of a box that holds an absolutely
    // positioned child, so 「制作76人赛季战况网页」 came out 3px short and
    // was cut. The button reaches over the line by padding that a
    // negative margin takes back; the line clips it.
    it("reaches the title's button over its line, with no ::after", () => {
      expect(css).not.toContain("::after");
      expect(css).not.toContain("::before");
      expect(css).toContain(
        `${both} ${line}:has(>span>button){overflow:hidden}`,
      );
      expect(css).toContain(
        `${both} ${line}>span>button{max-width:none;margin:0 -100vw 0 -30px;padding:0 100vw 0 30px}`,
      );
    });

    it("lets the pointer through the light things, and keeps the box, 取消 and a word with a reason", () => {
      const through = lines.find(
        (l) => l.includes("pointer-events:none}") && l.includes("todo-meta"),
      )!;
      expect(through).toContain('[data-role="subtask-card-word"]:not([title])');
      expect(through).toContain('[data-role="memo-card-state"]');
      expect(through).toContain(":is(:nth-child(2),:nth-child(4))");
      // A word with a reason (「出错」「没有开始」) and 「取消」 come after
      // the button and keep their own pointer; the box, before it, is
      // lifted.
      expect(through).not.toContain('[data-role="subtask-card-word"][title]');
      expect(through).not.toMatch(/reminder-card"\]>div:first-child>button/);
      expect(css).toContain(
        `${both} [data-role="todo-card"]>div:first-child>[data-card-icon] label{position:relative;z-index:1}`,
      );
    });

    // A line that opens nothing has its title as a span: no button to
    // reach over it, no hover ground (both rules need a button in a span).
    it("gives a line that opens nothing neither", () => {
      const reach = lines.find((l) => l.includes("margin:0 -100vw"))!;
      expect(reach).toContain(">span>button{");
      const lit = lines.find((l) =>
        l.includes("{background-color:var(--color-hover)}"),
      )!;
      expect(lit).toContain(":has(>span>button):hover");
      expect(lit).toContain(":has(>span>button:focus-visible)");
    });
  });

  // Ticket 132b: a percentage cap is not known while a box sizes itself to
  // its content, so a long folder set the frame (or 甲 / 乙's cards) at its
  // full length and was then cut to the share. Where width follows the
  // content the caps are lengths.
  it("caps the folder and a to-do's day with a length where width follows content", () => {
    expect(css).toContain(
      `${both132b} :is([data-role="todo-meta"],[data-role="file-card"]:not([data-file-kind])>button>span:nth-child(3)){max-width:16em}`,
    );
    expect(css).toContain(
      `html:is([data-reply-cards-width="jia"],[data-reply-cards-width="yi"]) [data-role="reply-cards"] [data-role="file-card"]:not([data-file-kind])>button>span:nth-child(3){max-width:16em}`,
    );
    // (100% only keeps a card inside the bubble's cap.)
    expect(css).not.toMatch(/max-width:(?!100%)\d+%/);
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
