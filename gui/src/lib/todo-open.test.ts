import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoItem } from "@/lib/assistant-todo";
import type { FreshCard } from "@/lib/fresh-cards";
import { useUiStore } from "@/stores/ui";

import {
  closeTodoPanel,
  goToTodoTarget,
  introduceTodoPanel,
  mainChatOnScreen,
  moveTodoGlance,
  openTodoPanel,
  quoteForComposer,
  quoteTodo,
  showMemoRow,
  showTodoRow,
  takeQuote,
  talkToGalley,
  todoConversationKey,
  todoGlanceAfterMove,
  todoPanelIntroduces,
  todoPlaceOf,
  todoView,
  toggleTodoPanel,
  type TodoIntroduction,
  type TodoLook,
  type TodoSpot,
} from "./todo-open";

/**
 * The to-do panel's ways in and out (main chat tickets 42, 45, 46): the
 * top bar's button in every conversation while there is a main chat,
 * open or closed in two places — Galley's and everything else's — each
 * remembered apart; ⌘K opens it where you are; a jump out of the panel
 * lands where it leads and takes the panel along; 「说说这件」 and
 * 「跟 Galley 说」 always end in Galley's composer. Since ticket 87 (PRD
 * ruling 131): under 760px of main area only a look, nothing remembered;
 * a card's title opens the panel at its row; the panel opens by itself
 * once; every open and close of yours marks it met.
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
    todoNarrow: true,
    todoGlance: null,
    todoPanelIntroduced: false,
    todoRowRequest: null,
    todoPageRequest: null,
    quoteRequest: null,
    locateRequest: null,
  });
});

const open = () => useUiStore.getState().todoPanelOpen;
const glance = () => useUiStore.getState().todoGlance;
const introduced = () => useUiStore.getState().todoPanelIntroduced;

// Where you are: beside Galley, beside a workbench conversation; in a
// main area wide enough for the panel beside it, or under 760px.
const GALLEY: TodoSpot = { here: "galley", at: "main:s-main", narrow: false };
const WORK: TodoSpot = { here: "elsewhere", at: "main:s-work", narrow: false };
const narrow = (spot: TodoSpot): TodoSpot => ({ ...spot, narrow: true });
/** A wide main area showing `sessionId`, no look open. */
const wide = (sessionId?: string): TodoLook => ({
  sessionId,
  narrow: false,
  glance: null,
});
/** The view as App takes it from the store, showing `sessionId`. */
function viewOf(
  session: { mainChat?: boolean } | undefined,
  sessionId: string | undefined,
  screen: "main" | "empty" = "main",
) {
  const ui = useUiStore.getState();
  return todoView(true, ui.todoPanelOpen, screen, session, {
    sessionId,
    narrow: ui.todoNarrow,
    glance: ui.todoGlance,
  });
}

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
    expect(todoView(true, CLOSED, "main", main, wide()).entry).toBe(true);
    expect(todoView(true, CLOSED, "main", workbench, wide()).entry).toBe(true);
    expect(todoView(true, CLOSED, "main", subtask, wide()).entry).toBe(true);
    // The empty composer has the top bar too.
    expect(todoView(true, CLOSED, "empty", undefined, wide()).entry).toBe(true);
  });

  it("not without a main chat (the external runtime, or none yet), nor its panel", () => {
    const allOpen = { galley: true, elsewhere: true };
    for (const session of [main, workbench, subtask, undefined]) {
      const view = todoView(false, allOpen, "main", session, wide());
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
    toggleTodoPanel(GALLEY, false);
    expect(open()).toEqual({ galley: true, elsewhere: false });
    expect(todoView(true, open(), "main", main, wide()).shown).toBe(true);
    expect(todoView(true, open(), "main", workbench, wide()).shown).toBe(false);
    expect(todoView(true, open(), "main", subtask, wide()).shown).toBe(false);
    expect(todoView(true, open(), "empty", undefined, wide()).shown).toBe(
      false,
    );
    // Nothing closed it on the way: it is open again beside Galley.
    expect(todoView(true, open(), "main", main, wide()).shown).toBe(true);
  });

  it("open in the workbench, back in Galley as Galley's was", () => {
    toggleTodoPanel(WORK, false);
    expect(open()).toEqual({ galley: false, elsewhere: true });
    expect(todoView(true, open(), "main", workbench, wide()).shown).toBe(true);
    // Subtasks and the empty composer share the workbench's place.
    expect(todoView(true, open(), "main", subtask, wide()).shown).toBe(true);
    expect(todoView(true, open(), "empty", undefined, wide()).shown).toBe(true);
    expect(todoView(true, open(), "main", main, wide()).shown).toBe(false);
    // Closing it there leaves Galley's as it is.
    useUiStore.getState().setTodoPanelOpen("galley", true);
    toggleTodoPanel(WORK, true);
    expect(open()).toEqual({ galley: true, elsewhere: false });
  });

  it("the button flips its own place in place, never lands", () => {
    toggleTodoPanel(WORK, false);
    toggleTodoPanel(WORK, true);
    toggleTodoPanel(GALLEY, false);
    toggleTodoPanel(GALLEY, true);
    expect(open()).toEqual(CLOSED);
    expect(openMainChat).not.toHaveBeenCalled();
  });

  it("⌘K opens it where you are, and only there: Galley is not entered first", () => {
    openTodoPanel(WORK);
    expect(open()).toEqual({ galley: false, elsewhere: true });
    // It opens; it never closes (the button toggles).
    openTodoPanel(WORK);
    expect(open()).toEqual({ galley: false, elsewhere: true });
    openTodoPanel(GALLEY);
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
    goToTodoTarget(reply, GALLEY, "s-main", openSession);
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
    goToTodoTarget(reply, WORK, "s-main", openSession);
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
    goToTodoTarget(reply, WORK, "s-main", vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(useUiStore.getState().locateRequest).toBeNull();
  });

  it("opens a subtask or a scheduled run's session, its place marked open", () => {
    const openSession = vi.fn();
    goToTodoTarget(
      { kind: "subtask", sessionId: "s-sub" },
      GALLEY,
      "s-main",
      openSession,
    );
    expect(open()).toEqual({ galley: false, elsewhere: true });
    goToTodoTarget(
      { kind: "session", sessionId: "s-run" },
      WORK,
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
      WORK,
      "s-main",
      openSession,
    );
    expect(open()).toEqual({ galley: true, elsewhere: false });
    expect(openSession).toHaveBeenCalledWith("s-main");
  });
});

