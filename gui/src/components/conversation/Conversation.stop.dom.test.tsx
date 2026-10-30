// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { LocalFilesContext } from "@/lib/local-files";
import type { AgentTurn, Turn, UserTurn } from "@/types/conversation";

import { Conversation } from "./Conversation";

/**
 * The stop of a workbench run (workbench conversation PRD ruling 9,
 * ticket 04): only the in-flight row goes (MainView's), and with it the
 * header's words change, 「已完成 N 步」 to 「中途停下 · N 步」. The header,
 * an open card and the last step stay the same nodes. Where the
 * in-flight row stood, a gap sweeps shut, on the stop you watch only.
 */

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // The fold header measures its tool scent (RunFoldHeader).
  if (typeof globalThis.ResizeObserver === "undefined") {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function user(content: string): UserTurn {
  return { role: "user", content, messageId: `u-${content}` };
}

function did(narration: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: narration,
    summary: narration,
    tools: [
      { id: `t-${index}`, name: "web_scan", status: "success-historical" },
    ],
    messageId: `a-${index}`,
  };
}

const TURNS: Turn[] = [
  user("把这一周的船票都查一遍"),
  did("我查第 1 天的船班。", 1),
  did("我查第 2 天的船班。", 2),
  did("我查第 3 天的船班。", 3),
  did("我查第 4 天的船班。", 4),
];

function draw(turns: Turn[], agentRunning: boolean) {
  const tree = (
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <Conversation turns={turns} agentRunning={agentRunning} />
      </LocalFilesContext.Provider>
    </Tooltip.Provider>
  );
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => root!.render(tree));
}

const header = () => host!.querySelector<HTMLElement>('[data-role="run-fold"]');
const marker = () =>
  host!.querySelector<HTMLElement>('[data-role="step-marker"]');
const card = () =>
  host!.querySelector<HTMLElement>('[data-role="process-card"]');
/** The closing gap where the in-flight row stood (Conversation's
 * SettleGap). */
const gap = () =>
  host!.querySelector<HTMLElement>(
    'div[aria-hidden][class*="1.6+var(--conversation-block-gap))"]',
  );

describe("the stop of a workbench run", () => {
  it("keeps the header, its open card and the last step: only the header's words change", () => {
    draw(TURNS, true);
    const liveHeader = header()!;
    const liveMarker = marker()!;
    expect(liveHeader.textContent).toContain(
      zhCopy.conversation.foldStepsLive(4),
    );
    // Opened while it runs.
    act(() => liveHeader.click());
    const liveCard = card()!;
    expect(liveCard).not.toBeNull();
    expect(gap()).toBeNull();

    draw(TURNS, false);
    expect(header()).toBe(liveHeader);
    expect(header()!.textContent).toContain(
      `${zhCopy.conversation.stoppedPartway} · ${zhCopy.conversation.foldSteps(4)}`,
    );
    expect(header()!.getAttribute("aria-expanded")).toBe("true");
    expect(card()).toBe(liveCard);
    expect(marker()).toBe(liveMarker);
    expect(host!.querySelectorAll('[data-role="step-marker"]')).toHaveLength(1);
    // The in-flight row's place closes under the last step.
    expect(gap()).not.toBeNull();
  });

  it("keeps a run stopped after one step as that step, no header", () => {
    const one = TURNS.slice(0, 2);
    draw(one, true);
    const liveMarker = marker()!;
    draw(one, false);
    expect(marker()).toBe(liveMarker);
    expect(header()).toBeNull();
  });

  it("draws no closing gap for a run that was stopped before this page saw it", () => {
    draw(TURNS, false);
    expect(header()!.textContent).toContain(zhCopy.conversation.stoppedPartway);
    expect(gap()).toBeNull();
  });

  it("takes the gap away once it has swept shut", async () => {
    draw(TURNS, true);
    draw(TURNS, false);
    expect(gap()).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(gap()).toBeNull();
  });
});
