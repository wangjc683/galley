import { describe, expect, it, vi } from "vitest";

import { copyForLanguage } from "@/lib/i18n";
import { buildRunGroups } from "@/lib/run-groups";
import {
  answeredInCard,
  deriveSubtaskCard,
  endsInSilentReport,
  hiddenReportTurns,
  inReportRound,
  isSilentReport,
  isSubtaskReportTurn,
  isUnpromotedSubtask,
  mergeDispatches,
  sameQuestion,
  subtaskBreadcrumb,
  subtaskCardLine,
  unpromotedSubtasksOf,
  type SubtaskDispatch,
  type SubtaskLiveView,
} from "@/lib/subtasks";
import { makeSession } from "@/test/factories";
import type { AgentTurn, Turn } from "@/types/conversation";

const zh = copyForLanguage("zh-CN");
const en = copyForLanguage("en-US");

function dispatch(extra: Partial<SubtaskDispatch> = {}): SubtaskDispatch {
  return {
    parentSessionId: "s-main",
    turnIndex: 4,
    ordinal: 0,
    messageId: "msg_s-main_4_assistant",
    sessionId: "s-sub",
    title: "把下载文件夹里的 PDF 按内容分类",
    failure: null,
    failureDetail: null,
    createdAt: "2026-10-13T08:00:00.000Z",
    ...extra,
  };
}

const subtask = makeSession({
  id: "s-sub",
  title: "把下载文件夹里的 PDF 按内容分类",
  parentSessionId: "s-main",
  gaRuntimeKind: "managed",
  runtimeKind: "managed",
});

function live(extra: Partial<SubtaskLiveView> = {}): SubtaskLiveView {
  return {
    agentRunning: false,
    pendingAskUser: null,
    turns: [],
    ...extra,
  };
}

const userTurn: Turn = {
  role: "user",
  content: "把下载文件夹里的 PDF 按内容分类",
};

function agent(extra: Partial<AgentTurn> = {}): AgentTurn {
  return { role: "agent", tools: [], finalAnswer: null, ...extra };
}

describe("which sessions are unpromoted subtasks", () => {
  it("is a session with a parent the user has not written in", () => {
    expect(isUnpromotedSubtask(subtask)).toBe(true);
    expect(isUnpromotedSubtask({ ...subtask, promoted: true })).toBe(false);
    expect(isUnpromotedSubtask(makeSession())).toBe(false);
    expect(isUnpromotedSubtask(undefined)).toBe(false);
  });

  it("lists a parent's unpromoted subtasks only", () => {
    const other = makeSession({ id: "s-x", parentSessionId: "s-other" });
    const promoted = { ...subtask, id: "s-p", promoted: true };
    expect(
      unpromotedSubtasksOf([subtask, other, promoted, makeSession()], "s-main"),
    ).toEqual([subtask]);
    expect(unpromotedSubtasksOf([subtask], undefined)).toEqual([]);
  });
});

describe("merging dispatch records", () => {
  it("keeps one record per reply and tag, in display order", () => {
    const a = dispatch({ ordinal: 1, sessionId: "s-b" });
    const b = dispatch({ ordinal: 0 });
    const c = dispatch({ turnIndex: 2, messageId: "msg_s-main_2_assistant" });
    const merged = mergeDispatches([a], [b, c]);
    expect(merged.map((d) => [d.turnIndex, d.ordinal])).toEqual([
      [2, 0],
      [4, 0],
      [4, 1],
    ]);
    // A repeat changes nothing; a newer record replaces the older one.
    expect(mergeDispatches(merged, [b])).toEqual(merged);
    const updated = mergeDispatches(merged, [
      { ...a, failure: "start_failed", failureDetail: "spawn failed" },
    ]);
    expect(updated.find((d) => d.ordinal === 1)?.failure).toBe("start_failed");
  });

  // Ticket 31: Core announces a record again when the assistant sent the
  // subtask back; a missing count (an older payload) is 0.
  it("takes a changed send-back count, and reads a missing one as 0", () => {
    const merged = mergeDispatches([], [dispatch()]);
    expect(mergeDispatches(merged, [dispatch({ sendBacks: 0 })])).toEqual(
      merged,
    );
    const sentBack = mergeDispatches(merged, [dispatch({ sendBacks: 1 })]);
    expect(sentBack[0].sendBacks).toBe(1);
  });
});

