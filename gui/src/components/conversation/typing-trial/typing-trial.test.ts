/*
 * TEMPORARY — 票 55 临时切换器，定档后由拆除票删掉 (see typing-trial.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AssistantCardLine,
  type AssistantLastMessage,
  type AssistantState,
  type AssistantStateInput,
  assistantCardLine,
  assistantState,
} from "@/lib/assistant";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { copyForLanguage } from "@/lib/i18n";
import { buildRunGroups } from "@/lib/run-groups";
import { endsInSilentReport, SUBTASK_REPORT_SUPERVISOR } from "@/lib/subtasks";
import { EMPTY_MESSAGES, useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type { AgentTurn, Turn, UserTurn } from "@/types/conversation";

import {
  assistantSettledSentence,
  assistantStateReadings,
  cardReadsLiveRound,
  liveLineDrawn,
  selectSettledSentence,
  typingBubbleShown,
  type TypingCardSignals,
  type TypingTier,
  typingTrialCardLine,
  useTypingTrialStore,
} from "./typing-trial";
import {
  playTypingDemo,
  startTypingDemo,
  stopTypingDemo,
} from "./typing-trial-demo";

const zh = copyForLanguage("zh-CN");
const MAIN = "s-main";

const greeting: AgentTurn = {
  role: "agent",
  turnIndex: -1,
  finalAnswer: "你好。以后有什么事，直接在这里跟我说就行。",
  tools: [],
  greeting: true,
  messageId: "a-greeting",
};
const earlierAsk: UserTurn = {
  role: "user",
  content: "今天厦门天气怎么样？",
  messageId: "u-weather",
  createdAt: "2026-10-19T01:00:00.000Z",
};
const earlierReply: AgentTurn = {
  role: "agent",
  turnIndex: 1,
  finalAnswer: "多云转阵雨，22 到 27 度，出门带把伞。",
  tools: [],
  messageId: "a-weather",
  settledAt: "2026-10-19T01:00:05.000Z",
};
const HISTORY: Turn[] = [greeting, earlierAsk, earlierReply];

function slice() {
  return useMessagesStore.getState().byId[MAIN];
}

/** MainView's own condition for the line (and, at tier 2, the dots):
 * running, the round not settled (its answer, or a silent report), not
 * asking you. */
function lineShownNow(): boolean {
  const m = slice();
  const groups = buildRunGroups(m.turns);
  const last = groups[groups.length - 1];
  const settled = (last?.complete ?? false) || endsInSilentReport(m.turns);
  return m.agentRunning && !settled && m.pendingAskUser === null;
}

function dotsNow(): boolean {
  const m = slice();
  return typingBubbleShown(lineShownNow(), m.turns, m.inFlightContent);
}

/** The header's state as useAssistantState builds it at `tier`. */
function headerNow(tier: TypingTier): AssistantState {
  const m = slice();
  const running = m.agentRunning;
  const reads = assistantStateReadings(tier, {
    running,
    open: true,
    header: true,
  });
  const settled = reads.settled
    ? selectSettledSentence(useMessagesStore.getState(), MAIN, true)
    : null;
  return assistantState(
    {
      status: running ? "running" : "idle",
      hasPendingAskUser: m.pendingAskUser !== null,
      open: true,
      sentence: tier === 2 ? settled : null,
      writing: false,
      errorCount: 0,
    },
    zh,
  );
}

beforeEach(() => {
  resetStores();
  useTypingTrialStore.setState({ tier: 1, demo: null });
  useSessionsStore.setState({
    sessions: [
      makeSession({
        id: MAIN,
        title: "主对话",
        mainChat: true,
        gaRuntimeKind: "managed",
        turnCount: 3,
        summary: "多云转阵雨",
        lastActivityAt: "2026-10-19T01:00:05.000Z",
        updatedAt: "2026-10-19T01:00:05.000Z",
        hasUnread: false,
      }),
    ],
    activeSessionId: MAIN,
  });
  useMessagesStore.setState({
    byId: { [MAIN]: { ...EMPTY_MESSAGES, turns: HISTORY } },
  });
});

afterEach(() => {
  stopTypingDemo();
  vi.useRealTimers();
});

