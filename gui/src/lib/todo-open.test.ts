import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoItem } from "@/lib/assistant-todo";
import { useUiStore } from "@/stores/ui";

import {
  goToTodoTarget,
  openTodoPanel,
  quoteForComposer,
  quoteTodo,
  toggleTodoPanel,
} from "./todo-open";

/**
 * The to-do panel's ways in and out (main chat ticket 42): the row and
 * ⌘K land on Galley with the panel open; a title jumps in the main chat
 * beside it or opens a session; 「说说这件」 quotes the title into the
 * main chat's composer and nothing else's.
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

  it("the row: opens when the panel is not on screen, closes when it is", () => {
    // Wanted but folded away (the user is in the workbench): open, and go.
    useUiStore.setState({ todoPanelOpen: true });
    toggleTodoPanel(false);
    expect(useUiStore.getState().todoPanelOpen).toBe(true);
    expect(openMainChat).toHaveBeenCalledTimes(1);
    toggleTodoPanel(true);
    expect(useUiStore.getState().todoPanelOpen).toBe(false);
    expect(openMainChat).toHaveBeenCalledTimes(1);
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
