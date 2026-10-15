import * as Tooltip from "@radix-ui/react-tooltip";
import {
  isValidElement,
  type ComponentProps,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Composer,
  type ComposerProps,
} from "@/components/conversation/Composer";
import { MainView } from "@/components/screens/MainView";
import { zhCopy } from "@/i18n/locales/zh";
import { LocalFilesContext } from "@/lib/local-files";
import { useQueueStore } from "@/stores/queue";
import { useSessionsStore } from "@/stores/sessions";
import type { AgentTurn, Turn } from "@/types/conversation";

import {
  composerTrialFor,
  demoQueue,
  useComposerTrialOverrides,
  useComposerTrialStore,
  type ComposerTrialChoice,
} from "./composer-trial";

/**
 * TEMPORARY — ticket 24's trial tests (see composer-trial.ts). The
 * winner's cases move into the components' own tests with the final
 * ticket; this file goes with the trial.
 *
 * A static render reads a zustand store's initial state; the queue strip
 * needs the session and its queue, so these two stores read their live
 * state here.
 */
vi.mock("@/stores/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/queue")>();
  const store = actual.useQueueStore;
  const live = Object.assign(
    (select?: (state: ReturnType<typeof store.getState>) => unknown) =>
      select ? select(store.getState()) : store.getState(),
    store,
  );
  return { ...actual, useQueueStore: live };
});
vi.mock("@/stores/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/sessions")>();
  const store = actual.useSessionsStore;
  const live = Object.assign(
    (select?: (state: ReturnType<typeof store.getState>) => unknown) =>
      select ? select(store.getState()) : store.getState(),
    store,
  );
  return { ...actual, useSessionsStore: live };
});

afterEach(() => {
  useSessionsStore.setState({ activeSessionId: undefined });
  useQueueStore.setState({ bySession: {} });
});

const LINE: ComposerTrialChoice = { shape: "line", demoRunning: false };
const CURRENT: ComposerTrialChoice = { shape: "current", demoRunning: false };

const ADD = `aria-label="${zhCopy.composer.addMenuTooltip}"`;
const MODEL = `aria-label="${zhCopy.composer.switchLlm}"`;
const SEND = `aria-label="${zhCopy.composer.send}"`;
const STOP = `aria-label="${zhCopy.composer.stop}"`;
const ONE_LINE = 'data-role="composer-one-line"';
const CARD = "relative rounded-md border border-line bg-elevated px-3.5";
const HINT_ROW = '<div class="mt-1.5 text-[11px] text-ink-muted">';

function answer(text: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: text,
    tools: [
      { id: `t-${index}`, name: "no_tool", status: "success-historical" },
    ],
    telemetry: { elapsedMs: 9_000 },
    messageId: `a-${index}`,
  };
}

function conversation(): Turn[] {
  return [
    { role: "user", content: "早，天气怎么样？", messageId: "u-1" },
    answer("多云，记得带伞。", 1),
  ];
}

const EFFORT = {
  effective: null,
  configured: null,
  override: null,
  onSelect: () => {},
};

function view(props: Partial<ComponentProps<typeof MainView>>): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <MainView
          turns={conversation()}
          llmDisplayName="gpt-6.1-sol"
          activeSessionId="s-1"
          llms={[{ index: 0, displayName: "gpt-6.1-sol", isCurrent: true }]}
          reasoningEffort={EFFORT}
          {...props}
        />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

/** The one-line box's markup (up to the end of the html). */
function lineBox(html: string): string {
  const at = html.indexOf(ONE_LINE);
  expect(at, "the one-line box").toBeGreaterThan(-1);
  return html.slice(at);
}

