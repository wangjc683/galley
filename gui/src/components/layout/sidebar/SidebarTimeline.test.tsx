import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildSidebarSections,
  type SidebarSections,
} from "@/lib/sidebar-timeline";
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

// 「静」 has gone quiet past the window: one of the 其他项目.
const quiet = {
  ...project,
  id: "q",
  name: "静",
  lastActivityAt: ago(90),
  createdAt: ago(90),
  updatedAt: ago(90),
} as Project;

const sections = buildSidebarSections(
  [
    session("x"),
    session("pinned", { pinned: true }),
    session("p1", { projectId: "p" }),
    session("p2", { projectId: "p" }),
    session("q1", { projectId: "q", lastActivityAt: ago(60) }),
  ],
  [project, quiet],
  { now: NOW },
);

function render(
  opts: {
    activeId?: string;
    collapsed?: boolean;
    othersOpen?: boolean;
    sections?: SidebarSections;
  } = {},
) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <SidebarSectionsList
        sections={opts.sections ?? sections}
        projectsCollapsed={opts.collapsed ?? false}
        onToggleProjectsCollapsed={() => {}}
        othersOpen={opts.othersOpen ?? false}
        onToggleOthers={() => {}}
        groupWiring={{ expandedProjectIds: new Set() }}
        activeId={opts.activeId}
        projects={[project, quiet]}
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

  it("closes the section with 其他项目, its groups behind it", () => {
    const html = render();
    expect(html.indexOf(">其他项目<")).toBeGreaterThan(
      html.indexOf('data-project-id="p"'),
    );
    expect(html).toContain('aria-label="其他 1 个项目"');
    expect(html).not.toContain('data-project-id="q"');
    // Shut, it hangs the selected session of a quiet project, once.
    const selected = render({ activeId: "q1" });
    expect(occurrences(selected, 'data-session-id="q1"')).toBe(1);
    expect(render({ othersOpen: true })).toContain('data-project-id="q"');
  });

  it("keeps the section for 其他项目 alone, with no 0 on its header", () => {
    const html = render({
      // x keeps the window non-empty (an empty one backfills 最近).
      sections: buildSidebarSections(
        [
          session("x"),
          session("q1", { projectId: "q", lastActivityAt: ago(60) }),
        ],
        [quiet],
        { now: NOW },
      ),
    });
    expect(html).toContain(">项目<");
    expect(html).toContain(">其他项目<");
    expect(html).not.toMatch(/>0</);
  });
});
