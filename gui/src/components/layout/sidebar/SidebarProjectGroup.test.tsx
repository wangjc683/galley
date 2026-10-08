import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Project, Session } from "@/types/session";

import { SidebarProjectGroup } from "./SidebarProjectGroup";

// useCopy falls back to the zh copy without a CopyProvider.

const session = (id: string): Session =>
  ({
    id,
    title: `title-${id}`,
    status: "idle",
    errorCount: 0,
    lastActivityAt: "2026-10-07T12:00:00.000Z",
    createdAt: "2026-10-07T12:00:00.000Z",
    updatedAt: "2026-10-07T12:00:00.000Z",
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
    olderSessions?: Session[];
  } = {},
) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <SidebarProjectGroup
        project={project}
        sessions={[session("a"), session("b"), session("c")]}
        olderSessions={opts.olderSessions ?? []}
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

describe("SidebarProjectGroup", () => {
  it("hangs the selected session under a collapsed group, mounted once", () => {
    const html = render({ activeId: "b" });
    expect(occurrences(html, "b")).toBe(1);
    // The others stay mounted (zero height) inside the collapsed drawer.
    expect(occurrences(html, "a")).toBe(1);
    const drawerStart = html.indexOf("data-collapsed-drawer");
    expect(html.indexOf('data-session-id="b"')).toBeGreaterThan(
      html.indexOf('data-session-id="c"'),
    );
    expect(drawerStart).toBeGreaterThan(-1);
  });

  it("lists every session once when expanded", () => {
    const html = render({ expanded: true, activeId: "b" });
    for (const id of ["a", "b", "c"]) expect(occurrences(html, id)).toBe(1);
    expect(html).not.toContain("data-collapsed-drawer");
  });

  it("borrows the selected older session above the shut tail", () => {
    const html = render({
      expanded: true,
      activeId: "old",
      olderSessions: [session("old"), session("older")],
    });
    expect(occurrences(html, "old")).toBe(1);
    expect(occurrences(html, "older")).toBe(0);
    expect(html).toContain("更早 2 个");
  });

  it("writes the summary on the row's second line", () => {
    expect(render()).toContain(">共 3 个对话<");
  });
});
