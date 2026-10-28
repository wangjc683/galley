// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { TodoItem } from "@/lib/assistant-todo";
import { FRESH_CARDS_GATHER_MS } from "@/lib/fresh-cards";
import type { MemoEventItem } from "@/lib/memo";
import type { ScheduledTask } from "@/lib/scheduled-tasks";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useMemoStore } from "@/stores/memo";
import { useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeSession } from "@/test/factories";
import type { Turn } from "@/types/conversation";

/**
 * The wiring of the panel's one opening by itself across the three
 * reads (main chat ticket 101, PRD ruling 147 point 4): the to-dos, the
 * memo writes and Galley's own reminders each say which cards are new;
 * one round's are gathered, then decided on the conditions as they stand
 * when the wait ends. Which cards count and which page wins are pinned
 * in lib/fresh-cards.test.ts and lib/todo-open.test.ts.
 */

const reminderReads = vi.hoisted(() => ({
  listeners: new Set<
    (
      previous: readonly ScheduledTask[] | null,
      next: readonly ScheduledTask[],
    ) => void
  >(),
}));
vi.mock("@/hooks/useReminderCards", () => ({
  subscribeReminderReads: (
    listener: (
      previous: readonly ScheduledTask[] | null,
      next: readonly ScheduledTask[],
    ) => void,
  ) => {
    reminderReads.listeners.add(listener);
    return () => reminderReads.listeners.delete(listener);
  },
}));

import { useFreshCards } from "./useFreshCards";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const MAIN = "s-main";

function todo(id: string, turnIndex?: number): TodoItem {
  return {
    kind: "todo",
    id,
    text: id,
    state: "open",
    createdBy: "assistant",
    createdIn: { sessionId: MAIN, turnIndex },
  };
}

function write(id: number, turnIndex?: number): MemoEventItem {
  return {
    id,
    memoId: `memo_${id}`,
    action: "add",
    text: "你不吃香菜",
    sessionId: MAIN,
    turnIndex,
    memoExists: true,
    createdAt: "2026-10-28T06:50:00Z",
  };
}

function task(id: string, turnIndex?: number): ScheduledTask {
  return {
    id,
    prompt: "提醒用户喝水",
    repeat: { kind: "once" },
    timeOfDay: "15:00",
    enabled: true,
    target: "assistant",
    createdIn: { sessionId: MAIN, turnIndex },
    createdAt: "2026-10-28T06:50:00Z",
    updatedAt: "2026-10-28T06:50:00Z",
  };
}

const userTurn: Turn = {
  role: "user",
  content: "十分钟后提醒我喝水",
  createdAt: "2026-10-28T06:50:00Z",
};

let root: Root | null = null;

function Probe({ mainChatId }: { mainChatId: string | undefined }) {
  useFreshCards(mainChatId);
  return null;
}

