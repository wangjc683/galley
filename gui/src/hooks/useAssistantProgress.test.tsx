// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  selectAssistantRound,
  useAssistantRunMinutes,
} from "@/hooks/useAssistantProgress";
import { typingBubbleShown } from "@/lib/assistant-conversation";
import { assistantDoing } from "@/lib/assistant-progress";
import { copyForLanguage } from "@/lib/i18n";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { buildRunGroups } from "@/lib/run-groups";
import {
  endsInSilentReport,
  SUBTASK_REPORT_SUPERVISOR,
  type SubtaskDispatch,
} from "@/lib/subtasks";
import { EMPTY_MESSAGES, useMessagesStore } from "@/stores/messages";
import { dispatched } from "@/test/second-half";
import { resetStores } from "@/test/store-reset";
import type { AgentTurn, Turn, UserTurn } from "@/types/conversation";

/*
 * The reads off the store while the main chat runs (main chat PRD
 * rulings 134, 135): a round driven event by event as the runner's events
 * reach the page, for the line under the dots and the card; the card's
 * minutes and their timer.
 */

const zh = copyForLanguage("zh-CN");
const MAIN = "s-main";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  resetStores();
});

// ---- A round, event by event ---------------------------------------------------

type Beat = [label: string, run: () => void];

let tick = 0;
const stamp = () =>
  `2026-10-23T02:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}:${String(tick++ % 60).padStart(2, "0")}.000Z`;

const progress = (delta: string) =>
  dispatchIPCEvent({
    kind: "turn_progress",
    sessionId: MAIN,
    delta,
    source: "test",
    timestamp: stamp(),
  });

const DISPATCH =
  '\n\n🛠️ Tool: `web_scan`  📥 args:\n````text\n{"tabs_only": false}\n````\n';

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

/** Core's report row waking the main chat for `reason` (the ids it
 * covers, ruling 197); `woke` keeps when it was written. */
let woke = "";
const wakeFor = (reason: string): Beat => [
  `wake for ${reason}`,
  () => {
    woke = stamp();
    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: MAIN,
      message: {
        id: `report-${reason}`,
        sessionId: MAIN,
        role: "user",
        content: "子任务汇报",
        createdAt: woke,
        turnIndex: 60,
        origin: {
          via: "system",
          supervisor: SUBTASK_REPORT_SUPERVISOR,
          reason,
        },
      },
      dispatch: "dispatched",
    });
  },
];

/** A tool step: its stream in `chunks` (ending in the dispatch), then it
 * lands with the summary GA kept; its row at `base + turnIndex`. */
function toolStepBeats(
  turnIndex: number,
  chunks: string[],
  summary: string,
  base = 100,
): Beat[] {
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
      () => progress(`\n**LLM Running (Turn ${turnIndex}) ...**\n\n`),
    ],
    ...chunks.map(
      (chunk, i): Beat => [
        `step ${turnIndex} chunk ${i + 1}`,
        () => progress(chunk),
      ],
    ),
    [
      `step ${turnIndex} settles`,
      () =>
        dispatchIPCEvent({
          kind: "turn_end",
          sessionId: MAIN,
          turnIndex,
          summary,
          toolCalls: [{ toolName: "web_scan", args: { tabs_only: false } }],
          toolResults: [{ content: "ok" }],
          responseContent: chunks.join(""),
          exitReason: null,
          absoluteTurnIndex: base + turnIndex,
          timestamp: stamp(),
        }),
    ],
  ];
}

