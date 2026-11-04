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

import { CopyProvider } from "@/lib/i18n";
import type { SidebarSubtasks } from "@/lib/sidebar-subtasks";

import { SidebarSubtaskRows } from "./SidebarSubtaskRows";

/**
 * The rows under Galley's card, pressed for real (main chat ticket 128):
 * a row opens its subtask on pointerdown as a session row does, the
 * click after it swallowed, Enter and Space as any button; 「还有 N 件在
 * 办」 unfolds the rest in place and becomes 「收起」 (ruling 197 point 4,
 * ticket 146). Where they stand and how they draw is
 * Sidebar.subtask-rows.test.tsx; the sidebar holding it unfolded,
 * Sidebar.subtask-more.dom.test.tsx.
 */

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const LIST: SidebarSubtasks = {
  rows: [
    { id: "s-ask", title: "比较三款扫地机器人的价格", state: "asking" },
    { id: "s-run", title: "整理下载文件夹里的发票", state: "running" },
  ],
  more: [
    { id: "s-r6", title: "查周六的船票", state: "running" },
    { id: "s-r7", title: "订周日的餐厅", state: "running" },
  ],
};

function mount(props: {
  subtasks?: SidebarSubtasks;
  unfolded?: boolean;
  onToggleMore?: () => void;
  activeId?: string;
  onOpen?: (id: string) => void;
}) {
  act(() =>
    root.render(
      <CopyProvider language="zh-CN">
        <SidebarSubtaskRows
          subtasks={props.subtasks ?? LIST}
          onToggleMore={() => {}}
          {...props}
        />
      </CopyProvider>,
    ),
  );
}

const row = (id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-subtask-id="${id}"]`)!;
const more = () =>
  host.querySelector<HTMLElement>('[data-role="sidebar-subtasks-more"]')!;

function press(el: HTMLElement, init: PointerEventInit = {}) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, ...init }),
    );
  });
  act(() => {
    el.click();
  });
}

describe("a row", () => {
  it("opens its subtask on pointerdown, once: the click after it is swallowed", () => {
    const onOpen = vi.fn();
    mount({ onOpen });
    press(row("s-run"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("s-run");
  });

  it("opens on a click without a press (Enter, Space)", () => {
    const onOpen = vi.fn();
    mount({ onOpen });
    act(() => row("s-ask").click());
    expect(onOpen).toHaveBeenCalledWith("s-ask");
  });

  it("leaves a secondary press and a Ctrl-press alone", () => {
    const onOpen = vi.fn();
    mount({ onOpen });
    act(() => {
      row("s-run").dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 2 }),
      );
      row("s-run").dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: true,
        }),
      );
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does nothing without a way to open", () => {
    mount({});
    expect(() => press(row("s-run"))).not.toThrow();
  });

  it("pops its glyph on entering a question, not for the state it mounted in", () => {
    mount({ onOpen: vi.fn() });
    const glyph = (id: string) => row(id).firstElementChild!;
    expect(glyph("s-ask").className).not.toContain("sidebar-state-pop");
    mount({
      onOpen: vi.fn(),
      subtasks: {
        rows: [
          { id: "s-run", title: "整理下载文件夹里的发票", state: "asking" },
          { id: "s-ask", title: "比较三款扫地机器人的价格", state: "asking" },
        ],
        more: [],
      },
    });
    expect(glyph("s-run").className).toContain("sidebar-state-pop");
    expect(glyph("s-ask").className).not.toContain("sidebar-state-pop");
  });
});

describe("「还有 N 件在办」 (ruling 197 point 4)", () => {
  const drawn = () =>
    Array.from(
      host.querySelectorAll<HTMLElement>('[data-role="sidebar-subtask"]'),
    ).map((el) => el.dataset.subtaskId);

  it("folded, draws the rows but the ones it stands for, and asks to unfold", () => {
    const onToggleMore = vi.fn();
    mount({ onToggleMore });
    expect(drawn()).toEqual(["s-ask", "s-run"]);
    expect(more().textContent).toBe("还有 2 件在办");
    expect(more().getAttribute("aria-expanded")).toBe("false");
    act(() => more().click());
    expect(onToggleMore).toHaveBeenCalledTimes(1);
  });

  it("unfolded, draws them after the rest, and becomes 「收起」", () => {
    const onToggleMore = vi.fn();
    mount({ onToggleMore, unfolded: true });
    expect(drawn()).toEqual(["s-ask", "s-run", "s-r6", "s-r7"]);
    expect(more().textContent).toBe("收起");
    expect(more().getAttribute("aria-expanded")).toBe("true");
    act(() => more().click());
    expect(onToggleMore).toHaveBeenCalledTimes(1);
  });

  it("an unfolded row opens and is selected as any other", () => {
    const onOpen = vi.fn();
    mount({ onOpen, unfolded: true, activeId: "s-r7" });
    expect(row("s-r7").getAttribute("aria-current")).toBe("page");
    press(row("s-r6"));
    expect(onOpen).toHaveBeenCalledWith("s-r6");
  });

  it("is not there with nothing past five, unfolded or not", () => {
    for (const unfolded of [false, true]) {
      mount({ unfolded, subtasks: { rows: LIST.rows, more: [] } });
      expect(more()).toBeNull();
      expect(drawn()).toEqual(["s-ask", "s-run"]);
    }
  });
});
