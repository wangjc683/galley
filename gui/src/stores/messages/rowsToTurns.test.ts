import { describe, expect, it } from "vitest";

import {
  derivePendingAskUser,
  rowsToTurns,
} from "@/stores/messages/rowsToTurns";
import { makeMessageRow } from "@/test/factories";
import type {
  AgentTurn,
  SystemTurn,
  UserTurn,
} from "@/types/conversation";

describe("rowsToTurns", () => {
  it("restores user, assistant, and goal system turns", () => {
    const turns = rowsToTurns([
      makeMessageRow({
        role: "user",
        turn_index: 5,
        content: "Investigate this",
        created_via: "supervisor",
        supervisor: "claude-skill-galley-supervisor/v1",
        origin_note: "user asked through supervisor",
        created_at: "2026-06-18T08:01:00.000Z",
      }),
      makeMessageRow({
        role: "assistant",
        turn_index: 5,
        content: "<thinking>private</thinking>Final answer",
        tool_calls: JSON.stringify([
          {
            toolName: "file_read",
            toolUseId: "call-1",
            args: { path: "README.md" },
          },
        ]),
        tool_results: JSON.stringify([
          {
            toolUseId: "result-1",
            content: { ok: true },
          },
        ]),
        thinking: "private",
        final_answer: "Final answer",
        summary: "Read the README",
        preamble: "Checking the file first.",
      }),
      makeMessageRow({
        role: "assistant",
        turn_index: 6,
        content: "Second step",
        final_answer: "",
        summary: "Checked the next file",
      }),
      makeMessageRow({
        role: "system",
        turn_index: 7,
        content: "Goal checkpoint",
      }),
    ]);

    expect(turns).toHaveLength(4);
    expect(turns[0]).toMatchObject({
      role: "user",
      content: "Investigate this",
      createdAt: "2026-06-18T08:01:00.000Z",
      origin: {
        via: "supervisor",
        supervisor: "claude-skill-galley-supervisor/v1",
        reason: "user asked through supervisor",
      },
    });
    expect(turns[1]).toMatchObject({
      role: "agent",
      thinking: "private",
      preamble: "Checking the file first.",
      finalAnswer: "Final answer",
      turnIndex: 1,
      summary: "Read the README",
      tools: [
        {
          id: "result-1",
          name: "file_read",
          status: "success-historical",
          args: { path: "README.md" },
          resultPreview: '{"ok":true}',
        },
      ],
    });
    expect(turns[2]).toMatchObject({
      role: "agent",
      finalAnswer: null,
      turnIndex: 2,
    });
    expect(turns[3]).toEqual({
      role: "system",
      content: "Goal checkpoint",
      variant: "goal",
    });
  });

  it("restores a denied tool as denied, not success", () => {
    const turns = rowsToTurns([
      makeMessageRow({
        role: "assistant",
        turn_index: 4,
        content: "OK, skipping that.",
        tool_calls: JSON.stringify([
          { toolName: "run_command", args: { command: "rm -rf build" } },
        ]),
        tool_results: JSON.stringify([
          {
            toolUseId: "call-9",
            // Verbatim shape from runner/handlers.py's deny path, as
            // GA serializes it into the tool result content.
            content: '{"status": "denied", "msg": "User denied this tool call"}',
          },
        ]),
        final_answer: "OK, skipping that.",
      }),
    ]);

    expect(turns).toHaveLength(1);
    const agent = turns[0];
    if (agent.role !== "agent") throw new Error("expected agent turn");
    expect(agent.tools[0]).toMatchObject({
      name: "run_command",
      status: "denied",
    });
  });

  it("tolerates malformed tool JSON", () => {
    const turns = rowsToTurns([
      makeMessageRow({
        role: "assistant",
        turn_index: 3,
        content: "Recovered answer",
        tool_calls: "not json",
        tool_results: "{}",
        final_answer: "Recovered answer",
      }),
    ]);

    expect(turns).toEqual([
      {
        role: "agent",
        thinking: undefined,
        preamble: undefined,
        tools: [],
        finalAnswer: "Recovered answer",
        turnIndex: 3,
        summary: undefined,
      },
    ]);
  });

  it("restores assistant telemetry when present", () => {
    const turns = rowsToTurns([
      makeMessageRow({
        role: "assistant",
        turn_index: 3,
        content: "Recovered answer",
        final_answer: "Recovered answer",
        telemetry: {
          elapsedMs: 135_000,
          inputTokens: 18_000,
          outputTokens: 1_200,
          contextUsedChars: 126_000,
          contextLimitChars: 300_000,
        },
      }),
    ]);

    expect(turns[0]).toMatchObject({
      role: "agent",
      telemetry: {
        elapsedMs: 135_000,
        inputTokens: 18_000,
        outputTokens: 1_200,
        contextUsedChars: 126_000,
        contextLimitChars: 300_000,
      },
    });
  });

  it("preserves ask_user question in tool args so it stays visible after answering", () => {
    // An ask_user turn typically carries no final_answer (the LLM
    // emitted a pure tool_use block). The question text lives only in
    // the ask_user tool's args JSON; Conversation renders a static
    // AnsweredAskUser echo from it once the live bubble clears. This
    // test pins the data contract: restore must keep the question in
    // tools[].args even though the ask_user callout is filtered at
    // render time.
    const turns = rowsToTurns([
      makeMessageRow({
        role: "assistant",
        turn_index: 1,
        content: "",
        tool_calls: JSON.stringify([
          {
            toolName: "ask_user",
            toolUseId: "call-1",
            args: {
              question:
                "<summary>internal recap</summary>\nPick a skill to master:",
              candidates: ["coding", "music"],
            },
          },
        ]),
        tool_results: JSON.stringify([
          { toolUseId: "result-1", content: "answered" },
        ]),
        final_answer: "",
        summary: "ask_user, args: {...}",
      }),
    ]);

    expect(turns).toEqual([
      {
        role: "agent",
        thinking: undefined,
        preamble: undefined,
        tools: [
          {
            id: "result-1",
            name: "ask_user",
            status: "success-historical",
            args: {
              question:
                "<summary>internal recap</summary>\nPick a skill to master:",
              candidates: ["coding", "music"],
            },
            resultPreview: "answered",
          },
        ],
        finalAnswer: null,
        turnIndex: 1,
        summary: "ask_user, args: {...}",
      },
    ]);
    // The raw args (incl. GA tags) survive intact here; AnsweredAskUser
    // strips the tags at render time so the displayed text is clean.
  });
});

