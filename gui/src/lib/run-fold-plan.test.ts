import { describe, expect, it } from "vitest";

import { type FoldHead, workbenchFoldPlan } from "@/lib/run-fold-plan";
import { buildRunGroups, liveRunGroup } from "@/lib/run-groups";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

function user(content: string): UserTurn {
  return { role: "user", content };
}

let toolSeq = 0;
function tool(name: string): ConversationToolEvent {
  return {
    id: `t-${toolSeq++}`,
    name,
    status: "success-historical",
    args: {},
  };
}

function step(): AgentTurn {
  return { role: "agent", tools: [tool("web_scan")], finalAnswer: null };
}

function askStep(): AgentTurn {
  return {
    role: "agent",
    tools: [tool("ask_user")],
    finalAnswer: null,
    telemetry: { elapsedMs: 1_000 },
  };
}

function closing(): AgentTurn {
  return {
    role: "agent",
    tools: [tool("no_tool")],
    finalAnswer: "结论",
    telemetry: { elapsedMs: 2_000 },
  };
}

/** 0 request, 1 step, 2 ask, 3 answer to it, 4 step, 5 step, 6 the
 * answer (the closing turn). */
function asked(): Turn[] {
  return [
    user("订船票"),
    step(),
    askStep(),
    user("8:30"),
    step(),
    step(),
    closing(),
  ];
}

function plan(
  turns: Turn[],
  {
    running = false,
    settling = false,
    opened = [] as number[],
    departing = [] as number[],
  } = {},
) {
  const groups = buildRunGroups(turns);
  const liveGroup = liveRunGroup(groups, running, false);
  return workbenchFoldPlan({
    groups,
    turns,
    liveGroup,
    settlingGroup: settling ? groups[groups.length - 1] : null,
    isDeparting: (i) => departing.includes(i),
    isOpened: (opener) => opened.includes(opener),
  });
}

function onlyHead(p: ReturnType<typeof plan>): [number, FoldHead] {
  expect(p.heads.size).toBe(1);
  return [...p.heads][0];
}

