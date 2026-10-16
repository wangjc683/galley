import { describe, expect, it } from "vitest";

import { assistantLinePlan } from "@/lib/assistant-conversation";
import { messageRowIds } from "@/lib/message-delete";
import {
  messageMenuEntries,
  messageMenuTarget,
  type MessageMenuEntry,
} from "@/lib/message-menu";
import { buildRunGroups, liveRunGroup } from "@/lib/run-groups";
import { SUBTASK_REPORT_SUPERVISOR } from "@/lib/subtasks";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

/**
 * A bubble's message menu (main chat ticket 38): its rows for your
 * message and for its reply, in order; the process only where the bar has
 * it; 删除 greyed alone; 引用 quoting the whole message; and the rows a
 * deletion hides.
 */

function tool(name: string, args: Record<string, unknown> = {}) {
  return {
    id: `t-${name}-${Math.random()}`,
    name,
    status: "success-historical",
    args,
  } as ConversationToolEvent;
}
function user(id: string, content = id): UserTurn {
  return { role: "user", content, messageId: id };
}
function step(id: string): AgentTurn {
  return {
    role: "agent",
    tools: [tool("web_scan")],
    finalAnswer: null,
    messageId: id,
  };
}
function question(id: string): AgentTurn {
  return {
    role: "agent",
    tools: [tool("ask_user", { question: "**哪天**出发？" })],
    finalAnswer: null,
    messageId: id,
  };
}
function answer(id: string, text = `${id} 的回答`): AgentTurn {
  return {
    role: "agent",
    tools: [tool("no_tool")],
    finalAnswer: text,
    messageId: id,
  };
}
function greeting(): AgentTurn {
  return { ...answer("g", "你好，我在。"), tools: [], greeting: true };
}
function report(id: string): UserTurn {
  return {
    ...user(id, "子任务完成"),
    origin: { via: "system", supervisor: SUBTASK_REPORT_SUPERVISOR },
  };
}

function setup(turns: Turn[]) {
  const groups = buildRunGroups(turns, { splitAfterAnswer: true });
  const plan = assistantLinePlan(
    groups,
    turns,
    liveRunGroup(groups, false, false),
  );
  return {
    target: (id: string) =>
      messageMenuTarget(
        turns,
        plan,
        groups,
        turns.findIndex((t) => t.role !== "system" && t.messageId === id),
      ),
    rows: (id: string) =>
      messageRowIds(
        turns,
        groups,
        turns.findIndex((t) => t.role !== "system" && t.messageId === id),
      ),
  };
}

/** The rows as words: `copy`, `process:open`, `—`, `delete:running`. */
function words(entries: MessageMenuEntry[]): string[] {
  return entries.map((entry) =>
    entry.kind === "separator"
      ? "—"
      : entry.kind === "process"
        ? `process${entry.open ? ":open" : ""}`
        : entry.kind === "delete"
          ? `delete${entry.block ? `:${entry.block}` : ""}`
          : entry.kind,
  );
}

const TURNS: Turn[] = [
  greeting(),
  user("u0", "帮我订周五去上海的票"),
  step("s0"),
  question("q1"),
  user("ans", "周五"),
  step("s2"),
  answer("a3", "订好了：G7 次，08:00 出发。"),
  user("u4", "谢谢"),
  answer("a4", "不客气"),
];

