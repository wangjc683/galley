import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  selectAssistantSettledSentence,
  selectAssistantTyping,
} from "@/hooks/useAssistantSentence";
import { assistantState } from "@/lib/assistant";
import {
  assistantSettledSentence,
  typingBubbleShown,
} from "@/lib/assistant-conversation";
import { copyForLanguage } from "@/lib/i18n";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { buildRunGroups } from "@/lib/run-groups";
import { endsInSilentReport, SUBTASK_REPORT_SUPERVISOR } from "@/lib/subtasks";
import { useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";

// Counts the passes over the stream: the regex cleaning is the cost the
// card and the conversation must not pay per store write.
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

const zh = copyForLanguage("zh-CN");
const MAIN = "s-main";
const DISPATCH =
  '🛠️ Tool: `code_run`  📥 args:\n````text\n{"script": "x"}\n````\n';

beforeEach(() => {
  resetStores();
  cleaning.calls = 0;
});

// ---- A round, event by event, as the runner's events reach the page ----

/** One event of a round, named for the expectations. */
type Beat = [label: string, run: () => void];

let tick = 0;
const stamp = () =>
  `2026-10-19T02:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}:${String(tick++ % 60).padStart(2, "0")}.000Z`;

const progress = (delta: string) =>
  dispatchIPCEvent({
    kind: "turn_progress",
    sessionId: MAIN,
    delta,
    source: "test",
    timestamp: stamp(),
  });

/** Your message: the composer's echo (the page marks the run started),
 * then Core's persisted row. */
function sendBeats(text: string): Beat[] {
  const clientRequestId = `c-${text}`;
  return [
    [
      "you send",
      () =>
        useMessagesStore.getState().appendUserTurn(MAIN, text, clientRequestId),
    ],
    [
      "persisted",
      () =>
        useMessagesStore.getState().applyUserMessagePersisted({
          sessionId: MAIN,
          message: {
            id: `u-${text}`,
            sessionId: MAIN,
            role: "user",
            content: text,
            createdAt: stamp(),
            turnIndex: 40,
          },
          dispatch: "dispatched",
          clientRequestId,
        }),
    ],
  ];
}

/** Core's report row waking the main chat (main chat ticket 31). */
const wakeBeat: Beat = [
  "report row",
  () =>
    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: MAIN,
      message: {
        id: "report-1",
        sessionId: MAIN,
        role: "user",
        content: "子任务汇报",
        createdAt: stamp(),
        turnIndex: 40,
        origin: { via: "system", supervisor: SUBTASK_REPORT_SUPERVISOR },
      },
      dispatch: "dispatched",
    }),
];

/** A tool step as GA's verbose display streams it: the turn's header,
 * an optional narration, its summary, the dispatch and the tool's output
 * (all of it but the narration cleaned away on the page), then it
 * lands. */
function toolStepBeats(
  turnIndex: number,
  summary: string,
  narration = "",
): Beat[] {
  const beats: Beat[] = [
    [
      `step ${turnIndex} starts`,
      () =>
        dispatchIPCEvent({
          kind: "turn_start",
          sessionId: MAIN,
          turnIndex,
          timestamp: stamp(),
        }),
    ],
    [
      `step ${turnIndex} header`,
      () => progress(`**LLM Running (Turn ${turnIndex}) ...**\n\n`),
    ],
  ];
  if (narration) {
    beats.push([`step ${turnIndex} narration`, () => progress(narration)]);
  }
  beats.push(
    [
      `step ${turnIndex} summary`,
      () => progress(`\n<summary>${summary}</summary>\n`),
    ],
    [`step ${turnIndex} dispatch`, () => progress(DISPATCH)],
    [`step ${turnIndex} output`, () => progress("`````\nok\n`````\n")],
    [
      `step ${turnIndex} settles`,
      () =>
        dispatchIPCEvent({
          kind: "turn_end",
          sessionId: MAIN,
          turnIndex,
          summary,
          toolCalls: [{ toolName: "code_run", args: { script: "x" } }],
          toolResults: [{ content: "ok" }],
          responseContent: `${narration}<summary>${summary}</summary>`,
          exitReason: null,
          absoluteTurnIndex: 100 + turnIndex,
          timestamp: stamp(),
        }),
    ],
  );
  return beats;
}