describe("workbenchFoldPlan: a settled run", () => {
  it("draws its questions and answers, header and card right before the answer, closed", () => {
    const p = plan(asked());
    const [anchor, head] = onlyHead(p);
    expect(anchor).toBe(6);
    expect(head.folded).toBe(true);
    expect(head.live).toBe(false);
    // The question and the user's answer, in order, out before the
    // header; the steps behind it, minus the one that only asked.
    expect(head.outside).toEqual([2, 3]);
    expect(head.rows).toEqual([1, 4, 5]);
    // Nothing of the run is drawn at its own place but the request and
    // the answer.
    expect([...p.elsewhere].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(p.windowOwner.size).toBe(0);
    expect(p.regionOwner.size).toBe(0);
  });

  it("opens when the reader opened its header", () => {
    expect(onlyHead(plan(asked(), { opened: [0] }))[1].folded).toBe(false);
  });

  it("keeps the step counts, the numbers and the grouping of run-groups", () => {
    const [, head] = onlyHead(plan(asked()));
    expect(head.group.stats.stepCount).toBe(5);
    expect(head.group.stats.askUserCount).toBe(1);
    expect(head.group.stats.elapsedMs).toBe(3_000);
    expect(head.foldedSteps).toBe(5);
  });
});

describe("workbenchFoldPlan: the live run", () => {
  // Running after the answer to its question and two more steps.
  const live = () => asked().slice(0, 6);

  it("folds the steps before the window behind the live header, its card their rows", () => {
    const p = plan(live(), { running: true });
    const [anchor, head] = onlyHead(p);
    // The window: the last completed step; the header right before it.
    expect(anchor).toBe(5);
    expect([...p.windowOwner.keys()]).toEqual([5]);
    expect(head.live).toBe(true);
    expect(head.foldedSteps).toBe(3);
    expect(head.rows).toEqual([1, 4]);
  });

  it("keeps a question and its answer where they are today: behind the live header, not as rows", () => {
    const p = plan(live(), { running: true });
    const [, head] = onlyHead(p);
    expect(head.outside).toEqual([]);
    expect(p.elsewhere.has(2)).toBe(true);
    expect(p.elsewhere.has(3)).toBe(true);
    expect(p.echoOutside.size).toBe(0);
    // While they are the window's tail, they are in the window.
    const tail = plan(asked().slice(0, 4), { running: true });
    expect([...tail.windowOwner.keys()]).toEqual([2, 3]);
  });

  it("settles open when opened live: the same run, its rows kept and the window's joined", () => {
    const opened = { opened: [0] };
    const [, liveHead] = onlyHead(plan(live(), { running: true, ...opened }));
    const [, settledHead] = onlyHead(plan(asked(), opened));
    expect(liveHead.folded).toBe(false);
    expect(settledHead.folded).toBe(false);
    expect(settledHead.group.openerIndex).toBe(liveHead.group.openerIndex);
    expect(settledHead.rows.slice(0, liveHead.rows.length)).toEqual(
      liveHead.rows,
    );
    expect(settledHead.rows).toEqual([1, 4, 5]);
  });

  it("anchors the header at a step still sweeping out of the window", () => {
    const p = plan(live(), { running: true, departing: [4] });
    const [anchor, head] = onlyHead(p);
    expect(anchor).toBe(4);
    expect([...p.windowOwner.keys()]).toEqual([4, 5]);
    expect(head.foldedSteps).toBe(3);
    expect(head.rows).toEqual([1]);
  });
});

describe("workbenchFoldPlan: settling", () => {
  it("puts the questions and answers out before the header already, where the settled run has them", () => {
    const p = plan(asked(), { settling: true });
    const [anchor, head] = onlyHead(p);
    expect(anchor).toBe(5);
    expect(head.live).toBe(false);
    expect(head.outside).toEqual([2, 3]);
    expect([...p.windowOwner.keys()]).toEqual([5]);
  });

  it("leaves the echo of a question in the window out", () => {
    // Answered right after its question: the window is the question's
    // step and the answer to it.
    const turns: Turn[] = [
      user("订船票"),
      step(),
      askStep(),
      user("8:30"),
      closing(),
    ];
    const p = plan(turns, { settling: true });
    const [anchor, head] = onlyHead(p);
    expect(head.outside).toEqual([2, 3]);
    expect([...p.windowOwner.keys()]).toEqual([2]);
    expect(anchor).toBe(2);
    expect(p.echoOutside.has(2)).toBe(true);
    expect(p.elsewhere.has(3)).toBe(true);
  });
});

describe("workbenchFoldPlan: a run that answered in one step", () => {
  const oneStep = (): Turn[] => [user("早"), closing()];

  it("is its answer alone: no header, no card, nothing drawn elsewhere", () => {
    const p = plan(oneStep());
    expect(p.heads.size).toBe(0);
    expect(p.elsewhere.size).toBe(0);
    expect(p.windowOwner.size).toBe(0);
    expect(p.regionOwner.size).toBe(0);
    expect(p.settleGapAbove).toBeNull();
  });

  it("closes the in-flight row's place above its answer while it settles", () => {
    const p = plan(oneStep(), { settling: true });
    expect(p.heads.size).toBe(0);
    expect(p.settleGapAbove).toBe(1);
  });

  it("leaves a run of two steps behind its header", () => {
    const p = plan([user("排个行程"), step(), closing()]);
    expect(onlyHead(p)[1].rows).toEqual([1]);
    expect(p.settleGapAbove).toBeNull();
  });
});

// Ruling 9 (ticket 04): a run that stopped without an answer keeps the
// live window's shape, frozen — the header 「中途停下 · N 步」 over every
// step but the last, the last in the step region's reading form.
describe("workbenchFoldPlan: a stopped run", () => {
  /** 0 request, 1–4 four steps, no answer. */
  const four = (): Turn[] => [
    user("查一周的船票"),
    step(),
    step(),
    step(),
    step(),
  ];

  it("folds every step but the last behind its header, the last out in the window", () => {
    const p = plan(four());
    const [anchor, head] = onlyHead(p);
    expect(anchor).toBe(4);
    expect(head.stopped).toBe(true);
    expect(head.live).toBe(false);
    expect(head.folded).toBe(true);
    expect(head.foldedSteps).toBe(3);
    expect(head.rows).toEqual([1, 2, 3]);
    expect(head.outside).toEqual([]);
    expect(head.group.stats.stepCount).toBe(4);
    expect([...p.windowOwner.keys()]).toEqual([4]);
    expect([...p.elsewhere].sort()).toEqual([1, 2, 3]);
    expect(p.regionOwner.size).toBe(0);
  });

  it("is the live window's plan from the stop on: same anchor, window, rows and open state", () => {
    for (const opened of [[], [0]]) {
      const live = plan(four(), { running: true, opened });
      const stopped = plan(four(), { opened });
      const [liveAnchor, liveHead] = onlyHead(live);
      const [anchor, head] = onlyHead(stopped);
      expect(anchor).toBe(liveAnchor);
      expect([...stopped.windowOwner]).toEqual([...live.windowOwner]);
      expect(head.rows).toEqual(liveHead.rows);
      expect(head.foldedSteps).toBe(liveHead.foldedSteps);
      expect(head.folded).toBe(liveHead.folded);
      expect(head.group.stats.stepCount).toBe(liveHead.group.stats.stepCount);
    }
    // A step still sweeping out of the window when it stopped stays a
    // window member until its sweep ends.
    const departing = plan(four(), { departing: [3] });
    expect([...departing.windowOwner.keys()]).toEqual([3, 4]);
    expect(onlyHead(departing)[0]).toBe(3);
    expect(onlyHead(departing)[1].rows).toEqual([1, 2]);
  });

  it("puts the questions and answers behind the header out before it; the steps that only asked are no rows", () => {
    // 0 request, 1 step, 2 ask, 3 answer, 4 step, 5 step; stopped.
    const p = plan(asked().slice(0, 6));
    const [anchor, head] = onlyHead(p);
    expect(anchor).toBe(5);
    expect(head.outside).toEqual([2, 3]);
    expect(head.rows).toEqual([1, 4]);
    expect(head.foldedSteps).toBe(3);
    expect([...p.windowOwner.keys()]).toEqual([5]);
    expect([...p.elsewhere].sort()).toEqual([1, 2, 3, 4]);
  });

  it("leaves a question and its answer in the window while they are its tail, as live", () => {
    // Stopped right after the user answered: the window is the
    // question's step and the answer, frozen as it was.
    const p = plan(asked().slice(0, 4));
    const [anchor, head] = onlyHead(p);
    expect(anchor).toBe(2);
    expect(head.outside).toEqual([]);
    expect(head.rows).toEqual([1]);
    expect([...p.windowOwner.keys()]).toEqual([2, 3]);
    expect(p.echoOutside.size).toBe(0);
  });

  it("draws a run stopped after one step as that step alone: nothing behind a header", () => {
    const p = plan([user("查船票"), step()]);
    const [anchor, head] = onlyHead(p);
    expect(anchor).toBe(1);
    expect(head.stopped).toBe(true);
    expect(head.foldedSteps).toBe(0);
    expect([...p.windowOwner.keys()]).toEqual([1]);
    expect(p.regionOwner.size).toBe(0);
    // None landed: nothing.
    const none = plan([user("查船票")]);
    expect(none.heads.size).toBe(0);
    expect(none.windowOwner.size).toBe(0);
    expect(none.regionOwner.size).toBe(0);
  });
});

describe("workbenchFoldPlan: runs drawn flat", () => {
  it("draws a run GA ended on its own with nothing but tags in full: it did not stop partway", () => {
    const ended: AgentTurn = {
      role: "agent",
      tools: [tool("no_tool")],
      finalAnswer: null,
    };
    const p = plan([user("查船票"), step(), step(), ended]);
    expect(p.heads.size).toBe(0);
    expect([...p.regionOwner.keys()]).toEqual([1, 2, 3]);
    expect(p.elsewhere.size).toBe(0);
  });

  it("draws a /btw exchange in full", () => {
    const turns: Turn[] = [
      user("查天气"),
      step(),
      {
        role: "system",
        content: "/btw 顺便看下船票",
        variant: "side_question",
      },
      closing(),
    ];
    const p = plan(turns);
    expect(p.heads.size).toBe(0);
    expect([...p.regionOwner.keys()]).toEqual([1, 2, 3]);
  });
});
