// @vitest-environment jsdom
import { act, type ReactNode } from "react";
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

import { EMPTY_TODO, type TodoItem } from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

import { TodoToggleButton } from "./TodoToggleButton";

/**
 * The 待办 button mounted for real (main chat ticket 104, PRD ruling 150;
 * the capsule kept by ticket 106, ruling 152): a capsule whose title is
 * cut writes the row in full in its tooltip. The tooltip is stood in by
 * an attribute (Radix draws its content only while open); today is
 * fixed, the list is the to-do store's.
 */

/** A title of 30 characters, cut in a capsule of 220px at most. */
const LONG_TITLE =
  "把第三季度各区域的销售数据整理成表格发给财务部审核并签字确认";

/** Today, 28 October 2026, at 15:00. */
const LONG: TodoItem = {
  kind: "todo",
  id: "long",
  text: LONG_TITLE,
  state: "open",
  createdBy: "assistant",
  due: {
    date: "2026-10-28",
    hasTime: true,
    at: new Date(2026, 9, 28, 15).toISOString(),
    time: "15:00",
  },
};

vi.mock("@/hooks/useDayStamp", () => ({
  useDayStamp: () => new Date(2026, 9, 28).getTime(),
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipLabel: ({ text, children }: { text: string; children: ReactNode }) => (
    <span data-tip={text}>{children}</span>
  ),
}));

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
  act(() => useAssistantTodoStore.setState({ todo: EMPTY_TODO }));
});

function mount() {
  act(() =>
    root.render(
      <CopyProvider language="zh-CN">
        <TodoToggleButton open={false} onToggle={() => {}} />
      </CopyProvider>,
    ),
  );
}

const button = () =>
  host.querySelector<HTMLButtonElement>('[data-role="topbar-todo"]')!;

describe("the capsule's tooltip", () => {
  it("writes the row in full while the title is cut, else what the button opens", () => {
    act(() =>
      useAssistantTodoStore.setState({
        todo: {
          ...EMPTY_TODO,
          yours: { today: [LONG], later: [], anytime: [] },
          todayCount: 1,
        },
      }),
    );
    mount();
    expect(button().dataset.shape).toBe("capsule");
    const tip = () =>
      host.querySelector("[data-tip]")!.getAttribute("data-tip");
    const title = host.querySelector<HTMLElement>(
      "[data-capsule-body] .truncate",
    )!;
    const widths = (scroll: number, client: number) => {
      Object.defineProperty(title, "scrollWidth", {
        value: scroll,
        configurable: true,
      });
      Object.defineProperty(title, "clientWidth", {
        value: client,
        configurable: true,
      });
    };
    expect(tip()).toBe("待办与备忘 · 今天 1");
    // Its accessible name says the row whether cut or not.
    expect(button().getAttribute("aria-label")).toBe(
      `待办与备忘 · 今天 15:00 · ${LONG_TITLE}`,
    );

    widths(360, 120);
    act(() => button().focus());
    expect(tip()).toBe(`待办与备忘 · 今天 15:00 · ${LONG_TITLE}`);

    widths(100, 120);
    act(() => {
      button().blur();
      button().focus();
    });
    expect(tip()).toBe("待办与备忘 · 今天 1");
  });
});
