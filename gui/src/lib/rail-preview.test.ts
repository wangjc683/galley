import { describe, expect, it } from "vitest";

import {
  buildPreview,
  buildRailExchanges,
  firstProseLine,
} from "@/lib/rail-preview";
import type { AgentTurn, SystemTurn, Turn, UserTurn } from "@/types/conversation";

function user(content: string): UserTurn {
  return { role: "user", content };
}

function agent(finalAnswer: string | null): AgentTurn {
  return { role: "agent", tools: [], finalAnswer };
}

function askUserTurn(): AgentTurn {
  return {
    role: "agent",
    tools: [
      { id: "t-ask", name: "ask_user", status: "success-historical", args: {} },
    ],
    finalAnswer: null,
  };
}

function system(content: string): SystemTurn {
  return { role: "system", content, variant: "system" };
}

describe("buildPreview", () => {
  it("collapses whitespace onto one line", () => {
    expect(buildPreview("line one\n\n  line two")).toBe("line one line two");
  });

  it("strips a leading markdown marker so the preview reads as prose", () => {
    expect(buildPreview("## 结论")).toBe("结论");
    expect(buildPreview("- 第一项")).toBe("第一项");
    expect(buildPreview("> 引用")).toBe("引用");
  });

  it("truncates past the budget with an ellipsis", () => {
    const preview = buildPreview("x".repeat(80));
    expect(preview).toBe("x".repeat(50) + "…");
  });

  it("returns empty string for whitespace-only content", () => {
    expect(buildPreview("   \n  ")).toBe("");
  });
});

describe("firstProseLine", () => {
  it("skips a leading heading and blank lines", () => {
    expect(firstProseLine("## 结论\n\nrail 现在只索引提问")).toBe(
      "rail 现在只索引提问",
    );
  });

  it("skips consecutive headings", () => {
    expect(firstProseLine("# A\n## B\n### C\nprose")).toBe("prose");
  });

  it("keeps a first line that is already prose", () => {
    expect(firstProseLine("直接回答\n\n## 细节")).toBe("直接回答");
  });

  it("does not treat a bare # without a space as a heading", () => {
    expect(firstProseLine("#hashtag")).toBe("#hashtag");
  });

  it("returns empty string when there is nothing but headings", () => {
    expect(firstProseLine("## 结论\n\n### 细节")).toBe("");
  });
});

describe("buildRailExchanges", () => {
  it("pairs each question with the answer that closed it", () => {
    const turns: Turn[] = [
      user("第一个问题"),
      agent("第一个回答"),
      user("第二个问题"),
      agent("第二个回答"),
    ];
    expect(buildRailExchanges(turns)).toEqual([
      { question: "第一个问题", answer: "第一个回答" },
      { question: "第二个问题", answer: "第二个回答" },
    ]);
  });

  it("takes the LAST non-null final answer of a multi-turn run", () => {
    const turns: Turn[] = [
      user("问题"),
      agent(null),
      agent("中间轮漏出的散话"),
      agent(null),
      agent("真正的结论"),
    ];
    expect(buildRailExchanges(turns)[0].answer).toBe("真正的结论");
  });

  it("overwrites with null when the closing turn has no previewable prose", () => {
    const turns: Turn[] = [
      user("问题"),
      agent("中间轮散话"),
      agent("## 只有标题"),
    ];
    expect(buildRailExchanges(turns)[0].answer).toBeNull();
  });

  it("leaves the answer null while the agent is still working", () => {
    expect(buildRailExchanges([user("问题"), agent(null)])).toEqual([
      { question: "问题", answer: null },
    ]);
  });

  it("skips system turns", () => {
    const turns: Turn[] = [
      user("问题"),
      system("Goal 叙述"),
      agent("回答"),
      system("收口"),
    ];
    expect(buildRailExchanges(turns)[0].answer).toBe("回答");
  });

  it("ignores agent turns that precede the first user message", () => {
    const turns: Turn[] = [agent("孤儿回答"), user("问题")];
    expect(buildRailExchanges(turns)).toEqual([
      { question: "问题", answer: null },
    ]);
  });

  it("previews the answer's first prose line, not its heading", () => {
    const turns: Turn[] = [user("问题"), agent("## 结论\n\n应该显示这一行")];
    expect(buildRailExchanges(turns)[0].answer).toBe("应该显示这一行");
  });

  it("keeps one entry per run opener so indices align with the DOM", () => {
    const turns: Turn[] = [
      user("a"),
      agent("A"),
      user("b"),
      user("c"),
      agent("C"),
    ];
    const exchanges = buildRailExchanges(turns);
    expect(exchanges).toHaveLength(3);
    expect(exchanges.map((e) => e.answer)).toEqual(["A", null, "C"]);
  });

  it("folds ask_user replies into their run instead of counting them", () => {
    const turns: Turn[] = [
      user("问题"),
      askUserTurn(),
      user("选 A"),
      agent("结论"),
    ];
    const exchanges = buildRailExchanges(turns);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toEqual({ question: "问题", answer: "结论" });
  });

  it("skips goal commission openers — they render as markers, not user-msgs", () => {
    const turns: Turn[] = [
      { ...user("目标"), goalId: "goal-1" },
      agent("执行"),
      user("普通问题"),
      agent("回答"),
    ];
    const exchanges = buildRailExchanges(turns);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].question).toBe("普通问题");
  });

  it("returns an empty question preview for a whitespace-only message", () => {
    expect(buildRailExchanges([user("   ")])[0].question).toBe("");
  });
});
