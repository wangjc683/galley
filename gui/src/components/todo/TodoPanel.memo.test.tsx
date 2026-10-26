// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { MemoCards } from "@/components/conversation/MemoCards";
import { EMPTY_TODO } from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import { LOCATE_FLASH_CLASS } from "@/lib/locate-flash";
import type { MemoEventItem, MemoItem } from "@/lib/memo";
import { openTodoPanel } from "@/lib/todo-open";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useMemoStore } from "@/stores/memo";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";

import { TodoPanel } from "./TodoPanel";

/**
 * The to-do panel's two pages (main chat ticket 97, PRD ruling 142 point
 * 5), through the real stores: the header's tabs, 待办 on every opening
 * but a memo card's, which opens 备忘 at its row lit up; ⌘K's 「待办」
 * turning the page back; closed and opened again, 待办. On the 备忘 page:
 * a memo's words jump back to the sentence, its ⋯ and right-click menu
 * hold 删除 alone, which takes the row off under an undo toast. The
 * page's markup is pinned in MemoPage.test.tsx, the store's timing in
 * stores/memo.test.ts.
 */

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
}));

const hadResizeObserver = "ResizeObserver" in globalThis;
beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (!hadResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
afterAll(() => {
  if (!hadResizeObserver) {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  }
});

const CILANTRO: MemoItem = {
  id: "memo_cilantro",
  text: "你不吃香菜",
  origin: { via: "supervisor", supervisor: "galley-assistant" },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  changedIn: { sessionId: "s-main", turnIndex: 4 },
};
const NAME: MemoItem = {
  ...CILANTRO,
  id: "memo_name",
  text: "叫你小林",
  changedIn: undefined,
};
const NOTED: MemoEventItem = {
  id: 1,
  memoId: CILANTRO.id,
  action: "add",
  text: CILANTRO.text,
  sessionId: "s-main",
  turnIndex: 4,
  memoExists: true,
  createdAt: CILANTRO.createdAt,
};

let root: Root | null = null;
beforeEach(() => {
  useAssistantTodoStore.setState({
    todo: EMPTY_TODO,
    noted: [],
    loaded: true,
    flips: {},
    failures: {},
    cancelling: {},
    deleting: {},
    deleteToastId: null,
  });
  useMemoStore.setState({
    memos: [CILANTRO, NAME],
    events: [NOTED],
    loaded: true,
    deleting: {},
    failures: {},
    deleteToastId: null,
  });
  useUiStore.setState({
    toasts: [],
    todoPanelOpen: { galley: false, elsewhere: false },
    todoNarrow: false,
    todoGlance: null,
    todoRowRequest: null,
    todoPageRequest: null,
    locateRequest: null,
  });
  usePrefsStore.setState({ languagePreference: "zh-CN" });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <CopyProvider language="zh-CN">
        <Tooltip.Provider>{node}</Tooltip.Provider>
      </CopyProvider>,
    );
  });
  return container;
}

const panel = () => (
  <TodoPanel
    mainChatId="s-main"
    spot={{ here: "galley", at: "main:s-main", narrow: false }}
    onOpenSession={() => {}}
    onTalk={() => {}}
    onClose={() => {}}
  />
);

/** The page shown, and which tab says so. */
function shown(container: HTMLElement) {
  const tabs = Array.from(
    container.querySelectorAll<HTMLElement>('[role="tab"]'),
  );
  return {
    page: container
      .querySelector<HTMLElement>('[role="tabpanel"]')
      ?.getAttribute("data-todo-page"),
    tabs: tabs.map((tab) => tab.textContent),
    selected: tabs
      .filter((tab) => tab.getAttribute("aria-selected") === "true")
      .map((tab) => tab.textContent),
  };
}