describe("tier 2: the typing bubble", () => {
  it("shows from the send on in a round you start, before any event, until the reply lands", () => {
    const play = playTypingDemo({
      sessionId: MAIN,
      demo: 1,
      language: "zh-CN",
      manual: true,
    });
    const seen: [string, boolean][] = [];
    play.script.beats.forEach((beat, index) => {
      play.runThrough(index);
      seen.push([beat.label, dotsNow()]);
    });
    // The send itself: the page marks the run started, nothing else yet.
    expect(seen[0]).toEqual(["you send", true]);
    const landed = seen.findIndex(([label]) => label === "reply settles");
    expect(seen.slice(0, landed).every(([, shown]) => shown)).toBe(true);
    expect(seen.slice(landed).every(([, shown]) => !shown)).toBe(true);
    play.stop();
  });

  it("shows in a woken round only while it writes words", () => {
    const play = playTypingDemo({
      sessionId: MAIN,
      demo: 2,
      language: "zh-CN",
      manual: true,
    });
    const shownAt: string[] = [];
    play.script.beats.forEach((beat, index) => {
      play.runThrough(index);
      // The round is live throughout until its reply lands…
      if (beat.label !== "reply settles" && beat.label !== "run complete") {
        expect(lineShownNow()).toBe(true);
      }
      if (dotsNow()) shownAt.push(beat.label);
    });
    // …but the dots only come with its words.
    expect(shownAt).toEqual(["chunk 1", "chunk 2", "chunk 3"]);
    play.stop();
  });

  it("goes when a tool dispatch follows the words, and comes back with the next words", () => {
    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: MAIN,
      message: {
        id: "report-1",
        role: "user",
        content: "子任务汇报",
        turnIndex: 4,
        origin: { via: "system", supervisor: SUBTASK_REPORT_SUPERVISOR },
      },
      dispatch: "dispatched",
    });
    const progress = (delta: string) =>
      dispatchIPCEvent({
        kind: "turn_progress",
        sessionId: MAIN,
        delta,
        source: "test",
        timestamp: "2026-10-19T02:00:00.000Z",
      });
    expect(dotsNow()).toBe(false);
    progress("我先看一下子任务交回来的结果。");
    expect(dotsNow()).toBe(true);
    progress("\n🛠️ Tool: `code_run`  📥 args:\n````text\n{}\n````\n");
    expect(dotsNow()).toBe(false);
    dispatchIPCEvent({
      kind: "turn_end",
      sessionId: MAIN,
      turnIndex: 1,
      summary: "看了结果",
      toolCalls: [{ toolName: "code_run", args: {} }],
      toolResults: [{ content: "ok" }],
      responseContent: "我先看一下子任务交回来的结果。",
      exitReason: null,
      absoluteTurnIndex: 5,
      timestamp: "2026-10-19T02:00:01.000Z",
    });
    expect(dotsNow()).toBe(false);
    progress("好了，");
    expect(dotsNow()).toBe(true);
  });

  it("never shows in a silent round", () => {
    const play = playTypingDemo({
      sessionId: MAIN,
      demo: 3,
      language: "zh-CN",
      manual: true,
    });
    play.script.beats.forEach((_, index) => {
      play.runThrough(index);
      expect(dotsNow()).toBe(false);
    });
    play.stop();
  });

  it("does not show while it asks you", () => {
    dispatchIPCEvent({
      kind: "turn_start",
      sessionId: MAIN,
      turnIndex: 1,
      timestamp: "2026-10-19T02:00:00.000Z",
    });
    useMessagesStore.getState().appendUserTurn(MAIN, "帮我订船票", "c-1");
    expect(dotsNow()).toBe(true);
    useMessagesStore.getState().setPendingAskUser(MAIN, {
      question: "订哪一班？",
      candidates: ["8:30", "10:15"],
    });
    expect(lineShownNow()).toBe(false);
    expect(dotsNow()).toBe(false);
  });

  it("is not drawn at tier 1, where the line is", () => {
    expect(liveLineDrawn(1, true)).toBe(true);
    expect(liveLineDrawn(1, false)).toBe(false);
    expect(liveLineDrawn(2, true)).toBe(false);
    expect(liveLineDrawn(2, false)).toBe(false);
  });
});

