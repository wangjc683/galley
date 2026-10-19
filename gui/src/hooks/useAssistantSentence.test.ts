import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  selectAssistantSentence,
  selectAssistantWriting,
} from "@/hooks/useAssistantSentence";
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

describe("the card's sentence: the conversation's line", () => {
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

  // Ruling 100 (ticket 47): a step that wrote only its summary moves the
  // card's sentence on, through the cache, as a narration does.
  it("takes up a step's summary when it wrote no narration", () => {
    const store = useMessagesStore.getState();
    store.appendUserTurn(MAIN, "提醒我喝水", "c-1");
    store.setAgentRunning(MAIN, true);
    const sentence = () =>
      selectAssistantSentence(useMessagesStore.getState(), MAIN, true);
    expect(sentence()).toBeNull();

    const turnEnd = (
      turnIndex: number,
      responseContent: string,
      summary: string,
    ) =>
      dispatchIPCEvent({
        kind: "turn_end",
        sessionId: MAIN,
        turnIndex,
        summary,
        toolCalls: [{ toolName: "code_run", args: {} }],
        toolResults: [{ toolUseId: `c${turnIndex}`, content: "ok" }],
        responseContent,
        exitReason: null,
        timestamp: `2026-10-19T02:3${turnIndex}:00.000Z`,
      });

    turnEnd(
      1,
      "我先看一下现在几点。<summary>需要设置喝水提醒；先读取本机时间。</summary>",
      "需要设置喝水提醒；先读取本机时间。",
    );
    expect(sentence()).toBe("我先看一下现在几点。");

    // Step 2 wrote only its summary: the card moves on to it, not
    // holding step 1's narration.
    turnEnd(
      2,
      "<summary>本机时间为10月19日10:34；先检查是否已有喝水提醒，避免重复。</summary>",
      "本机时间为10月19日10:34；先检查是否已有喝水提醒，避免重复。",
    );
    expect(sentence()).toBe(
      "本机时间为10月19日10:34；先检查是否已有喝水提醒，避免重复。",
    );
    // Through the same function as the line.
    expect(sentence()).toBe(
      assistantLineSentence(useMessagesStore.getState().byId[MAIN].turns, ""),
    );
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

// Ruling 104 (ticket 52): the header's 「正在输入…」 reads the same
// stream, through the same one cleaning pass, and only flips.
describe("the header's 「正在输入…」: whether it writes words", () => {
  const DISPATCH =
    '🛠️ Tool: `web_scan`  📥 args:\n````text\n{"url": "x"}\n````\n';
  const progress = (delta: string) =>
    dispatchIPCEvent({
      kind: "turn_progress",
      sessionId: MAIN,
      delta,
      source: "workbench",
      timestamp: "2026-10-19T08:00:01.000Z",
    });
  const turnEnd = (
    turnIndex: number,
    responseContent: string,
    final: boolean,
  ) =>
    dispatchIPCEvent({
      kind: "turn_end",
      sessionId: MAIN,
      turnIndex,
      summary: `第 ${turnIndex} 步的摘要`,
      toolCalls: final ? [] : [{ toolName: "web_scan", args: {} }],
      toolResults: final ? [] : [{ toolUseId: `c${turnIndex}`, content: "ok" }],
      responseContent,
      exitReason: final ? { result: "CURRENT_TASK_DONE", data: null } : null,
      timestamp: `2026-10-19T08:0${turnIndex}:00.000Z`,
    });

  it("is false at rest without looking at the stream, and shares the card's one pass per chunk", () => {
    const store = useMessagesStore.getState();
    store.appendUserTurn(MAIN, "看看周六的船票", "c-1");
    store.setAgentRunning(MAIN, true);
    store.appendInFlightDelta(MAIN, "周六上午还有三班船。\n");
    cleaning.calls = 0;
    const state = () => useMessagesStore.getState();

    expect(selectAssistantWriting(state(), MAIN, false)).toBe(false);
    expect(cleaning.calls).toBe(0);

    // The header and the card's sentence on the same chunk: one pass.
    expect(selectAssistantWriting(state(), MAIN, true)).toBe(true);
    expect(selectAssistantSentence(state(), MAIN, true)).toBe(
      "周六上午还有三班船。",
    );
    expect(selectAssistantWriting(state(), MAIN, true)).toBe(true);
    expect(cleaning.calls).toBe(1);

    // Another session's write leaves the stream as it was: no pass.
    store.appendInFlightDelta("s-other", "别的会话");
    expect(selectAssistantWriting(state(), MAIN, true)).toBe(true);
    expect(cleaning.calls).toBe(1);

    // A dispatch, an open thinking: known without cleaning.
    store.appendInFlightDelta(MAIN, DISPATCH);
    expect(selectAssistantWriting(state(), MAIN, true)).toBe(false);
    store.clearInFlightContent(MAIN);
    store.appendInFlightDelta(MAIN, "<thinking>再看看返程");
    expect(selectAssistantWriting(state(), MAIN, true)).toBe(false);
    expect(cleaning.calls).toBe(1);
  });

  it("re-renders the header only when it flips, the open card never per chunk", () => {
    useSessionsStore.setState({
      sessions: [
        makeSession({ id: MAIN, mainChat: true, gaRuntimeKind: "managed" }),
      ],
      activeSessionId: MAIN,
    });
    const store = useMessagesStore.getState();
    store.appendUserTurn(MAIN, "看看周六的船票", "c-1");
    store.setAgentRunning(MAIN, true);

    // What each subscribes to, as useSyncExternalStore compares it: a
    // re-render when any selected value changes (Object.is; the status
    // view's useShallow projection as one key).
    const status = (s: ReturnType<typeof useMessagesStore.getState>) => {
      const m = s.byId[MAIN];
      return `${m?.agentRunning}|${m?.pendingAskUser != null}|${m?.pausedAtStepLimit}`;
    };
    const running = (s: ReturnType<typeof useMessagesStore.getState>) =>
      s.byId[MAIN]?.agentRunning ?? false;
    const readers = {
      // AssistantIdentity: useAssistantState({ open: true, header: true }).
      header: (s: ReturnType<typeof useMessagesStore.getState>) => [
        status(s),
        selectAssistantSentence(s, MAIN, false),
        selectAssistantWriting(s, MAIN, running(s)),
      ],
      // SidebarAssistantCard with the main chat on screen: its state
      // (no stream: !open, not the header), the question, the turns
      // its last message comes from.
      card: (s: ReturnType<typeof useMessagesStore.getState>) => [
        status(s),
        selectAssistantSentence(s, MAIN, false),
        selectAssistantWriting(s, MAIN, false),
        s.byId[MAIN]?.pendingAskUser?.question ?? null,
        s.byId[MAIN]?.turns,
        s.byId[MAIN]?.restoring ?? false,
      ],
    };
    const renders = { header: 0, card: 0 };
    const words: boolean[] = [];
    let last = {
      header: readers.header(useMessagesStore.getState()),
      card: readers.card(useMessagesStore.getState()),
    };
    const unsubscribe = useMessagesStore.subscribe((s) => {
      for (const key of ["header", "card"] as const) {
        const next = readers[key](s);
        if (next.some((v, i) => !Object.is(v, last[key][i]))) {
          renders[key] += 1;
          last = { ...last, [key]: next };
          if (key === "header") words.push(next[2] as boolean);
        }
      }
    });

    // Step 1: it reasons, writes a line, dispatches a tool, the tool
    // prints; then the step lands.
    const step1 = [
      "<thinking>",
      ...Array.from({ length: 8 }, (_, i) => `想第 ${i + 1} 点。`),
      "</thinking>\n\n",
      ...Array.from({ length: 12 }, (_, i) => `查第 ${i + 1} 班。`),
      "\n",
      DISPATCH,
      ...Array.from({ length: 6 }, (_, i) => `\`\`\`\`\`\n输出 ${i}\n`),
    ];
    for (const chunk of step1) progress(chunk);
    turnEnd(1, "查第 1 班。", false);
    // Step 2: the reply streams, then lands; the run completes.
    const step2 = [
      "<thinking>想好了</thinking>\n\n",
      ...Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 句。`),
    ];
    for (const chunk of step2) progress(chunk);
    turnEnd(2, "周六上午还有三班船有票。", true);
    dispatchIPCEvent({
      kind: "run_complete",
      sessionId: MAIN,
      exitReason: { result: "CURRENT_TASK_DONE", data: null },
      finalContent: "周六上午还有三班船有票。",
      totalTurns: 2,
      timestamp: "2026-10-19T08:03:00.000Z",
    });
    unsubscribe();

    const chunks = step1.length + step2.length;
    expect(chunks).toBe(51);
    // The header: 「正在输入…」 on the line's first words, 「思考中」 at the
    // dispatch, 「正在输入…」 on the reply, gone when it lands — and once
    // for the run's end. Nothing for the other chunks.
    expect(words).toEqual([true, false, true, false, false]);
    expect(renders.header).toBe(5);
    // The open card: each landed step (a new turn) and the run's end.
    expect(renders.card).toBe(3);
  });
});
