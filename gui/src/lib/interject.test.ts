// What you say while the main chat's run works (main chat ticket 136):
// how the run, the line under the dots, a restore and the queue bar read
// it.

import { describe, expect, it } from "vitest";

import { assistantTyping } from "@/lib/assistant-conversation";
import { assistantDoing } from "@/lib/assistant-progress";
import { copyForLanguage } from "@/lib/i18n";
import {
  buildRunGroups,
  liveRunElapsedBaseMs,
  runStepNumbers,
} from "@/lib/run-groups";
import { queueBarItems, type QueuedMessage } from "@/lib/session-queue";
import { rowsToTurns } from "@/stores/messages/rowsToTurns";
import { makeMessageRow } from "@/test/factories";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

const zh = copyForLanguage("zh-CN");

function tool(name: string): ConversationToolEvent {
  return { id: `t-${name}`, name, status: "success-historical", args: {} };
}

function user(content: string, extra: Partial<UserTurn> = {}): UserTurn {
  return { role: "user", content, messageId: `u-${content}`, ...extra };
}

function step(summary: string): AgentTurn {
  return {
    role: "agent",
    tools: [tool("file_read")],
    finalAnswer: null,
    summary,
  };
}

function answer(text: string, elapsedMs: number): AgentTurn {
  return {
    role: "agent",
    tools: [tool("no_tool")],
    finalAnswer: text,
    telemetry: { elapsedMs, inputTokens: 10, outputTokens: 5, requestCount: 3 },
  };
}

describe("a run with words said while it worked", () => {
  const turns: Turn[] = [
    user("查明天天气"),
    step("先查城市"),
    user("上海的", { interjected: true }),
    step("查上海的预报"),
    answer("上海明天晴。", 12_000),
  ];

  it("is one run, its words a member, its steps numbered on", () => {
    const groups = buildRunGroups(turns);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIndices).toEqual([0, 1, 2, 3, 4]);
    expect(groups[0].complete).toBe(true);
    expect(groups[0].stats.stepCount).toBe(3);
    expect([...runStepNumbers(groups, turns).values()]).toEqual([1, 2, 3]);
  });

  it("keeps its whole time and tokens: the words split no GA loop", () => {
    const groups = buildRunGroups(turns);
    expect(groups[0].stats.elapsedMs).toBe(12_000);
    expect(groups[0].stats.telemetry).toMatchObject({
      elapsedMs: 12_000,
      requestCount: 3,
    });
    expect(liveRunElapsedBaseMs(turns.slice(0, 4))).toBe(0);
  });

  it("the line under the dots goes on saying what it was doing", () => {
    const live = turns.slice(0, 3);
    expect(assistantDoing(live, "", zh)).toBe("先查城市");
    // An ordinary message of yours starts the line over.
    expect(assistantDoing([...turns.slice(0, 2), user("新问题")], "", zh)).toBe(
      zh.assistant.progressThinking,
    );
  });

  it("a woken round you wrote into types like one you started", () => {
    const report: UserTurn = {
      role: "user",
      content: "[Galley — not a message from the user] report",
      messageId: "u-report",
      origin: { via: "system", supervisor: "galley-report" },
    };
    const woken: Turn[] = [report, step("看看子任务")];
    expect(assistantTyping(woken, "")).toBe(false);
    expect(
      assistantTyping([...woken, user("怎么样了", { interjected: true })], ""),
    ).toBe(true);
  });
});

describe("restoring words said mid-run", () => {
  it("reads a user row with a higher sequence as interjected, the step count going on", () => {
    const restored = rowsToTurns([
      makeMessageRow({
        id: "u",
        role: "user",
        turn_index: 4,
        sequence: 0,
        content: "查天气",
      }),
      makeMessageRow({
        id: "a4",
        role: "assistant",
        turn_index: 4,
        sequence: 1,
        content: "先查城市",
        tool_calls: JSON.stringify([{ toolName: "file_read", args: {} }]),
      }),
      makeMessageRow({
        id: "i",
        role: "user",
        turn_index: 4,
        sequence: 2,
        content: "上海的",
      }),
      makeMessageRow({
        id: "a5",
        role: "assistant",
        turn_index: 5,
        sequence: 1,
        content: "上海明天晴。",
        final_answer: "上海明天晴。",
        tool_calls: JSON.stringify([{ toolName: "no_tool", args: {} }]),
      }),
    ]);
    expect(restored[0]).not.toHaveProperty("interjected");
    expect(restored[2]).toMatchObject({ role: "user", interjected: true });
    expect((restored[3] as AgentTurn).turnIndex).toBe(2);
    const groups = buildRunGroups(restored);
    expect(groups).toHaveLength(1);
    expect(groups[0].finalTurnIndex).toBe(3);
  });
});

describe("the queue bar", () => {
  const queued = (queueId: string, interjected?: boolean): QueuedMessage => ({
    queueId,
    text: queueId,
    queuedAt: "t",
    interjected,
  });

  it("leaves out what the running run takes mid-way", () => {
    const plain = [queued("a"), queued("b")];
    expect(queueBarItems(plain)).toBe(plain);
    expect(
      queueBarItems([queued("a"), queued("b", true)]).map((m) => m.queueId),
    ).toEqual(["a"]);
  });
});