describe("「说说这件」", () => {
  it("beside Galley: quotes into the main chat's composer, and only there", () => {
    quoteTodo(ITEM, GALLEY, "s-main");
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
    quoteTodo(ITEM, WORK, "s-main");
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
    quoteTodo(ITEM, WORK, "s-main");
    await Promise.resolve();
    await Promise.resolve();
    expect(useUiStore.getState().quoteRequest).toBeNull();
  });

  it("quotes what the row shows when it is not the words it carries (a subtask without a title)", () => {
    const untitled: TodoItem = {
      kind: "subtask",
      id: "s-sub",
      text: "",
      state: "running",
      createdBy: "assistant",
    };
    quoteTodo(untitled, GALLEY, "s-main", "子任务");
    expect(takeQuote("s-main", true)).toBe("子任务");
  });

  // Main chat ticket 105, PRD ruling 151.
  it("left to itself, quotes a task's first line, not its notes", () => {
    const reminder: TodoItem = {
      kind: "task",
      id: "sched_1",
      text: "看看快递到了没有\n\n单号 JD8812345678，到时查物流。",
      state: "scheduled",
      createdBy: "assistant",
    };
    quoteTodo(reminder, GALLEY, "s-main");
    expect(takeQuote("s-main", true)).toBe("看看快递到了没有");
  });

  it("a second click quotes again (the composer drops a duplicate)", () => {
    quoteTodo(ITEM, GALLEY, "s-main");
    expect(takeQuote("s-main", true)).toBe("交季度报告");
    quoteTodo(ITEM, GALLEY, "s-main");
    expect(takeQuote("s-main", true)).toBe("交季度报告");
  });
});

describe("「跟 Galley 说」", () => {
  it("beside Galley: the caret into its composer, in place", () => {
    const focus = vi.fn();
    talkToGalley(GALLEY, "s-main", focus);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(openMainChat).not.toHaveBeenCalled();
  });

  it("from elsewhere: Galley first, the panel with it; its composer takes the caret as it appears", () => {
    const focus = vi.fn();
    useUiStore.setState({ todoPanelOpen: { galley: false, elsewhere: true } });
    talkToGalley(WORK, "s-main", focus);
    expect(openMainChat).toHaveBeenCalledTimes(1);
    expect(focus).not.toHaveBeenCalled();
    expect(open()).toEqual({ galley: true, elsewhere: true });
  });
});