describe("the composer trial only reaches the main chat", () => {
  it("leaves every other conversation (an ordinary one, a subtask) byte for byte as without it, in every choice", () => {
    const choices: ComposerTrialChoice[] = [
      LINE,
      CURRENT,
      { shape: "line", demoRunning: true },
      { shape: "current", demoRunning: true },
    ];
    for (const state of [
      {},
      { isRunning: true },
      {
        pendingAskUser: { question: "订哪一班？", candidates: ["8:30"] },
      },
    ]) {
      const today = view({ isMainChat: false, ...state });
      for (const composerTrial of choices) {
        expect(view({ isMainChat: false, composerTrial, ...state })).toBe(
          today,
        );
      }
    }
  });

  it("App hands MainView the choice only while the main chat is open", () => {
    expect(composerTrialFor(LINE, { mainChatOpen: true })).toBe(LINE);
    expect(composerTrialFor(LINE, { mainChatOpen: false })).toBeUndefined();
  });

  it("starts on 一行式 with the demo off", () => {
    const { shape, demoRunning } = useComposerTrialStore.getState();
    expect(shape).toBe("line");
    expect(demoRunning).toBe(false);
  });

  it("现状 with the demo off sets nothing: the main chat's card renders as without the trial", () => {
    expect(view({ isMainChat: true, composerTrial: CURRENT })).toBe(
      view({ isMainChat: true }),
    );
  });
});

describe("一行式", () => {
  it("draws one row: ＋, the input, 「模型 · 强度」, send — and no hint row", () => {
    const html = view({ isMainChat: true, composerTrial: LINE });
    expect(html).not.toContain(CARD);
    expect(html).not.toContain(HINT_ROW);
    expect(html).not.toContain(zhCopy.composer.dragToReferenceHint);
    const box = lineBox(html);
    const order = [
      ADD,
      "<textarea",
      MODEL,
      zhCopy.composer.reasoningEffort.default,
      SEND,
    ].map((needle) => box.indexOf(needle));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // One line high, eight at most.
    expect(box).toContain('rows="1"');
    expect(box).toContain("7 * 1.55 * var(--conversation-composer-size)");
  });

  it("says 「发消息…」, and 「回复上方提问」 while it asks", () => {
    const rest = view({ isMainChat: true, composerTrial: LINE });
    expect(rest).toContain(`placeholder="${zhCopy.composer.writeMessage}"`);
    const running = view({
      isMainChat: true,
      composerTrial: LINE,
      isRunning: true,
    });
    expect(running).toContain(`placeholder="${zhCopy.composer.writeMessage}"`);
    expect(running).not.toContain("/btw");
    const asking = view({
      isMainChat: true,
      composerTrial: LINE,
      pendingAskUser: { question: "订哪一班？", candidates: [] },
    });
    expect(asking).toContain(`placeholder="${zhCopy.composer.replyOpen}"`);
  });

  it("says 「正在停止，排队的消息会自动发出」 in the queue strip's heading while a stop waits on queued messages", () => {
    useSessionsStore.setState({ activeSessionId: "s-1" });
    useQueueStore.setState({
      bySession: { "s-1": demoQueue("zh-CN").slice(0, 1) },
    });
    const stopping = view({
      isMainChat: true,
      composerTrial: LINE,
      isRunning: true,
      isStopping: true,
    });
    const heading = stopping.indexOf('data-role="composer-queue-heading"');
    expect(heading).toBeGreaterThan(-1);
    expect(stopping.slice(heading, heading + 200)).toContain(
      zhCopy.composer.stoppingQueueHint,
    );
    expect(stopping).not.toContain(HINT_ROW);
    expect(heading).toBeLessThan(stopping.indexOf(ONE_LINE));
    // Still working, not stopping: the count, as before.
    const running = view({
      isMainChat: true,
      composerTrial: LINE,
      isRunning: true,
    });
    expect(running).not.toContain(zhCopy.composer.stoppingQueueHint);
    expect(running).toContain(zhCopy.composer.queueStripLabel(1));
  });
});

describe("现状", () => {
  it("keeps today's card and its hint row, with the new placeholder", () => {
    const html = view({ isMainChat: true, composerTrial: CURRENT });
    expect(html).toContain(CARD);
    expect(html).not.toContain(ONE_LINE);
    expect(html).toContain(`${HINT_ROW}${zhCopy.composer.dragToReferenceHint}`);
    expect(html).toContain(`placeholder="${zhCopy.composer.writeMessage}"`);
    // Stopping with a queue: the hint row says it, as before.
    useSessionsStore.setState({ activeSessionId: "s-1" });
    useQueueStore.setState({
      bySession: { "s-1": demoQueue("zh-CN").slice(0, 1) },
    });
    const stopping = view({
      isMainChat: true,
      composerTrial: CURRENT,
      isRunning: true,
      isStopping: true,
    });
    expect(stopping).toContain(
      `${HINT_ROW}${zhCopy.composer.stoppingQueueHint}`,
    );
    expect(stopping).not.toContain('data-role="composer-queue-heading"');
  });
});

