import * as Tooltip from "@radix-ui/react-tooltip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantLiveLine } from "@/components/conversation/AssistantParts";
import { zhCopy } from "@/i18n/locales/zh";
import { dropComposerDraft, saveComposerDraft } from "@/lib/composer-draft";
import { LocalFilesContext } from "@/lib/local-files";
import type { PerSessionMessages } from "@/stores/messages";
import { useQueueStore } from "@/stores/queue";
import { useSessionsStore } from "@/stores/sessions";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
} from "@/types/conversation";

import { MainView } from "./MainView";

// The live state MainView reads off the active session (its run clock):
// a static render reads the stores' initial state, so the tests hand it
// in here.
const live = vi.hoisted(() => ({
  slice: {} as Partial<PerSessionMessages>,
}));
vi.mock("@/hooks/useActiveSession", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useActiveSession")>();
  const { EMPTY_MESSAGES } = await import("@/stores/messages");
  return {
    ...actual,
    useActiveMessages: <T,>(
      select: (m: PerSessionMessages) => T,
      fallback: T,
    ): T =>
      Object.keys(live.slice).length > 0
        ? select({ ...EMPTY_MESSAGES, ...live.slice })
        : fallback,
  };
});

// The composer's queue strip needs the active session and its queue; a
// static render reads a zustand store's initial state, so these two read
// their current state here (unset, that is the initial state).
vi.mock("@/stores/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/queue")>();
  const store = actual.useQueueStore;
  const current = Object.assign(
    (select?: (state: ReturnType<typeof store.getState>) => unknown) =>
      select ? select(store.getState()) : store.getState(),
    store,
  );
  return { ...actual, useQueueStore: current };
});
vi.mock("@/stores/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/sessions")>();
  const store = actual.useSessionsStore;
  const current = Object.assign(
    (select?: (state: ReturnType<typeof store.getState>) => unknown) =>
      select ? select(store.getState()) : store.getState(),
    store,
  );
  return { ...actual, useSessionsStore: current };
});

afterEach(() => {
  live.slice = {};
  useSessionsStore.setState({ activeSessionId: undefined });
  useQueueStore.setState({ bySession: {} });
});

function tool(name: string, args: Record<string, unknown> = {}) {
  return {
    id: `t-${name}-${Math.random()}`,
    name,
    status: "success-historical",
    args,
  } as ConversationToolEvent;
}

function step(narration: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: narration,
    summary: narration,
    tools: [tool("web_scan")],
  };
}

function answer(text: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: text,
    tools: [tool("no_tool")],
    telemetry: { elapsedMs: 9_000 },
    messageId: `a-${text}`,
  };
}

function ask(question: string, candidates: string[], index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: null,
    tools: [tool("ask_user", { question, candidates })],
  };
}

const GREETING: AgentTurn = {
  role: "agent",
  turnIndex: -1,
  finalAnswer: "你好。以后有什么事，直接在这里跟我说就行。",
  tools: [],
  greeting: true,
  messageId: "a-greeting",
};

/** The greeting, a one-step answer and a two-step one. */
function conversation(): Turn[] {
  return [
    GREETING,
    { role: "user", content: "早，天气怎么样？", messageId: "u-1" },
    answer("多云，记得带伞。", 1),
    { role: "user", content: "帮我排个行程", messageId: "u-2" },
    step("我先查一下船票。", 1),
    answer("排好了。", 2),
  ];
}

function render(props: Partial<ComponentProps<typeof MainView>>): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <MainView
          turns={conversation()}
          llmDisplayName="model"
          activeSessionId="s-1"
          {...props}
        />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

const CORNER_CLOCK = `aria-label="${zhCopy.conversation.runWorking}`;

describe("the main chat is the assistant's conversation", () => {
  it("draws the main chat as the assistant's and every other conversation (a subtask, the external runtime) as before", () => {
    // The process button: a <button> chip (the fold header is a div
    // with the same words).
    const PROCESS = `<button type="button" aria-label="${zhCopy.conversation.foldExpand}"`;
    const main = render({ isMainChat: true });
    expect(main).toContain('data-role="assistant-bubble"');
    expect(main).toContain("ml-auto max-w-[min(80%,560px)]");
    expect(count(main, PROCESS)).toBe(1);
    const other = render({ isMainChat: false });
    expect(other).not.toContain('data-role="assistant-bubble"');
    expect(other).not.toContain("max-w-[min(80%,560px)]");
    expect(other).not.toContain(PROCESS);
    expect(other).toContain('data-role="run-fold"');
  });

  it("stacks a short conversation up from the composer (贴底)", () => {
    const main = render({ isMainChat: true, turns: [GREETING] });
    expect(main).toContain("overflow-y-auto px-8 py-6 flex flex-col");
    expect(main).toContain("mt-auto w-full");
    const other = render({ isMainChat: false, turns: [GREETING] });
    expect(other).not.toContain("flex flex-col");
    expect(other).not.toContain("mt-auto w-full");
  });

  it("asks as a plain left bubble with the candidates under it", () => {
    const turns: Turn[] = [
      ...conversation(),
      { role: "user", content: "顺便订船票", messageId: "u-3" },
      ask("订哪一班？", ["8:30", "9:00", "9:30"], 1),
    ];
    const pendingAskUser = {
      question: "订哪一班？",
      candidates: ["8:30", "9:00", "9:30"],
    };
    const html = render({ isMainChat: true, turns, pendingAskUser });
    expect(html).not.toContain(zhCopy.conversation.waitingForYou);
    expect(html).not.toContain("border-warning bg-warning");
    const bubble = html.indexOf('data-role="ask-user-bubble"');
    const inner = html.indexOf('data-role="assistant-bubble"', bubble);
    const question = html.indexOf("订哪一班？", bubble);
    expect(inner).toBeGreaterThan(bubble);
    expect(question).toBeGreaterThan(inner);
    expect(html.indexOf("8:30", question)).toBeGreaterThan(question);
    // Elsewhere: the warning bar and 「等你回复」.
    const other = render({ isMainChat: false, turns, pendingAskUser });
    expect(other).toContain(zhCopy.conversation.waitingForYou);
  });
});