describe("a narrow main area: only a look (ticket 87, ruling 131 point 2)", () => {
  it("does not show the remembered open; widened, it is back", () => {
    useUiStore.setState({ todoPanelOpen: { galley: true, elsewhere: true } });
    expect(viewOf(main, "s-main").shown).toBe(false);
    expect(viewOf(workbench, "s-work").shown).toBe(false);
    useUiStore.setState({ todoNarrow: false });
    expect(viewOf(main, "s-main").shown).toBe(true);
    expect(viewOf(workbench, "s-work").shown).toBe(true);
    // From wide to narrow the panel beside it folds; nothing is written.
    useUiStore.setState({ todoNarrow: true });
    expect(viewOf(main, "s-main").shown).toBe(false);
    expect(open()).toEqual({ galley: true, elsewhere: true });
  });

  it("the button and ⌘K open a look there and remember nothing; the button again, × and Esc fold it", () => {
    toggleTodoPanel(narrow(GALLEY), false);
    expect(glance()).toEqual({ at: "main:s-main", arrived: true });
    expect(open()).toEqual(CLOSED);
    // On screen: the button's selected ground follows it.
    expect(viewOf(main, "s-main").shown).toBe(true);
    // Not beside another conversation.
    expect(viewOf(workbench, "s-work").shown).toBe(false);
    toggleTodoPanel(narrow(GALLEY), true);
    expect(glance()).toBeNull();
    expect(viewOf(main, "s-main").shown).toBe(false);

    openTodoPanel(narrow(WORK));
    expect(glance()).toEqual({ at: "main:s-work", arrived: true });
    openTodoPanel(narrow(WORK));
    expect(glance()).toEqual({ at: "main:s-work", arrived: true });
    closeTodoPanel(narrow(WORK));
    expect(glance()).toBeNull();
    expect(open()).toEqual(CLOSED);
  });

  it("leaves what is remembered as it is, open or closed", () => {
    useUiStore.setState({ todoPanelOpen: { galley: true, elsewhere: false } });
    openTodoPanel(narrow(GALLEY));
    closeTodoPanel(narrow(GALLEY));
    openTodoPanel(narrow(WORK));
    toggleTodoPanel(narrow(WORK), true);
    expect(open()).toEqual({ galley: true, elsewhere: false });
  });

  it("folds when you leave the conversation it is open in, and stays folded when you come back", () => {
    openTodoPanel(narrow(WORK));
    moveTodoGlance("main:s-work");
    expect(glance()).toEqual({ at: "main:s-work", arrived: true });
    moveTodoGlance("main:s-other");
    expect(glance()).toBeNull();
    moveTodoGlance("main:s-work");
    expect(viewOf(workbench, "s-work").shown).toBe(false);
    // The other screen is a leaving too.
    openTodoPanel(narrow(WORK));
    moveTodoGlance(todoConversationKey("empty", "s-work"));
    expect(glance()).toBeNull();
  });

  it("names the conversation by its session, the empty composer by its screen", () => {
    expect(todoConversationKey("main", "s-1")).toBe("main:s-1");
    expect(todoConversationKey("empty", "s-1")).toBe("empty");
    expect(todoConversationKey("empty", undefined)).toBe("empty");
  });

  it("stays on screen through a widening, beside the conversation, still a look", () => {
    openTodoPanel(narrow(WORK));
    useUiStore.setState({ todoNarrow: false });
    expect(viewOf(workbench, "s-work").shown).toBe(true);
    expect(open()).toEqual(CLOSED);
    // Leaving folds it as before; nothing was remembered.
    moveTodoGlance("main:s-main");
    expect(glance()).toBeNull();
    expect(viewOf(workbench, "s-work").shown).toBe(false);
  });

  it("widened, a close is a wide one: remembered closed, the look gone", () => {
    openTodoPanel(narrow(WORK));
    useUiStore.setState({
      todoNarrow: false,
      todoPanelOpen: { galley: false, elsewhere: true },
    });
    closeTodoPanel(WORK);
    expect(glance()).toBeNull();
    expect(open()).toEqual(CLOSED);
  });

  it("a jump out of the panel takes the look along, and the jump is no leaving", () => {
    const openSession = vi.fn();
    openTodoPanel(narrow(GALLEY));
    goToTodoTarget(
      { kind: "subtask", sessionId: "s-sub" },
      narrow(GALLEY),
      "s-main",
      openSession,
    );
    expect(openSession).toHaveBeenCalledWith("s-sub");
    expect(glance()).toEqual({ at: "main:s-sub", arrived: false });
    expect(open()).toEqual(CLOSED);
    // On the way (the switch can show another conversation a moment
    // while the one you go to is restored): it waits.
    moveTodoGlance("main:s-other");
    expect(glance()).toEqual({ at: "main:s-sub", arrived: false });
    moveTodoGlance("main:s-sub");
    expect(glance()).toEqual({ at: "main:s-sub", arrived: true });
    expect(viewOf(subtask, "s-sub").shown).toBe(true);
    // Landed, leaving folds it.
    moveTodoGlance("main:s-work");
    expect(glance()).toBeNull();
  });

  it("a jump to the conversation on screen has already arrived", () => {
    openTodoPanel(narrow(WORK));
    goToTodoTarget(
      { kind: "session", sessionId: "s-work" },
      narrow(WORK),
      "s-main",
      vi.fn(),
    );
    expect(glance()).toEqual({ at: "main:s-work", arrived: true });
    moveTodoGlance("main:s-main");
    expect(glance()).toBeNull();
  });

  it("back to Galley from elsewhere — a title, 「说说这件」, 「跟 Galley 说」 — the look goes ahead, Galley's memory untouched", () => {
    const reply = {
      kind: "reply" as const,
      sessionId: "s-main",
      messageId: "msg_s-main_4_assistant",
    };
    for (const jump of [
      () => goToTodoTarget(reply, narrow(WORK), "s-main", vi.fn()),
      () => quoteTodo(ITEM, narrow(WORK), "s-main"),
      () => talkToGalley(narrow(WORK), "s-main", vi.fn()),
    ]) {
      useUiStore.setState({ todoGlance: { at: "main:s-work", arrived: true } });
      jump();
      expect(glance()).toEqual({ at: "main:s-main", arrived: false });
      expect(open()).toEqual(CLOSED);
    }
    expect(openMainChat).toHaveBeenCalledTimes(3);
  });

  it("beside Galley a title jumps in place: the look stays", () => {
    openTodoPanel(narrow(GALLEY));
    goToTodoTarget(
      {
        kind: "reply",
        sessionId: "s-main",
        messageId: "msg_s-main_4_assistant",
      },
      narrow(GALLEY),
      "s-main",
      vi.fn(),
    );
    expect(glance()).toEqual({ at: "main:s-main", arrived: true });
    expect(openMainChat).not.toHaveBeenCalled();
  });

  it("with no Galley to land on, the look sent ahead is dropped", async () => {
    openMainChat.mockImplementation(async () => false);
    openTodoPanel(narrow(WORK));
    quoteTodo(ITEM, narrow(WORK), "s-main");
    await Promise.resolve();
    await Promise.resolve();
    expect(glance()).toBeNull();
    expect(useUiStore.getState().quoteRequest).toBeNull();
  });

  it("a look after a move, purely", () => {
    const here = { at: "main:a", arrived: true };
    const ahead = { at: "main:b", arrived: false };
    expect(todoGlanceAfterMove(null, "main:a")).toBeNull();
    expect(todoGlanceAfterMove(here, "main:a")).toBe(here);
    expect(todoGlanceAfterMove(here, "main:b")).toBeNull();
    expect(todoGlanceAfterMove(ahead, "main:c")).toBe(ahead);
    expect(todoGlanceAfterMove(ahead, "main:b")).toEqual({
      at: "main:b",
      arrived: true,
    });
  });
});