/** The closing step: its words stream in `pieces`, then it lands, then
 * the run completes. */
function replyBeats(turnIndex: number, pieces: string[]): Beat[] {
  const content = pieces.join("");
  return [
    [
      `step ${turnIndex} starts`,
      () =>
        dispatchIPCEvent({
          kind: "turn_start",
          sessionId: MAIN,
          turnIndex,
          timestamp: stamp(),
        }),
    ],
    [
      `step ${turnIndex} header`,
      () => progress(`**LLM Running (Turn ${turnIndex}) ...**\n\n`),
    ],
    ...pieces.map(
      (piece, i): Beat => [`chunk ${i + 1}`, () => progress(piece)],
    ),
    [
      "reply settles",
      () =>
        dispatchIPCEvent({
          kind: "turn_end",
          sessionId: MAIN,
          turnIndex,
          summary: "直接回答了用户问题",
          toolCalls: [],
          toolResults: [],
          responseContent: content,
          exitReason: { result: "CURRENT_TASK_DONE", data: null },
          absoluteTurnIndex: 100 + turnIndex,
          timestamp: stamp(),
        }),
    ],
    [
      "run complete",
      () =>
        dispatchIPCEvent({
          kind: "run_complete",
          sessionId: MAIN,
          exitReason: { result: "CURRENT_TASK_DONE", data: null },
          finalContent: content,
          totalTurns: turnIndex,
          timestamp: stamp(),
        }),
    ],
  ];
}

const STEP_ONE = "本机时间为10月19日10:34；先检查是否已有喝水提醒，避免重复。";
const STEP_TWO = "已建好明天 9:00 的提醒。";

/** A round you start: two tool steps that write only their summaries
 * (the main model's habit), then the reply. */
const youStart = (): Beat[] => [
  ...sendBeats("明天早上 9 点提醒我喝水"),
  ...toolStepBeats(1, STEP_ONE),
  ...toolStepBeats(2, STEP_TWO),
  ...replyBeats(3, ["好的，", "明天早上 ", "9 点", "提醒你", "喝水。"]),
];

/** A round Core woke it for: one tool step, then the reply. */
const woken = (): Beat[] => [
  wakeBeat,
  ...toolStepBeats(1, "读到子任务的汇报：喝水提醒到点了。"),
  ...replyBeats(2, ["该喝水啦，", "记得喝", "点水 💧"]),
];

/** The same, saying nothing. */
const silent = (): Beat[] => [
  wakeBeat,
  ...toolStepBeats(1, "子任务交回的结果缺了确认号，打回去重查。"),
  ...replyBeats(2, ["<no-", "reply/>"]),
];

function slice() {
  return useMessagesStore.getState().byId[MAIN];
}

/** MainView's own condition for the live round: running, the main chat,
 * the round not settled (its answer, or a silent report), not asking. */
function liveNow(): boolean {
  const m = slice();
  const groups = buildRunGroups(m.turns);
  const last = groups[groups.length - 1];
  const settled = (last?.complete ?? false) || endsInSilentReport(m.turns);
  return m.agentRunning && !settled && m.pendingAskUser === null;
}

/** The conversation ends in the typing bubble (MainView). */
function dotsNow(): boolean {
  const m = slice();
  return typingBubbleShown(liveNow(), m.turns, m.inFlightContent);
}

/** The header's second line (AssistantIdentity: useAssistantState with
 * `header`). */
