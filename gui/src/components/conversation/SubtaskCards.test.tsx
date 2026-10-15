import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubtaskDispatch } from "@/lib/subtasks";
import { makeSession } from "@/test/factories";
import type { Session } from "@/types/session";

/**
 * The cards under a main chat reply (ticket 06a). Static rendering reads
 * a zustand store's initial state, so the stores the card reads are
 * swapped for plain state objects seeded per test; the state rules
 * themselves are pinned in lib/subtasks.test.ts.
 */

const state = vi.hoisted(() => ({
  sessions: [] as Session[],
  messages: {} as Record<string, unknown>,
  runtime: {} as Record<string, unknown>,
  runErrors: {} as Record<string, string>,
}));

function fakeStore<T>(get: () => T) {
  return Object.assign(<R,>(select: (s: T) => R) => select(get()), {
    getState: get,
  });
}

vi.mock("@/stores/sessions", () => ({
  useSessionsStore: fakeStore(() => ({ sessions: state.sessions })),
}));
vi.mock("@/stores/messages", () => ({
  useMessagesStore: fakeStore(() => ({
    byId: state.messages,
    restoreSessionTurns: () => Promise.resolve(),
  })),
}));
vi.mock("@/stores/runtime", () => ({
  useRuntimeStore: fakeStore(() => ({ byId: state.runtime })),
}));
vi.mock("@/stores/subtasks", () => ({
  useSubtasksStore: fakeStore(() => ({ runErrors: state.runErrors })),
}));

import { SubtaskCards } from "./SubtaskCards";

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
  turnCount: 1,
});

function render(dispatches: SubtaskDispatch[]): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <SubtaskCards dispatches={dispatches} />
    </Tooltip.Provider>,
  );
}

function liveMessages(extra: Record<string, unknown>) {
  state.messages = {
    "s-sub": {
      agentRunning: false,
      pendingAskUser: null,
      turns: [{ role: "user", content: "x" }],
      restoring: false,
      ...extra,
    },
  };
}

beforeEach(() => {
  state.sessions = [subtask];
  state.messages = {};
  state.runtime = {};
  state.runErrors = {};
});

describe("a subtask card", () => {
  it("runs: spinner, the sidebar's step line, 打开", () => {
    state.sessions = [
      { ...subtask, lastStepIndex: 3, summary: "读了 12 个 PDF" },
    ];
    liveMessages({ agentRunning: true });
    const html = render([dispatch()]);
    expect(html).toContain('data-subtask-state="running"');
    expect(html).toContain(">把下载文件夹里的 PDF 按内容分类<");
    expect(html).toContain(">第 3 步 · 读了 12 个 PDF<");
    expect(html).toContain(">打开<");
    expect(html).toContain("bg-brand");
  });

  // Ticket 31: sent back by the assistant, it runs its second round.
  it("runs a later round: 「第 2 轮 · 」 before the step line, and only while it runs", () => {
    state.sessions = [
      { ...subtask, lastStepIndex: 3, summary: "补查了 2 个 PDF" },
    ];
    liveMessages({ agentRunning: true });
    expect(render([dispatch({ sendBacks: 1 })])).toContain(
      ">第 2 轮 · 第 3 步 · 补查了 2 个 PDF<",
    );
    liveMessages({
      agentRunning: false,
      turns: [
        { role: "user", content: "x" },
        { role: "agent", tools: [], finalAnswer: "补好了。" },
      ],
    });
    const done = render([dispatch({ sendBacks: 1 })]);
    expect(done).toContain('data-subtask-state="done"');
    expect(done).not.toContain("第 2 轮");
  });

  it("asks: the question, its candidates and a reply line in the card", () => {
    liveMessages({
      pendingAskUser: {
        question: "要把发票单独放吗？",
        candidates: ["要", "不要"],
      },
    });
    const html = render([dispatch()]);
    expect(html).toContain('data-subtask-state="asking"');
    expect(html).toContain("要把发票单独放吗？");
    expect(html).toContain(">不要<");
    expect(html).toContain('placeholder="回复…"');
    expect(html).toContain('aria-label="发送"');
    expect(html).toContain("bg-warning");
    expect(html).toContain(">打开<");
  });

  it("is done: one line of result and 打开", () => {
    state.sessions = [{ ...subtask, summary: "30 个 PDF 分成 5 类" }];
    liveMessages({
      turns: [
        { role: "user", content: "x" },
        { role: "agent", tools: [], finalAnswer: "分好了。" },
      ],
    });
    const html = render([dispatch()]);
    expect(html).toContain('data-subtask-state="done"');
    expect(html).toContain(">30 个 PDF 分成 5 类<");
    expect(html).toContain(">打开<");
  });

  it("fails: the reason and 打开", () => {
    liveMessages({});
    state.runErrors = { "s-sub": "quota exceeded" };
    const html = render([dispatch()]);
    expect(html).toContain('data-subtask-state="failed"');
    expect(html).toContain(">出错：quota exceeded<");
    expect(html).toContain(">打开<");
  });

  it("never started: the reason, and nothing to open", () => {
    const html = render([
      dispatch({ sessionId: null, title: "", failure: "unclosed" }),
    ]);
    expect(html).toContain('data-subtask-state="notStarted"');
    // No title to show: it says what it is.
    expect(html).toContain(">子任务<");
    expect(html).toContain(">没有开始：主对话没写完要做什么<");
    expect(html).not.toContain(">打开<");
  });

  it("stacks one card per tag, in tag order", () => {
    state.sessions = [subtask, { ...subtask, id: "s-b", title: "订机票" }];
    state.messages = {};
    const html = render([
      dispatch(),
      dispatch({ ordinal: 1, sessionId: "s-b", title: "订机票" }),
    ]);
    expect(html.indexOf(">把下载文件夹里的 PDF 按内容分类<")).toBeLessThan(
      html.indexOf(">订机票<"),
    );
    expect(html.split('data-role="subtask-card"').length - 1).toBe(2);
  });
});
