import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeSession } from "@/test/factories";
import type { PendingAskUser, Turn } from "@/types/conversation";
import type { Session } from "@/types/session";

/**
 * The glue of ruling 102: which stores feed `subtaskQuestionHolder` for
 * the session open in the main area. Static rendering reads a zustand
 * store's initial state, so the three stores are swapped for plain
 * state objects seeded per test (as SubtaskCards.test.tsx does); the
 * rule itself is pinned in lib/subtasks.test.ts.
 */

const state = vi.hoisted(() => ({
  sessions: [] as Session[],
  messages: {} as Record<string, unknown>,
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
  EMPTY_TURNS: [],
  useMessagesStore: fakeStore(() => ({ byId: state.messages })),
}));
vi.mock("@/stores/subtasks", () => ({
  useSubtasksStore: fakeStore(() => ({ askInCard: state.askInCard })),
}));

import { useSubtaskQuestionHolder } from "./useSubtaskQuestionHolder";

function Probe({ id }: { id: string | undefined }) {
  return <>{useSubtaskQuestionHolder(id)}</>;
}

function holder(id: string | undefined = "s-sub"): string {
  return renderToStaticMarkup(<Probe id={id} />);
}

const asked: PendingAskUser = { question: "按什么分类？", candidates: [] };

const subTurns: Turn[] = [
  {
    role: "user",
    content: "整理下载文件夹",
    createdAt: "2026-10-19T03:19:12Z",
  },
];

const mainTurns: Turn[] = [
  {
    role: "user",
    content: "[Galley — not a message from the user] …",
    createdAt: "2026-10-19T03:19:18Z",
    origin: { via: "system", supervisor: "galley-report", reason: "s-sub" },
  },
  {
    role: "agent",
    finalAnswer: null,
    tools: [
      {
        id: "t",
        name: "ask_user",
        status: "success-historical",
        args: { question: asked.question, candidates: [] },
      },
    ],
  },
];

beforeEach(() => {
  state.sessions = [
    makeSession({ id: "s-main", mainChat: true, gaRuntimeKind: "managed" }),
    makeSession({
      id: "s-sub",
      parentSessionId: "s-main",
      gaRuntimeKind: "managed",
    }),
  ];
  state.messages = {
    "s-sub": { pendingAskUser: asked, turns: subTurns },
    "s-main": {
      turns: mainTurns,
      agentRunning: false,
      pendingAskUser: asked,
    },
  };
  state.askInCard = {};
});

describe("the open subtask's question holder (ruling 102)", () => {
  it("reads the subtask and its main chat: Galley asked", () => {
    expect(holder()).toBe("galleyAsked");
  });

  it("reads the card's word from the subtasks store", () => {
    state.askInCard = { "s-sub": asked };
    expect(holder()).toBe("card");
  });

  it("leaves it to the subtask when the main chat's turns are not loaded (a reload)", () => {
    state.messages = {
      "s-sub": { pendingAskUser: asked, turns: subTurns },
    };
    expect(holder()).toBe("subtask");
  });

  it("is none for a promoted subtask, any other session, and no session", () => {
    state.sessions = state.sessions.map((s) =>
      s.id === "s-sub" ? { ...s, promoted: true } : s,
    );
    expect(holder()).toBe("none");
    expect(holder("s-main")).toBe("none");
    expect(holder(undefined)).toBe("none");
  });
});