function headerNow(): string {
  const m = slice();
  const running = m.agentRunning;
  return (
    assistantState(
      {
        status: running ? "running" : "idle",
        hasPendingAskUser: m.pendingAskUser !== null,
        open: true,
        sentence: selectAssistantSettledSentence(
          useMessagesStore.getState(),
          MAIN,
          running,
        ),
      },
      zh,
    ).line?.text ?? ""
  );
}

/** Runs `beats`, reading `read` after each one. */
function play<T>(beats: Beat[], read: () => T): [string, T][] {
  return beats.map(([label, run]) => {
    run();
    return [label, read()];
  });
}

// ---- The typing bubble ---------------------------------------------------

describe("the typing bubble, and the card's 「正在输入…」 with it", () => {
  it("shows from the send on in a round you start, before any event, until the reply lands", () => {
    const seen = play(youStart(), dotsNow);
    // The send itself: the page marks the run started, nothing else yet.
    expect(seen[0]).toEqual(["you send", true]);
    const landed = seen.findIndex(([label]) => label === "reply settles");
    expect(seen.slice(0, landed).every(([, shown]) => shown)).toBe(true);
    expect(seen.slice(landed).every(([, shown]) => !shown)).toBe(true);
  });

  it("shows in a woken round only while it writes words", () => {
    const seen = play(woken(), () => [liveNow(), dotsNow()] as const);
    // The round is live throughout until its reply lands…
    for (const [label, [live]] of seen) {
      if (label !== "reply settles" && label !== "run complete") {
        expect([label, live]).toEqual([label, true]);
      }
    }
    // …but the dots only come with its words.
    expect(seen.filter(([, [, dots]]) => dots).map(([label]) => label)).toEqual(
      ["chunk 1", "chunk 2", "chunk 3"],
    );
  });

  it("goes when a tool dispatch follows the words, and comes back with the next words", () => {
    wakeBeat[1]();
    expect(dotsNow()).toBe(false);
    progress("我先看一下子任务交回来的结果。");
    expect(dotsNow()).toBe(true);
    progress(`\n${DISPATCH}`);
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
      absoluteTurnIndex: 101,
      timestamp: stamp(),
    });
    expect(dotsNow()).toBe(false);
    progress("好了，");
    expect(dotsNow()).toBe(true);
  });

  it("never shows in a silent round", () => {
    for (const [label, dots] of play(silent(), dotsNow)) {
      expect([label, dots]).toEqual([label, false]);
    }
  });

  it("does not show while it asks you", () => {
    sendBeats("帮我订船票").forEach(([, run]) => run());
    expect(dotsNow()).toBe(true);
    useMessagesStore.getState().setPendingAskUser(MAIN, {
      question: "订哪一班？",
      candidates: ["8:30", "10:15"],
    });
    expect(liveNow()).toBe(false);
    expect(dotsNow()).toBe(false);
  });

  it("says the card types as the dots do: throughout a round you start, with the words in a woken one", () => {
    const card = () =>
      selectAssistantTyping(
        useMessagesStore.getState(),
        MAIN,
        slice()?.agentRunning ?? false,
      );
    const you = play(youStart(), card);
    const end = you.findIndex(([label]) => label === "run complete");
    expect(you.slice(0, end).every(([, typing]) => typing)).toBe(true);
    expect(you[end][1]).toBe(false);
    resetStores();
    const wake = play(woken(), card);
    // Once the answer lands the card says it, the face at work until
    // run_complete.
    expect(wake.filter(([, typing]) => typing).map(([label]) => label)).toEqual(
      ["chunk 1", "chunk 2", "chunk 3"],
    );
  });

  it("is false at rest without looking at the stream, and cleans it once per chunk for every reader", () => {
    const state = () => useMessagesStore.getState();
    // A round you start types throughout: the stream is not read.
    sendBeats("看看周六的船票").forEach(([, run]) => run());
    progress("周六上午还有三班船。\n");
    cleaning.calls = 0;
    expect(selectAssistantTyping(state(), MAIN, true)).toBe(true);
    expect(selectAssistantTyping(state(), MAIN, false)).toBe(false);
    expect(cleaning.calls).toBe(0);

    // A woken round reads it: the card and the conversation's dots on
    // the same chunk, one pass.
    resetStores();
    wakeBeat[1]();
    progress("我先看一下结果。");
    cleaning.calls = 0;
    expect(selectAssistantTyping(state(), MAIN, false)).toBe(false);
    expect(cleaning.calls).toBe(0);
    expect(selectAssistantTyping(state(), MAIN, true)).toBe(true);
    expect(dotsNow()).toBe(true);
    expect(selectAssistantTyping(state(), MAIN, true)).toBe(true);
    expect(cleaning.calls).toBe(1);

    // Another session's write leaves the stream as it was: no pass.
    useMessagesStore.getState().appendInFlightDelta("s-other", "别的会话");
    expect(selectAssistantTyping(state(), MAIN, true)).toBe(true);
    expect(cleaning.calls).toBe(1);

    // A dispatch, an open thinking: known without cleaning.
    progress(`\n${DISPATCH}`);
    expect(selectAssistantTyping(state(), MAIN, true)).toBe(false);
    useMessagesStore.getState().clearInFlightContent(MAIN);
    progress("<thinking>再看看返程");
    expect(selectAssistantTyping(state(), MAIN, true)).toBe(false);
    expect(cleaning.calls).toBe(1);
  });
});