function mount(mainChatId: string | undefined = MAIN) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Probe mainChatId={mainChatId} />));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  reminderReads.listeners.clear();
  useSessionsStore.setState({
    sessions: [makeSession({ id: MAIN, mainChat: true })],
    activeSessionId: MAIN,
  });
  useMessagesStore.setState({
    byId: { [MAIN]: { turns: [userTurn] } } as never,
  });
  useAssistantTodoStore.setState({ noted: [], loaded: false });
  useMemoStore.setState({ events: [], loaded: false });
  useUiStore.setState({
    screen: "main",
    todoPanelOpen: { galley: false, elsewhere: false },
    todoNarrow: false,
    todoGlance: null,
    todoPanelIntroduced: false,
    todoRowRequest: null,
    todoPageRequest: null,
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/** The first read of the to-dos and the memos, and of the reminders. */
function firstReads(
  noted: TodoItem[] = [todo("todo_old", 3)],
  events: MemoEventItem[] = [write(1, 3)],
  tasks: ScheduledTask[] = [],
) {
  useAssistantTodoStore.setState({ noted, loaded: true });
  useMemoStore.setState({ events, loaded: true });
  for (const listener of reminderReads.listeners) listener(null, tasks);
}

function reminderRead(previous: ScheduledTask[], next: ScheduledTask[]) {
  for (const listener of reminderReads.listeners) listener(previous, next);
}

const ui = () => useUiStore.getState();
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("the panel opens by itself once, for any card the panel lists", () => {
  it("opens on 待办 at a to-do once the wait is over", () => {
    mount();
    firstReads();
    useAssistantTodoStore.setState({
      noted: [todo("todo_old", 3), todo("todo_new", 7)],
    });
    wait(FRESH_CARDS_GATHER_MS - 1);
    expect(ui().todoPanelOpen.galley).toBe(false);
    wait(1);
    expect(ui().todoPanelOpen.galley).toBe(true);
    expect(ui().todoPanelIntroduced).toBe(true);
    expect(ui().todoPageRequest?.page).toBe("todo");
    expect(ui().todoRowRequest?.ids).toEqual(["todo_new"]);
  });

  it("opens on 待办 at one of Galley's own reminders", () => {
    mount();
    firstReads();
    reminderRead([], [task("sched_new", 7)]);
    wait(FRESH_CARDS_GATHER_MS);
    expect(ui().todoPanelOpen.galley).toBe(true);
    expect(ui().todoPageRequest?.page).toBe("todo");
    expect(ui().todoRowRequest?.ids).toEqual(["sched_new"]);
  });

  it("opens on 备忘 at a memo when only memos came", () => {
    mount();
    firstReads();
    useMemoStore.setState({ events: [write(1, 3), write(2, 7)] });
    wait(FRESH_CARDS_GATHER_MS);
    expect(ui().todoPanelOpen.galley).toBe(true);
    expect(ui().todoPageRequest?.page).toBe("memo");
    expect(ui().todoRowRequest?.ids).toEqual(["memo_2"]);
  });

  it("waits for the reads that land later: a memo first, the to-do 200ms after, opens on 待办", () => {
    mount();
    firstReads();
    useMemoStore.setState({ events: [write(1, 3), write(2, 7)] });
    wait(200);
    useAssistantTodoStore.setState({
      noted: [todo("todo_old", 3), todo("todo_new", 7)],
    });
    wait(FRESH_CARDS_GATHER_MS - 200);
    expect(ui().todoPageRequest?.page).toBe("todo");
    expect(ui().todoRowRequest?.ids).toEqual(["todo_new"]);
  });

  it("does nothing on each read's first", () => {
    mount();
    useAssistantTodoStore.setState({
      noted: [todo("todo_new", 7)],
      loaded: true,
    });
    useMemoStore.setState({ events: [write(2, 7)], loaded: true });
    for (const listener of reminderReads.listeners) {
      listener(null, [task("sched_new", 7)]);
    }
    wait(FRESH_CARDS_GATHER_MS * 2);
    expect(ui().todoPanelOpen.galley).toBe(false);
    expect(ui().todoPanelIntroduced).toBe(false);
  });

  it("goes by the conditions as the wait ends: left Galley, or narrowed, it does not open", () => {
    mount();
    firstReads();
    useAssistantTodoStore.setState({
      noted: [todo("todo_old", 3), todo("todo_new", 7)],
    });
    act(() => useUiStore.setState({ screen: "empty" }));
    wait(FRESH_CARDS_GATHER_MS);
    expect(ui().todoPanelOpen.galley).toBe(false);
    expect(ui().todoPanelIntroduced).toBe(false);

    act(() => useUiStore.setState({ screen: "main" }));
    useAssistantTodoStore.setState({
      noted: [todo("todo_old", 3), todo("todo_new", 7), todo("todo_two", 8)],
    });
    act(() => useUiStore.setState({ todoNarrow: true }));
    wait(FRESH_CARDS_GATHER_MS);
    expect(ui().todoPanelOpen.galley).toBe(false);
    expect(ui().todoPanelIntroduced).toBe(false);
  });

  it("does not open for a round Core woke Galley for, nor once met", () => {
    useMessagesStore.setState({
      byId: {
        [MAIN]: {
          turns: [
            {
              role: "user",
              content: "[Galley — not a message from the user] …",
              createdAt: "2026-10-28T06:50:00Z",
              origin: {
                via: "system",
                supervisor: "galley-report",
                reason: "s-sub",
              },
            },
          ],
        },
      } as never,
    });
    mount();
    firstReads();
    reminderRead([], [task("sched_new", 7)]);
    wait(FRESH_CARDS_GATHER_MS);
    expect(ui().todoPanelOpen.galley).toBe(false);

    useMessagesStore.setState({
      byId: { [MAIN]: { turns: [userTurn] } } as never,
    });
    useUiStore.setState({ todoPanelIntroduced: true });
    reminderRead(
      [task("sched_new", 7)],
      [task("sched_new", 7), task("sched_two", 8)],
    );
    wait(FRESH_CARDS_GATHER_MS);
    expect(ui().todoPanelOpen.galley).toBe(false);
  });

  it("stops hearing the reads when unmounted, a wait under way dropped", () => {
    mount();
    firstReads();
    useAssistantTodoStore.setState({
      noted: [todo("todo_old", 3), todo("todo_new", 7)],
    });
    act(() => root?.unmount());
    root = null;
    expect(reminderReads.listeners.size).toBe(0);
    wait(FRESH_CARDS_GATHER_MS);
    expect(ui().todoPanelOpen.galley).toBe(false);
  });
});