function replyBeats(turnIndex: number, pieces: string[], base = 100): Beat[] {
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
    ...pieces.map(
      (piece, i): Beat => [`reply chunk ${i + 1}`, () => progress(piece)],
    ),
    [
      "reply settles",
      () =>
        dispatchIPCEvent({
          kind: "turn_end",
          sessionId: MAIN,
          turnIndex,
          summary: "都查完了；结论是凯尔特人第一",
          toolCalls: [],
          toolResults: [],
          responseContent: content,
          exitReason: { result: "CURRENT_TASK_DONE", data: null },
          absoluteTurnIndex: base + turnIndex,
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

const STEP_ONE = "已拿到东部各队休赛期动向；我查各队伤病与轮换。";
const STEP_TWO = "伤病已查完；我对比各队近三季的胜场";

/** Step 1 with native tool calls (the reasoning tagged in-band, then the
 * model's text, the call itself not streamed); step 2 in GA's text
 * protocol (`<tool_use>` as text); then the reply. */
const youStart = (): Beat[] => [
  ...sendBeats("新赛季 NBA 东部你怎么预测？"),
  ...toolStepBeats(
    1,
    [
      "<thinking>",
      "先看休赛期动向。",
      "</thinking>",
      "<summary>已拿到东部各队",
      "休赛期动向；我查各队伤病与轮换。</summary>",
      DISPATCH,
    ],
    STEP_ONE,
  ),
  ...toolStepBeats(
    2,
    [
      `<summary>${STEP_TWO}</summary>\n`,
      '<tool_use>{"name": "web_scan", ',
      '"arguments": {"tabs_only": false}}</tool_use>',
      DISPATCH,
    ],
    STEP_TWO,
  ),
  ...replyBeats(3, [
    "<summary>都查完了；结论是凯尔特人第一</summary>\n",
    "东部我看好",
    "凯尔特人。",
  ]),
];

const woken = (): Beat[] => [
  wakeBeat,
  ...toolStepBeats(
    1,
    ["<summary>读到汇报；我核对结果</summary>", DISPATCH],
    "读到汇报；我核对结果",
  ),
  ...replyBeats(2, ["子任务查好了，", "东部凯尔特人第一。"]),
];

function slice() {
  return useMessagesStore.getState().byId[MAIN];
}

/** MainView: the line is drawn while the typing bubble is (the main
 * chat's live round, `typingBubbleShown`), saying `assistantDoing`;
 * `dispatches`, the main chat's records (ruling 197). */
function lineNow(dispatches?: readonly SubtaskDispatch[]): string | null {
  const m = slice();
  const groups = buildRunGroups(m.turns);
  const last = groups[groups.length - 1];
  const settled = (last?.complete ?? false) || endsInSilentReport(m.turns);
  const live = m.agentRunning && !settled && m.pendingAskUser === null;
  return typingBubbleShown(live, m.turns, m.inFlightContent, dispatches)
    ? assistantDoing(m.turns, m.inFlightContent, zh, dispatches)
    : null;
}

// Ruling 197 (ticket 146): your round sends a subtask off (its reply the
// row at 201), and the wake that brings it back is that round's second
// half; the morning review's round sends one off (its reply at 301), and
// the wake that brings that back stays woken.
const SECOND_HALF: SubtaskDispatch[] = [dispatched("s-phone-a", 201)];
const REVIEW_SENT: SubtaskDispatch[] = [dispatched("s-ferry", 301)];

const yourRoundComesBack = (): Beat[] => [
  ...sendBeats("比较这两款手机，拆开查"),
  ...replyBeats(1, ["好，我派人分头查。"], 200),
  wakeFor("s-phone-a"),
  ...toolStepBeats(
    1,
    ["<summary>两份都到了；我核对两款的口径</summary>", DISPATCH],
    "两份都到了；我核对两款的口径",
    210,
  ),
  ...replyBeats(2, ["两款对比如下，", "差在续航。"], 210),
];

const reviewComesBack = (): Beat[] => [
  wakeFor("sched_review"),
  ...replyBeats(1, ["<subtask>查周六的船票</subtask>\n<no-reply/>"], 300),
  wakeFor("s-ferry"),
  ...toolStepBeats(
    1,
    ["<summary>船票查到了；我核对班次</summary>", DISPATCH],
    "船票查到了；我核对班次",
    310,
  ),
  ...replyBeats(2, ["周六上午还有票。"], 310),
];

function play<T>(beats: Beat[], read: () => T): [string, T][] {
  return beats.map(([label, run]) => {
    run();
    return [label, read()];
  });
}

/** The values in order, each run of the same one once. */
function changes<T>(seen: [string, T][]): T[] {
  const out: T[] = [];
  for (const [, value] of seen) {
    if (out.length === 0 || out[out.length - 1] !== value) out.push(value);
  }
  return out;
}

describe("the line under the dots, a round driven through the page's events", () => {
  it("changes only at a dispatch, keeps a step's sentence when it lands, and gives the reply nothing away", () => {
    const seen = play(youStart(), lineNow);
    expect(changes(seen)).toEqual([
      "思考中",
      "我查各队伤病与轮换",
      "我对比各队近三季的胜场",
      "正在写回复",
      null,
    ]);
    const at = (label: string) => seen.find(([l]) => l === label)?.[1];
    // Native: the dispatch, not the closed summary, changes it…
    expect(at("step 1 chunk 5")).toBe("思考中");
    expect(at("step 1 chunk 6")).toBe("我查各队伤病与轮换");
    // …and the step landing says the same.
    expect(at("step 1 settles")).toBe("我查各队伤病与轮换");
    expect(at("step 2 chunk 3")).toBe("我查各队伤病与轮换");
    // Text protocol: the same.
    expect(at("step 2 chunk 4")).toBe("我对比各队近三季的胜场");
    expect(at("step 2 settles")).toBe("我对比各队近三季的胜场");
    // The reply's summary is never said.
    expect(seen.some(([, said]) => said?.includes("凯尔特人"))).toBe(false);
    expect(at("reply chunk 1")).toBe("我对比各队近三季的胜场");
    expect(at("reply settles")).toBeNull();
  });

  it("is not drawn in a round Core woke it for", () => {
    expect(changes(play(woken(), lineNow))).toEqual([null]);
  });

  it("is drawn from the wake on in the second half of your round, its time from the wake", () => {
    const seen = play(yourRoundComesBack(), () => lineNow(SECOND_HALF));
    expect(changes(seen)).toEqual([
      "思考中",
      "正在写回复",
      null,
      // The wake: the rest of your round.
      "思考中",
      "我核对两款的口径",
      "正在写回复",
      null,
    ]);
    expect(seen.find(([l]) => l === "wake for s-phone-a")?.[1]).toBe("思考中");
    // The round's own clock starts at the wake.
    resetStores();
    play(yourRoundComesBack().slice(0, -5), () => null);
    expect(slice().currentRunStartedAtMs).toBe(Date.parse(woke));
    // Without the records: woken, as before.
    resetStores();
    const blind = play(yourRoundComesBack(), () => lineNow());
    expect(blind.find(([l]) => l === "wake for s-phone-a")?.[1]).toBeNull();
  });

  it("is not drawn when what comes back is what the morning review sent off", () => {
    const seen = play(reviewComesBack(), () => lineNow(REVIEW_SENT));
    expect(changes(seen)).toEqual([null]);
  });
});

describe("selectAssistantRound: the card's read", () => {
  const read = () =>
    selectAssistantRound(
      useMessagesStore.getState(),
      MAIN,
      slice()?.agentRunning ?? false,
    );

  it("says a round you started, writing or not; nothing at rest", () => {
    expect(read()).toBeNull();
    const seen = play(youStart(), read);
    // The reply lands before run_complete: its stream is cleared, the run
    // goes on a moment longer.
    expect(changes(seen)).toEqual(["own", "own-writing", "own", null]);
    expect(seen.find(([l]) => l === "reply chunk 2")?.[1]).toBe("own-writing");
    expect(seen.find(([l]) => l === "step 1 chunk 6")?.[1]).toBe("own");
  });

  it("says a woken round as one, writing or not", () => {
    expect(changes(play(woken(), read))).toEqual(["woken", null]);
  });

  // Ruling 197: the card says 「正在工作…」 in a second half as in your
  // round; what the review sent off coming back stays woken.
  it("says the second half of your round as yours, the review's comeback as woken", () => {
    const readWith = (dispatches: readonly SubtaskDispatch[]) => () =>
      selectAssistantRound(
        useMessagesStore.getState(),
        MAIN,
        slice()?.agentRunning ?? false,
        dispatches,
      );
    const seen = play(yourRoundComesBack(), readWith(SECOND_HALF));
    expect(changes(seen)).toEqual([
      "own",
      "own-writing",
      "own",
      null,
      "own",
      "own-writing",
      "own",
      null,
    ]);
    expect(seen.find(([l]) => l === "wake for s-phone-a")?.[1]).toBe("own");
    resetStores();
    expect(changes(play(reviewComesBack(), readWith(REVIEW_SENT)))).toEqual([
      "woken",
      null,
      "woken",
      null,
    ]);
  });

  it("reads nothing while it is not running", () => {
    useMessagesStore.setState({
      byId: { [MAIN]: { ...EMPTY_MESSAGES, inFlightContent: "东部" } },
    });
    expect(selectAssistantRound(useMessagesStore.getState(), MAIN, false)).toBe(
      null,
    );
  });
});

// ---- The minutes ------------------------------------------------------------------

describe("useAssistantRunMinutes: the card's minutes", () => {
  const T0 = Date.UTC(2026, 9, 23, 4, 0, 0);
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  const renders = { count: 0, minutes: -1 };

  function Probe({ active }: { active: boolean }) {
    const minutes = useAssistantRunMinutes(MAIN, active);
    renders.count += 1;
    renders.minutes = minutes;
    return null;
  }

  function mount(active: boolean) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<Probe active={active} />));
  }

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  function running(startedAtMs: number, turns: Turn[] = []) {
    useMessagesStore.setState({
      byId: {
        [MAIN]: {
          ...EMPTY_MESSAGES,
          turns,
          agentRunning: true,
          currentRunStartedAtMs: startedAtMs,
        },
      },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    renders.count = 0;
    renders.minutes = -1;
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.useRealTimers();
  });

  it("turns over only at the whole minute, rendering nothing between", () => {
    running(T0 - 30_000);
    mount(true);
    expect([renders.minutes, renders.count]).toEqual([0, 1]);
    advance(29_000);
    expect([renders.minutes, renders.count]).toEqual([0, 1]);
    advance(1_100);
    expect([renders.minutes, renders.count]).toEqual([1, 2]);
    advance(58_000);
    expect([renders.minutes, renders.count]).toEqual([1, 2]);
    advance(2_000);
    expect([renders.minutes, renders.count]).toEqual([2, 3]);
  });

  it("adds what the answered segments banked", () => {
    const you: UserTurn = { role: "user", content: "东部", messageId: "u-1" };
    const asked: AgentTurn = {
      role: "agent",
      turnIndex: 2,
      finalAnswer: null,
      tools: [
        {
          id: "t-ask",
          name: "ask_user",
          status: "success-historical",
          args: {},
        },
      ],
      telemetry: { elapsedMs: 50_000 },
    } as AgentTurn;
    running(T0 - 15_000, [
      { role: "user", content: "预测一下", messageId: "u-0" },
      asked,
      you,
    ]);
    mount(true);
    expect(renders.minutes).toBe(1);
  });

  it("is 0 and sets no timer while not active", () => {
    running(T0 - 3 * 60_000);
    mount(false);
    expect(renders.minutes).toBe(0);
    advance(10 * 60_000);
    expect(renders.count).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("catches a stale clock up at once when it turns active", () => {
    running(T0 + 60_000);
    mount(false);
    // Five minutes on, a run that began three minutes ago turns it on.
    advance(5 * 60_000);
    act(() => {
      running(T0 + 2 * 60_000);
      root!.render(<Probe active />);
    });
    advance(0);
    expect(renders.minutes).toBe(3);
    expect(renders.count).toBeLessThanOrEqual(3);
  });
});