// ---- The header's sentence -------------------------------------------------

describe("the header's sentence: the newest settled step's", () => {
  it("is the newest settled step's sentence, never what streams, no clock; 「思考中」 before one", () => {
    const lines: string[] = [];
    for (const [, text] of play(youStart(), headerNow)) {
      if (lines[lines.length - 1] !== text) lines.push(text);
    }
    expect(lines).toEqual([
      "思考中",
      STEP_ONE,
      STEP_TWO,
      // run_complete: only the name.
      "",
    ]);
  });

  it("takes the narration first, else the summary", () => {
    const beats: Beat[] = [
      ...sendBeats("查船票"),
      ...toolStepBeats(1, "查船班", "我先查船班。"),
    ];
    play(beats, () => null);
    expect(headerNow()).toBe("我先查船班。");
    play(toolStepBeats(2, "已查到两班"), () => null);
    // Step 2 wrote only its summary: the header moves on to it, not
    // holding step 1's narration (ruling 100).
    expect(headerNow()).toBe("已查到两班");
    expect(
      selectAssistantSettledSentence(useMessagesStore.getState(), MAIN, true),
    ).toBe(assistantSettledSentence(slice().turns));
  });

  it("is null at rest without looking at the turns", () => {
    play(youStart().slice(0, 9), () => null);
    expect(
      selectAssistantSettledSentence(useMessagesStore.getState(), MAIN, false),
    ).toBeNull();
    expect(
      selectAssistantSettledSentence(useMessagesStore.getState(), MAIN, true),
    ).toBe(STEP_ONE);
  });

  it("re-reads only when a step lands: a chunk returns the same string", () => {
    let changes = 0;
    let last = selectAssistantSettledSentence(
      useMessagesStore.getState(),
      MAIN,
      true,
    );
    const unsubscribe = useMessagesStore.subscribe((state) => {
      const next = selectAssistantSettledSentence(state, MAIN, true);
      if (next !== last) changes += 1;
      last = next;
    });
    play(youStart(), () => null);
    unsubscribe();
    // Step 1 lands, step 2 lands; the reply and every chunk change nothing.
    expect(changes).toBe(2);
  });

  it("reads the main chat's cache while another session is on screen", () => {
    useSessionsStore.setState({
      sessions: [
        makeSession({ id: MAIN, mainChat: true, gaRuntimeKind: "managed" }),
        makeSession({ id: "s-other", gaRuntimeKind: "managed" }),
      ],
      activeSessionId: "s-other",
    });
    useMessagesStore.getState().ensureMessages("s-other");
    const sentence = () =>
      selectAssistantSettledSentence(useMessagesStore.getState(), MAIN, true);
    play(sendBeats("看看周六的船票"), () => null);
    expect(sentence()).toBeNull();
    play(toolStepBeats(1, "已查到周六的船班；接下来核对余票。"), () => null);
    expect(sentence()).toBe("已查到周六的船班；接下来核对余票。");
    // Nothing went to the session on screen.
    expect(useMessagesStore.getState().byId["s-other"].inFlightContent).toBe(
      "",
    );
    expect(useSessionsStore.getState().activeSessionId).toBe("s-other");
  });
});

