import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Project, Session } from "@/types/session";

import { SidebarProjectGroup } from "./SidebarProjectGroup";

// useCopy falls back to the zh copy without a CopyProvider.

// Static rendering reads the stores' initial state, so a session's
// erroring bridge can't be seeded there; mark ids as needing the user
// on top of the real hook instead.
const needsYou = vi.hoisted(() => new Set<string>());
vi.mock("@/hooks/useSessionsAttention", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useSessionsAttention")>();
  return {
    ...actual,
    useSessionsAttention: (
      ...args: Parameters<typeof actual.useSessionsAttention>
    ) => {
      const view = actual.useSessionsAttention(...args);
      return {
        ...view,
        needsYouIds: new Set([...view.needsYouIds, ...needsYou]),
      };
    },
  };
});

const session = (id: string, extra: Partial<Session> = {}): Session =>
  ({
    id,
    title: `title-${id}`,
    status: "idle",
    errorCount: 0,
    lastActivityAt: "2026-10-07T12:00:00.000Z",
    createdAt: "2026-10-07T12:00:00.000Z",
    updatedAt: "2026-10-07T12:00:00.000Z",
    ...extra,
  }) as Session;

const project = {
  id: "p",
  name: "回归",
  workspaceEnabled: false,
  pinned: false,
  lastActivityAt: "2026-10-01T00:00:00.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
} as Project;

function render(
  opts: {
    expanded?: boolean;
    activeId?: string;
    sessions?: Session[];
    olderSessions?: Session[];
    defaultOlderOpen?: boolean;
  } = {},
) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <SidebarProjectGroup
        project={project}
        sessions={opts.sessions ?? [session("a"), session("b"), session("c")]}
        olderSessions={opts.olderSessions ?? []}
        defaultOlderOpen={opts.defaultOlderOpen}
        expanded={opts.expanded ?? false}
        activeId={opts.activeId}
        projects={[project]}
        onConfirmRename={() => {}}
        onCancelRename={() => {}}
      />
    </Tooltip.Provider>,
  );
}

const occurrences = (html: string, id: string) =>
  html.split(`data-session-id="${id}"`).length - 1;
const at = (html: string, id: string) =>
  html.indexOf(`data-session-id="${id}"`);

describe("SidebarProjectGroup", () => {
  it("hangs the selected session under a collapsed group, mounted once", () => {
    const html = render({ activeId: "b" });
    expect(occurrences(html, "b")).toBe(1);
    // The others stay mounted (zero height) inside the collapsed drawer.
    expect(occurrences(html, "a")).toBe(1);
    const drawerStart = html.indexOf("data-collapsed-drawer");
    expect(at(html, "b")).toBeGreaterThan(at(html, "c"));
    expect(drawerStart).toBeGreaterThan(-1);
  });

  it("lists every session once when expanded", () => {
    const html = render({ expanded: true, activeId: "b" });
    for (const id of ["a", "b", "c"]) expect(occurrences(html, id)).toBe(1);
    expect(html).not.toContain("data-collapsed-drawer");
  });

  it("closes the list with 显示更多 and the hidden count, borrowed rows above it", () => {
    needsYou.add("o2");
    const html = render({
      expanded: true,
      activeId: "o3",
      olderSessions: [
        session("o1"),
        session("o2"),
        session("o3"),
        session("o4"),
      ],
    });
    needsYou.clear();
    // The tail's needs-you and selected sessions show; the rest hide.
    for (const id of ["o2", "o3"]) expect(occurrences(html, id)).toBe(1);
    for (const id of ["o1", "o4"]) expect(occurrences(html, id)).toBe(0);
    // Borrowed rows follow the newest ones, above 显示更多.
    const more = html.indexOf(">显示更多<");
    expect(at(html, "o2")).toBeGreaterThan(at(html, "c"));
    expect(more).toBeGreaterThan(at(html, "o3"));
    // The count leaves the borrowed two out, and the row ends the group.
    expect(html).toContain('aria-label="再显示 2 个对话"');
    expect(html.slice(more)).toContain('tabular-nums">2<');
    expect(html.indexOf("data-session-id", more)).toBe(-1);
    expect(html).not.toContain(">收起<");
  });

  it("drops 显示更多 when every tail session is borrowed", () => {
    const html = render({
      expanded: true,
      activeId: "old",
      olderSessions: [session("old")],
    });
    expect(occurrences(html, "old")).toBe(1);
    expect(html).not.toContain(">显示更多<");
  });

  it("appends the tail after the newest sessions and ends with 收起 when open", () => {
    const html = render({
      expanded: true,
      defaultOlderOpen: true,
      olderSessions: [session("o1"), session("o2")],
    });
    const order = ["a", "b", "c", "o1", "o2"].map((id) => at(html, id));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(order[0]).toBeGreaterThan(-1);
    const less = html.indexOf(">收起<");
    expect(less).toBeGreaterThan(at(html, "o2"));
    expect(html.indexOf("data-session-id", less)).toBe(-1);
    expect(html).not.toContain(">显示更多<");
  });

  it("draws the project row on one line with the total, no summary", () => {
    const html = render();
    const row = html.slice(0, html.indexOf("data-collapsed-drawer"));
    expect(row).toContain("min-h-9");
    expect(row).toContain(">回归<");
    expect(row).toContain(">3</span>");
    // No second line: state rides the rail, weight and folder pop.
    expect(row).not.toMatch(/共|个/);
    expect(row).not.toContain("mt-0.5");
  });

  it("draws drawer, borrowed and hung rows on one line, no subline", () => {
    const withRecap = (id: string) => session(id, { summary: `recap-${id}` });
    const sessions = ["a", "b", "c"].map(withRecap);
    const olderSessions = ["o1", "o2"].map(withRecap);
    const rows = (html: string) => html.split('data-session-id="').length - 1;
    // Open, tail open: every row in the drawer.
    const open = render({
      expanded: true,
      defaultOlderOpen: true,
      sessions,
      olderSessions,
    });
    // Open, tail shut: o2 borrowed above 显示更多.
    const borrowed = render({
      expanded: true,
      activeId: "o2",
      sessions,
      olderSessions,
    });
    // Collapsed: b hung under the row, a / c in the shut drawer.
    const hung = render({ activeId: "b", sessions, olderSessions });
    for (const [html, count] of [
      [open, 5],
      [borrowed, 4],
      [hung, 3],
    ] as const) {
      expect(html).not.toContain("recap-");
      expect(rows(html)).toBe(count);
      expect(html.split("min-h-8").length - 1).toBe(count);
    }
  });
});