describe("the card's state", () => {
  it("never started: the dispatch's reason, and nothing to open", () => {
    for (const [failure, text] of [
      ["empty", "没有开始：主对话没写要做什么"],
      ["unclosed", "没有开始：主对话没写完要做什么"],
    ] as const) {
      const state = deriveSubtaskCard(
        dispatch({ sessionId: null, failure, title: "" }),
        undefined,
        live(),
      );
      expect(state.kind).toBe("notStarted");
      expect(subtaskCardLine(state, zh)).toBe(text);
    }
    const failed = deriveSubtaskCard(
      dispatch({
        sessionId: null,
        failure: "start_failed",
        failureDetail: "the managed runtime is not configured",
      }),
      undefined,
      live(),
    );
    expect(failed.kind).toBe("notStarted");
    expect(subtaskCardLine(failed, zh)).toBe(
      "没能启动：the managed runtime is not configured",
    );
    expect(subtaskCardLine(failed, en)).toBe(
      "Could not start: the managed runtime is not configured",
    );
  });

  it("is gone when its session is", () => {
    expect(deriveSubtaskCard(dispatch(), undefined, live()).kind).toBe("gone");
  });

  it("runs with the sidebar's own subline", () => {
    const thinking = deriveSubtaskCard(
      dispatch(),
      subtask,
      live({ agentRunning: true, turns: [userTurn] }),
    );
    expect(thinking).toEqual({ kind: "running", step: null, summary: null });
    expect(subtaskCardLine(thinking, zh)).toBe("思考中");

    const stepping = deriveSubtaskCard(
      dispatch(),
      { ...subtask, lastStepIndex: 3, summary: "读了 12 个 PDF" },
      live({ agentRunning: true, turns: [userTurn, agent()] }),
    );
    expect(subtaskCardLine(stepping, zh)).toBe("第 3 步 · 读了 12 个 PDF");
    // A runner still starting is running too.
    expect(
      deriveSubtaskCard(dispatch(), subtask, live({ bridgeStatus: "spawning" }))
        .kind,
    ).toBe("running");
  });

  // Ticket 31: sent back, the running line says which round first.
  it("says which round it runs once the assistant sent it back", () => {
    const stepping = {
      ...subtask,
      lastStepIndex: 3,
      summary: "补查了 2 个 PDF",
    };
    const running = live({ agentRunning: true, turns: [userTurn, agent()] });
    const second = deriveSubtaskCard(
      dispatch({ sendBacks: 1 }),
      stepping,
      running,
    );
    expect(second).toEqual({
      kind: "running",
      step: 3,
      summary: "补查了 2 个 PDF",
      round: 2,
    });
    expect(subtaskCardLine(second, zh)).toBe(
      "第 2 轮 · 第 3 步 · 补查了 2 个 PDF",
    );
    expect(subtaskCardLine(second, en)).toMatch(/^Round 2 · /);
    const thinking = deriveSubtaskCard(
      dispatch({ sendBacks: 2 }),
      subtask,
      live({ agentRunning: true, turns: [userTurn] }),
    );
    expect(subtaskCardLine(thinking, zh)).toBe("第 3 轮 · 思考中");
    // The first round says none, and no other state does.
    expect(
      subtaskCardLine(
        deriveSubtaskCard(dispatch({ sendBacks: 0 }), stepping, running),
        zh,
      ),
    ).toBe("第 3 步 · 补查了 2 个 PDF");
    const done = deriveSubtaskCard(
      dispatch({ sendBacks: 1 }),
      { ...subtask, summary: "30 个 PDF 分成 5 类" },
      live({ turns: [userTurn, agent({ finalAnswer: "分好了。" })] }),
    );
    expect(subtaskCardLine(done, zh)).toBe("30 个 PDF 分成 5 类");
    const asking = deriveSubtaskCard(
      dispatch({ sendBacks: 1 }),
      subtask,
      live({
        pendingAskUser: { question: "要单独放吗？", candidates: [] },
        turns: [userTurn, agent()],
      }),
    );
    expect(subtaskCardLine(asking, zh)).toBe("等你回复");
    const failed = deriveSubtaskCard(
      dispatch({ sendBacks: 1 }),
      subtask,
      live({ runError: "quota exceeded", turns: [userTurn] }),
    );
    expect(subtaskCardLine(failed, zh)).toBe("出错：quota exceeded");
  });

  // Ruling 101: the assistant takes a subtask's question to the main
  // chat; the card answers it only when that wake could not be delivered.
  it("asks: the card says it is waiting, the question goes to the assistant", () => {
    const pending = {
      question: "要把发票单独放吗？",
      candidates: ["要", "不要"],
    };
    const state = deriveSubtaskCard(
      dispatch(),
      subtask,
      live({ pendingAskUser: pending, turns: [userTurn, agent()] }),
    );
    expect(state).toEqual({ kind: "asking", pending, inCard: false });
    // The sidebar row's words, nothing of the question.
    expect(subtaskCardLine(state, zh)).toBe("等你回复");
    expect(subtaskCardLine(state, en)).toBe("Waiting for you");
  });

  it("asks in the card when its report could not wake the main chat", () => {
    const pending = {
      question: "要把发票单独放吗？",
      candidates: ["要", "不要"],
    };
    const state = deriveSubtaskCard(
      dispatch(),
      subtask,
      live({
        pendingAskUser: pending,
        askInCard: { ...pending, candidates: [...pending.candidates] },
        turns: [userTurn, agent()],
      }),
    );
    expect(state).toEqual({ kind: "asking", pending, inCard: true });
    // The bubble in the card says 「等你回复」; the state line stays empty.
    expect(subtaskCardLine(state, zh)).toBeNull();
  });

  it("answers in the card only the question Core could not deliver", () => {
    const asked = {
      question: "要把发票单独放吗？",
      candidates: ["要", "不要"],
    };
    // No word from Core: the assistant has it.
    expect(answeredInCard(undefined, asked)).toBe(false);
    // Core said so before the page saw the question: the one it asks.
    expect(answeredInCard(null, asked)).toBe(true);
    expect(answeredInCard({ ...asked }, asked)).toBe(true);
    // A new question is a new report: not this fallback's.
    expect(
      answeredInCard(asked, { question: "合同放哪？", candidates: [] }),
    ).toBe(false);
    expect(
      answeredInCard(asked, { ...asked, candidates: ["要", "不要", "看情况"] }),
    ).toBe(false);
    expect(sameQuestion(asked, { ...asked, candidates: ["不要", "要"] })).toBe(
      false,
    );
  });

  it("is done with one line of result: the recap, else the answer's first line", () => {
    const answer = agent({
      finalAnswer: "## 分好了\n\n30 个 PDF 分成 5 类。",
      tools: [],
    });
    const recap = deriveSubtaskCard(
      dispatch(),
      { ...subtask, summary: "30 个 PDF 分成 5 类" },
      live({ turns: [userTurn, answer] }),
    );
    expect(recap).toEqual({ kind: "done", line: "30 个 PDF 分成 5 类" });
    expect(subtaskCardLine(recap, zh)).toBe("30 个 PDF 分成 5 类");
    const bare = deriveSubtaskCard(
      dispatch(),
      subtask,
      live({ turns: [userTurn, answer] }),
    );
    expect(subtaskCardLine(bare, zh)).toBe("分好了");
  });

  it("fails on an error, a crash, a runner that never started, or a run cut short", () => {
    const err = deriveSubtaskCard(
      dispatch(),
      subtask,
      live({ runError: "quota exceeded", turns: [userTurn] }),
    );
    expect(subtaskCardLine(err, zh)).toBe("出错：quota exceeded");
    // Even while it looked running: the error wins, as on the sidebar.
    const crash = deriveSubtaskCard(
      dispatch(),
      subtask,
      live({ bridgeStatus: "error", bridgeError: null, agentRunning: true }),
    );
    expect(crash.kind).toBe("failed");
    expect(subtaskCardLine(crash, zh)).toBe("出错");

    const neverRan = deriveSubtaskCard(
      dispatch({ failure: "start_failed", failureDetail: "spawn failed" }),
      { ...subtask, turnCount: 0 },
      live({ turns: [userTurn] }),
    );
    expect(subtaskCardLine(neverRan, zh)).toBe("没能启动：spawn failed");

    const cut = deriveSubtaskCard(
      dispatch(),
      subtask,
      live({
        turns: [
          userTurn,
          agent({
            tools: [
              { id: "t", name: "code_run", status: "success-historical" },
            ],
          }),
        ],
      }),
    );
    expect(subtaskCardLine(cut, zh)).toBe("没有跑完");
  });

  it("waits for history it has not read yet", () => {
    expect(
      deriveSubtaskCard(dispatch(), { ...subtask, turnCount: 4 }, live()).kind,
    ).toBe("loading");
  });
});

