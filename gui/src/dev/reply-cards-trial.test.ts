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
  it("defaults to 乙 · 40 · 真实 · 真实", () => {
    expect(parsePick(null)).toEqual({
      width: "yi",
      height: "40",
      demo: "real",
      data: "real",
    });
  });

  it("keeps what it knows and drops the rest", () => {
    expect(
      parsePick(
        JSON.stringify({
          width: "bing",
          height: "32",
          demo: "nope",
          data: "mixed",
        }),
      ),
    ).toEqual({ width: "bing", height: "32", demo: "real", data: "mixed" });
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