describe("the assistant's live line", () => {
  const sent: Turn[] = [
    ...conversation(),
    { role: "user", content: "顺便看看船票", messageId: "u-3" },
  ];

  it("while it runs, shows only one line: the latest sentence, no steps, no streaming prose", () => {
    const turns: Turn[] = [...sent, step("我先查一下周六的船班。", 1)];
    const html = render({ isMainChat: true, isRunning: true, turns });
    expect(count(html, 'data-role="assistant-live-line"')).toBe(1);
    const line = html.indexOf('data-role="assistant-live-line"');
    expect(html.slice(line, line + 400)).toContain("我先查一下周六的船班。");
    expect(html).not.toContain('data-role="step-marker"');
    expect(html).not.toContain("streaming-prose");
    // Elsewhere: the live window and the in-flight row.
    const other = render({ isMainChat: false, isRunning: true, turns });
    expect(other).toContain('data-role="step-marker"');
    expect(other).not.toContain('data-role="assistant-live-line"');
  });

  it("writes 「思考中」 before any sentence, and goes once the round has its answer or asks", () => {
    const thinking = render({ isMainChat: true, isRunning: true, turns: sent });
    const line = thinking.indexOf('data-role="assistant-live-line"');
    expect(thinking.slice(line, line + 400)).toContain("思考中");
    // The answer landed before the run closed: the line goes.
    const answered = render({
      isMainChat: true,
      isRunning: true,
      turns: [...sent, answer("还有票。", 1)],
    });
    expect(answered).not.toContain('data-role="assistant-live-line"');
    // Asking: it waits, it is not busy.
    const asking = render({
      isMainChat: true,
      turns: [...sent, ask("订哪一班？", ["8:30"], 1)],
      pendingAskUser: { question: "订哪一班？", candidates: ["8:30"] },
    });
    expect(asking).not.toContain('data-role="assistant-live-line"');
    expect(asking).toContain('data-role="ask-user-bubble"');
  });

  it("carries the round's clock past 3 seconds, and the corner clock is not shown", () => {
    live.slice = { currentRunStartedAtMs: Date.now() - 14_000 };
    const html = render({ isMainChat: true, isRunning: true, turns: sent });
    const line = html.indexOf('data-role="assistant-live-line"');
    expect(html.slice(line, line + 600)).toContain("· 14 秒");
    expect(html).not.toContain(CORNER_CLOCK);
    // Elsewhere the corner clock stays.
    const other = render({ isMainChat: false, isRunning: true, turns: sent });
    expect(other).toContain(CORNER_CLOCK);
  });

  it("shows no clock in its first 3 seconds", () => {
    const line = (startedAgoMs: number) =>
      renderToStaticMarkup(
        <AssistantLiveLine
          sentence="我先查一下。"
          startedAtMs={Date.now() - startedAgoMs}
          baseMs={0}
        />,
      );
    expect(line(10_400)).toContain("· 10 秒");
    expect(line(1_000)).not.toContain("·");
  });
});

