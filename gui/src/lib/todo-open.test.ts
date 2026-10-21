import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoItem } from "@/lib/assistant-todo";
import { useUiStore } from "@/stores/ui";

import {
  goToTodoTarget,
  mainChatOnScreen,
  openTodoPanel,
  quoteForComposer,
  quoteTodo,
  takeQuote,
  talkToGalley,
  todoPlaceOf,
  todoView,
  toggleTodoPanel,
} from "./todo-open";

/**
 * The to-do panel's ways in and out (main chat tickets 42, 45, 46): the
 * top bar's button in every conversation while there is a main chat,
 * open or closed in two places — Galley's and everything else's — each
 * remembered apart; ⌘K opens it where you are; a jump out of the panel
 * lands where it leads and takes the panel along; 「说说这件」 and
 * 「跟 Galley 说」 always end in Galley's composer.
 */

const openMainChat = vi.hoisted(() =>
  vi.fn<() => Promise<boolean>>(async () => true),
);
vi.mock("@/lib/main-chat", () => ({ openMainChat }));

const CLOSED = { galley: false, elsewhere: false } as const;

afterEach(() => {
  openMainChat.mockReset();
  openMainChat.mockImplementation(async () => true);
  useUiStore.setState({
    todoPanelOpen: CLOSED,
    quoteRequest: null,
    locateRequest: null,
  });
});

const open = () => useUiStore.getState().todoPanelOpen;

const ITEM: TodoItem = {
  kind: "todo",
  id: "todo_1",
  text: "交季度报告",
  state: "open",
  createdBy: "assistant",
};

const main = { mainChat: true };
const subtask = { mainChat: false };
const workbench = {};

describe("where the button is (ticket 46)", () => {
  it("in every conversation's top bar while there is a main chat", () => {
    expect(todoView(true, CLOSED, "main", main).entry).toBe(true);
    expect(todoView(true, CLOSED, "main", workbench).entry).toBe(true);
    expect(todoView(true, CLOSED, "main", subtask).entry).toBe(true);
    // The empty composer has the top bar too.
    expect(todoView(true, CLOSED, "empty", undefined).entry).toBe(true);
  });

  it("not without a main chat (the external runtime, or none yet), nor its panel", () => {
    const allOpen = { galley: true, elsewhere: true };
    for (const session of [main, workbench, subtask, undefined]) {
      const view = todoView(false, allOpen, "main", session);
      expect(view.entry).toBe(false);
      expect(view.shown).toBe(false);
    }
  });
});