const memoRow = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-memo-row="${id}"]`);

/** A frame for the panel to light what it drew. */
async function frame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

describe("the header's tabs", () => {
  it("are 待办 and 备忘, 待办 shown on opening, the other muted; + and × stay", () => {
    const container = mount(panel());
    expect(shown(container)).toEqual({
      page: "todo",
      tabs: ["待办", "备忘"],
      selected: ["待办"],
    });
    const memoTab = container.querySelector('[data-todo-tab="memo"]')!;
    expect(memoTab.className).toContain("text-ink-muted");
    expect(
      container.querySelector('[data-todo-tab="todo"]')!.className,
    ).toContain("text-ink");
    expect(
      container.querySelector('button[aria-label="跟 Galley 说"]'),
    ).not.toBeNull();
    expect(container.querySelector('button[aria-label="关闭"]')).not.toBeNull();
    // The region keeps its name.
    expect(
      container.querySelector('[role="region"]')?.getAttribute("aria-label"),
    ).toBe("待办");
  });

  it("switch the page by a click or the arrow keys, + and × still there", () => {
    const container = mount(panel());
    act(() =>
      container.querySelector<HTMLElement>('[data-todo-tab="memo"]')!.click(),
    );
    expect(shown(container).page).toBe("memo");
    expect(memoRow(container, CILANTRO.id)).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="跟 Galley 说"]'),
    ).not.toBeNull();
    const memoTab = container.querySelector<HTMLElement>(
      '[data-todo-tab="memo"]',
    )!;
    act(() =>
      memoTab.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      ),
    );
    expect(shown(container).selected).toEqual(["待办"]);
    expect(document.activeElement).toBe(
      container.querySelector('[data-todo-tab="todo"]'),
    );
  });

  it("come back to 待办 when the panel is closed and opened again: nothing remembers the page", () => {
    let container = mount(panel());
    act(() =>
      container.querySelector<HTMLElement>('[data-todo-tab="memo"]')!.click(),
    );
    expect(shown(container).page).toBe("memo");
    act(() => root?.unmount());
    container = mount(panel());
    expect(shown(container).page).toBe("todo");
  });

  it("turn back to 待办 on ⌘K's 「待办」 while the panel is up on 备忘", () => {
    const container = mount(panel());
    act(() =>
      container.querySelector<HTMLElement>('[data-todo-tab="memo"]')!.click(),
    );
    act(() =>
      openTodoPanel({ here: "galley", at: "main:s-main", narrow: false }),
    );
    expect(shown(container).page).toBe("todo");
    expect(useUiStore.getState().todoPageRequest).toBeNull();
  });
});

describe("a memo card's words", () => {
  const lit = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>("[data-memo-row]"))
      .filter((el) => el.classList.contains(LOCATE_FLASH_CLASS))
      .map((el) => el.dataset.memoRow);

  it("open the panel on 备忘 at the memo's row, lit up", async () => {
    const card = mount(<MemoCards events={[NOTED]} />);
    const button = card.querySelector<HTMLButtonElement>(
      '[data-role="memo-card"] button',
    )!;
    expect(button.textContent).toBe("记下了 · 你不吃香菜");
    act(() => button.click());
    expect(useUiStore.getState().todoPanelOpen.galley).toBe(true);
    expect(useUiStore.getState().todoPageRequest?.page).toBe("memo");
    expect(useUiStore.getState().todoRowRequest?.ids).toEqual([CILANTRO.id]);
    act(() => root?.unmount());
    // The panel App now shows beside Galley.
    const container = mount(panel());
    expect(shown(container).page).toBe("memo");
    await frame();
    expect(lit(container)).toEqual([CILANTRO.id]);
    expect(useUiStore.getState().todoRowRequest).toBeNull();
    expect(useUiStore.getState().todoPageRequest).toBeNull();
  });

  it("turn a panel already up on 待办 to 备忘", async () => {
    const container = mount(
      <>
        {panel()}
        <MemoCards events={[NOTED]} />
      </>,
    );
    expect(shown(container).page).toBe("todo");
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-role="memo-card"] button')!
        .click(),
    );
    expect(shown(container).page).toBe("memo");
    await frame();
    expect(lit(container)).toEqual([CILANTRO.id]);
  });
});

describe("a row on the 备忘 page", () => {
  const MENU = '[data-role="todo-row-menu"]';
  const menuRows = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>(`${MENU} [role="menuitem"]`),
    ).map((item) => item.textContent);
  const toasts = () => useUiStore.getState().toasts;

  function onMemoPage(): HTMLElement {
    useUiStore.setState({ todoPageRequest: { page: "memo", nonce: 1 } });
    return mount(panel());
  }

  it("jumps back to the sentence it was last noted in; one noted elsewhere is words", () => {
    const container = onMemoPage();
    const words = memoRow(container, CILANTRO.id)!.querySelector(
      "button:not([aria-label])",
    ) as HTMLElement;
    expect(words.textContent).toBe(CILANTRO.text);
    act(() => words.click());
    expect(useUiStore.getState().locateRequest).toMatchObject({
      sessionId: "s-main",
      messageId: "msg_s-main_4_assistant",
    });
    expect(
      memoRow(container, NAME.id)!.querySelector("button:not([aria-label])"),
    ).toBeNull();
  });

  it("has 删除 alone in its ⋯ menu: the row off at once under an undo toast, 撤销 back, Core told nothing", async () => {
    const { invoke } = getTauriMocks();
    const container = onMemoPage();
    const more = memoRow(container, CILANTRO.id)!.querySelector(
      'button[aria-label="更多"]',
    )!;
    await act(async () => {
      more.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    await settle();
    expect(menuRows()).toEqual(["删除"]);
    expect(
      document.querySelectorAll(`${MENU} [role="separator"]`),
    ).toHaveLength(0);
    const item = document.querySelector<HTMLElement>(
      `${MENU} [role="menuitem"]`,
    )!;
    await act(async () => item.click());
    await settle();

    expect(memoRow(container, CILANTRO.id)).toBeNull();
    expect(memoRow(container, NAME.id)).not.toBeNull();
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].title).toBe("已删除「你不吃香菜」");
    expect(invoke).not.toHaveBeenCalled();

    const toast = toasts()[0];
    await act(async () => {
      if (toast.action?.kind === "undo") toast.action.run();
    });
    expect(memoRow(container, CILANTRO.id)).not.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("opens the same menu on a right-click", async () => {
    const container = onMemoPage();
    await act(async () => {
      memoRow(container, NAME.id)!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    await settle();
    expect(menuRows()).toEqual(["删除"]);
  });

  it("asks Core once the toast goes; refused, it is back with the reason", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "delete_memo") {
        throw JSON.stringify({ error: "db_unavailable", message: "busy" });
      }
      if (command === "list_memos") return [CILANTRO, NAME];
      if (command === "list_memo_events") return [NOTED];
      return undefined;
    });
    const container = onMemoPage();
    act(() => useMemoStore.getState().deleteMemo(CILANTRO));
    expect(memoRow(container, CILANTRO.id)).toBeNull();
    const toast = toasts()[0];
    await act(async () => {
      toast.onClose?.();
      useUiStore.getState().dismissToast(toast.id);
    });
    await settle();
    expect(invoke).toHaveBeenCalledWith("delete_memo", { id: CILANTRO.id });
    expect(
      memoRow(container, CILANTRO.id)?.querySelector('[role="alert"]')
        ?.textContent,
    ).toBe("没能完成，再试一次。");
  });
});