describe("met (ticket 87, ruling 131 point 4)", () => {
  const actions: [string, (spot: TodoSpot) => void][] = [
    ["the button opening", (spot) => toggleTodoPanel(spot, false)],
    ["the button closing", (spot) => toggleTodoPanel(spot, true)],
    ["⌘K", (spot) => openTodoPanel(spot)],
    ["× and Esc", (spot) => closeTodoPanel(spot)],
    [
      "a jump to a subtask",
      (spot) =>
        goToTodoTarget(
          { kind: "subtask", sessionId: "s-sub" },
          spot,
          "s-main",
          vi.fn(),
        ),
    ],
    ["「说说这件」 from elsewhere", (spot) => quoteTodo(ITEM, spot, "s-main")],
    [
      "「跟 Galley 说」 from elsewhere",
      (spot) => talkToGalley(spot, "s-main", vi.fn()),
    ],
  ];

  it("by every open and close of yours, narrow and wide", () => {
    for (const [name, act] of actions) {
      for (const spot of [WORK, narrow(WORK)]) {
        useUiStore.setState({ todoPanelIntroduced: false });
        act(spot);
        expect(introduced(), `${name}, narrow ${spot.narrow}`).toBe(true);
      }
    }
  });

  it("by a card's title, narrow and wide", () => {
    for (const todoNarrow of [false, true]) {
      useUiStore.setState({ todoPanelIntroduced: false, todoNarrow });
      showTodoRow("todo_1", "s-main");
      expect(introduced()).toBe(true);
    }
  });
});

