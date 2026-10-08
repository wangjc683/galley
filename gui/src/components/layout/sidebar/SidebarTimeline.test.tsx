import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildSidebarSections } from "@/lib/sidebar-timeline";
import type { Project, Session } from "@/types/session";

import { SidebarSectionsList } from "./SidebarTimeline";

// useCopy falls back to the zh copy without a CopyProvider.

const NOW = new Date("2026-10-08T12:00:00");
const ago = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 3600 * 1000).toISOString();

const session = (id: string, extra: Partial<Session> = {}): Session =>
  ({
    id,
    title: `title-${id}`,
    status: "idle",
    errorCount: 0,
    lastActivityAt: ago(0),
    createdAt: ago(0),
    updatedAt: ago(0),
    ...extra,
  }) as Session;

const project = {
  id: "p",
  name: "回归",
  workspaceEnabled: false,
  pinned: false,
  lastActivityAt: ago(5),
  createdAt: ago(5),
  updatedAt: ago(5),
} as Project;

const sections = buildSidebarSections(
  [
    session("x"),
    session("pinned", { pinned: true }),
    session("p1", { projectId: "p" }),
    session("p2", { projectId: "p" }),
  ],
  [project],
  { now: NOW },
);

function render(
  opts: {
    activeId?: string;
    collapsed?: boolean;
  } = {},
) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <SidebarSectionsList
        sections={sections}
        projectsCollapsed={opts.collapsed ?? false}
        onToggleProjectsCollapsed={() => {}}
        groupWiring={{ expandedProjectIds: new Set() }}
        activeId={opts.activeId}
        projects={[project]}
        onConfirmRename={() => {}}
        onCancelRename={() => {}}
      />
    </Tooltip.Provider>,
  );
}

const occurrences = (html: string, needle: string) =>
  html.split(needle).length - 1;

describe("SidebarSectionsList", () => {
  it("lists 置顶, then 项目, then the time buckets", () => {
    const html = render();
    const pinned = html.indexOf(">置顶<");
    const projects = html.indexOf(">项目<");
    const today = html.indexOf(">今天<");
    expect(pinned).toBeGreaterThan(-1);
    expect(projects).toBeGreaterThan(pinned);
    expect(today).toBeGreaterThan(projects);
    // 今天 lists only the session outside the project.
    expect(occurrences(html, 'data-session-id="x"')).toBe(1);
  });

  it("hangs the selected project session under a collapsed section, once", () => {
    const html = render({ collapsed: true, activeId: "p2" });
    expect(html).not.toContain("data-project-id");
    expect(occurrences(html, 'data-session-id="p2"')).toBe(1);
    expect(occurrences(html, 'data-session-id="p1"')).toBe(0);
    expect(html).toContain('aria-expanded="false"');
  });

  it("shows the groups when open, each session still mounted once", () => {
    const html = render({ activeId: "p2" });
    expect(occurrences(html, 'data-project-id="p"')).toBe(1);
    expect(occurrences(html, 'data-session-id="p2"')).toBe(1);
    expect(occurrences(html, 'data-session-id="p1"')).toBe(1);
  });
});