// ---- Re-renders ----------------------------------------------------------

describe("re-renders", () => {
  it("re-renders the header and the card on no chunk but the one that starts a woken round's words", () => {
    useSessionsStore.setState({
      sessions: [
        makeSession({ id: MAIN, mainChat: true, gaRuntimeKind: "managed" }),
      ],
      activeSessionId: MAIN,
    });

    // What each subscribes to, as useSyncExternalStore compares it: a
    // re-render when any selected value changes (Object.is; the status
    // view's useShallow projection as one key).
    type State = ReturnType<typeof useMessagesStore.getState>;
    const status = (s: State) => {
      const m = s.byId[MAIN];
      return `${m?.agentRunning}|${m?.pendingAskUser != null}|${m?.pausedAtStepLimit}`;
    };
    const running = (s: State) => s.byId[MAIN]?.agentRunning ?? false;
    const readers = {
      // AssistantIdentity: useAssistantState({ open: true, header: true }).
      header: (s: State) => [
        status(s),
        selectAssistantSettledSentence(s, MAIN, running(s)),
      ],
      // SidebarAssistantCard: its state (no sentence), whether it types,
      // the question, the turns its last message comes from.
      card: (s: State) => [
        status(s),
        selectAssistantTyping(s, MAIN, running(s)),
        s.byId[MAIN]?.pendingAskUser?.question ?? null,
        s.byId[MAIN]?.turns,
        s.byId[MAIN]?.restoring ?? false,
      ],
    };
    /** The beats during which each re-renders (once per re-render). */
    const renders = (beats: Beat[]) => {
      const seen = { header: [] as string[], card: [] as string[] };
      let beat = "";
      let last = {
        header: readers.header(useMessagesStore.getState()),
        card: readers.card(useMessagesStore.getState()),
      };
      const unsubscribe = useMessagesStore.subscribe((s) => {
        for (const key of ["header", "card"] as const) {
          const next = readers[key](s);
          if (next.some((v, i) => !Object.is(v, last[key][i]))) {
            seen[key].push(beat);
            last = { ...last, [key]: next };
          }
        }
      });
      for (const [label, run] of beats) {
        beat = label;
        run();
      }
      unsubscribe();
      return seen;
    };

    // A round you start: 23 events, 14 of them chunks.
    const you = youStart();
    expect(you).toHaveLength(23);
    expect(
      you.filter(([label]) =>
        /chunk|header|summary|dispatch|output/.test(label),
      ),
    ).toHaveLength(14);
    // No chunk re-renders either: the header when its run starts, each
    // step lands and the run ends; the card on each write to the turns
    // and when the run starts and ends.
    expect(renders(you)).toEqual({
      header: ["you send", "step 1 settles", "step 2 settles", "run complete"],
      card: [
        "you send",
        "persisted",
        "step 1 settles",
        "step 2 settles",
        "reply settles",
        "run complete",
      ],
    });

    // A woken round: the card also when the dots come with its first
    // words (they go as the answer lands, a write to the turns anyway);
    // no other chunk.
    resetStores();
    expect(renders(woken())).toEqual({
      header: ["report row", "step 1 settles", "run complete"],
      card: [
        "report row",
        "step 1 settles",
        "chunk 1",
        "reply settles",
        "run complete",
      ],
    });
  });
});