describe("a card's title (ticket 87, ruling 131 point 3)", () => {
  const rows = () => useUiStore.getState().todoRowRequest?.ids;

  it("opens Galley's panel when wide, remembered open, and lights the row", () => {
    useUiStore.setState({ todoNarrow: false });
    showTodoRow("todo_1", "s-main");
    expect(open()).toEqual({ galley: true, elsewhere: false });
    expect(glance()).toBeNull();
    expect(rows()).toEqual(["todo_1"]);
    expect(viewOf(main, "s-main").shown).toBe(true);
  });

  it("opens a look when narrow, nothing remembered", () => {
    showTodoRow("todo_1", "s-main");
    expect(open()).toEqual(CLOSED);
    expect(glance()).toEqual({ at: "main:s-main", arrived: true });
    expect(rows()).toEqual(["todo_1"]);
  });

  // Ticket 107 (PRD ruling 153): the row opens too; the panel opening by
  // itself only lights.
  it("asks the panel to open the row as well; the panel opening by itself does not", () => {
    showTodoRow("todo_1", "s-main");
    expect(useUiStore.getState().todoRowRequest?.open).toBe(true);
    introduceTodoPanel({ page: "todo", rows: ["todo_2"] });
    expect(useUiStore.getState().todoRowRequest?.ids).toEqual(["todo_2"]);
    expect(useUiStore.getState().todoRowRequest?.open).toBeUndefined();
  });

  it("leaves a panel already on screen as it is, and only lights the row", () => {
    useUiStore.setState({
      todoNarrow: false,
      todoPanelOpen: { galley: true, elsewhere: false },
    });
    showTodoRow("todo_1", "s-main");
    expect(open()).toEqual({ galley: true, elsewhere: false });
    expect(glance()).toBeNull();
    expect(rows()).toEqual(["todo_1"]);

    useUiStore.setState({
      todoNarrow: true,
      todoGlance: { at: "main:s-main", arrived: true },
    });
    showTodoRow("todo_2", "s-main");
    expect(glance()).toEqual({ at: "main:s-main", arrived: true });
    expect(open()).toEqual({ galley: true, elsewhere: false });
    expect(rows()).toEqual(["todo_2"]);
  });
});

describe("the panel's page (ticket 97)", () => {
  const page = () => useUiStore.getState().todoPageRequest?.page;
  const rows = () => useUiStore.getState().todoRowRequest?.ids;

  it("a memo card's words open the panel beside Galley as a to-do card's title does, on 备忘, its row lit", () => {
    useUiStore.setState({ todoNarrow: false });
    showMemoRow("memo_1", "s-main");
    expect(open()).toEqual({ galley: true, elsewhere: false });
    expect(page()).toBe("memo");
    expect(rows()).toEqual(["memo_1"]);
    expect(introduced()).toBe(true);
  });

  it("a memo card's words open a look when narrow, and leave a panel on screen as it is", () => {
    showMemoRow("memo_1", "s-main");
    expect(open()).toEqual(CLOSED);
    expect(glance()).toEqual({ at: "main:s-main", arrived: true });
    expect(page()).toBe("memo");
    useUiStore.setState({
      todoNarrow: false,
      todoGlance: null,
      todoPanelOpen: { galley: true, elsewhere: false },
    });
    showMemoRow("memo_2", "s-main");
    expect(open()).toEqual({ galley: true, elsewhere: false });
    expect(rows()).toEqual(["memo_2"]);
  });

  it("⌘K's 「待办」 asks for 待办; the button asks for nothing", () => {
    openTodoPanel(WORK);
    expect(page()).toBe("todo");
    useUiStore.setState({ todoPageRequest: null });
    toggleTodoPanel(WORK, false);
    expect(useUiStore.getState().todoPageRequest).toBeNull();
  });

  it("a to-do card's title, a reminder card's words, ask for 待办: a panel up on 备忘 turns back (ticket 101)", () => {
    useUiStore.setState({
      todoNarrow: false,
      todoPanelOpen: { galley: true, elsewhere: false },
    });
    showTodoRow("sched_1", "s-main");
    expect(page()).toBe("todo");
    expect(rows()).toEqual(["sched_1"]);
  });
});