describe("tier 2: the header's sentence", () => {
  it("is the newest settled step's sentence, never what streams, no clock; 「思考中」 before one", () => {
    const play = playTypingDemo({
      sessionId: MAIN,
      demo: 1,
      language: "zh-CN",
      manual: true,
    });
    const lines: string[] = [];
    play.script.beats.forEach((_, index) => {
      play.runThrough(index);
      const text = headerNow(2).line?.text ?? "";
      if (lines[lines.length - 1] !== text) lines.push(text);
    });
    expect(lines).toEqual([
      "思考中",
      "本机时间为10月19日10:34；先检查是否已有喝水提醒，避免重复。",
      "已建好明天 9:00 的提醒。",
      // run_complete: only the name.
      "",
    ]);
    play.stop();
  });

  it("takes the narration first, else the summary, from the last message on", () => {
    const step = (finalAnswer: string | null, summary: string): AgentTurn => ({
      role: "agent",
      turnIndex: 1,
      finalAnswer,
      summary,
      tools: [
        {
          id: `t-${summary}`,
          name: "web_scan",
          status: "success-historical",
          args: {},
        },
      ],
    });
    const you: UserTurn = { role: "user", content: "查船票", messageId: "u-1" };
    expect(assistantSettledSentence([...HISTORY, you])).toBeNull();
    expect(
      assistantSettledSentence([
        ...HISTORY,
        you,
        step("我先查船班。", "查船班"),
      ]),
    ).toBe("我先查船班。");
    expect(
      assistantSettledSentence([
        ...HISTORY,
        you,
        step("我先查船班。", "查船班"),
        step(null, "已查到两班"),
      ]),
    ).toBe("已查到两班");
    // The answer that closes the round is no step's sentence.
    expect(
      assistantSettledSentence([
        ...HISTORY,
        you,
        step(null, "已查到两班"),
        { ...earlierReply, finalAnswer: "周六有两班。", messageId: "a-2" },
      ]),
    ).toBe("已查到两班");
  });

  it("re-reads only when a step lands: a chunk returns the same string", () => {
    const play = playTypingDemo({
      sessionId: MAIN,
      demo: 1,
      language: "zh-CN",
      manual: true,
    });
    let changes = 0;
    let last = selectSettledSentence(useMessagesStore.getState(), MAIN, true);
    const unsubscribe = useMessagesStore.subscribe((state) => {
      const next = selectSettledSentence(state, MAIN, true);
      if (next !== last) changes += 1;
      last = next;
    });
    play.script.beats.forEach((_, index) => play.runThrough(index));
    unsubscribe();
    // Step 1 lands, step 2 lands; the reply and every chunk change nothing.
    expect(changes).toBe(2);
    play.stop();
  });
});

describe("tier 2: the card", () => {
  const running: AssistantState = {
    kind: "running",
    line: { text: "思考中", tone: "running" },
    fromSubtask: false,
  };
  const lastMessage: AssistantLastMessage = {
    fromUser: false,
    text: "多云转阵雨，22 到 27 度，出门带把伞。",
  };
  const you: TypingCardSignals = { reportRound: false, writing: false };

  it("says 「正在输入…」 while it runs, the main chat open or not", () => {
    for (const open of [true, false]) {
      expect(
        typingTrialCardLine(2, running, { lastMessage, open }, you, zh),
      ).toEqual({ kind: "running", text: "正在输入…" });
    }
  });

  it("follows the dots in a woken round: 「正在输入…」 while it writes, else the last message", () => {
    for (const open of [true, false]) {
      expect(
        typingTrialCardLine(
          2,
          running,
          { lastMessage, open },
          { reportRound: true, writing: true },
          zh,
        ),
      ).toEqual({ kind: "running", text: "正在输入…" });
      expect(
        typingTrialCardLine(
          2,
          running,
          { lastMessage, open },
          { reportRound: true, writing: false },
          zh,
        ),
      ).toEqual({ kind: "message", prefix: null, text: lastMessage.text });
    }
    // The last message skips the live round's steps, open or not.
    expect(cardReadsLiveRound(2, false)).toBe(true);
    expect(cardReadsLiveRound(2, true)).toBe(true);
  });

  it("keeps today's rules when it is not running", () => {
    const states: AssistantState[] = [
      { kind: "idle", line: null, fromSubtask: false },
      { kind: "unread", line: null, fromSubtask: false },
      {
        kind: "ask",
        line: { text: "等你回复", tone: "warning" },
        fromSubtask: false,
      },
      {
        kind: "error",
        line: { text: "出错", tone: "error" },
        fromSubtask: false,
      },
    ];
    for (const state of states) {
      for (const open of [true, false]) {
        const context = {
          question: "订哪一班？",
          draft: { text: "草稿里的字", imageCount: 0 },
          lastMessage,
          open,
        };
        expect(typingTrialCardLine(2, state, context, you, zh)).toEqual(
          assistantCardLine(state, context, zh),
        );
      }
    }
  });
});

