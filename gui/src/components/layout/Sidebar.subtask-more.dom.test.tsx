// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
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
import { CopyProvider } from "@/lib/i18n";
import { useUiStore } from "@/stores/ui";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import type { Session } from "@/types/session";

import { Sidebar } from "./Sidebar";

/**
 * 「还有 N 件在办」 under Galley's card, pressed for real (main chat PRD
 * ruling 197 point 4, ticket 146): with seven subtasks running, the two
 * past five unfold in place under the others and the row becomes
 * 「收起」, which folds them again — the to-do panel is not touched (until
 * ruling 197 it opened with them lit; it lists no subtask now). The
 * sidebar holds it unfolded: a subtask open in the main area is its
 * row's to select once drawn, the card's while folded away.
 */

// Galley's group of Core's list, seeded through the real grouping, as in
// Sidebar.subtask-rows.test.tsx.
const todo = vi.hoisted(() => ({ items: [] as TodoItem[] }));
vi.mock("@/hooks/useSidebarSubtasks", async () => {
  const { sidebarSubtasks } = await import("@/lib/sidebar-subtasks");
  return {
    useSidebarSubtasks: (subtasks: Session[]) =>
      sidebarSubtasks(todo.items, subtasks),
  };
});

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom has no CSS.escape (the sidebar scrolls the active row into
  // view by its id); the card reads the main chat's dispatch records
  // once: none.
  if (typeof CSS === "undefined" || !CSS.escape) {
    vi.stubGlobal("CSS", { escape: (s: string) => s });
  }
  getTauriMocks().invoke.mockImplementation(async (command) =>
    command === "list_subtask_dispatches" ? [] : undefined,
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  todo.items = [];
  vi.unstubAllGlobals();
});

const managed = (id: string, extra: Partial<Session> = {}) =>
  makeSession({
    id,
    title: `title-${id}`,
    gaRuntimeKind: "managed",
    runtimeKind: "managed",
    ...extra,
  });

const mainChat = managed("s-main", { title: "Galley", mainChat: true });
const seven = Array.from({ length: 7 }, (_, i) =>
  managed(`s-r${i}`, {
    title: `差事 ${i}`,
    origin: { via: "subtask" },
    parentSessionId: "s-main",
    createdAt: new Date(Date.UTC(2026, 10, 4, 8, i)).toISOString(),
  }),
);

function mount(activeId?: string) {
  todo.items = seven.map((s) => ({
    kind: "subtask",
    id: s.id,
    text: s.title,
    state: "running",
    createdBy: "assistant",
  }));
  act(() =>
    root.render(
      <CopyProvider language="zh-CN">
        <Tooltip.Provider>
          <Sidebar
            sessions={[mainChat, ...seven]}
            activeId={activeId}
            expandedProjectIds={[]}
            onNewChat={() => {}}
            onSelectSession={() => {}}
            onArchiveSession={() => {}}
          />
        </Tooltip.Provider>
      </CopyProvider>,
    ),
  );
}

const drawn = () =>
  Array.from(
    host.querySelectorAll<HTMLElement>('[data-role="sidebar-subtask"]'),
  ).map((el) => el.dataset.subtaskId);
const more = () =>
  host.querySelector<HTMLButtonElement>('[data-role="sidebar-subtasks-more"]')!;
const selected = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[aria-current="page"]')).map(
    (el) => el.dataset.subtaskId ?? el.dataset.role,
  );

describe("「还有 N 件在办」 with seven running", () => {
  it("unfolds the two in place, becomes 「收起」, folds them again, and opens no panel", () => {
    const ui = useUiStore.getState();
    const before = {
      open: ui.todoPanelOpen,
      glance: ui.todoGlance,
      rows: ui.todoRowRequest,
      page: ui.todoPageRequest,
    };
    mount();
    const five = ["s-r0", "s-r1", "s-r2", "s-r3", "s-r4"];
    expect(drawn()).toEqual(five);
    expect(more().textContent).toBe("还有 2 件在办");

    act(() => more().click());
    expect(drawn()).toEqual([...five, "s-r5", "s-r6"]);
    expect(more().textContent).toBe("收起");
    expect(more().getAttribute("aria-expanded")).toBe("true");

    act(() => more().click());
    expect(drawn()).toEqual(five);
    expect(more().textContent).toBe("还有 2 件在办");

    // The to-do panel was never asked for: not opened, not looked at, no
    // rows lit, no page turned.
    const after = useUiStore.getState();
    expect(after.todoPanelOpen).toEqual(before.open);
    expect(after.todoGlance).toBe(before.glance);
    expect(after.todoRowRequest).toBe(before.rows);
    expect(after.todoPageRequest).toBe(before.page);
  });

  it("selects an open subtask's row once unfolded, the card while it is folded away", () => {
    mount("s-r6");
    expect(selected()).toEqual(["assistant-card"]);
    act(() => more().click());
    expect(selected()).toEqual(["s-r6"]);
    act(() => more().click());
    expect(selected()).toEqual(["assistant-card"]);
  });
});
