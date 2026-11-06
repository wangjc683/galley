// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildAgentTurn, interimTurn } from "@/lib/agent-turn";
import { LocalFilesContext } from "@/lib/local-files";
import type { AgentTurn, Turn, UserTurn } from "@/types/conversation";

import { Conversation } from "./Conversation";

/**
 * A line told mid-run keeps its row while the round goes on (main chat
 * tickets 137, 149, 151). The step that said it lands after it, and
 * before it in the turns (stores/messages.ts `withLandedStep`: the
 * restored order); while it runs that step draws nothing, so had the
 * line's row been keyed by its place, the row would be drawn anew — its
 * growth (ticket 149) and its landing bounce (ticket 151) cut off, the
 * words just there. Found by the dev window's probe: a `tell_user` whose
 * step ended in the same second.
 */

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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

const you: UserTurn = {
  role: "user",
  content: "帮我查明天的天气",
  messageId: "msg_s_1_user",
};

/** The step that called `tell_user`, landed. */
function step(index: number): AgentTurn {
  const turn = buildAgentTurn({
    tools: [
      { id: `t-${index}`, name: "tell_user", status: "success-historical" },
    ],
    finalAnswer: null,
    turnIndex: index,
  });
  turn.messageId = `msg_s_${index}`;
  return turn;
}

/** What it told you in step `index`. */
function told(index: number, words: string): AgentTurn {
  const turn = interimTurn(words, index);
  turn.messageId = `msg_s_${index}_tell_1`;
  return turn;
}

function draw(turns: Turn[], assistant: boolean) {
  const tree = (
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        <Conversation turns={turns} agentRunning assistant={assistant} />
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

const rowOf = (id: string) =>
  host!.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null;

describe("a line told mid-run, in the main chat", () => {
  it("stays the same row when the step that said it lands before it", () => {
    const line = told(2, "记上了，天气还在查。");
    draw([you, line], true);
    const drawn = rowOf(line.messageId!);
    expect(drawn).not.toBeNull();
    const bubble = drawn!.querySelector('[data-role="assistant-bubble"]');
    // Its step lands before it, as the store puts it.
    draw([you, step(2), line], true);
    expect(rowOf(line.messageId!)).toBe(drawn);
    expect(drawn!.isConnected).toBe(true);
    expect(drawn!.querySelector('[data-role="assistant-bubble"]')).toBe(bubble);
  });

  it("stays the same row as the next line lands, and that one as its own step does", () => {
    const first = told(2, "记上了，天气还在查。");
    const next = told(3, "还要大约一分钟。");
    draw([you, step(2), first], true);
    const drawn = rowOf(first.messageId!);
    draw([you, step(2), first, next], true);
    const drawnNext = rowOf(next.messageId!);
    draw([you, step(2), first, step(3), next], true);
    expect(rowOf(first.messageId!)).toBe(drawn);
    expect(rowOf(next.messageId!)).toBe(drawnNext);
  });
});