describe("the header's crumb", () => {
  it("shows for an unpromoted subtask and opens its parent", () => {
    const openParent = vi.fn();
    const crumb = subtaskBreadcrumb(subtask, {
      label: "主对话",
      ariaLabel: "回到主对话",
      openParent,
    });
    expect(crumb?.label).toBe("主对话");
    crumb?.onClick();
    expect(openParent).toHaveBeenCalledOnce();
  });

  it("is absent for every other session", () => {
    const args = {
      label: "主对话",
      ariaLabel: "回到主对话",
      openParent: () => {},
    };
    expect(
      subtaskBreadcrumb({ ...subtask, promoted: true }, args),
    ).toBeUndefined();
    expect(
      subtaskBreadcrumb(makeSession({ mainChat: true }), args),
    ).toBeUndefined();
    expect(subtaskBreadcrumb(undefined, args)).toBeUndefined();
  });
});

// Ticket 31: the rows of the main chat a subtask report round hides.
describe("report rounds", () => {
  const reportRow: Turn = {
    role: "user",
    content: "[Galley — not a message from the user] …",
    messageId: "u-report",
    origin: { via: "system", supervisor: "galley-report", reason: "s-sub" },
  };
  const said = (text: string) =>
    agent({
      finalAnswer: text,
      tools: [{ id: "n", name: "no_tool", status: "success-historical" }],
    });
  const sendBack = agent({
    finalAnswer: "我让它再查一家。",
    tools: [{ id: "c", name: "code_run", status: "success-historical" }],
  });
  const silent = agent({ silent: true });
  const asked = agent({
    tools: [
      {
        id: "a",
        name: "ask_user",
        status: "success-historical",
        args: { question: "要付定金吗？", candidates: [] },
      },
    ],
  });
  const you: Turn = { role: "user", content: "早", messageId: "u-1" };

  it("knows a report row by its origin, and nothing else", () => {
    expect(isSubtaskReportTurn(reportRow)).toBe(true);
    expect(isSubtaskReportTurn(you)).toBe(false);
    expect(
      isSubtaskReportTurn({
        ...reportRow,
        origin: { via: "supervisor", supervisor: "galley-report" },
      }),
    ).toBe(false);
    expect(isSubtaskReportTurn(said("x"))).toBe(false);
  });

  it("hides the report row, and the whole of a round that said nothing", () => {
    const turns: Turn[] = [you, said("早。"), reportRow, sendBack, silent];
    const groups = buildRunGroups(turns);
    expect(isSilentReport(groups[1], turns)).toBe(true);
    expect(endsInSilentReport(turns)).toBe(true);
    expect(inReportRound(turns)).toBe(true);
    expect([...hiddenReportTurns(turns)].sort()).toEqual([2, 3, 4]);
  });

  it("hides only the row of a round that answered", () => {
    const turns: Turn[] = [
      you,
      said("早。"),
      reportRow,
      sendBack,
      said("查好了。"),
    ];
    expect(isSilentReport(buildRunGroups(turns)[1], turns)).toBe(false);
    expect(endsInSilentReport(turns)).toBe(false);
    expect([...hiddenReportTurns(turns)]).toEqual([2]);
  });

  it("keeps a silent round's question to the user and their answer", () => {
    const answer: Turn = { role: "user", content: "付", messageId: "u-2" };
    const turns: Turn[] = [reportRow, asked, answer, sendBack, silent];
    expect([...hiddenReportTurns(turns)].sort()).toEqual([0, 3, 4]);
  });

  it("is no report round for the user's own message, silent reply or not", () => {
    const turns: Turn[] = [you, silent];
    expect(inReportRound(turns)).toBe(false);
    expect(endsInSilentReport(turns)).toBe(false);
    expect(hiddenReportTurns(turns).size).toBe(0);
  });
});
