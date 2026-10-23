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
import { endsInSilentReport, SUBTASK_REPORT_SUPERVISOR } from "@/lib/subtasks";
import { EMPTY_MESSAGES, useMessagesStore } from "@/stores/messages";
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

/** A tool step: its stream in `chunks` (ending in the dispatch), then it
 * lands with the summary GA kept. */
function toolStepBeats(
  turnIndex: number,
  chunks: string[],
  summary: string,
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
          absoluteTurnIndex: 100 + turnIndex,
          timestamp: stamp(),
        }),
    ],
  ];
}

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
 * chat's live round, `typingBubbleShown`), saying `assistantDoing`. */
function lineNow(): string | null {
  const m = slice();
  const groups = buildRunGroups(m.turns);
  const last = groups[groups.length - 1];
  const settled = (last?.complete ?? false) || endsInSilentReport(m.turns);
  const live = m.agentRunning && !settled && m.pendingAskUser === null;
  return typingBubbleShown(live, m.turns, m.inFlightContent)
    ? assistantDoing(m.turns, m.inFlightContent, zh)
    : null;
}

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