describe("the two places", () => {
  it("Galley's is beside the main chat itself, the other one beside anything else", () => {
    expect(mainChatOnScreen("main", main)).toBe(true);
    expect(todoPlaceOf("main", main)).toBe("galley");
    // Ruling 87's 「开着」: its subtask is not it.
    expect(todoPlaceOf("main", subtask)).toBe("elsewhere");
    expect(todoPlaceOf("main", workbench)).toBe("elsewhere");
    expect(todoPlaceOf("empty", undefined)).toBe("elsewhere");
    expect(todoPlaceOf("empty", main)).toBe("elsewhere");
    expect(todoPlaceOf("main", undefined)).toBe("elsewhere");
  });

  it("each opens and closes on its own: open in Galley, closed in the workbench", () => {
    toggleTodoPanel("galley", false);
    expect(open()).toEqual({ galley: true, elsewhere: false });
    expect(todoView(true, open(), "main", main).shown).toBe(true);
    expect(todoView(true, open(), "main", workbench).shown).toBe(false);
    expect(todoView(true, open(), "main", subtask).shown).toBe(false);
    expect(todoView(true, open(), "empty", undefined).shown).toBe(false);
    // Nothing closed it on the way: it is open again beside Galley.
    expect(todoView(true, open(), "main", main).shown).toBe(true);
  });

  it("open in the workbench, back in Galley as Galley's was", () => {
    toggleTodoPanel("elsewhere", false);
    expect(open()).toEqual({ galley: false, elsewhere: true });
    expect(todoView(true, open(), "main", workbench).shown).toBe(true);
    // Subtasks and the empty composer share the workbench's place.
    expect(todoView(true, open(), "main", subtask).shown).toBe(true);
    expect(todoView(true, open(), "empty", undefined).shown).toBe(true);
    expect(todoView(true, open(), "main", main).shown).toBe(false);
    // Closing it there leaves Galley's as it is.
    useUiStore.getState().setTodoPanelOpen("galley", true);
    toggleTodoPanel("elsewhere", true);
    expect(open()).toEqual({ galley: true, elsewhere: false });
  });

  it("the button flips its own place in place, never lands", () => {
    toggleTodoPanel("elsewhere", false);
    toggleTodoPanel("elsewhere", true);
    toggleTodoPanel("galley", false);
    toggleTodoPanel("galley", true);
    expect(open()).toEqual(CLOSED);
    expect(openMainChat).not.toHaveBeenCalled();
  });

  it("⌘K opens it where you are, and only there: Galley is not entered first", () => {
    openTodoPanel("elsewhere");
    expect(open()).toEqual({ galley: false, elsewhere: true });
    // It opens; it never closes (the button toggles).
    openTodoPanel("elsewhere");
    expect(open()).toEqual({ galley: false, elsewhere: true });
    openTodoPanel("galley");
    expect(open()).toEqual({ galley: true, elsewhere: true });
    expect(openMainChat).not.toHaveBeenCalled();
  });
});