describe("the rows of a bubble's menu", () => {
  const { target } = setup(TURNS);
  const idle = { processOpen: false, block: null };

  it("your message: 复制, 引用 — 删除", () => {
    expect(words(messageMenuEntries(target("u0")!, idle))).toEqual([
      "copy",
      "quote",
      "—",
      "delete",
    ]);
    // Copies your words as sent.
    expect(target("u0")!.copyText).toBe("帮我订周五去上海的票");
    expect(target("ans")!.copyText).toBe("周五");
  });

  it("its reply: 复制, 引用, 保存, 展开过程 — 删除; the source is Markdown", () => {
    const reply = target("a3")!;
    expect(words(messageMenuEntries(reply, idle))).toEqual([
      "copy",
      "quote",
      "save",
      "process",
      "—",
      "delete",
    ]);
    expect(reply.copyText).toBe("订好了：G7 次，08:00 出发。");
    expect(reply.saveSource).toBe(reply.copyText);
    // Open, it reads 收起过程.
    expect(
      words(messageMenuEntries(reply, { processOpen: true, block: null })),
    ).toContain("process:open");
  });

  it("no process item for a reply with no process, nor for the greeting", () => {
    expect(words(messageMenuEntries(target("a4")!, idle))).toEqual([
      "copy",
      "quote",
      "save",
      "—",
      "delete",
    ]);
    expect(words(messageMenuEntries(target("g")!, idle))).toEqual([
      "copy",
      "quote",
      "save",
      "—",
      "delete",
    ]);
  });

  it("a question it asked: its question, nothing of the bar's", () => {
    const asked = target("q1")!;
    expect(words(messageMenuEntries(asked, idle))).toEqual([
      "copy",
      "quote",
      "—",
      "delete",
    ]);
    expect(asked.copyText).toBe("**哪天**出发？");
    expect(asked.quoteText).toBe("哪天出发？");
    // Deleting it deletes the reply: asked by its answer.
    expect(asked.deletable).toEqual({ messageId: "q1", replyAnswerId: "a3" });
  });

  it("greys 删除 alone, with its reason; the rest stay", () => {
    for (const block of ["running", "asking", "subtasks"] as const) {
      expect(
        words(messageMenuEntries(target("a3")!, { processOpen: false, block })),
      ).toEqual(["copy", "quote", "save", "process", "—", `delete:${block}`]);
    }
  });

  it("an image without words: 删除 alone, no separator", () => {
    const turns: Turn[] = [
      { ...user("img", ""), attachments: [] },
      answer("a0"),
    ];
    expect(
      words(messageMenuEntries(setup(turns).target("img")!, idle)),
    ).toEqual(["delete"]);
  });

  it("a reply that is leaked tool-call markup: nothing to copy or save", () => {
    const turns: Turn[] = [
      user("u0"),
      answer(
        "a0",
        '<invoke name="code_run"><parameter name="x">1</parameter></invoke>',
      ),
    ];
    expect(words(messageMenuEntries(setup(turns).target("a0")!, idle))).toEqual(
      ["delete"],
    );
  });

  it("no menu on a step, a report row, a run drawn flat", () => {
    expect(target("s0")).toBeNull();
    const woke: Turn[] = [user("u0"), answer("a0"), report("r1"), answer("a1")];
    expect(setup(woke).target("r1")).toBeNull();
    const aborted: Turn[] = [user("u0"), answer("a0"), user("u1"), step("s1")];
    expect(setup(aborted).target("s1")).toBeNull();
  });
});

describe("引用 quotes the whole message", () => {
  it("short: whole; long: cut with 「…」", () => {
    const long = "这是一段很长的回复。".repeat(30);
    const turns: Turn[] = [user("u0"), answer("a0", long)];
    const quote = setup(turns).target("a0")!.quoteText!;
    expect(quote.endsWith("…")).toBe(true);
    // About 120 CJK characters.
    expect(Array.from(quote).length).toBeLessThanOrEqual(121);
    expect(setup(TURNS).target("a4")!.quoteText).toBe("不客气");
  });
});

describe("the rows a deletion hides", () => {
  it("yours, the greeting: the one row", () => {
    const { rows } = setup(TURNS);
    expect(rows("u0")).toEqual(["u0"]);
    expect(rows("ans")).toEqual(["ans"]);
    expect(rows("g")).toEqual(["g"]);
  });

  it("a reply: everything it said in the run, your answer staying", () => {
    const { rows } = setup(TURNS);
    expect(rows("a3")).toEqual(["s0", "q1", "s2", "a3"]);
    expect(rows("q1")).toEqual(["s0", "q1", "s2", "a3"]);
    expect(rows("a4")).toEqual(["a4"]);
  });

  it("a round Core woke it for: with its hidden report row", () => {
    const turns: Turn[] = [
      user("u0"),
      answer("a0"),
      report("r1"),
      step("s1"),
      answer("a1"),
    ];
    expect(setup(turns).rows("a1")).toEqual(["r1", "s1", "a1"]);
  });
});
