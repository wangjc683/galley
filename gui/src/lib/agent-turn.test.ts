import { beforeEach, describe, expect, it } from "vitest";

import {
  buildAgentTurn,
  isFinalAnswerTurn,
  normalizeFinalAnswer,
  previewFromContent,
  toolEventsFromRaw,
} from "@/lib/agent-turn";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { rowsToTurns } from "@/stores/messages/rowsToTurns";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { makeMessageRow, makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type { AgentTurn } from "@/types/conversation";

const tauriMocks = getTauriMocks();

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

// ---------------- unit: the shared construction rules ----------------

describe("toolEventsFromRaw", () => {
  it("resolves ids result-first, call-second, prefix-fallback-last", () => {
    const events = toolEventsFromRaw(
      [
        { toolName: "a", toolUseId: "call-a" },
        { toolName: "b", toolUseId: "call-b" },
        { toolName: "c" },
      ],
      [{ toolUseId: "result-a" }, {}, {}],
      "t-9-",
    );
    expect(events.map((e) => e.id)).toEqual(["result-a", "call-b", "t-9-2"]);
  });

  it("narrows malformed names and args defensively", () => {
    const [event] = toolEventsFromRaw([{ toolName: 42, args: null }], [], "t-");
    expect(event.name).toBe("(unknown)");
    expect(event.args).toEqual({});
  });

  it("previews are capped at 500 chars with a visible ellipsis", () => {
    const long = "x".repeat(600);
    const [event] = toolEventsFromRaw(
      [{ toolName: "a" }],
      [{ content: long }],
      "t-",
    );
    expect(event.resultPreview).toHaveLength(501);
    expect(event.resultPreview?.endsWith("…")).toBe(true);
  });

  it("null and undefined content mean no preview (2026-07-11 unification)", () => {
    // Pre-unification the live path rendered a literal "null" preview
    // while restore showed nothing — the exact live/restore divergence
    // this module exists to prevent.
    expect(previewFromContent(null)).toBeUndefined();
    expect(previewFromContent(undefined)).toBeUndefined();
    expect(previewFromContent({ ok: true })).toBe('{"ok":true}');
  });
});

describe("isFinalAnswerTurn / normalizeFinalAnswer / buildAgentTurn", () => {
  it("gates on zero tools or the synthetic no_tool placeholder", () => {
    expect(isFinalAnswerTurn([])).toBe(true);
    const noTool = toolEventsFromRaw([{ toolName: "no_tool" }], [], "t-");
    expect(isFinalAnswerTurn(noTool)).toBe(true);
    const real = toolEventsFromRaw([{ toolName: "file_read" }], [], "t-");
    expect(isFinalAnswerTurn(real)).toBe(false);
  });

  it("normalizes empty/whitespace/legacy-null final answers to null", () => {
    expect(normalizeFinalAnswer("")).toBeNull();
    expect(normalizeFinalAnswer("   \n")).toBeNull();
    expect(normalizeFinalAnswer(null)).toBeNull();
    expect(normalizeFinalAnswer(undefined)).toBeNull();
    expect(normalizeFinalAnswer("answer")).toBe("answer");
  });

  it("normalizes field presence: nulls omitted, summaries trimmed", () => {
    const turn = buildAgentTurn({
      thinking: null,
      preamble: null,
      tools: [],
      finalAnswer: "ok",
      turnIndex: 3,
      summary: "  trimmed  ",
      telemetry: null,
    });
    expect(turn).toEqual({
      role: "agent",
      thinking: undefined,
      preamble: undefined,
      tools: [],
      finalAnswer: "ok",
      turnIndex: 3,
      summary: "trimmed",
    });
    expect("telemetry" in turn).toBe(false);
  });
});

// ---------------- round trip: live === restored ----------------
//
// The whole point of the shared module: a turn rendered live and the
// same turn reopened from SQLite must be one shape. Drives the REAL
// live path (dispatchIPCEvent → store) and the REAL restore path
// (persist payload → MessageRow → rowsToTurns) with no re-derivation
// in between, so a one-sided edit to either path fails here.

describe("live → persist → restore round trip", () => {
  beforeEach(() => {
    resetStores();
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-test", gaRuntimeKind: "external" })],
      activeSessionId: "s-test",
    });
    usePrefsStore.setState({ yoloMode: false });
    useMessagesStore.getState().ensureMessages("s-test");
    useRuntimeStore.getState().ensureRuntime("s-test", { cachedLLMs: [] });
  });

  async function roundTrip(event: {
    turnIndex: number;
    summary: string;
    toolCalls: unknown[];
    toolResults: unknown[];
    responseContent: string;
  }): Promise<{ live: AgentTurn; restored: AgentTurn }> {
    dispatchIPCEvent({
      kind: "turn_end",
      sessionId: "s-test",
      exitReason: null,
      timestamp: "2026-06-18T08:01:02.000Z",
      ...event,
    } as never);
    await flushPromises();

    const turns = useMessagesStore.getState().byId["s-test"].turns;
    const live = turns[turns.length - 1] as AgentTurn;

    const persistCall = tauriMocks.invoke.mock.calls.find(
      ([cmd]) => cmd === "persist_assistant_message",
    );
    expect(persistCall).toBeDefined();
    const input = (persistCall![1] as { input: Record<string, unknown> })
      .input;

    // The persisted columns, exactly as Core would hand them back.
    const assistantRow = makeMessageRow({
      role: "assistant",
      turn_index: input.turnIndex as number,
      content: input.content as string,
      tool_calls: input.toolCalls as string,
      tool_results: input.toolResults as string,
      thinking: input.thinking as string | null,
      final_answer: input.finalAnswer as string | null,
      summary: input.summary as string | null,
      preamble: input.preamble as string | null,
    });
    // User row opening the message block — base for step recovery
    // (turnIndexOffset is 0 in this fresh store, so base = 1).
    const userRow = makeMessageRow({ role: "user", turn_index: 1 });
    const restored = rowsToTurns([userRow, assistantRow]).find(
      (t): t is AgentTurn => t.role === "agent",
    );
    expect(restored).toBeDefined();
    return { live, restored: restored! };
  }

  it("an intermediate tool turn survives the round trip identically", async () => {
    const { live, restored } = await roundTrip({
      turnIndex: 2,
      summary: "读取 PRD 第 180-230 行",
      toolCalls: [
        {
          toolName: "file_read",
          toolUseId: "call-1",
          args: { path: "docs/PRD.md" },
        },
      ],
      toolResults: [{ toolUseId: "call-1", content: "line 180…line 230" }],
      responseContent:
        "<thinking>需要先看 PRD</thinking>当前阶段：读取需求文档。<tool_use>file_read</tool_use>",
    });

    // Tool-only turn: no final answer either side.
    expect(live.finalAnswer).toBeNull();
    // Field-for-field: what the user saw live IS what reopen shows.
    expect(restored.thinking).toEqual(live.thinking);
    expect(restored.preamble).toEqual(live.preamble);
    expect(restored.finalAnswer).toEqual(live.finalAnswer);
    expect(restored.summary).toEqual(live.summary);
    expect(restored.tools).toEqual(live.tools);
    // displayStep recovered by the stepper === GA's live step
    // (the turn-index identity invariant, crossing paths here).
    expect(restored.turnIndex).toEqual(live.turnIndex);
  });

  it("a final-answer turn survives the round trip identically", async () => {
    const { live, restored } = await roundTrip({
      turnIndex: 1,
      summary: "回答完毕",
      toolCalls: [{ toolName: "no_tool", args: {} }],
      toolResults: [{ content: null }],
      responseContent: "<thinking>可以直接回答</thinking>最终答案在此。",
    });

    expect(live.finalAnswer).toBe("最终答案在此。");
    // The no_tool gate must have suppressed the preamble on BOTH sides.
    expect(live.preamble).toBeUndefined();
    expect(restored.preamble).toBeUndefined();
    expect(restored.thinking).toEqual(live.thinking);
    expect(restored.finalAnswer).toEqual(live.finalAnswer);
    expect(restored.summary).toEqual(live.summary);
    expect(restored.turnIndex).toEqual(live.turnIndex);
    // null tool-result content: no preview on either side (the
    // divergence that existed before unification).
    expect(live.tools[0].resultPreview).toBeUndefined();
    expect(restored.tools[0].resultPreview).toBeUndefined();
  });
});