describe("tier 1 is main", () => {
  it("draws the card line with assistantCardLine itself", () => {
    const base: AssistantStateInput = {
      status: "idle",
      hasPendingAskUser: false,
      open: false,
    };
    const inputs: Partial<AssistantStateInput>[] = [
      {},
      { status: "running" },
      { status: "running", sentence: "我先查船班。" },
      { status: "running", writing: true },
      { hasPendingAskUser: true },
      { status: "error", errorCount: 2 },
      { subtaskState: "ask" },
      { subtaskState: "error" },
      { hasUnread: true },
    ];
    const lastMessages: (AssistantLastMessage | null)[] = [
      null,
      { fromUser: true, text: "帮我订船票" },
      { fromUser: false, text: "订好了。" },
    ];
    for (const input of inputs) {
      for (const open of [true, false]) {
        const state = assistantState({ ...base, ...input, open }, zh);
        for (const lastMessage of lastMessages) {
          for (const signals of [
            { reportRound: false, writing: false },
            { reportRound: true, writing: true },
            { reportRound: true, writing: false },
          ]) {
            const context = {
              question: "订哪一班？",
              draft: { text: "草稿", imageCount: 0 },
              lastMessage,
              open,
            };
            const line: AssistantCardLine | null = typingTrialCardLine(
              1,
              state,
              context,
              signals,
              zh,
            );
            expect(line).toEqual(assistantCardLine(state, context, zh));
          }
        }
      }
    }
  });

  it("reads the stream as main does, and no settled sentence", () => {
    for (const running of [true, false]) {
      for (const open of [true, false]) {
        for (const header of [true, false]) {
          expect(assistantStateReadings(1, { running, open, header })).toEqual({
            sentence: running && !open,
            writing: running && header,
            settled: false,
          });
          expect(cardReadsLiveRound(1, open)).toBe(open);
        }
      }
    }
  });

  it("keeps the header as main: the line's words are not its", () => {
    const play = playTypingDemo({
      sessionId: MAIN,
      demo: 1,
      language: "zh-CN",
      manual: true,
    });
    play.runThrough(play.script.beats.length - 3);
    // Tier 1 never asks for the settled sentence.
    expect(headerNow(1).line?.text).toBe("思考中");
    play.stop();
  });
});

describe("the demos", () => {
  it("put the conversation and the session row back as they were", () => {
    const before = slice();
    const sessionBefore = useSessionsStore.getState().sessions[0];
    for (const demo of [1, 2, 3] as const) {
      const play = playTypingDemo({
        sessionId: MAIN,
        demo,
        language: "zh-CN",
        manual: true,
      });
      play.runThrough(play.script.beats.length - 1);
      expect(slice()).not.toBe(before);
      play.stop();
      expect(slice()).toBe(before);
      expect(useSessionsStore.getState().sessions[0]).toEqual(sessionBefore);
    }
    // No Core write on the way: the reads and writes all stayed in the page.
    expect(getTauriMocks().invoke).not.toHaveBeenCalled();
  });

  it("draw what a real round draws: your message, the report row hidden, the reply", () => {
    const play = playTypingDemo({
      sessionId: MAIN,
      demo: 2,
      language: "en-US",
      manual: true,
    });
    play.runThrough(play.script.beats.length - 1);
    const turns = slice().turns.slice(HISTORY.length);
    expect(turns[0]).toMatchObject({
      role: "user",
      origin: { via: "system", supervisor: SUBTASK_REPORT_SUPERVISOR },
    });
    const reply = turns[turns.length - 1] as AgentTurn;
    expect(reply.finalAnswer).toBe("Time for some water 💧");
    expect(slice().agentRunning).toBe(false);
    play.stop();
  });

  it("read the conversation again from Core when a real event came in meanwhile", () => {
    const play = playTypingDemo({
      sessionId: MAIN,
      demo: 3,
      language: "zh-CN",
      manual: true,
    });
    play.runThrough(2);
    // A real event lands in the same slice.
    useMessagesStore.getState().setNextSuggestion(MAIN, "看看提醒");
    getTauriMocks().invoke.mockResolvedValue({ rows: [], hasMore: false });
    play.stop();
    expect(getTauriMocks().invoke).toHaveBeenCalledWith(
      "session_message_turns_page",
      expect.anything(),
    );
  });

  it("end when the main chat stops being the active session", () => {
    const play = playTypingDemo({
      sessionId: MAIN,
      demo: 1,
      language: "zh-CN",
      manual: true,
    });
    const before = useMessagesStore.getState().byId[MAIN];
    play.runThrough(0);
    useSessionsStore.setState({ activeSessionId: "s-other" });
    play.runThrough(5);
    expect(slice()).toBe(before);
  });

  it("play on timers from the pill, and a second click ends it", () => {
    vi.useFakeTimers();
    startTypingDemo(MAIN, 2, "zh-CN");
    expect(useTypingTrialStore.getState().demo).toBe(2);
    vi.advanceTimersByTime(5300);
    expect(dotsNow()).toBe(true);
    vi.advanceTimersByTime(5000);
    // Played out: the conversation is back, the pill is free.
    expect(useTypingTrialStore.getState().demo).toBeNull();
    expect(slice().turns).toBe(HISTORY);
    startTypingDemo(MAIN, 1, "zh-CN");
    vi.advanceTimersByTime(2000);
    stopTypingDemo();
    expect(useTypingTrialStore.getState().demo).toBeNull();
    expect(slice().turns).toBe(HISTORY);
  });
});