describe("derivePendingAskUser", () => {
  const askUserTurn = (args: Record<string, unknown>): AgentTurn => ({
    role: "agent",
    tools: [
      { id: "t-ask", name: "ask_user", status: "success-historical", args },
    ],
    finalAnswer: null,
  });
  const agentTurn = (): AgentTurn => ({
    role: "agent",
    tools: [
      { id: "t-1", name: "file_read", status: "success-historical", args: {} },
    ],
    finalAnswer: "done",
  });
  const userTurn = (): UserTurn => ({ role: "user", content: "answered" });
  const systemTurn = (): SystemTurn => ({
    role: "system",
    content: "checkpoint",
    variant: "goal",
  });

  it("rebuilds pending state from an unanswered trailing ask_user, stripping GA tags", () => {
    const pending = derivePendingAskUser([
      userTurn(),
      askUserTurn({
        question: "<summary>recap</summary>\nPick a skill to master:",
        candidates: ["coding", 42],
      }),
    ]);
    // Non-string candidates go through String() — same defensive
    // coercion the bridge applies to GA args on the live path.
    expect(pending).toEqual({
      question: "Pick a skill to master:",
      candidates: ["coding", "42"],
    });
  });

  it("treats missing candidates as an open-ended question", () => {
    expect(
      derivePendingAskUser([askUserTurn({ question: "What now?" })]),
    ).toEqual({ question: "What now?", candidates: [] });
  });

  it("returns null when a user turn answered the question", () => {
    expect(
      derivePendingAskUser([askUserTurn({ question: "Q?" }), userTurn()]),
    ).toBeNull();
  });

  it("returns null when a later agent turn superseded the question", () => {
    expect(
      derivePendingAskUser([askUserTurn({ question: "Q?" }), agentTurn()]),
    ).toBeNull();
  });

  it("skips trailing system turns (goal narration / btw bystanders)", () => {
    expect(
      derivePendingAskUser([askUserTurn({ question: "Q?" }), systemTurn()]),
    ).toEqual({ question: "Q?", candidates: [] });
  });

  it("returns null for sessions with no ask_user tail", () => {
    expect(derivePendingAskUser([])).toBeNull();
    expect(derivePendingAskUser([userTurn(), agentTurn()])).toBeNull();
    expect(
      derivePendingAskUser([askUserTurn({ candidates: ["no question"] })]),
    ).toBeNull();
  });
});
