import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  buildSidebarSections,
  type SidebarSections,
} from "@/lib/sidebar-timeline";
import type { Project, Session } from "@/types/session";

import { SidebarSectionsList } from "./SidebarTimeline";

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

// 「静」 and 「眠」 have gone quiet past the window: behind 更多项目.
const quiet = {
  ...project,
  id: "q",
  name: "静",
  lastActivityAt: ago(90),
  createdAt: ago(90),
  updatedAt: ago(90),
} as Project;
const dormant = { ...quiet, id: "r", name: "眠" } as Project;

// Every session carries a recap, so a two-line row shows it and a
// single-line one doesn't.
const recap = (id: string, extra: Partial<Session> = {}) =>
  session(id, { summary: `recap-${id}`, ...extra });

const sections = buildSidebarSections(
  [
    recap("x"),
    recap("pinned", { pinned: true }),
    recap("p1", { projectId: "p" }),
    recap("p2", { projectId: "p" }),
    recap("q1", { projectId: "q", lastActivityAt: ago(60) }),
    recap("r1", { projectId: "r", lastActivityAt: ago(70) }),
  ],
  [project, quiet, dormant],
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
        projects={[project, quiet, dormant]}
        onConfirmRename={() => {}}
        onCancelRename={() => {}}
      />
    </Tooltip.Provider>,
  );
}

const occurrences = (html: string, needle: string) =>
  html.split(needle).length - 1;
const groupAt = (html: string, id: string) =>
  html.indexOf(`data-project-id="${id}"`);

describe("SidebarSectionsList", () => {
  it("lists 置顶, then 项目, then the time buckets", () => {
    const html = render();
    const pinned = html.indexOf(">置顶<");
    const projects = html.indexOf(">项目<");
    const today = html.indexOf(">今天<");
    expect(pinned).toBeGreaterThan(-1);
    expect(projects).toBeGreaterThan(pinned);
    expect(today).toBeGreaterThan(projects);
    // 今天 lists only the session outside the project, on two lines.
    expect(occurrences(html, 'data-session-id="x"')).toBe(1);
    expect(html).toContain(">recap-x<");
  });

  it("hangs the selected project session under a collapsed section, once", () => {
    const html = render({ collapsed: true, activeId: "p2" });
    expect(html).not.toContain("data-project-id");
    expect(occurrences(html, 'data-session-id="p2"')).toBe(1);
    expect(occurrences(html, 'data-session-id="p1"')).toBe(0);
    expect(html).toContain('aria-expanded="false"');
    // A plain two-line row under the header, like a time bucket's.
    expect(html).toContain(">recap-p2<");
  });

  it("shows the groups when open, each session still mounted once", () => {
    const html = render({ activeId: "p2" });
    expect(occurrences(html, 'data-project-id="p"')).toBe(1);
    expect(occurrences(html, 'data-session-id="p2"')).toBe(1);
    expect(occurrences(html, 'data-session-id="p1"')).toBe(1);
    // In its group, hung or in the shut drawer: one line.
    expect(html).not.toContain("recap-p1");
    expect(html).not.toContain("recap-p2");
  });

  it("closes the section with 更多项目 and the hidden count", () => {
    const html = render();
    const more = html.indexOf(">更多项目<");
    expect(more).toBeGreaterThan(groupAt(html, "p"));
    expect(more).toBeLessThan(html.indexOf(">今天<"));
    expect(html).toContain('aria-label="再显示 2 个项目"');
    expect(html.slice(more)).toContain('tabular-nums">2<');
    expect(groupAt(html, "q")).toBe(-1);
    expect(groupAt(html, "r")).toBe(-1);
    // No project group after it.
    expect(html.indexOf("data-project-id", more)).toBe(-1);
  });

  it("lends a quiet project's group row to a session that needs you", () => {
    needsYou.add("q1");
    const html = render();
    needsYou.clear();
    const more = html.indexOf(">更多项目<");
    // q's whole group row shows above 更多项目, its session hung under
    // it on one line; r stays behind, and the count leaves q out.
    expect(groupAt(html, "q")).toBeGreaterThan(groupAt(html, "p"));
    expect(groupAt(html, "q")).toBeLessThan(more);
    expect(occurrences(html, 'data-session-id="q1"')).toBe(1);
    expect(html.indexOf('data-session-id="q1"')).toBeGreaterThan(
      groupAt(html, "q"),
    );
    expect(html).not.toContain("recap-q1");
    expect(groupAt(html, "r")).toBe(-1);
    expect(html).toContain('aria-label="再显示 1 个项目"');
    // The selected session lends its project's row the same way.
    const selected = render({ activeId: "r1" });
    expect(groupAt(selected, "r")).toBeGreaterThan(-1);
    expect(groupAt(selected, "q")).toBe(-1);
    expect(occurrences(selected, 'data-session-id="r1"')).toBe(1);
  });

  it("drops 更多项目 when every quiet project is borrowed", () => {
    needsYou.add("q1");
    const html = render({ activeId: "r1" });
    needsYou.clear();
    expect(groupAt(html, "q")).toBeGreaterThan(-1);
    expect(groupAt(html, "r")).toBeGreaterThan(-1);
    expect(html).not.toContain(">更多项目<");
  });

  it("lists every quiet project when open and ends with 收起", () => {
    const html = render({ othersOpen: true });
    const less = html.indexOf(">收起<");
    expect(groupAt(html, "q")).toBeGreaterThan(groupAt(html, "p"));
    expect(groupAt(html, "r")).toBeGreaterThan(groupAt(html, "q"));
    expect(less).toBeGreaterThan(groupAt(html, "r"));
    expect(html.indexOf("data-project-id", less)).toBe(-1);
    expect(html).not.toContain(">更多项目<");
  });

  it("keeps the section for 更多项目 alone, with no 0 on its header", () => {
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
    expect(html).toContain(">更多项目<");
    expect(html).not.toMatch(/>0</);
  });
});
