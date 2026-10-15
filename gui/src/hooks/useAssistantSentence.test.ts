import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectAssistantSentence } from "@/hooks/useAssistantSentence";
import {
  assistantCachedSentence,
  assistantLineSentence,
} from "@/lib/assistant-conversation";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { cleanPartialContent } from "@/lib/ipc/ga-output-cleaning";
import { useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

// Counts the passes over the stream: the regex cleaning is the cost the
// card and the header must not pay per store write.
const cleaning = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/ipc/ga-output-cleaning", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ipc/ga-output-cleaning")>();
  return {
    ...actual,
    cleanPartialContent: (text: string) => {
      cleaning.calls += 1;
      return actual.cleanPartialContent(text);
    },
  };
});

function tool(name: string, args: Record<string, unknown> = {}) {
  return {
    id: `t-${name}-${Math.random()}`,
    name,
    status: "success-historical",
    args,
  } as ConversationToolEvent;
}

function user(content: string): UserTurn {
  return { role: "user", content, messageId: `u-${content}` };
}

function step(narration: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: narration,
    summary: `第 ${index} 步的摘要`,
    tools: [tool("web_scan")],
  };
}

function ask(question: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: null,
    tools: [tool("ask_user", { question, candidates: ["8:30", "9:00"] })],
  };
}

const MAIN = "s-main";

beforeEach(() => {
  resetStores();
  cleaning.calls = 0;
});

describe("the card's and the header's sentence: the conversation's line", () => {
  it("cleans the raw stream as the main area does, then takes the line's sentence", () => {
    const turns: Turn[] = [user("看看周六的船票"), step("我先查一下船班。", 1)];
    const cases: [string, string | null][] = [
      ["", "我先查一下船班。"],
      // The first line of what streams wins, GA's tags out.
      [
        "<thinking>先想一下</thinking>\n\n周六上午还有三班船。\n\n我再看返程",
        "周六上午还有三班船。",
      ],
      // Still reasoning: nothing readable streams yet.
      ["<thinking>还在想", "我先查一下船班。"],
    ];
    for (const [stream, expected] of cases) {
      expect(assistantCachedSentence(turns, stream)).toBe(expected);
      // The same edges as the line (MainView: cleaned, trimmed).
      expect(assistantCachedSentence(turns, stream)).toBe(
        assistantLineSentence(turns, cleanPartialContent(stream).trim()),
      );
    }
    // Answered its question: the narration before it is stale.
    expect(
      assistantCachedSentence(
        [...turns, ask("订哪一班？", 2), user("8:30")],
        "",
      ),
    ).toBeNull();
  });

  it("is null at rest without looking at the stream, and cleans it once per chunk for every reader", () => {
    const store = useMessagesStore.getState();
    store.appendUserTurn(MAIN, "看看周六的船票", "c-1");
    store.setAgentRunning(MAIN, true);
    store.appendInFlightDelta(MAIN, "周六上午还有三班船。\n");
    cleaning.calls = 0;
    const state = () => useMessagesStore.getState();

    expect(selectAssistantSentence(state(), MAIN, false)).toBeNull();
    expect(cleaning.calls).toBe(0);

    // The card and the header read the same chunk: one pass.
    expect(selectAssistantSentence(state(), MAIN, true)).toBe(
      "周六上午还有三班船。",
    );
    expect(selectAssistantSentence(state(), MAIN, true)).toBe(
      "周六上午还有三班船。",
    );
    expect(cleaning.calls).toBe(1);

    // Another session's write leaves the pair as it was: no pass.
    store.appendInFlightDelta("s-other", "别的会话");
    expect(selectAssistantSentence(state(), MAIN, true)).toBe(
      "周六上午还有三班船。",
    );
    expect(cleaning.calls).toBe(1);

    // The next chunk: one more.
    store.appendInFlightDelta(MAIN, "8:30");
    selectAssistantSentence(state(), MAIN, true);
    selectAssistantSentence(state(), MAIN, true);
    expect(cleaning.calls).toBe(2);
  });

  it("changes, and so re-renders a reader, only when the sentence does — not per chunk", () => {
    const store = useMessagesStore.getState();
    store.appendUserTurn(MAIN, "看看周六的船票", "c-1");
    store.setAgentRunning(MAIN, true);
    // What useSyncExternalStore does with a selector: re-render when
    // the selected value changes (Object.is).
    let selected = selectAssistantSentence(
      useMessagesStore.getState(),
      MAIN,
      true,
    );
    const seen: (string | null)[] = [selected];
    const unsubscribe = useMessagesStore.subscribe((state) => {
      const next = selectAssistantSentence(state, MAIN, true);
      if (!Object.is(next, selected)) {
        selected = next;
        seen.push(next);
      }
    });
    // The first line in three chunks, then 30 chunks of the rest.
    const chunks = [
      "周六上午",
      "还有三班船",
      "有票。\n\n",
      ...Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 段的内容。\n`),
    ];
    for (const chunk of chunks) store.appendInFlightDelta(MAIN, chunk);
    unsubscribe();
    expect(chunks).toHaveLength(33);
    expect(seen).toEqual([
      null,
      "周六上午",
      "周六上午还有三班船",
      "周六上午还有三班船有票。",
    ]);
  });

  it("reads the main chat's cache while another session is on screen", () => {
    useSessionsStore.setState({
      sessions: [
        makeSession({ id: MAIN, mainChat: true, gaRuntimeKind: "managed" }),
        makeSession({ id: "s-other", gaRuntimeKind: "managed" }),
      ],
      activeSessionId: "s-other",
    });
    const store = useMessagesStore.getState();
    store.ensureMessages("s-other");
    store.appendUserTurn(MAIN, "看看周六的船票", "c-1");
    store.setAgentRunning(MAIN, true);
    const sentence = () =>
      selectAssistantSentence(useMessagesStore.getState(), MAIN, true);
    expect(sentence()).toBeNull();

    dispatchIPCEvent({
      kind: "turn_end",
      sessionId: MAIN,
      turnIndex: 1,
      summary: "已查到周六的船班；接下来核对余票。",
      toolCalls: [{ toolName: "web_scan", args: {} }],
      toolResults: [{ toolUseId: "c1", content: "ok" }],
      responseContent: "我先查一下周六上午的船班。",
      exitReason: null,
      timestamp: "2026-10-15T08:01:00.000Z",
    });
    expect(sentence()).toBe("我先查一下周六上午的船班。");

    dispatchIPCEvent({
      kind: "turn_progress",
      sessionId: MAIN,
      delta: "周六上午还有三班船有票。\n\n",
      source: "workbench",
      timestamp: "2026-10-15T08:01:02.000Z",
    });
    expect(sentence()).toBe("周六上午还有三班船有票。");
    // Nothing went to the session on screen.
    expect(useMessagesStore.getState().byId["s-other"].inFlightContent).toBe(
      "",
    );
    expect(useSessionsStore.getState().activeSessionId).toBe("s-other");
  });
});
