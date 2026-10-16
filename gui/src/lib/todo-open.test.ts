import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoItem } from "@/lib/assistant-todo";
import { useUiStore } from "@/stores/ui";

import {
  goToTodoTarget,
  mainChatOnScreen,
  openTodoPanel,
  quoteForComposer,
  quoteTodo,
  toggleTodoPanel,
} from "./todo-open";

/**
 * The to-do panel's ways in and out (main chat tickets 42, 45): ⌘K
 * lands on Galley with the panel open; the top bar's button, there only
 * beside the main chat, flips it in place; a title jumps in the main
 * chat beside it or opens a session; 「说说这件」 quotes the title into
 * the main chat's composer and nothing else's.
 */

const openMainChat = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/main-chat", () => ({ openMainChat }));

afterEach(() => {
  openMainChat.mockClear();
  useUiStore.setState({
    todoPanelOpen: false,
    quoteRequest: null,
    locateRequest: null,
  });
});

const ITEM: TodoItem = {
  kind: "todo",
  id: "todo_1",
  text: "交季度报告",
  state: "open",
  createdBy: "assistant",
};

describe("opening the panel", () => {
  it("lands on Galley with the panel wanted, from anywhere", () => {
    openTodoPanel();
    expect(useUiStore.getState().todoPanelOpen).toBe(true);
    expect(openMainChat).toHaveBeenCalledTimes(1);
  });

  it("the top bar's button: opens and closes in place, never lands", () => {
    toggleTodoPanel(false);
    expect(useUiStore.getState().todoPanelOpen).toBe(true);
    toggleTodoPanel(true);
    expect(useUiStore.getState().todoPanelOpen).toBe(false);
    // It is only ever beside the main chat itself.
    expect(openMainChat).not.toHaveBeenCalled();
  });
});

describe("where the button and the panel are (ticket 45)", () => {
  const main = { mainChat: true };
  const subtask = { mainChat: false };
  const workbench = {};

  it("only with the main chat itself in the main area", () => {
    expect(mainChatOnScreen("main", main)).toBe(true);
    // Ruling 87's 「开着」: its subtask is not it.
    expect(mainChatOnScreen("main", subtask)).toBe(false);
    expect(mainChatOnScreen("main", workbench)).toBe(false);
    // The empty composer, onboarding, nothing open.
    expect(mainChatOnScreen("empty", main)).toBe(false);
    expect(mainChatOnScreen("onboarding", main)).toBe(false);
    expect(mainChatOnScreen("main", undefined)).toBe(false);
  });

  it("left open, the panel folds away elsewhere and is back with Galley", () => {
    toggleTodoPanel(false);
    const shown = (session: { mainChat?: boolean }) =>
      useUiStore.getState().todoPanelOpen && mainChatOnScreen("main", session);
    expect(shown(main)).toBe(true);
    expect(shown(workbench)).toBe(false);
    expect(shown(subtask)).toBe(false);
    // Nothing closed it on the way: it is open again beside Galley.
    expect(shown(main)).toBe(true);
  });
});

describe("a title", () => {
  it("jumps to the reply in place: the 查找聊天记录 locate, the panel kept", () => {
    const openSession = vi.fn();
    useUiStore.setState({ todoPanelOpen: true });
    goToTodoTarget(
      {
        kind: "reply",
        sessionId: "s-main",
        messageId: "msg_s-main_4_assistant",
      },
      openSession,
    );
    expect(useUiStore.getState().locateRequest).toMatchObject({
      sessionId: "s-main",
      messageId: "msg_s-main_4_assistant",
    });
    expect(openSession).not.toHaveBeenCalled();
    expect(useUiStore.getState().todoPanelOpen).toBe(true);
  });

  it("opens a subtask, or a scheduled run's session", () => {
    const openSession = vi.fn();
    goToTodoTarget({ kind: "subtask", sessionId: "s-sub" }, openSession);
    goToTodoTarget({ kind: "session", sessionId: "s-run" }, openSession);
    expect(openSession.mock.calls).toEqual([["s-sub"], ["s-run"]]);
    expect(useUiStore.getState().locateRequest).toBeNull();
  });
});

describe("「说说这件」", () => {
  it("quotes the title into the main chat's composer, and only there", () => {
    quoteTodo("s-main", ITEM);
    const request = useUiStore.getState().quoteRequest;
    expect(request).toMatchObject({ sessionId: "s-main", text: "交季度报告" });
    expect(quoteForComposer(request, null, "s-main", true)).toBe("交季度报告");
    // Another conversation's composer, or the same request again: no.
    expect(quoteForComposer(request, null, "s-other", true)).toBeNull();
    expect(quoteForComposer(request, null, "s-main", false)).toBeNull();
    expect(quoteForComposer(request, request, "s-main", true)).toBeNull();
    expect(quoteForComposer(null, request, "s-main", true)).toBeNull();
    // A second click quotes again (the composer drops a duplicate).
    quoteTodo("s-main", ITEM);
    const again = useUiStore.getState().quoteRequest;
    expect(again).not.toBe(request);
    expect(quoteForComposer(again, request, "s-main", true)).toBe("交季度报告");
  });
});
