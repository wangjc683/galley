import { describe, expect, it } from "vitest";
import {
  askUserQuestionCount,
  askUserReplyContent,
  candidateLayout,
  chosenCandidateIndex,
  mergedAskUserArgs,
} from "./ask-user-candidates";
import type { ConversationToolEvent, Turn } from "@/types/conversation";

describe("candidateLayout", () => {
  it("keeps short label sets in a row", () => {
    expect(candidateLayout(["是", "否"])).toBe("row");
    expect(candidateLayout(["方案 A", "方案 B", "方案 C"])).toBe("row");
  });
  it("stacks sentence-length or numerous candidates", () => {
    expect(
      candidateLayout([
        "A. 个人博客/演示站等轻量应用 → 推荐 2核-4G ¥30/月",
        "B. 正式生产应用",
      ]),
    ).toBe("list");
    expect(candidateLayout(["一", "二", "三", "四", "五"])).toBe("list");
    // Four 18-char labels: none over the per-item cap, under the count
    // cap, but 72 chars total would wrap the row anyway.
    const eighteen = "十八个字十八个字十八个字十八个字十八";
    expect(candidateLayout([eighteen, eighteen, eighteen, eighteen])).toBe(
      "list",
    );
    expect(candidateLayout([eighteen, eighteen, eighteen])).toBe("row");
  });
});

describe("chosenCandidateIndex", () => {
  it("matches the verbatim chip text and nothing else", () => {
    const c = ["B. 4核-8G ¥60/月 生产应用", "A. 2核-4G ¥30/月 轻量应用"];
    expect(chosenCandidateIndex(c, "A. 2核-4G ¥30/月 轻量应用 ")).toBe(1);
    expect(chosenCandidateIndex(c, "A 就行，但要 8G")).toBeNull();
    expect(chosenCandidateIndex(c, undefined)).toBeNull();
  });
});

describe("askUserReplyContent", () => {
  const agent = (ask: boolean): Turn =>
    ({
      role: "agent",
      tools: ask ? [{ id: "t", name: "ask_user", status: "success" }] : [],
      finalAnswer: null,
      turnIndex: 1,
    }) as unknown as Turn;
  const user = (content: string): Turn => ({ role: "user", content }) as Turn;
  const system: Turn = { role: "system", content: "btw", variant: "side_question" } as Turn;

  it("returns the reply user turn, skipping system bystanders", () => {
    const turns = [user("q"), agent(true), system, user("B")];
    expect(askUserReplyContent(turns, 1, new Set([3]))).toBe("B");
  });
  it("returns undefined when pending, superseded, or the next user turn is a new run", () => {
    expect(askUserReplyContent([user("q"), agent(true)], 1, new Set())).toBeUndefined();
    expect(
      askUserReplyContent([user("q"), agent(true), agent(false)], 1, new Set()),
    ).toBeUndefined();
    expect(
      askUserReplyContent([user("q"), agent(true), user("new run")], 1, new Set()),
    ).toBeUndefined();
  });
});

describe("mergedAskUserArgs", () => {
  const ask = (
    question: unknown,
    candidates?: unknown,
  ): ConversationToolEvent => ({
    id: "t",
    name: "ask_user",
    status: "success-historical",
    args: { question, candidates },
  });
  const q = "如果只能选一种，你更希望我长期怎么帮你？";

  it("merges split same-question calls in order, deduplicated", () => {
    expect(
      mergedAskUserArgs([
        ask(q, ["自动化"]),
        ask(q + " ", ["参谋"]),
        ask(q, ["自动化", "探索"]),
      ]),
    ).toEqual({ question: q, candidates: ["自动化", "参谋", "探索"] });
  });
  it("ignores a different question and coerces odd candidate shapes", () => {
    expect(mergedAskUserArgs([ask("A?", ["a1"]), ask("B?", ["b1"])])).toEqual({
      question: "A?",
      candidates: ["a1"],
    });
    expect(mergedAskUserArgs([ask("Go?", "yes")])).toEqual({
      question: "Go?",
      candidates: ["yes"],
    });
    expect(mergedAskUserArgs([ask("N?", [1, "two"])])).toEqual({
      question: "N?",
      candidates: ["1", "two"],
    });
    expect(mergedAskUserArgs([ask("Open?")])).toEqual({
      question: "Open?",
      candidates: [],
    });
  });
  it("returns null without an ask_user or with a non-string question", () => {
    expect(mergedAskUserArgs([])).toBeNull();
    expect(mergedAskUserArgs([ask(42)])).toBeNull();
  });
  it("counts distinct questions for the fold header", () => {
    expect(askUserQuestionCount([ask(q, ["a"]), ask(q, ["b"]), ask("B?")])).toBe(2);
    expect(askUserQuestionCount([])).toBe(0);
  });
});
