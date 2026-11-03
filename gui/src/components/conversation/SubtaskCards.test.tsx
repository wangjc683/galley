import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubtaskDispatch } from "@/lib/subtasks";
import { makeSession } from "@/test/factories";
import type { PendingAskUser } from "@/types/conversation";
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
  askInCard: {} as Record<string, PendingAskUser | null>,
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
  useSubtasksStore: fakeStore(() => ({
    runErrors: state.runErrors,
    askInCard: state.askInCard,
  })),
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
  state.askInCard = {};
});

/** The card's opening tag. */
const cardTag = (html: string) =>
  html.slice(
    html.lastIndexOf("<", html.indexOf('data-role="subtask-card"')),
    html.indexOf(">", html.indexOf('data-role="subtask-card"')) + 1,
  );
/** The element carrying `role`, opening tag to the first close after it. */
const part = (html: string, role: string) => {
  const at = html.indexOf(`data-role="${role}"`);
  if (at < 0) return null;
  return html.slice(html.lastIndexOf("<", at), html.indexOf("</", at));
};

// Ruling 179 (ticket 130): a one-line receipt; ruling 182 (ticket 133):
// a 24px line in the reply's frame (ReplyCards).
describe("a subtask card", () => {
  it("is a 24px line in the reply's frame: no frame of its own, no bar, no tint", () => {
    liveMessages({ agentRunning: true });
    for (const html of [
      render([dispatch()]),
      (() => {
        liveMessages({
          pendingAskUser: { question: "要把发票单独放吗？", candidates: [] },
        });
        return render([dispatch()]);
      })(),
      (() => {
        liveMessages({});
        state.runErrors = { "s-sub": "quota exceeded" };
        return render([dispatch()]);
      })(),
    ]) {
      expect(cardTag(html)).toContain('class="rounded-sm"');
      expect(html).toContain(
        'class="flex h-6 min-w-0 items-center rounded-sm px-2 [font-size:var(--conversation-step-size)] group/line overflow-hidden hover:bg-hover has-[&gt;span&gt;button:focus-visible]:bg-hover"',
      );
      expect(html).not.toContain("min-h-10");
      expect(html).not.toContain("border-line");
      expect(html).not.toContain("w-[3px]");
      expect(html).not.toMatch(/bg-(brand|warning|error|surface)/);
      expect(html).not.toContain(">打开<");
    }
  });

  it("runs: a still dashed ring, the title, no word, no step line", () => {
    state.sessions = [
      { ...subtask, lastStepIndex: 3, summary: "读了 12 个 PDF" },
    ];
    liveMessages({ agentRunning: true });
    const html = render([dispatch({ sendBacks: 1 })]);
    expect(html).toContain('data-subtask-state="running"');
    expect(html).toContain(">把下载文件夹里的 PDF 按内容分类</span></button>");
    // Still: the sidebar row spins.
    expect(html).not.toContain("spin");
    expect(html).toMatch(/<svg[^>]*class="text-ink-muted"/);
    expect(part(html, "subtask-card-word")).toBeNull();
    expect(html).not.toContain("第 3 步");
    expect(html).not.toContain("读了 12 个 PDF");
    expect(html).not.toContain("第 2 轮");
    expect(html).not.toContain("思考中");
  });

  it("titles itself as the process card's rows do: the step size, ink-soft, ink on hover", () => {
    liveMessages({ agentRunning: true });
    const title = part(render([dispatch()]), "subtask-card-title")!;
    expect(title).toMatch(/^<button type="button"/);
    expect(title).toContain(
      "text-ink-soft group-hover/line:text-ink focus-visible:text-ink",
    );
    // The line's ground says it opens: no underline, no ring.
    expect(title).not.toContain("hover:underline");
    expect(title).not.toContain("focus-visible:ring");
    expect(title).not.toContain("font-medium");
    // As wide as its words (no flex-1): the word follows it 8px on.
    expect(render([dispatch()])).toContain(
      '<span class="flex min-w-0 leading-5"><button',
    );
  });

  // Ticket 132b: the title's button reaches over the whole line by
  // padding a negative margin takes back, the line clipping it; not a
  // stretched ::after, which WebKit sizes without the CJK / Latin
  // autospace, cutting 「制作76人赛季战况网页」 in a frame as wide as it.
  it("opens from anywhere on its line: the title's button reaches over it", () => {
    liveMessages({ agentRunning: true });
    const title = part(render([dispatch()]), "subtask-card-title")!;
    expect(title).toContain(
      "-ml-[30px] -mr-[100vw] min-w-0 pl-[30px] pr-[100vw] text-left outline-none",
    );
    // Its words a span of their own that cuts them (what the hover
    // measures); the button a flex item that shrinks to the line's room.
    expect(title).toContain('<span class="block truncate">');
    expect(title).not.toContain("max-w-full");
    expect(title).not.toContain("after:");
  });

  it("lets a word without a reason pass the click, and keeps one with a reason", () => {
    liveMessages({
      pendingAskUser: { question: "要把发票单独放吗？", candidates: [] },
    });
    expect(part(render([dispatch()]), "subtask-card-word")).toContain(
      "pointer-events-none",
    );
    liveMessages({});
    state.runErrors = { "s-sub": "quota exceeded" };
    expect(part(render([dispatch()]), "subtask-card-word")).not.toContain(
      "pointer-events-none",
    );
  });

  it("does not light a line that opens nothing", () => {
    const html = render([
      dispatch({ sessionId: null, title: "", failure: "unclosed" }),
    ]);
    expect(html).not.toContain("group/line");
    expect(html).not.toContain("hover:bg-hover");
    expect(html).not.toContain("-mr-[100vw]");
  });

  // Ruling 101: the question is the assistant's to take to the main
  // chat, where the user answers it; the card only says it waits.
  it("asks: the amber pause and 「等你回复」, the question goes to the assistant", () => {
    liveMessages({
      pendingAskUser: {
        question: "要把发票单独放吗？",
        candidates: ["要", "不要"],
      },
    });
    const html = render([dispatch()]);
    expect(html).toContain('data-subtask-state="asking"');
    expect(part(html, "subtask-card-word")).toMatch(
      /class="ml-2 shrink-0 select-none leading-5 pointer-events-none font-medium text-warning">等你回复$/,
    );
    expect(html).toMatch(/<svg[^>]*class="text-warning"/);
    expect(cardTag(html)).toContain(
      'aria-label="子任务 · 把下载文件夹里的 PDF 按内容分类 · 等你回复"',
    );
    expect(html).not.toContain("要把发票单独放吗？");
    expect(html).not.toContain(">不要<");
    expect(html).not.toContain('data-role="ask-user-bubble"');
    expect(html).not.toContain('placeholder="回复…"');
    expect(html).not.toContain('aria-label="发送"');
  });

  it("asks in the card when Core could not wake the main chat for it, under the line, on faint amber", () => {
    const pending = {
      question: "要把发票单独放吗？",
      candidates: ["要", "不要"],
    };
    liveMessages({ pendingAskUser: pending });
    state.askInCard = { "s-sub": { ...pending } };
    const html = render([dispatch()]);
    expect(html).toContain('data-subtask-state="asking"');
    expect(cardTag(html)).toContain(
      'class="rounded-sm bg-warning/[var(--opacity-subtle)]"',
    );
    expect(html).not.toContain("w-[3px]");
    // Under the line, on the title's edge.
    expect(html.indexOf('data-role="ask-user-bubble"')).toBeGreaterThan(
      html.indexOf('data-role="subtask-card-title"'),
    );
    expect(html).toMatch(/data-role="ask-user-bubble"[^>]*pl-\[30px\]/);
    expect(html).toContain("要把发票单独放吗？");
    expect(html).toContain(">不要<");
    expect(html).toContain('placeholder="回复…"');
    expect(html).toContain('aria-label="发送"');
    // The bubble says 「等你回复」 once; the line says no word.
    expect(html.split("等你回复").length - 1).toBe(1);
    expect(part(html, "subtask-card-word")).toBeNull();
    // Still openable from its title.
    expect(part(html, "subtask-card-title")).toMatch(/^<button/);
    // Core's word came before the page had the question: the one it asks.
    state.askInCard = { "s-sub": null };
    expect(render([dispatch()])).toContain('placeholder="回复…"');
  });

  it("goes back to the word on a new question, and to running when it runs", () => {
    state.askInCard = {
      "s-sub": { question: "要把发票单独放吗？", candidates: ["要", "不要"] },
    };
    liveMessages({
      pendingAskUser: { question: "合同放哪一类？", candidates: [] },
    });
    const asked = render([dispatch()]);
    expect(part(asked, "subtask-card-word")).toMatch(/>等你回复$/);
    expect(asked).not.toContain("合同放哪一类？");
    expect(asked).not.toContain('placeholder="回复…"');
    expect(cardTag(asked)).toContain('class="rounded-sm"');
    liveMessages({ agentRunning: true });
    const running = render([dispatch()]);
    expect(running).toContain('data-subtask-state="running"');
    expect(running).not.toContain('placeholder="回复…"');
  });

  it("is done: the muted check and the title, no result line, no word", () => {
    state.sessions = [{ ...subtask, summary: "30 个 PDF 分成 5 类" }];
    liveMessages({
      turns: [
        { role: "user", content: "x" },
        { role: "agent", tools: [], finalAnswer: "分好了。" },
      ],
    });
    const html = render([dispatch()]);
    expect(html).toContain('data-subtask-state="done"');
    expect(html).not.toContain("30 个 PDF 分成 5 类");
    expect(part(html, "subtask-card-word")).toBeNull();
    expect(part(html, "subtask-card-title")).toMatch(/^<button/);
  });

  it("fails: the red cross and 「出错」, the reason on hover and in its name", () => {
    liveMessages({});
    state.runErrors = { "s-sub": "quota exceeded" };
    const html = render([dispatch()]);
    expect(html).toContain('data-subtask-state="failed"');
    expect(part(html, "subtask-card-word")).toMatch(
      /title="出错：quota exceeded" class="[^"]*text-error">出错$/,
    );
    expect(cardTag(html)).toContain(
      'aria-label="子任务 · 把下载文件夹里的 PDF 按内容分类 · 出错：quota exceeded"',
    );
    expect(html).toMatch(/<svg[^>]*class="text-error"/);
    expect(part(html, "subtask-card-title")).toMatch(/^<button/);
  });

  it("did not finish: 「没有跑完」 in muted ink", () => {
    liveMessages({
      turns: [
        { role: "user", content: "x" },
        {
          role: "agent",
          tools: [{ id: "t", name: "code_run", status: "success-historical" }],
          finalAnswer: null,
        },
      ],
    });
    const html = render([dispatch()]);
    expect(html).toContain('data-subtask-state="failed"');
    const word = part(html, "subtask-card-word")!;
    expect(word).toMatch(/text-ink-muted">没有跑完$/);
    expect(word).not.toContain("title=");
  });

  it("never started: 「没有开始」 with the reason, and nothing to open", () => {
    const html = render([
      dispatch({ sessionId: null, title: "", failure: "unclosed" }),
    ]);
    expect(html).toContain('data-subtask-state="notStarted"');
    // No title to show: it says what it is, as words, not a button.
    const title = part(html, "subtask-card-title")!;
    expect(title).toMatch(/^<span/);
    expect(title).toMatch(/>子任务$/);
    expect(part(html, "subtask-card-word")).toMatch(
      /title="没有开始：Galley 没写完要做什么" class="[^"]*text-error">没有开始$/,
    );
    expect(html).not.toContain("<button");
  });

  it("is gone: words only, why on hover and in its name", () => {
    state.sessions = [];
    const html = render([dispatch()]);
    expect(html).toContain('data-subtask-state="gone"');
    const title = part(html, "subtask-card-title")!;
    expect(title).toMatch(/^<span[^>]*title="这个子任务已经删除"/);
    expect(part(html, "subtask-card-word")).toBeNull();
    expect(cardTag(html)).toContain(" · 这个子任务已经删除");
    expect(html).not.toContain("<button");
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