describe("演示在跑", () => {
  it("draws the composer as if it worked — Stop, two queued messages — in either form, and nothing goes out", () => {
    useSessionsStore.setState({ activeSessionId: "s-1" });
    for (const shape of ["line", "current"] as const) {
      const html = view({
        isMainChat: true,
        composerTrial: { shape, demoRunning: true },
      });
      expect(html).toContain(STOP);
      expect(html).not.toContain(SEND);
      const demo = html.indexOf('data-role="composer-trial-demo"');
      expect(demo).toBeGreaterThan(-1);
      for (const item of demoQueue("zh-CN")) {
        expect(html.indexOf(item.text)).toBeGreaterThan(demo);
      }
      expect(html).toContain(zhCopy.composer.queueStripLabel(2));
    }
  });

  it("keeps Stop and Enter from doing anything", () => {
    let overrides: Partial<ComposerProps> = {};
    function Probe() {
      overrides = useComposerTrialOverrides({
        shape: "line",
        demoRunning: true,
      });
      return null;
    }
    renderToStaticMarkup(<Probe />);
    expect(overrides.stopMode).toBe(true);
    expect(overrides.onSubmit?.("一句话", [])).toBe(false);
    expect(overrides.onStop?.()).toBeUndefined();
  });
});

// ---- Enter (the Composer's own render function, as in Composer.test.tsx)

type ComposerRender = (props: ComposerProps, ref: null) => ReactNode;

/** Every element in a tree, props included (the one-line form gets its
 * pieces as props). */
function elements(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
  } else if (isValidElement(node)) {
    out.push(node);
    for (const value of Object.values(node.props as Record<string, unknown>)) {
      elements(value, out);
    }
  }
  return out;
}

function composerTree(props: Partial<ComposerProps>): ReactElement[] {
  const render = (Composer as unknown as { render: ComposerRender }).render;
  let tree: ReactNode = null;
  function Probe() {
    tree = render({ llmDisplayName: "gpt-6.1-sol", ...props }, null);
    return tree;
  }
  renderToStaticMarkup(
    <Tooltip.Provider>
      <Probe />
    </Tooltip.Provider>,
  );
  return elements(tree);
}

describe("in the one-line form", () => {
  it("Enter mid-run hands the draft to the send, which queues it: no choice in between", () => {
    const onSubmit = vi.fn();
    const textarea = composerTree({
      value: "顺便查下周五的天气",
      onChange: () => {},
      onSubmit,
      stopMode: true,
      trial: { oneLine: true },
    }).find((element) => element.type === "textarea");
    (
      textarea!.props as {
        onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
      }
    ).onKeyDown({
      key: "Enter",
      shiftKey: false,
      preventDefault: () => {},
      nativeEvent: { isComposing: false, keyCode: 13 },
    } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    expect(onSubmit).toHaveBeenCalledWith("顺便查下周五的天气", []);
  });

  it("opens the model phrase's popovers right-aligned (the card keeps them left)", () => {
    const aligns = (oneLine: boolean) =>
      composerTree({
        llms: [{ index: 0, displayName: "gpt-6.1-sol", isCurrent: true }],
        reasoningEffort: EFFORT,
        trial: oneLine ? { oneLine: true } : undefined,
      })
        .filter((element) =>
          ["LLMPill", "EffortPill"].includes(
            (element.type as { name?: string }).name ?? "",
          ),
        )
        .map(
          (element) =>
            (element.props as { popoverAlign?: string }).popoverAlign,
        );
    expect(aligns(true)).toEqual(["end", "end"]);
    expect(aligns(false)).toEqual([undefined, undefined]);
  });
});