describe("opening by itself, once (ticket 87, ruling 131 point 4; ticket 101, ruling 147 point 4)", () => {
  const todo = (row: string): FreshCard => ({ kind: "todo", row, card: row });
  const reminder = (row: string): FreshCard => ({
    kind: "reminder",
    row,
    card: row,
  });
  const memo = (row: string, card: string): FreshCard => ({
    kind: "memo",
    row,
    card,
  });
  const BASE: TodoIntroduction = {
    introduced: false,
    fresh: [todo("todo_new")],
    yourRound: true,
    mainChatOnScreen: true,
    narrow: false,
  };

  it("opens on 待办 for a to-do card that has just appeared under your round", () => {
    expect(todoPanelIntroduces(BASE)).toEqual({
      page: "todo",
      rows: ["todo_new"],
    });
    // Two in one reply: both.
    expect(
      todoPanelIntroduces({
        ...BASE,
        fresh: [todo("todo_new"), todo("todo_two")],
      }),
    ).toEqual({ page: "todo", rows: ["todo_new", "todo_two"] });
  });

  it("opens on 待办 for one of Galley's own reminders", () => {
    expect(
      todoPanelIntroduces({ ...BASE, fresh: [reminder("sched_1")] }),
    ).toEqual({ page: "todo", rows: ["sched_1"] });
  });

  it("opens on 备忘 when only memos came, their rows lit, each once", () => {
    expect(
      todoPanelIntroduces({
        ...BASE,
        fresh: [
          memo("memo_1", "11"),
          memo("memo_2", "12"),
          memo("memo_1", "13"),
        ],
      }),
    ).toEqual({ page: "memo", rows: ["memo_1", "memo_2"] });
  });

  it("opens on 待办 when a to-do or a reminder came with memos, lighting those alone", () => {
    expect(
      todoPanelIntroduces({
        ...BASE,
        fresh: [todo("todo_new"), memo("memo_1", "11")],
      }),
    ).toEqual({ page: "todo", rows: ["todo_new"] });
    expect(
      todoPanelIntroduces({
        ...BASE,
        fresh: [reminder("sched_1"), memo("memo_1", "11")],
      }),
    ).toEqual({ page: "todo", rows: ["sched_1"] });
    expect(
      todoPanelIntroduces({
        ...BASE,
        fresh: [todo("todo_new"), reminder("sched_1"), memo("memo_1", "11")],
      }),
    ).toEqual({ page: "todo", rows: ["todo_new", "sched_1"] });
  });

  it("not without a card", () => {
    expect(todoPanelIntroduces({ ...BASE, fresh: [] })).toBeNull();
  });

  it("not once met", () => {
    expect(todoPanelIntroduces({ ...BASE, introduced: true })).toBeNull();
  });

  it("not for a round Core woke Galley for", () => {
    expect(todoPanelIntroduces({ ...BASE, yourRound: false })).toBeNull();
    expect(
      todoPanelIntroduces({
        ...BASE,
        fresh: [memo("memo_1", "11")],
        yourRound: false,
      }),
    ).toBeNull();
  });

  it("not unless Galley's conversation is on screen", () => {
    expect(
      todoPanelIntroduces({ ...BASE, mainChatOnScreen: false }),
    ).toBeNull();
  });

  it("not in a narrow main area", () => {
    expect(todoPanelIntroduces({ ...BASE, narrow: true })).toBeNull();
    expect(
      todoPanelIntroduces({
        ...BASE,
        fresh: [reminder("sched_1")],
        narrow: true,
      }),
    ).toBeNull();
  });

  it("opens Galley's place, remembered open, on its page, marks the panel met and lights the rows", () => {
    useUiStore.setState({ todoNarrow: false });
    introduceTodoPanel({ page: "todo", rows: ["todo_new"] });
    expect(open()).toEqual({ galley: true, elsewhere: false });
    expect(introduced()).toBe(true);
    expect(useUiStore.getState().todoPageRequest?.page).toBe("todo");
    expect(useUiStore.getState().todoRowRequest?.ids).toEqual(["todo_new"]);
    introduceTodoPanel({ page: "memo", rows: ["memo_1"] });
    expect(useUiStore.getState().todoPageRequest?.page).toBe("memo");
    expect(useUiStore.getState().todoRowRequest?.ids).toEqual(["memo_1"]);
  });
});