describe("the main chat's composer", () => {
  const ONE_LINE = 'data-role="composer-one-line"';
  const CARD = "relative rounded-md border border-line bg-elevated px-3.5";
  const HINT_ROW = '<div class="mt-1.5 text-[11px] text-ink-muted">';
  const QUEUE_HEADING = 'data-role="composer-queue-heading"';

  afterEach(() => {
    dropComposerDraft("s-1");
  });

  /** The two the stopping sentence needs: the session, one queued message. */
  function queueOne() {
    useSessionsStore.setState({ activeSessionId: "s-1" });
    useQueueStore.setState({
      bySession: {
        "s-1": [
          {
            queueId: "q-1",
            text: "顺便看看周六的船票",
            queuedAt: "2026-10-15T08:00:00.000Z",
          },
        ],
      },
    });
  }

  it("is one line in the main chat, the card in every other conversation (a subtask, the external runtime)", () => {
    for (const state of [
      {},
      { isRunning: true },
      { pendingAskUser: { question: "订哪一班？", candidates: ["8:30"] } },
    ]) {
      const main = render({ isMainChat: true, ...state });
      expect(main).toContain(ONE_LINE);
      expect(main).not.toContain(CARD);
      const other = render({ isMainChat: false, ...state });
      expect(other).toContain(CARD);
      expect(other).not.toContain(ONE_LINE);
    }
  });

  it("has no hint row in the main chat; every other conversation keeps it", () => {
    const main = render({ isMainChat: true });
    expect(main).not.toContain(HINT_ROW);
    expect(main).not.toContain(zhCopy.composer.dragToReferenceHint);
    const other = render({ isMainChat: false });
    expect(other).toContain(
      `${HINT_ROW}${zhCopy.composer.dragToReferenceHint}`,
    );
  });

  it("sits 24px off the window's bottom edge in the main chat, 16 elsewhere (ruling 72)", () => {
    expect(render({ isMainChat: true })).toContain(
      '<div class="bg-app px-8 pb-6">',
    );
    const other = render({ isMainChat: false });
    expect(other).toContain('<div class="bg-app px-8 pb-4">');
    expect(other).not.toContain("pb-6");
  });

  it("says 「发消息…」 at rest and while it works (no /btw), and 「回复上方提问」 while it asks", () => {
    const rest = render({ isMainChat: true });
    expect(rest).toContain(`placeholder="${zhCopy.composer.writeMessage}"`);
    const running = render({ isMainChat: true, isRunning: true });
    expect(running).toContain(`placeholder="${zhCopy.composer.writeMessage}"`);
    expect(running).not.toContain("/btw");
    const asking = render({
      isMainChat: true,
      pendingAskUser: { question: "订哪一班？", candidates: [] },
    });
    expect(asking).toContain(`placeholder="${zhCopy.composer.replyOpen}"`);
  });

  it("says 「正在停止，排队的消息会自动发出」 in the queue strip's heading while a stop waits on queued messages", () => {
    queueOne();
    const stopping = render({
      isMainChat: true,
      isRunning: true,
      isStopping: true,
    });
    const heading = stopping.indexOf(QUEUE_HEADING);
    expect(heading).toBeGreaterThan(-1);
    expect(stopping.slice(heading, heading + 200)).toContain(
      zhCopy.composer.stoppingQueueHint,
    );
    expect(heading).toBeLessThan(stopping.indexOf(ONE_LINE));
    expect(stopping).not.toContain(HINT_ROW);
    // Still working, not stopping: the count, as before.
    const running = render({ isMainChat: true, isRunning: true });
    expect(running).not.toContain(zhCopy.composer.stoppingQueueHint);
    expect(running).toContain(zhCopy.composer.queueStripLabel(1));
    // Every other conversation says it in the hint row, as before.
    const other = render({
      isMainChat: false,
      isRunning: true,
      isStopping: true,
    });
    expect(other).toContain(`${HINT_ROW}${zhCopy.composer.stoppingQueueHint}`);
    expect(other).not.toContain(QUEUE_HEADING);
  });

  it("queues a send while it works, as every session does (ruling 71: no 排队 / 开新对话 choice)", () => {
    // A typed draft (the Composer seeds from the parked one). Enter's
    // own path is in Composer.test.tsx; the main chat has no hint row
    // to teach it, every other conversation's says 「Enter 排队」.
    saveComposerDraft("s-1", { text: "顺便查下周五的天气", images: [] });
    const QUEUE_HINT = `<span class="font-mono text-ink-soft">Enter</span>${zhCopy.composer.queueEnterHint.slice("Enter".length)}`;
    const main = render({ isMainChat: true, isRunning: true });
    expect(main).toContain("顺便查下周五的天气");
    expect(main).not.toContain(QUEUE_HINT);
    expect(main).not.toContain("main-chat-busy-choice");
    expect(main).not.toContain("开新对话");
    const other = render({ isMainChat: false, isRunning: true });
    expect(other).toContain(QUEUE_HINT);
  });
});

describe("the composer trial is gone", () => {
  const SRC = path.resolve(__dirname, "../..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
    });
  }

  it("leaves no switcher, demo, storage key or trial prop behind", () => {
    const self = path.resolve(__filename);
    const leftovers = [
      "galley.tmp.composerTrial",
      "composer-trial",
      "ComposerTrialSwitcher",
      "ComposerDemoInert",
      "useComposerTrialOverrides",
      "composerTrial",
      "ComposerTrialView",
      "demoQueue",
      "trial?.",
      "ticket 24",
      "票 24",
    ];
    const hits = sources(SRC)
      .filter((file) => file !== self && !file.includes("zz-harness"))
      .flatMap((file) => {
        const text = readFileSync(file, "utf8");
        return leftovers
          .filter((needle) => text.includes(needle))
          .map((needle) => `${path.relative(SRC, file)}: ${needle}`);
      });
    expect(hits).toEqual([]);
  });
});