describe("a title", () => {
  const reply = {
    kind: "reply" as const,
    sessionId: "s-main",
    messageId: "msg_s-main_4_assistant",
  };

  it("beside Galley: jumps to the reply in place, the panel kept", () => {
    const openSession = vi.fn();
    useUiStore.setState({ todoPanelOpen: { galley: true, elsewhere: false } });
    goToTodoTarget(reply, "galley", "s-main", openSession);
    expect(useUiStore.getState().locateRequest).toMatchObject({
      sessionId: "s-main",
      messageId: "msg_s-main_4_assistant",
    });
    expect(openSession).not.toHaveBeenCalled();
    expect(openMainChat).not.toHaveBeenCalled();
    expect(open()).toEqual({ galley: true, elsewhere: false });
  });

  it("from elsewhere: the locate filed first, then Galley, the panel with it", () => {
    const openSession = vi.fn();
    let filedBeforeLanding: unknown = null;
    openMainChat.mockImplementation(async () => {
      filedBeforeLanding = useUiStore.getState().locateRequest;
      return true;
    });
    useUiStore.setState({ todoPanelOpen: { galley: false, elsewhere: true } });
    goToTodoTarget(reply, "elsewhere", "s-main", openSession);
    expect(openMainChat).toHaveBeenCalledTimes(1);
    expect(filedBeforeLanding).toMatchObject({
      sessionId: "s-main",
      messageId: "msg_s-main_4_assistant",
    });
    expect(openSession).not.toHaveBeenCalled();
    // Galley's place is marked open; the one left behind is untouched.
    expect(open()).toEqual({ galley: true, elsewhere: true });
  });

  it("from elsewhere with no Galley to land on: the locate does not linger", async () => {
    openMainChat.mockImplementation(async () => false);
    goToTodoTarget(reply, "elsewhere", "s-main", vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(useUiStore.getState().locateRequest).toBeNull();
  });

  it("opens a subtask or a scheduled run's session, its place marked open", () => {
    const openSession = vi.fn();
    goToTodoTarget(
      { kind: "subtask", sessionId: "s-sub" },
      "galley",
      "s-main",
      openSession,
    );
    expect(open()).toEqual({ galley: false, elsewhere: true });
    goToTodoTarget(
      { kind: "session", sessionId: "s-run" },
      "elsewhere",
      "s-main",
      openSession,
    );
    expect(openSession.mock.calls).toEqual([["s-sub"], ["s-run"]]);
    expect(useUiStore.getState().locateRequest).toBeNull();
    expect(openMainChat).not.toHaveBeenCalled();
  });

  it("a session that is the main chat itself: Galley's place", () => {
    const openSession = vi.fn();
    goToTodoTarget(
      { kind: "session", sessionId: "s-main" },
      "elsewhere",
      "s-main",
      openSession,
    );
    expect(open()).toEqual({ galley: true, elsewhere: false });
    expect(openSession).toHaveBeenCalledWith("s-main");
  });
});

describe("「说说这件」", () => {
  it("beside Galley: quotes into the main chat's composer, and only there", () => {
    quoteTodo(ITEM, "galley", "s-main");
    const request = useUiStore.getState().quoteRequest;
    expect(request).toMatchObject({ sessionId: "s-main", text: "交季度报告" });
    expect(openMainChat).not.toHaveBeenCalled();
    expect(quoteForComposer(request, "s-main", true)).toBe("交季度报告");
    // Another conversation's composer, or nothing asked: no.
    expect(quoteForComposer(request, "s-other", true)).toBeNull();
    expect(quoteForComposer(request, "s-main", false)).toBeNull();
    expect(quoteForComposer(null, "s-main", true)).toBeNull();
  });

  it("from the workbench: into Galley's composer, not the workbench's, once", () => {
    useUiStore.setState({ todoPanelOpen: { galley: false, elsewhere: true } });
    quoteTodo(ITEM, "elsewhere", "s-main");
    expect(useUiStore.getState().quoteRequest).toMatchObject({
      sessionId: "s-main",
      text: "交季度报告",
    });
    expect(openMainChat).toHaveBeenCalledTimes(1);
    expect(open()).toEqual({ galley: true, elsewhere: true });
    // The workbench conversation still on screen leaves it be…
    expect(takeQuote("s-work", false)).toBeNull();
    expect(useUiStore.getState().quoteRequest).not.toBeNull();
    // …the main chat's MainView takes it as it appears, and only once.
    expect(takeQuote("s-main", true)).toBe("交季度报告");
    expect(useUiStore.getState().quoteRequest).toBeNull();
    expect(takeQuote("s-main", true)).toBeNull();
  });

  it("from elsewhere with no Galley to land on: the quote does not wait for the next visit", async () => {
    openMainChat.mockImplementation(async () => false);
    quoteTodo(ITEM, "elsewhere", "s-main");
    await Promise.resolve();
    await Promise.resolve();
    expect(useUiStore.getState().quoteRequest).toBeNull();
  });

  it("quotes what the row shows when it names a row its own way (the daily review, ticket 74)", () => {
    quoteTodo(ITEM, "galley", "s-main", "过一遍在办的事");
    expect(takeQuote("s-main", true)).toBe("过一遍在办的事");
  });

  it("a second click quotes again (the composer drops a duplicate)", () => {
    quoteTodo(ITEM, "galley", "s-main");
    expect(takeQuote("s-main", true)).toBe("交季度报告");
    quoteTodo(ITEM, "galley", "s-main");
    expect(takeQuote("s-main", true)).toBe("交季度报告");
  });
});

describe("「跟 Galley 说」", () => {
  it("beside Galley: the caret into its composer, in place", () => {
    const focus = vi.fn();
    talkToGalley("galley", focus);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(openMainChat).not.toHaveBeenCalled();
  });

  it("from elsewhere: Galley first, the panel with it; its composer takes the caret as it appears", () => {
    const focus = vi.fn();
    useUiStore.setState({ todoPanelOpen: { galley: false, elsewhere: true } });
    talkToGalley("elsewhere", focus);
    expect(openMainChat).toHaveBeenCalledTimes(1);
    expect(focus).not.toHaveBeenCalled();
    expect(open()).toEqual({ galley: true, elsewhere: true });
  });
});
